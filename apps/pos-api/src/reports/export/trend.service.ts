import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { codedError } from '../../common/validation';
import type { Db } from '../../db/db.module';
import { InjectDb } from '../../db/db.module';
import {
  FINAL_SALE_STATUSES,
  SUPPLIER_PAYMENT_CATEGORY,
} from '../../db/schema';
import { ExpensesService } from '../../expenses/expenses.service';
import { ReportsService } from '../reports.service';
import type { BarsVisual } from '../visuals/types';
import {
  addDays,
  bucketEnd,
  bucketLabel,
  bucketStart,
  bucketStarts,
  nextBucket,
  DEFAULT_BUCKETS,
  MAX_BUCKETS,
  percentChange,
  periodLabel,
  prevBucket,
  type Scale,
  SCALE_NAMES,
  type TrendQuery,
} from './scales';

const FINAL_LIST = sql.raw(FINAL_SALE_STATUSES.map((s) => `'${s}'`).join(', '));

export const RANGE_TOO_LARGE = 'EXPORT_RANGE_TOO_LARGE';

/** The refusal of a window longer than the scale allows, in the words of the error dialog (design feature 37). */
export function rangeTooLarge(scale: Scale, max: number) {
  return codedError(
    RANGE_TOO_LARGE,
    'count',
    `Rentang laporan terlalu panjang untuk satu PDF (lebih dari ${max} ${SCALE_NAMES[scale].unit} untuk laporan ${SCALE_NAMES[scale].adj.toLowerCase()}).`,
    { maxBuckets: max },
  );
}

export interface TrendBucket {
  key: string;
  label: string;
  /** Sales without tax, voids counted on the day they were done. */
  sales: number;
  /** Expenses without supplier payments. */
  expenses: number;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/**
 * "Penjualan dan pengeluaran" (design feature 37): sales and expenses per day, month or year, with the profit
 * and loss figures of the whole window. Every figure is the profit and loss report's: sales are `total − tax`
 * of the receipts paid in the bucket minus the voids done in it, expenses are the live rows without supplier
 * payments, the window totals come from `ReportsService.salesTotals` and `ExpensesService.totals` (the very
 * calls the profit and loss report makes). Buckets follow the store's calendar; the last one stops at today.
 */
@Injectable()
export class SalesExpensesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly reports: ReportsService,
    private readonly expenses: ExpensesService,
  ) {}

  private async rows(q: SQL): Promise<Row[]> {
    return [...(await this.db.execute(q))] as Row[];
  }

  private async perBucket(
    tenantId: string,
    tz: string,
    scale: Scale,
    from: string,
    to: string,
  ) {
    const start = sql`((${from}::date)::timestamp at time zone ${tz})`;
    const end = sql`(((${to}::date) + 1)::timestamp at time zone ${tz})`;
    const [sales, spent] = await Promise.all([
      this.rows(sql`
        select to_char(date_trunc(${scale}, x.at at time zone ${tz}), 'YYYY-MM-DD') as b, sum(x.net) as v
          from (
            select s.paid_at as at, s.total - s.tax as net from pos.sales s
             where s.tenant_id = ${tenantId} and s.status in (${FINAL_LIST})
               and s.paid_at >= ${start} and s.paid_at < ${end}
            union all
            select v.created_at, -(v.total - v.tax) from pos.sale_voids v
             where v.tenant_id = ${tenantId} and v.created_at >= ${start} and v.created_at < ${end}) x
         group by 1`),
      this.rows(sql`
        select to_char(date_trunc(${scale}, e.expense_date::timestamp), 'YYYY-MM-DD') as b, sum(e.amount) as v
          from pos.expenses e
         where e.tenant_id = ${tenantId} and e.voided_at is null and e.category <> ${SUPPLIER_PAYMENT_CATEGORY}
           and e.expense_date >= ${from}::date and e.expense_date <= ${to}::date
         group by 1`),
    ]);
    const by = (rows: Row[]) =>
      new Map(rows.map((r) => [r.b as string, n(r.v)]));
    return { sales: by(sales), expenses: by(spent) };
  }

  /** The profit and loss figures of `[from, to]`, the way `ProfitLossService` computes them. */
  private async figures(
    tenantId: string,
    tz: string,
    from: string,
    to: string,
  ) {
    const [s, spent, shrinkage] = await Promise.all([
      this.reports.salesTotals(tenantId, tz, { from, to }),
      this.expenses.totals(tenantId, from, to),
      // "Susut stok" (UMK-2072): netted over the whole range like the profit and loss report, never per bucket.
      this.reports.shrinkage(tenantId, tz, { from, to }),
    ]);
    return {
      sales: s.revenue - s.tax,
      cost: s.cost,
      grossProfit: s.grossProfit,
      shrinkage,
      expenses: spent.expenses,
      netProfit: s.grossProfit - shrinkage - spent.expenses,
      tax: s.tax,
    };
  }

  /** Sales and expenses of every bucket from the one holding `from` to the one holding `to`, oldest first. */
  async between(
    tenantId: string,
    scale: Scale,
    from: string,
    to: string,
  ): Promise<TrendBucket[]> {
    const tz = await this.reports.timezone(tenantId);
    const starts: string[] = [];
    for (let s = bucketStart(scale, from); s <= to; s = nextBucket(scale, s))
      starts.push(s);
    const series = await this.perBucket(tenantId, tz, scale, from, to);
    return starts.map((s) => ({
      key: s,
      label: bucketLabel(scale, s, starts.length),
      sales: series.sales.get(s) ?? 0,
      expenses: series.expenses.get(s) ?? 0,
    }));
  }

  async report(tenantId: string, q: TrendQuery) {
    const scale = q.scale;
    const count = q.count ?? DEFAULT_BUCKETS[scale];
    if (count > MAX_BUCKETS[scale])
      throw rangeTooLarge(scale, MAX_BUCKETS[scale]);
    const [tz, today] = await Promise.all([
      this.reports.timezone(tenantId),
      this.expenses.today(tenantId),
    ]);
    const anchor = q.to && q.to < today ? q.to : today;
    const starts = bucketStarts(scale, anchor, count);
    const from = starts[0];
    const lastEnd = bucketEnd(scale, starts[count - 1]);
    const to = lastEnd > today ? today : lastEnd;
    const prevStarts = (() => {
      const out: string[] = [];
      let s = starts[0];
      for (let i = 0; i < count; i++) {
        s = prevBucket(scale, s);
        out.unshift(s);
      }
      return out;
    })();
    const prevFrom = prevStarts[0];
    // A window that is still running is compared with the same number of days of the one before (like-for-like, as
    // the profit and loss report does); a finished one with the whole previous window.
    const partial = lastEnd > today;
    const elapsedDays = Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    );
    const prevTo = partial ? addDays(prevFrom, elapsedDays) : addDays(from, -1);

    const [series, totals, previous] = await Promise.all([
      this.perBucket(tenantId, tz, scale, from, to),
      this.figures(tenantId, tz, from, to),
      this.figures(tenantId, tz, prevFrom, prevTo),
    ]);
    const buckets: TrendBucket[] = starts.map((s) => ({
      key: s,
      label: bucketLabel(scale, s, count),
      sales: series.sales.get(s) ?? 0,
      expenses: series.expenses.get(s) ?? 0,
    }));
    return {
      scale,
      timezone: tz,
      today,
      from,
      to,
      count,
      periodLabel: periodLabel(scale, from, to),
      // The last bucket is still running (the year of "2026 baru berjalan sampai 26 Nov").
      partialLast: partial,
      buckets,
      totals,
      previous: {
        from: prevFrom,
        to: prevTo,
        periodLabel: periodLabel(scale, prevFrom, prevTo),
        sales: previous.sales,
        expenses: previous.expenses,
      },
      change: {
        sales: percentChange(totals.sales, previous.sales),
        expenses: percentChange(totals.expenses, previous.expenses),
      },
      visual: trendVisual(scale, buckets),
    };
  }
}

/** The two-series column chart of the report: sales and expenses per bucket, the same words on screen and in the PDF. */
export function trendVisual(scale: Scale, buckets: TrendBucket[]): BarsVisual {
  return {
    id: 'penjualan-pengeluaran',
    kind: 'bars',
    title: `Penjualan dan pengeluaran ${SCALE_NAMES[scale].per}`,
    unit: 'rupiah',
    orientation: 'vertical',
    categoryLabel:
      SCALE_NAMES[scale].unit === 'hari'
        ? 'Hari'
        : SCALE_NAMES[scale].unit === 'bulan'
          ? 'Bulan'
          : 'Tahun',
    categories: buckets.map((b) => b.label),
    series: [
      { label: 'Penjualan', values: buckets.map((b) => b.sales), color: 1 },
      {
        label: 'Pengeluaran',
        values: buckets.map((b) => b.expenses),
        color: 2,
      },
    ],
  };
}
