import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { FINAL_SALE_STATUSES } from '../db/schema';
import type { Period } from './reports.schemas';
import { ReportsService } from './reports.service';

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const FINAL_LIST = sql.raw(FINAL_SALE_STATUSES.map((s) => `'${s}'`).join(', '));

const UNIT: Record<Period, string> = {
  today: 'day',
  week: 'week', // ISO: Monday
  month: 'month',
  year: 'year',
};
/** How many buckets the trend draws for each period: 7 days, 8 weeks, 6 months, 3 years. */
export const TREND_BUCKETS: Record<Period, number> = {
  today: 7,
  week: 8,
  month: 6,
  year: 3,
};
/** The hour strip always shows the shop day's usual hours, and grows to cover any sale outside them. */
export const HOURS_FROM = 8;
export const HOURS_TO = 20;
/** The payment mix keeps this many parts; the rest is one `Lainnya` part. */
export const MIX_PARTS = 5;
export const OTHER_METHODS = 'Lainnya';

/**
 * The dashboard's widgets (design feature 35). Every figure is the reports' own definition, read again for the
 * widget's shape: sales PAID in the window (`paid_at`) minus voids DONE in it, final sales only
 * (FINAL_SALE_STATUSES), tax left out (`sales` = total − tax; `grossProfit` = total − tax − cost, as everywhere),
 * days by the store's timezone, money in integer rupiah. The screen draws what is answered and computes nothing.
 * Every query filters the session's tenant.
 */
@Injectable()
export class DashboardWidgetsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly reports: ReportsService,
  ) {}

  private async rows(q: SQL): Promise<Row[]> {
    return [...(await this.db.execute(q))] as Row[];
  }

  /** The current period so far, as timestamptz expressions, and its store dates. */
  private async window(tenantId: string, period: Period) {
    const tz = await this.reports.timezone(tenantId);
    const local = sql`(now() at time zone ${tz})`;
    const start = sql`date_trunc(${UNIT[period]}, ${local})`;
    const [r] = await this.rows(
      sql`select to_char(${start}, 'YYYY-MM-DD') as "from", to_char(${local}, 'YYYY-MM-DD') as "to"`,
    );
    return {
      tz,
      from: r.from as string,
      to: r.to as string,
      start: sql`(${start} at time zone ${tz})`,
      end: sql`now()`,
    };
  }

  /**
   * Hero and tiles: sales, transactions, average basket and gross profit of the period so far against the same
   * span of the period before (the dashboard's comparison), plus one figure set per bucket for the small lines
   * and the trend chart. The last bucket is the current period, so it equals `current`.
   */
  async overview(tenantId: string, period: Period) {
    const [dash, tz] = await Promise.all([
      this.reports.dashboard(tenantId, period),
      this.reports.timezone(tenantId),
    ]);
    const unit = UNIT[period];
    const count = TREND_BUCKETS[period];
    const step = sql`(${`1 ${unit}`})::interval`;
    const local = sql`(now() at time zone ${tz})`;
    const first = sql`(date_trunc(${unit}, ${local}) - (${count - 1}::int * ${step}))`;
    const last = sql`date_trunc(${unit}, ${local})`;
    const salesIn = (table: SQL, at: SQL, only: SQL = sql``) => sql`
      (select count(*) as n, coalesce(sum(total), 0) as revenue, coalesce(sum(tax), 0) as tax,
              coalesce(sum(cost_total), 0) as cost
         from ${table}
        where tenant_id = ${tenantId}
          and ${at} >= (b.d at time zone ${tz}) and ${at} < ((b.d + ${step}) at time zone ${tz})
          ${only})`;
    const buckets = await this.rows(sql`
      select to_char(b.d, 'YYYY-MM-DD') as "from",
             to_char(b.d + ${step} - interval '1 day', 'YYYY-MM-DD') as "to",
             s.n - v.n as sales_count,
             (s.revenue - s.tax) - (v.revenue - v.tax) as sales,
             (s.revenue - s.tax - s.cost) - (v.revenue - v.tax - v.cost) as gross_profit
        from generate_series(${first}, ${last}, ${step}) as b(d)
        cross join lateral ${salesIn(sql`pos.sales`, sql`paid_at`, sql`and status in (${FINAL_LIST})`)} s
        cross join lateral ${salesIn(sql`pos.sale_voids`, sql`created_at`)} v
       order by b.d`);
    const figures = (m: {
      salesCount: number;
      revenue: number;
      tax: number;
      grossProfit: number;
    }) => {
      const sales = m.revenue - m.tax;
      return {
        sales,
        salesCount: m.salesCount,
        averageBasket: m.salesCount > 0 ? Math.round(sales / m.salesCount) : 0,
        grossProfit: m.grossProfit,
      };
    };
    return {
      period,
      timezone: tz,
      from: dash.from,
      to: dash.to,
      current: figures(dash.current),
      previous: figures(dash.previous),
      trend: buckets.map((b) => {
        const sales = n(b.sales);
        const salesCount = n(b.sales_count);
        return {
          from: b.from as string,
          to: b.to as string,
          sales,
          salesCount,
          averageBasket: salesCount > 0 ? Math.round(sales / salesCount) : 0,
          grossProfit: n(b.gross_profit),
        };
      }),
    };
  }

  /** Today's sales by hour in the store's timezone, voids taken off in the hour they were done. */
  async hourly(tenantId: string) {
    const tz = await this.reports.timezone(tenantId);
    const local = sql`(now() at time zone ${tz})`;
    const dayStart = sql`date_trunc('day', ${local})`;
    const start = sql`(${dayStart} at time zone ${tz})`;
    const end = sql`((${dayStart} + interval '1 day') at time zone ${tz})`;
    const [rows, [d]] = await Promise.all([
      this.rows(sql`
        select h, sum(amount) as amount, sum(cnt) as cnt from (
          select extract(hour from s.paid_at at time zone ${tz})::int as h, s.total - s.tax as amount, 1 as cnt
            from pos.sales s
           where s.tenant_id = ${tenantId} and s.status in (${FINAL_LIST})
             and s.paid_at >= ${start} and s.paid_at < ${end}
          union all
          select extract(hour from v.created_at at time zone ${tz})::int, -(v.total - v.tax), -1
            from pos.sale_voids v
           where v.tenant_id = ${tenantId} and v.created_at >= ${start} and v.created_at < ${end}
        ) x group by h order by h`),
      this.rows(sql`select to_char(${local}, 'YYYY-MM-DD') as today`),
    ]);
    const byHour = new Map(
      rows.map((r) => [n(r.h), { sales: n(r.amount), count: n(r.cnt) }]),
    );
    const used = [...byHour.keys()];
    const from = Math.min(HOURS_FROM, ...used);
    const to = Math.max(HOURS_TO, ...used);
    const hours = Array.from({ length: to - from + 1 }, (_, i) => {
      const hour = from + i;
      return { hour, ...(byHour.get(hour) ?? { sales: 0, count: 0 }) };
    });
    const total = hours.reduce((a, h) => a + h.sales, 0);
    const busiest = hours.reduce<(typeof hours)[number] | null>(
      (best, h) => (h.sales > 0 && (!best || h.sales > best.sales) ? h : best),
      null,
    );
    return {
      date: d.today as string,
      timezone: tz,
      hours,
      total,
      transactions: hours.reduce((a, h) => a + h.count, 0),
      peak: busiest ? { hour: busiest.hour, sales: busiest.sales } : null,
    };
  }

  /**
   * How the period's sales were paid, by payment method (a kasbon sale is the method of kind kasbon). A void takes
   * its sale's method off. The parts add up to the period's `sales`; more than `MIX_PARTS` methods end in `Lainnya`.
   */
  async paymentMix(tenantId: string, period: Period) {
    const w = await this.window(tenantId, period);
    const rows = await this.rows(sql`
      select pm.name, sum(x.amount) as amount, sum(x.cnt) as cnt from (
        select s.payment_method_id as pmid, s.total - s.tax as amount, 1 as cnt
          from pos.sales s
         where s.tenant_id = ${tenantId} and s.status in (${FINAL_LIST})
           and s.paid_at >= ${w.start} and s.paid_at < ${w.end}
        union all
        select s.payment_method_id, -(v.total - v.tax), -1
          from pos.sale_voids v
          join pos.sales s on s.tenant_id = v.tenant_id and s.id = v.sale_id
         where v.tenant_id = ${tenantId} and v.created_at >= ${w.start} and v.created_at < ${w.end}
      ) x
      join pos.payment_methods pm on pm.tenant_id = ${tenantId} and pm.id = x.pmid
      group by pm.id, pm.name
     having sum(x.amount) <> 0 or sum(x.cnt) <> 0
      order by amount desc, pm.name`);
    const all = rows.map((r) => ({
      name: r.name as string,
      value: n(r.amount),
      count: n(r.cnt),
    }));
    const parts =
      all.length > MIX_PARTS
        ? [
            ...all.slice(0, MIX_PARTS - 1),
            {
              name: OTHER_METHODS,
              value: all.slice(MIX_PARTS - 1).reduce((a, p) => a + p.value, 0),
              count: all.slice(MIX_PARTS - 1).reduce((a, p) => a + p.count, 0),
            },
          ]
        : all;
    return {
      period,
      timezone: w.tz,
      from: w.from,
      to: w.to,
      total: all.reduce((a, p) => a + p.value, 0),
      parts,
    };
  }

  /** The best sellers of the period by units sold (base units, voided lines taken off), at most `limit`. */
  async topProducts(tenantId: string, period: Period, limit: number) {
    const w = await this.window(tenantId, period);
    const rows = await this.rows(sql`
      select p.id, p.name, p.sku, p.unit, sum(x.base_qty) as qty, sum(x.line_total - x.discount) as sales
        from ${this.reports.lineRows(tenantId, w.start, w.end)} x
        join pos.products p on p.tenant_id = ${tenantId} and p.id = x.product_id
       group by p.id
      having sum(x.base_qty) > 0
       order by qty desc, sales desc, p.name
       limit ${limit}`);
    return {
      period,
      timezone: w.tz,
      from: w.from,
      to: w.to,
      rows: rows.map((r) => ({
        productId: r.id as string,
        name: r.name as string,
        sku: r.sku as string,
        unit: r.unit as string,
        qty: n(r.qty),
        sales: n(r.sales),
      })),
    };
  }

  /**
   * Stock-tracked products that are out (0) or low (at or under their own threshold), emptiest first, at most
   * `limit`; `out` and `low` count all of them. The same rule as the products list's stock filter. `fullLevel` is
   * what the bar is measured against: the last quantity received, at least the threshold and the on-hand.
   */
  async lowStock(tenantId: string, limit: number) {
    const rows = await this.rows(sql`
      select p.id, p.name, p.sku, p.unit, p.low_stock_threshold as threshold,
             coalesce(sum(b.qty_remaining), 0) as on_hand,
             (select lb.qty_initial from pos.stock_batches lb
               where lb.tenant_id = p.tenant_id and lb.product_id = p.id
               order by lb.received_at desc, lb.created_at desc limit 1) as last_in,
             count(*) over () as total_rows
        from pos.products p
        left join pos.stock_batches b on b.tenant_id = p.tenant_id and b.product_id = p.id
       where p.tenant_id = ${tenantId} and p.type = 'product' and p.deleted_at is null
       group by p.id
      having coalesce(sum(b.qty_remaining), 0) <= p.low_stock_threshold
       order by on_hand, p.name, p.id`);
    const out = rows.filter((r) => n(r.on_hand) === 0).length;
    return {
      total: rows.length,
      out,
      low: rows.length - out,
      rows: rows.slice(0, limit).map((r) => {
        const onHand = n(r.on_hand);
        const threshold = n(r.threshold);
        return {
          productId: r.id as string,
          name: r.name as string,
          sku: r.sku as string,
          unit: r.unit as string,
          onHand,
          threshold,
          fullLevel: Math.max(n(r.last_in), threshold, onHand, 1),
          status: onHand === 0 ? ('out' as const) : ('low' as const),
        };
      }),
    };
  }
}
