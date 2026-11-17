import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { reportSettings } from '../db/schema';
import { fieldError } from '../common/validation';
import {
  TIMEZONE_UNKNOWN,
  type DateRange,
  type Period,
} from './reports.schemas';

export const DEFAULT_TIMEZONE = 'Asia/Jakarta';
/** Line reports return at most this many rows; totals always cover the whole range. */
export const ROW_CAP = 5000;

const TRUNC: Record<Period, string> = {
  today: 'day',
  week: 'week', // ISO: Monday
  month: 'month',
  year: 'year',
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
/** Who rang it up: the owner, or the cashier's name (Lakasir's cashier report shows the seller of each sale). */
const cashierName = (r: Row) =>
  r.actor_kind === 'owner'
    ? 'Pemilik'
    : ((r.staff_name as string | null) ?? 'Staf');

/**
 * The one place a metric is defined (Lakasir swapped revenue and profit, flaw 5).
 * revenue = Σ sale totals (paid by customers, after discounts, incl. tax);
 * grossProfit = revenue − tax − cost (tax is owed, not earned; equals revenue − cost at tax 0).
 */
function metrics(r: Row) {
  const revenue = n(r.revenue);
  const tax = n(r.tax);
  const cost = n(r.cost);
  return {
    salesCount: n(r.sales_count),
    grossSales: n(r.gross_sales),
    discount: n(r.discount),
    tax,
    revenue,
    cost,
    grossProfit: revenue - tax - cost,
  };
}

/**
 * Read-only reports and dashboard metrics (Lakasir DashboardController + *ReportService). Every query filters
 * tenant_id = session tenant; day boundaries are computed by Postgres in the store's timezone, half-open.
 */
@Injectable()
export class ReportsService {
  constructor(@InjectDb() private readonly db: Db) {}

  private async rows(q: SQL): Promise<Row[]> {
    return [...(await this.db.execute(q))] as Row[];
  }

  async timezone(tenantId: string): Promise<string> {
    const [row] = await this.rows(
      sql`select timezone from pos.report_settings where tenant_id = ${tenantId}`,
    );
    return (row?.timezone as string | undefined) ?? DEFAULT_TIMEZONE;
  }

  async settings(tenantId: string) {
    return { timezone: await this.timezone(tenantId) };
  }

  async updateSettings(tenantId: string, timezone: string) {
    // Postgres resolves the boundaries, so its tz database is the authority (Node's ICU list may differ).
    const [known] = await this.rows(
      sql`select 1 from pg_timezone_names where name = ${timezone}`,
    );
    if (!known) throw fieldError('timezone', TIMEZONE_UNKNOWN);
    await this.db
      .insert(reportSettings)
      .values({ tenantId, timezone })
      .onConflictDoUpdate({
        target: reportSettings.tenantId,
        set: { timezone },
      });
    return { timezone };
  }

  /** `[from 00:00, to+1 00:00)` in the store's timezone, as timestamptz expressions. */
  private bounds(r: DateRange, tz: string) {
    return {
      start: sql`((${r.from}::date)::timestamp at time zone ${tz})`,
      end: sql`(((${r.to}::date) + 1)::timestamp at time zone ${tz})`,
    };
  }

  private async salesMetrics(tenantId: string, start: SQL, end: SQL) {
    const [r] = await this.rows(sql`
      select count(*) as sales_count, coalesce(sum(subtotal), 0) as gross_sales,
             coalesce(sum(discount), 0) as discount, coalesce(sum(tax), 0) as tax,
             coalesce(sum(total), 0) as revenue, coalesce(sum(cost_total), 0) as cost
        from pos.sales
       where tenant_id = ${tenantId} and created_at >= ${start} and created_at < ${end}`);
    return metrics(r);
  }

  /**
   * Current period so far vs the same span one period earlier ("this week so far" vs "last week up to the same
   * moment"). Lakasir compared overlapping windows.
   */
  async dashboard(tenantId: string, period: Period) {
    const tz = await this.timezone(tenantId);
    const unit = TRUNC[period];
    const step = sql`(${`1 ${unit}`})::interval`;
    const local = sql`(now() at time zone ${tz})`;
    const start = sql`date_trunc(${unit}, ${local})`;
    const [current, previous] = await Promise.all([
      this.salesMetrics(
        tenantId,
        sql`(${start} at time zone ${tz})`,
        sql`now()`,
      ),
      this.salesMetrics(
        tenantId,
        sql`((${start} - ${step}) at time zone ${tz})`,
        sql`((${local} - ${step}) at time zone ${tz})`,
      ),
    ]);
    const [range] = await this.rows(
      sql`select to_char(${start}, 'YYYY-MM-DD') as "from", to_char(${local}, 'YYYY-MM-DD') as "to"`,
    );
    return {
      period,
      timezone: tz,
      from: range.from,
      to: range.to,
      current,
      previous,
    };
  }

  async sales(tenantId: string, range: DateRange) {
    const tz = await this.timezone(tenantId);
    const { start, end } = this.bounds(range, tz);
    const [lines, totals, [q]] = await Promise.all([
      this.rows(sql`
        select s.number, to_char(s.created_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as time,
               s.actor_kind, st.name as staff_name,
               p.sku, l.name, l.qty, l.unit_price, l.line_total, l.cost_total
          from pos.sale_lines l
          join pos.sales s on s.tenant_id = l.tenant_id and s.id = l.sale_id
          join pos.products p on p.tenant_id = l.tenant_id and p.id = l.product_id
          left join pos.staff st on st.tenant_id = s.tenant_id and st.id = s.actor_id
         where s.tenant_id = ${tenantId} and s.created_at >= ${start} and s.created_at < ${end}
         order by s.created_at, s.number, l.id
         limit ${ROW_CAP + 1}`),
      this.salesMetrics(tenantId, start, end),
      this.rows(sql`
        select coalesce(sum(l.qty), 0) as qty
          from pos.sale_lines l
          join pos.sales s on s.tenant_id = l.tenant_id and s.id = l.sale_id
         where s.tenant_id = ${tenantId} and s.created_at >= ${start} and s.created_at < ${end}`),
    ]);
    return {
      ...range,
      timezone: tz,
      truncated: lines.length > ROW_CAP,
      rows: lines.slice(0, ROW_CAP).map((r) => ({
        number: n(r.number),
        time: r.time as string,
        cashier: cashierName(r),
        sku: r.sku as string,
        name: r.name as string,
        qty: n(r.qty),
        unitPrice: n(r.unit_price),
        lineTotal: n(r.line_total),
        cost: n(r.cost_total),
        grossProfit: n(r.line_total) - n(r.cost_total),
      })),
      totals: { qty: n(q.qty), ...totals },
    };
  }

  /** Per product; bounded by catalog size, so uncapped. Sale-level discount and tax appear only in totals. */
  async products(tenantId: string, range: DateRange) {
    const tz = await this.timezone(tenantId);
    const { start, end } = this.bounds(range, tz);
    const [rows, totals] = await Promise.all([
      this.rows(sql`
        select p.id, p.sku, p.name, sum(l.qty) as qty, sum(l.line_total) as sales,
               sum(l.cost_total) as cost
          from pos.sale_lines l
          join pos.sales s on s.tenant_id = l.tenant_id and s.id = l.sale_id
          join pos.products p on p.tenant_id = l.tenant_id and p.id = l.product_id
         where s.tenant_id = ${tenantId} and s.created_at >= ${start} and s.created_at < ${end}
         group by p.id
         order by sales desc, p.name`),
      this.salesMetrics(tenantId, start, end),
    ]);
    const items = rows.map((r) => ({
      productId: r.id as string,
      sku: r.sku as string,
      name: r.name as string,
      qty: n(r.qty),
      sales: n(r.sales),
      cost: n(r.cost),
      grossProfit: n(r.sales) - n(r.cost),
    }));
    return {
      ...range,
      timezone: tz,
      rows: items,
      totals: { qty: items.reduce((a, r) => a + r.qty, 0), ...totals },
    };
  }

  /** Shifts opened in the range, with their cashier and sales. A shift's sales count wholly to its row. */
  async shifts(tenantId: string, range: DateRange) {
    const tz = await this.timezone(tenantId);
    const { start, end } = this.bounds(range, tz);
    const rows = await this.rows(sql`
      select sh.id, sh.actor_kind, st.name as staff_name,
             to_char(sh.opened_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as opened_at,
             to_char(sh.closed_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as closed_at,
             sh.opening_cash, sh.expected_cash, sh.counted_cash,
             count(s.id) as sales_count, coalesce(sum(s.subtotal), 0) as gross_sales,
             coalesce(sum(s.discount), 0) as discount, coalesce(sum(s.tax), 0) as tax,
             coalesce(sum(s.total), 0) as revenue, coalesce(sum(s.cost_total), 0) as cost
        from pos.shifts sh
        left join pos.staff st on st.tenant_id = sh.tenant_id and st.id = sh.actor_id
        left join pos.sales s on s.tenant_id = sh.tenant_id and s.shift_id = sh.id
       where sh.tenant_id = ${tenantId} and sh.opened_at >= ${start} and sh.opened_at < ${end}
       group by sh.id, st.name
       order by sh.opened_at`);
    const items = rows.map((r) => {
      const counted = r.counted_cash == null ? null : n(r.counted_cash);
      const expected = r.expected_cash == null ? null : n(r.expected_cash);
      return {
        shiftId: r.id as string,
        cashier: cashierName(r),
        openedAt: r.opened_at as string,
        closedAt: (r.closed_at as string | null) ?? null,
        openingCash: n(r.opening_cash),
        expectedCash: expected,
        countedCash: counted,
        difference:
          counted == null || expected == null ? null : counted - expected,
        ...metrics(r),
      };
    });
    const sum = (
      k:
        | 'salesCount'
        | 'grossSales'
        | 'discount'
        | 'tax'
        | 'revenue'
        | 'cost'
        | 'grossProfit',
    ) => items.reduce((a, r) => a + r[k], 0);
    return {
      ...range,
      timezone: tz,
      rows: items,
      totals: {
        shifts: items.length,
        salesCount: sum('salesCount'),
        grossSales: sum('grossSales'),
        discount: sum('discount'),
        tax: sum('tax'),
        revenue: sum('revenue'),
        cost: sum('cost'),
        grossProfit: sum('grossProfit'),
      },
    };
  }

  /** Approved purchase lines by approval time (Lakasir ignored the store timezone here). */
  async purchasing(tenantId: string, range: DateRange) {
    const tz = await this.timezone(tenantId);
    const { start, end } = this.bounds(range, tz);
    const where = sql`o.tenant_id = ${tenantId} and o.status = 'approved'
      and o.approved_at >= ${start} and o.approved_at < ${end}`;
    const [lines, [t]] = await Promise.all([
      this.rows(sql`
        select o.id as order_id, to_char(o.approved_at at time zone ${tz}, 'YYYY-MM-DD') as date,
               sup.name as supplier, p.sku, p.name, l.qty, l.unit_cost, l.qty * l.unit_cost as line_total
          from pos.purchase_order_lines l
          join pos.purchase_orders o on o.tenant_id = l.tenant_id and o.id = l.order_id
          join pos.suppliers sup on sup.tenant_id = o.tenant_id and sup.id = o.supplier_id
          join pos.products p on p.tenant_id = l.tenant_id and p.id = l.product_id
         where ${where}
         order by o.approved_at, o.id, l.id
         limit ${ROW_CAP + 1}`),
      this.rows(sql`
        select count(distinct o.id) as orders, coalesce(sum(l.qty), 0) as qty,
               coalesce(sum(l.qty * l.unit_cost), 0) as total
          from pos.purchase_order_lines l
          join pos.purchase_orders o on o.tenant_id = l.tenant_id and o.id = l.order_id
         where ${where}`),
    ]);
    return {
      ...range,
      timezone: tz,
      truncated: lines.length > ROW_CAP,
      rows: lines.slice(0, ROW_CAP).map((r) => ({
        orderId: r.order_id as string,
        date: r.date as string,
        supplier: r.supplier as string,
        sku: r.sku as string,
        name: r.name as string,
        qty: n(r.qty),
        unitCost: n(r.unit_cost),
        lineTotal: n(r.line_total),
      })),
      totals: { orders: n(t.orders), qty: n(t.qty), total: n(t.total) },
    };
  }
}
