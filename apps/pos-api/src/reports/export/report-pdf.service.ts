import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { codedError } from '../../common/validation';
import type { Db } from '../../db/db.module';
import { InjectDb } from '../../db/db.module';
import { AGENT_LABEL } from '../../db/schema';
import {
  PROFIT_LOSS_LABELS,
  ProfitLossService,
} from '../../expenses/profit-loss.service';
import type { PeriodQuery } from '../../expenses/expenses.schemas';
import type { PosSession } from '../../tenancy/session';
import { ReceivablesReportService } from '../receivables-report.service';
import type { DateRange, ReceivableFilter } from '../reports.schemas';
import { ReportsService } from '../reports.service';
import {
  MAX_BYTES,
  MAX_TABLE_ROWS,
  withExportSlot,
} from '../pdf/export-limits';
import { cashDiff, dateLabel, dateTimeLabel, int, rp } from '../pdf/format';
import {
  PdfBuilder,
  PdfTooLargeError,
  type SummaryItem,
  type TableColumn,
} from '../pdf/pdf-document';
import { REPORT_DEFS, type ReportKind } from './report-defs';
import {
  periodLabel,
  SCALE_NAMES,
  type Scale,
  type TrendQuery,
} from './scales';
import { SalesExpensesService } from './trend.service';
import { ReportVisualsService } from './visuals.service';
import { visualIsEmpty } from '../visuals/types';

export interface PdfFile {
  filename: string;
  bytes: Buffer;
}

/** What goes into the "Penjualan dan pengeluaran" document (the dialog's three ticks). */
export interface TrendParts {
  summary: boolean;
  chart: boolean;
  table: boolean;
}

type Row = Record<string, unknown>;

const TOO_LARGE =
  'Laporan terlalu panjang untuk satu PDF. Persempit rentang tanggalnya, atau unduh CSV untuk semua baris.';

/**
 * Server-side report PDFs (design features 37 and 38, owner ruling 2026-11-26): A4, the store's name and address
 * in the header, the period, a summary, the screen's own charts, the table, and "Dicetak <waktu> oleh <nama>,
 * Halaman x dari y" in the footer. Every figure is the report service's, the charts are `ReportVisualsService`'s, so
 * the file says what the screen says. The file is built in memory and never stored. No customer phone number is
 * printed; customer names only where the report is about who owes (kasbon).
 */
@Injectable()
export class ReportPdfService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly reports: ReportsService,
    private readonly receivables: ReceivablesReportService,
    private readonly profitLoss: ProfitLossService,
    private readonly trend: SalesExpensesService,
    private readonly visuals: ReportVisualsService,
  ) {}

  private async identity(s: PosSession, tz: string) {
    const [[store], [who], [now]] = await Promise.all([
      this.db.execute(
        sql`select name, address from pos.store_profiles where tenant_id = ${s.tenantId}`,
      ),
      s.kind === 'cashier'
        ? this.db.execute(
            sql`select name from pos.staff where tenant_id = ${s.tenantId} and id = ${s.actorId}`,
          )
        : Promise.resolve([
            { name: s.kind === 'agent' ? AGENT_LABEL : 'Pemilik' },
          ]),
      this.db.execute(
        sql`select to_char(now() at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as t`,
      ),
    ]);
    const st = store as Row | undefined;
    return {
      storeName: (st?.name as string | undefined) ?? 'Toko',
      storeAddress: (st?.address as string | undefined) ?? undefined,
      actorName:
        ((who as Row | undefined)?.name as string | undefined) ?? 'Staf',
      generatedAt: dateTimeLabel((now as Row).t as string),
    };
  }

  private async finish(b: PdfBuilder): Promise<Buffer> {
    try {
      const bytes = await b.finish();
      if (bytes.length > MAX_BYTES) throw new PdfTooLargeError();
      return bytes;
    } catch (e) {
      if (e instanceof PdfTooLargeError)
        throw codedError('EXPORT_TOO_LARGE', '_', TOO_LARGE);
      throw e;
    }
  }

  /** Penjualan, Produk, Kasir (shift) and Pembelian: summary, pictures, rows. */
  async dated(
    kind: ReportKind,
    s: PosSession,
    range: DateRange,
  ): Promise<PdfFile> {
    return withExportSlot(async () => {
      const def = REPORT_DEFS[kind];
      const [r, visuals, tz] = await Promise.all([
        kind === 'sales'
          ? this.reports.sales(s.tenantId, range)
          : kind === 'products'
            ? this.reports.products(s.tenantId, range)
            : kind === 'shifts'
              ? this.reports.shifts(s.tenantId, range)
              : this.reports.purchasing(s.tenantId, range),
        kind === 'sales'
          ? this.visuals.sales(s.tenantId, range)
          : kind === 'products'
            ? this.visuals.products(s.tenantId, range)
            : kind === 'shifts'
              ? this.visuals.shifts(s.tenantId, range)
              : this.visuals.purchasing(s.tenantId, range),
        this.reports.timezone(s.tenantId),
      ]);
      const who = await this.identity(s, tz);
      const b = new PdfBuilder(
        {
          ...who,
          title: def.title,
          period: `${periodLabel('day', range.from, range.to)} · zona waktu ${tz}`,
        },
        { landscape: def.landscape },
      );
      const totals = r.totals as Record<string, number>;
      const fmt = (as: string, v: unknown) =>
        v == null
          ? '–'
          : as === 'rp'
            ? rp(Number(v))
            : as === 'int'
              ? int(Number(v))
              : as === 'diff'
                ? cashDiff(Number(v))
                : typeof v === 'string'
                  ? v
                  : '';
      b.summary(
        def.totals.map((t, i): SummaryItem => ({
          label: t.label,
          value: fmt(t.as, totals[t.key] ?? 0),
          strong: i === 0,
        })),
      );
      if (kind === 'sales' && totals.creditSales !== undefined)
        b.summary([
          { label: 'Lunas', value: rp(totals.settledSales ?? 0) },
          { label: 'Kasbon', value: rp(totals.creditSales ?? 0) },
          {
            label: 'Piutang dibayar (uang masuk, bukan penjualan baru)',
            value: rp(totals.receivablePaid ?? 0),
          },
        ]);
      for (const v of visuals) b.chart(v);
      const rows = r.rows as Row[];
      const shown = rows.slice(0, MAX_TABLE_ROWS);
      if (rows.length === 0) b.note('Belum ada data pada rentang ini.');
      else {
        b.table({
          title: 'Rincian',
          columns: def.columns.map((c): TableColumn => ({
            label: c.label,
            weight: c.weight,
            align: c.as === 'text' ? 'left' : 'right',
          })),
          rows: shown.map((x) => def.columns.map((c) => fmt(c.as, x[c.key]))),
        });
        if (rows.length > shown.length || ('truncated' in r && r.truncated))
          b.note(
            `Menampilkan ${int(shown.length)} baris pertama dari ${int(rows.length)}. Angka ringkasan mencakup semua baris; unduh CSV untuk semuanya.`,
          );
      }
      return {
        filename: `laporan-${def.slug}-${range.from}_${range.to}.pdf`,
        bytes: await this.finish(b),
      };
    });
  }

  async profit(s: PosSession, q: PeriodQuery): Promise<PdfFile> {
    return withExportSlot(async () => {
      const [r, visuals] = await Promise.all([
        this.profitLoss.report(s.tenantId, q),
        this.visuals.profit(s.tenantId, q),
      ]);
      const who = await this.identity(s, r.timezone);
      const c = r.current;
      const p = r.previous;
      const l = r.labels;
      const b = new PdfBuilder({
        ...who,
        title: 'Laporan untung rugi',
        period: `${periodLabel('day', c.from, c.to)} · dibanding ${periodLabel('day', p.from, p.to)} · zona waktu ${r.timezone}`,
      });
      b.summary([
        { label: l.netProfit, value: rp(c.netProfit), strong: true },
        {
          label: 'Perubahan untung bersih dari periode lalu',
          value: rp(r.netProfitChange),
        },
        { label: l.revenue, value: rp(c.revenue) },
        { label: l.cost, value: rp(c.cost) },
        { label: l.grossProfit, value: rp(c.grossProfit) },
        { label: l.shrinkage, value: rp(c.shrinkage) },
        { label: l.expenses, value: rp(c.expenses) },
      ]);
      for (const v of visuals) b.chart(v);
      const line = (label: string, a: number, z: number) => [
        label,
        rp(a),
        rp(z),
      ];
      b.table({
        title: 'Cara hitungnya',
        columns: [
          { label: 'Keterangan', weight: 4 },
          {
            label: `${dateLabel(c.from)} s.d. ${dateLabel(c.to)}`,
            weight: 2.4,
            align: 'right',
          },
          {
            label: `${dateLabel(p.from)} s.d. ${dateLabel(p.to)}`,
            weight: 2.4,
            align: 'right',
          },
        ],
        rows: [
          line(l.revenue, c.revenue, p.revenue),
          line(l.cost, c.cost, p.cost),
          line(l.grossProfit, c.grossProfit, p.grossProfit),
          line(l.shrinkage, c.shrinkage, p.shrinkage),
          line(l.expenses, c.expenses, p.expenses),
          line(l.netProfit, c.netProfit, p.netProfit),
          line(l.tax, c.tax, p.tax),
          line(l.rounding, c.rounding, p.rounding),
          line(l.supplierPayments, c.supplierPayments, p.supplierPayments),
          ...r.topExpenses.map((e) => [
            `Pengeluaran: ${e.label}`,
            rp(e.total),
            '–',
          ]),
        ],
      });
      b.note(
        `Pajak adalah uang titipan untuk disetor, jadi tidak dihitung sebagai hasil jualan maupun untung. ${PROFIT_LOSS_LABELS.supplierPayments}: modal barang sudah mencakup barang dari pemasok.`,
      );
      const stamp = r.period ?? `${c.from}_${c.to}`;
      return {
        filename: `laporan-untung-rugi-${stamp}.pdf`,
        bytes: await this.finish(b),
      };
    });
  }

  async kasbon(s: PosSession, filter: ReceivableFilter): Promise<PdfFile> {
    return withExportSlot(async () => {
      const [list, visuals, tz] = await Promise.all([
        this.receivables.list(s.tenantId, filter),
        this.visuals.receivablesVisuals(s.tenantId, filter),
        this.reports.timezone(s.tenantId),
      ]);
      const who = await this.identity(s, tz);
      const sum = list.summary;
      const b = new PdfBuilder({
        ...who,
        title: 'Laporan kasbon',
        period: `Per ${dateLabel(sum.today)} · ${filter === 'due' ? 'yang sudah jatuh tempo' : filter === 'not_due' ? 'yang belum jatuh tempo' : 'semua yang belum lunas'}`,
      });
      b.summary([
        { label: 'Total piutang', value: rp(sum.totalRest), strong: true },
        { label: 'Jatuh tempo', value: rp(sum.dueRest) },
        { label: 'Dibayar bulan ini', value: rp(sum.paidThisMonth) },
        { label: 'Dipegang penagih', value: rp(sum.collectorHeld) },
      ]);
      for (const v of visuals) b.chart(v);
      const status = (r: { status: string; overdueDays: number | null }) =>
        r.status === 'not_due' || r.overdueDays === null
          ? 'Belum jatuh tempo'
          : r.overdueDays === 0
            ? 'Jatuh tempo hari ini'
            : `Terlambat ${r.overdueDays} hari`;
      if (list.rows.length === 0) b.note('Belum ada kasbon yang belum lunas.');
      else {
        const shown = list.rows.slice(0, MAX_TABLE_ROWS);
        b.table({
          title: 'Pelanggan yang masih berhutang',
          columns: [
            { label: 'Pelanggan', weight: 3 },
            { label: 'Kasbon', weight: 1.7, align: 'right' },
            { label: 'Dibayar', weight: 1.7, align: 'right' },
            { label: 'Sisa', weight: 1.7, align: 'right' },
            { label: 'Jatuh tempo', weight: 1.6 },
            { label: 'Status', weight: 2.2 },
          ],
          rows: shown.map((r) => [
            r.name,
            rp(r.total),
            rp(r.paid),
            rp(r.rest),
            r.oldestDueDate ? dateLabel(r.oldestDueDate) : '–',
            status(r),
          ]),
        });
        if (list.rows.length > shown.length)
          b.note(
            `Menampilkan ${int(shown.length)} pelanggan pertama dari ${int(list.rows.length)}.`,
          );
      }
      return {
        filename: `laporan-kasbon-${sum.today}.pdf`,
        bytes: await this.finish(b),
      };
    });
  }

  /** "Penjualan dan pengeluaran": the report of design feature 37. */
  async trendPdf(
    s: PosSession,
    q: TrendQuery,
    parts: TrendParts,
  ): Promise<PdfFile> {
    return withExportSlot(async () => {
      const r = await this.trend.report(s.tenantId, q);
      const who = await this.identity(s, r.timezone);
      const scale = r.scale;
      const b = new PdfBuilder({
        ...who,
        title: 'Laporan penjualan dan pengeluaran',
        period: `${SCALE_NAMES[scale].adj} · ${r.periodLabel}`,
      });
      const t = r.totals;
      if (parts.summary)
        b.summary([
          {
            label: 'Penjualan (tanpa pajak)',
            value: rp(t.sales),
            strong: true,
          },
          { label: 'Harga pokok penjualan', value: rp(t.cost) },
          { label: 'Laba kotor', value: rp(t.grossProfit) },
          { label: 'Susut stok', value: rp(t.shrinkage) },
          { label: 'Pengeluaran', value: rp(t.expenses) },
          { label: 'Laba bersih', value: rp(t.netProfit), strong: true },
          { label: 'Pajak dikumpulkan (bukan pendapatan)', value: rp(t.tax) },
        ]);
      const empty = visualIsEmpty(r.visual);
      if (parts.chart) b.chart(r.visual);
      if (parts.table) {
        b.table({
          title: `Rincian ${SCALE_NAMES[scale].per}`,
          columns: [
            {
              label:
                scale === 'day'
                  ? 'Tanggal'
                  : scale === 'month'
                    ? 'Bulan'
                    : 'Tahun',
              weight: 3,
            },
            { label: 'Penjualan', weight: 2.2, align: 'right' },
            { label: 'Pengeluaran', weight: 2.2, align: 'right' },
          ],
          rows: r.buckets.map((x) => [
            bucketName(scale, x.key),
            rp(x.sales),
            rp(x.expenses),
          ]),
          totals: [['Total', rp(t.sales), rp(t.expenses)]],
        });
      }
      if (empty) b.note('Belum ada penjualan atau pengeluaran di periode ini.');
      if (r.partialLast)
        b.note(`Periode terakhir baru berjalan sampai ${dateLabel(r.to)}.`);
      b.note(
        'Penjualan dicatat tanpa pajak; pajak tampil terpisah. Void dan koreksi dicatat pada hari kejadian.',
      );
      return {
        filename: `laporan-penjualan-pengeluaran-${SCALE_NAMES[scale].adj.toLowerCase()}-${r.from}_${r.to}.pdf`,
        bytes: await this.finish(b),
      };
    });
  }
}

const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];
/** "Rab 20 Nov", "November 2026", "2026": the first column of the detail table. */
export function bucketName(scale: Scale, start: string): string {
  if (scale === 'year') return start.slice(0, 4);
  if (scale === 'month')
    return `${MONTH_NAMES[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;
  const dow = DAY_NAMES[new Date(`${start}T00:00:00Z`).getUTCDay()];
  return `${dow} ${dateLabel(start).slice(0, -5)}`;
}
