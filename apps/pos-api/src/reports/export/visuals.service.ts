import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/db.module';
import { InjectDb } from '../../db/db.module';
import { FINAL_SALE_STATUSES } from '../../db/schema';
import type { PeriodQuery } from '../../expenses/expenses.schemas';
import { ProfitLossService } from '../../expenses/profit-loss.service';
import { ReceivablesReportService } from '../receivables-report.service';
import type { DateRange, ReceivableFilter } from '../reports.schemas';
import { ReportsService } from '../reports.service';
import type { BarsVisual, SegmentsVisual, Visual } from './../visuals/types';
import { MONTHS } from './scales';
import { SalesExpensesService } from './trend.service';

const FINAL_LIST = sql.raw(FINAL_SALE_STATUSES.map((s) => `'${s}'`).join(', '));
type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** At most this many bars or parts; the rest are summed into "Lainnya" (guideline: five parts, grouped). */
const TOP = 5;
const TOP_WIDE = 8;

/** "24 Nov" from a store-local `YYYY-MM-DD` (with or without a time). */
const dayMonth = (d: string) =>
  `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

function ranked(
  rows: Array<{ label: string; value: number }>,
  max: number,
): Array<{ label: string; value: number }> {
  const sorted = rows
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  return [
    ...head,
    {
      label: 'Lainnya',
      value: sorted.slice(max - 1).reduce((a, r) => a + r.value, 0),
    },
  ];
}

function hbars(
  id: string,
  title: string,
  unit: 'rupiah' | 'count',
  label: string,
  rows: Array<{ label: string; value: number }>,
  categoryLabel: string,
): BarsVisual {
  return {
    id,
    kind: 'bars',
    title,
    unit,
    orientation: 'horizontal',
    categoryLabel,
    categories: rows.map((r) => r.label),
    series: [{ label, values: rows.map((r) => r.value), color: 1 }],
  };
}

/**
 * The pictures of the report screens (design feature 38) as data: pos-api decides what each one shows and with
 * which numbers, the screen and the PDF only draw it. Every figure comes from the report's own service, so a
 * picture and its table can never disagree. Read only; every query filters the session's tenant.
 */
@Injectable()
export class ReportVisualsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly reports: ReportsService,
    private readonly trend: SalesExpensesService,
    private readonly profitLoss: ProfitLossService,
    private readonly receivables: ReceivablesReportService,
  ) {}

  private async rows(q: SQL): Promise<Row[]> {
    return [...(await this.db.execute(q))] as Row[];
  }

  private bounds(r: DateRange, tz: string) {
    return {
      start: sql`((${r.from}::date)::timestamp at time zone ${tz})`,
      end: sql`(((${r.to}::date) + 1)::timestamp at time zone ${tz})`,
    };
  }

  /** Trend, payment methods and best sellers of a sales report. */
  async sales(tenantId: string, range: DateRange): Promise<Visual[]> {
    const tz = await this.reports.timezone(tenantId);
    const { start, end } = this.bounds(range, tz);
    const days =
      (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
    const scale = days <= 62 ? 'day' : 'month';
    const [buckets, methods, products] = await Promise.all([
      this.trend.between(tenantId, scale, range.from, range.to),
      this.rows(sql`
        select pm.name, sum(x.v) as v from (
          select s.payment_method_id as pmid, s.total as v from pos.sales s
           where s.tenant_id = ${tenantId} and s.status in (${FINAL_LIST}) and s.paid_at >= ${start} and s.paid_at < ${end}
          union all
          select s.payment_method_id, -v.total from pos.sale_voids v
            join pos.sales s on s.tenant_id = v.tenant_id and s.id = v.sale_id
           where v.tenant_id = ${tenantId} and v.created_at >= ${start} and v.created_at < ${end}) x
        join pos.payment_methods pm on pm.tenant_id = ${tenantId} and pm.id = x.pmid
        group by pm.name`),
      this.reports.products(tenantId, range),
    ]);
    const trendVisual: BarsVisual = {
      id: scale === 'day' ? 'tren-harian' : 'tren-bulanan',
      kind: 'bars',
      title:
        scale === 'day'
          ? 'Tren harian (tanpa pajak)'
          : 'Tren bulanan (tanpa pajak)',
      unit: 'rupiah',
      orientation: 'vertical',
      categoryLabel: scale === 'day' ? 'Hari' : 'Bulan',
      categories: buckets.map((b) => b.label),
      series: [
        { label: 'Penjualan', values: buckets.map((b) => b.sales), color: 1 },
      ],
    };
    const payment: SegmentsVisual = {
      id: 'cara-bayar',
      kind: 'segments',
      title: 'Cara bayar (jumlah dibayar pelanggan)',
      unit: 'rupiah',
      categoryLabel: 'Cara bayar',
      parts: ranked(
        methods.map((r) => ({ label: r.name as string, value: n(r.v) })),
        TOP,
      ),
    };
    const best = hbars(
      'produk-terlaris',
      'Produk terlaris (jumlah terjual)',
      'count',
      'Terjual',
      [...products.rows]
        .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
        .slice(0, TOP)
        .map((r) => ({ label: r.name, value: r.qty })),
      'Produk',
    );
    return [trendVisual, payment, best];
  }

  async products(tenantId: string, range: DateRange): Promise<Visual[]> {
    const r = await this.reports.products(tenantId, range);
    return [
      hbars(
        'penjualan-produk',
        'Penjualan per produk (8 teratas)',
        'rupiah',
        'Penjualan',
        r.rows
          .slice(0, TOP_WIDE)
          .map((x) => ({ label: x.name, value: x.sales })),
        'Produk',
      ),
      hbars(
        'laba-produk',
        'Laba kotor per produk (8 teratas)',
        'rupiah',
        'Laba kotor',
        [...r.rows]
          .sort((a, b) => b.grossProfit - a.grossProfit)
          .slice(0, TOP_WIDE)
          .map((x) => ({ label: x.name, value: x.grossProfit })),
        'Produk',
      ),
    ];
  }

  /** Revenue of the latest shifts of the range, one bar each. */
  async shifts(tenantId: string, range: DateRange): Promise<Visual[]> {
    const r = await this.reports.shifts(tenantId, range);
    const latest = r.rows.slice(-10);
    return [
      {
        ...hbars(
          'pendapatan-shift',
          'Pendapatan per shift (10 terakhir)',
          'rupiah',
          'Pendapatan',
          latest.map((x) => ({
            label: `${x.cashier} · ${dayMonth(x.openedAt)}`,
            value: x.revenue,
          })),
          'Shift',
        ),
        // A shift with no sales still has its row: the bars keep their order in time.
        categories: latest.map((x) => `${x.cashier} · ${dayMonth(x.openedAt)}`),
        series: [
          {
            label: 'Pendapatan',
            values: latest.map((x) => x.revenue),
            color: 1,
          },
        ],
      },
    ];
  }

  async purchasing(tenantId: string, range: DateRange): Promise<Visual[]> {
    const tz = await this.reports.timezone(tenantId);
    const { start, end } = this.bounds(range, tz);
    const rows = await this.rows(sql`
      select sup.name, sum(l.qty * l.unit_cost) as v
        from pos.purchase_order_lines l
        join pos.purchase_orders o on o.tenant_id = l.tenant_id and o.id = l.order_id
        join pos.suppliers sup on sup.tenant_id = o.tenant_id and sup.id = o.supplier_id
       where o.tenant_id = ${tenantId} and o.status = 'approved' and o.approved_at >= ${start} and o.approved_at < ${end}
       group by sup.name`);
    return [
      hbars(
        'pembelian-pemasok',
        'Pembelian per pemasok',
        'rupiah',
        'Pembelian',
        ranked(
          rows.map((r) => ({ label: r.name as string, value: n(r.v) })),
          TOP_WIDE,
        ),
        'Pemasok',
      ),
    ];
  }

  /** The bridge from sales to net profit, and where the expenses went. */
  async profit(tenantId: string, q: PeriodQuery): Promise<Visual[]> {
    const r = await this.profitLoss.report(tenantId, q);
    const c = r.current;
    const bridge: BarsVisual = {
      id: 'jembatan-untung',
      kind: 'bars',
      title: 'Dari hasil jualan ke untung bersih (tanpa pajak)',
      unit: 'rupiah',
      orientation: 'horizontal',
      categoryLabel: 'Langkah',
      categories: [
        'Hasil jualan',
        'Modal barang',
        'Untung kotor',
        'Susut stok',
        'Pengeluaran',
        'Untung bersih',
      ],
      series: [
        {
          label: 'Rupiah',
          values: [
            c.revenue,
            -c.cost,
            c.grossProfit,
            -c.shrinkage,
            -c.expenses,
            c.netProfit,
          ],
          color: 1,
        },
      ],
    };
    const spent = hbars(
      'pengeluaran-kategori',
      'Pengeluaran per kategori',
      'rupiah',
      'Pengeluaran',
      ranked(
        r.topExpenses.map((e) => ({ label: e.label, value: e.total })),
        TOP,
      ),
      'Kategori',
    );
    return [bridge, spent];
  }

  async receivablesVisuals(
    tenantId: string,
    filter: ReceivableFilter,
  ): Promise<Visual[]> {
    const [aging, list] = await Promise.all([
      this.receivables.aging(tenantId),
      this.receivables.list(tenantId, filter),
    ]);
    const ageing: SegmentsVisual = {
      id: 'umur-piutang',
      kind: 'segments',
      title: 'Piutang menurut umur',
      unit: 'rupiah',
      palette: 'sequential',
      categoryLabel: 'Umur',
      parts: [
        ...aging.buckets.map((x) => ({ label: x.label, value: x.amount })),
      ],
    };
    const top = hbars(
      'pelanggan-terbesar',
      'Pelanggan dengan sisa terbesar',
      'rupiah',
      'Sisa',
      ranked(
        list.rows.map((x) => ({ label: x.name, value: x.rest })),
        TOP,
      ),
      'Pelanggan',
    );
    return [ageing, top];
  }
}
