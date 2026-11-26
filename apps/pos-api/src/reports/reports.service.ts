import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { AGENT_LABEL, FINAL_SALE_STATUSES, reportSettings } from '../db/schema';
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
    : r.actor_kind === 'agent'
      ? AGENT_LABEL
      : ((r.staff_name as string | null) ?? 'Staf');

/**
 * The one place a metric is defined (Lakasir swapped revenue and profit, flaw 5).
 * revenue = Σ sale totals = grossSales − discount − voucher + tax (paid by customers);
 * grossProfit = revenue − tax − cost (tax is owed, not earned; equals revenue − cost at tax 0). Owner
 * ruling 2026-11-25: this holds everywhere, the profit and loss report included.
 * rounding = Σ cash rounding (UMK-1993): its own line, outside revenue and gross profit;
 * revenue + rounding is what customers owed.
 */
function metrics(r: Row) {
  const revenue = n(r.revenue);
  const tax = n(r.tax);
  const cost = n(r.cost);
  return {
    salesCount: n(r.sales_count),
    grossSales: n(r.gross_sales),
    discount: n(r.discount),
    voucher: n(r.voucher),
    tax,
    revenue,
    cost,
    grossProfit: revenue - tax - cost,
    rounding: n(r.rounding),
  };
}

/**
 * Read-only reports and dashboard metrics (Lakasir DashboardController + *ReportService). Every query filters
 * tenant_id = session tenant; day boundaries are computed by Postgres in the store's timezone, half-open.
 */
/** Receipts only: a sale awaiting payment or cancelled for want of one is in no report (UMK-1991). */
const FINAL_LIST = sql.raw(FINAL_SALE_STATUSES.map((s) => `'${s}'`).join(', '));
const FINAL = sql`and status in (${FINAL_LIST})`;

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

  /**
   * Sales PAID in `[start, end)` (`paid_at`: when the sale was rung up, or for a sale that waited for a
   * payment gateway the moment it was paid, owner ruling 2026-11-25) minus the voids DONE in `[start, end)`
   * (UMK-1962, owner ruling on G-09): a sale stays in the figures of its own day for ever, and its void is a reversal in the figures
   * of the day the void was done. A same-day void nets to zero; a void of an older receipt makes that
   * day's figures lower (even negative) and never changes an earlier day. The reversal uses the figures
   * stored on pos.sale_voids (the sale's own, cost as stored at the sale).
   */
  private async salesMetrics(tenantId: string, start: SQL, end: SQL) {
    const sums = (table: SQL, at: SQL, only: SQL = sql``) => sql`
      (select count(*) as n, coalesce(sum(subtotal), 0) as gross_sales,
              coalesce(sum(discount), 0) as discount,
              coalesce(sum(voucher_discount), 0) as voucher, coalesce(sum(tax), 0) as tax,
              coalesce(sum(total), 0) as revenue, coalesce(sum(cost_total), 0) as cost,
              coalesce(sum(rounding), 0) as rounding
         from ${table}
        where tenant_id = ${tenantId} and ${at} >= ${start} and ${at} < ${end} ${only})`;
    const [r] = await this.rows(sql`
      select s.n - v.n as sales_count, s.gross_sales - v.gross_sales as gross_sales,
             s.discount - v.discount as discount, s.voucher - v.voucher as voucher,
             s.tax - v.tax as tax, s.revenue - v.revenue as revenue, s.cost - v.cost as cost,
             s.rounding - v.rounding as rounding, v.n as void_count
        from ${sums(sql`pos.sales`, sql`paid_at`, FINAL)} s,
             ${sums(sql`pos.sale_voids`, sql`created_at`)} v`);
    return { ...metrics(r), voidCount: n(r.void_count) };
  }

  /**
   * UMK-1964: of the revenue in `[start, end)`, the part rung up as kasbon (a sale with a receivable), by the
   * same rule as `salesMetrics` (sales by `paid_at` minus voids by the void's time). Lunas = revenue − this.
   */
  private async creditRevenue(tenantId: string, start: SQL, end: SQL) {
    const [r] = await this.rows(sql`
      select (select coalesce(sum(s.total), 0) from pos.sales s
               where s.tenant_id = ${tenantId} and s.paid_at >= ${start} and s.paid_at < ${end}
                 and s.status in (${FINAL_LIST})
                 and exists (select 1 from pos.receivables r
                              where r.tenant_id = s.tenant_id and r.sale_id = s.id))
           - (select coalesce(sum(v.total), 0) from pos.sale_voids v
               where v.tenant_id = ${tenantId} and v.created_at >= ${start} and v.created_at < ${end}
                 and exists (select 1 from pos.receivables r
                              where r.tenant_id = v.tenant_id and r.sale_id = v.sale_id)) as credit`);
    return n(r.credit);
  }

  /**
   * UMK-1964 "Piutang dibayar (uang masuk)": kasbon instalments received in `[start, end)` minus the instalments
   * that voids done in `[start, end)` gave back. Not revenue: the kasbon sale was counted when it was rung up.
   * A kasbon's down payment (the book row written with the sale, the only one without an Idempotency-Key) is part
   * of that sale and is left out. The kasbon report's "Dibayar bulan ini" is this figure for the month.
   */
  async receivablePaid(tenantId: string, start: SQL, end: SQL) {
    const [r] = await this.rows(sql`
      select (select coalesce(sum(p.amount), 0) from pos.receivable_payments p
               where p.tenant_id = ${tenantId} and p.idempotency_key is not null
                 and p.created_at >= ${start} and p.created_at < ${end})
           - (select coalesce(sum(p.amount), 0) from pos.sale_voids v
                join pos.receivables r on r.tenant_id = v.tenant_id and r.sale_id = v.sale_id
                join pos.receivable_payments p on p.tenant_id = r.tenant_id and p.receivable_id = r.id
               where v.tenant_id = ${tenantId} and p.idempotency_key is not null
                 and v.created_at >= ${start} and v.created_at < ${end}) as paid`);
    return n(r.paid);
  }

  /**
   * The hook of the profit and loss report (UMK-1984): the same revenue, tax, cost and rounding as
   * every report here, for whole store days `[from, to]`; with `cutoff` (a timestamptz expression) the
   * window ends there when that is earlier ("up to the same moment one period ago").
   */
  async salesTotals(
    tenantId: string,
    tz: string,
    range: DateRange,
    cutoff?: SQL,
  ) {
    const { start, end } = this.bounds(range, tz);
    return this.salesMetrics(
      tenantId,
      start,
      cutoff ? sql`least(${end}, ${cutoff})` : end,
    );
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

  /**
   * The lines behind `salesMetrics`: every line of a sale paid in the range, plus, for every void done
   * in the range, the voided sale's lines again with negative quantity, amount and cost, dated at the void
   * and attributed to whoever started it.
   */
  private lineRows(tenantId: string, start: SQL, end: SQL) {
    return sql`(
      select 'sale' as kind, s.paid_at as at, s.number, s.actor_kind, s.actor_id,
             l.id as line_id, l.product_id, l.name, l.qty, l.unit, l.base_qty, l.unit_price, l.line_total, l.cost_total
        from pos.sale_lines l
        join pos.sales s on s.tenant_id = l.tenant_id and s.id = l.sale_id
       where s.tenant_id = ${tenantId} and s.paid_at >= ${start} and s.paid_at < ${end}
         and s.status in (${FINAL_LIST})
      union all
      select 'void', v.created_at, s.number, v.actor_kind, v.actor_id,
             l.id, l.product_id, l.name, -l.qty, l.unit, -l.base_qty, l.unit_price, -l.line_total, -l.cost_total
        from pos.sale_voids v
        join pos.sales s on s.tenant_id = v.tenant_id and s.id = v.sale_id
        join pos.sale_lines l on l.tenant_id = v.tenant_id and l.sale_id = v.sale_id
       where v.tenant_id = ${tenantId} and v.created_at >= ${start} and v.created_at < ${end})`;
  }

  async sales(tenantId: string, range: DateRange) {
    const tz = await this.timezone(tenantId);
    const { start, end } = this.bounds(range, tz);
    const lineRows = this.lineRows(tenantId, start, end);
    const [lines, totals, [q], credit, repaid] = await Promise.all([
      this.rows(sql`
        select x.number, x.kind, to_char(x.at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as time,
               x.actor_kind, st.name as staff_name,
               p.sku, x.name, x.qty, coalesce(x.unit, p.unit) as unit, x.unit_price, x.line_total, x.cost_total
          from ${lineRows} x
          join pos.products p on p.tenant_id = ${tenantId} and p.id = x.product_id
          left join pos.staff st on st.tenant_id = ${tenantId} and st.id = x.actor_id
         order by x.at, x.number, x.kind, x.line_id
         limit ${ROW_CAP + 1}`),
      this.salesMetrics(tenantId, start, end),
      // Totalled as rung up, in each line's own unit (UMK-1985); the product report counts base units.
      this.rows(sql`select coalesce(sum(x.qty), 0) as qty from ${lineRows} x`),
      this.creditRevenue(tenantId, start, end),
      this.receivablePaid(tenantId, start, end),
    ]);
    return {
      ...range,
      timezone: tz,
      truncated: lines.length > ROW_CAP,
      rows: lines.slice(0, ROW_CAP).map((r) => ({
        number: n(r.number),
        // `void`: the reversal of a voided receipt, at the time of the void, with negative figures.
        kind: r.kind as 'sale' | 'void',
        time: r.time as string,
        cashier: cashierName(r),
        sku: r.sku as string,
        name: r.name as string,
        // In the line's own unit (`unit`): qty × unitPrice = lineTotal.
        qty: n(r.qty),
        unit: r.unit as string,
        unitPrice: n(r.unit_price),
        lineTotal: n(r.line_total),
        cost: n(r.cost_total),
        grossProfit: n(r.line_total) - n(r.cost_total),
      })),
      totals: {
        qty: n(q.qty),
        ...totals,
        // UMK-1964: revenue split into Lunas and Kasbon (settledSales + creditSales = revenue), and the kasbon
        // instalments received, shown apart: money in, not new revenue.
        settledSales: totals.revenue - credit,
        creditSales: credit,
        receivablePaid: repaid,
      },
    };
  }

  /** Per product; bounded by catalog size, so uncapped. Sale-level discount and tax appear only in totals. */
  async products(tenantId: string, range: DateRange) {
    const tz = await this.timezone(tenantId);
    const { start, end } = this.bounds(range, tz);
    const [rows, totals] = await Promise.all([
      // A product sold and voided inside the range nets to nothing and is left out.
      this.rows(sql`
        select p.id, p.sku, p.name, sum(x.base_qty) as qty, sum(x.line_total) as sales,
               sum(x.cost_total) as cost
          from ${this.lineRows(tenantId, start, end)} x
          join pos.products p on p.tenant_id = ${tenantId} and p.id = x.product_id
         group by p.id
        having sum(x.base_qty) <> 0 or sum(x.line_total) <> 0 or sum(x.cost_total) <> 0
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
    const sums = (table: SQL, only: SQL = sql``) => sql`
      select count(*) as n, coalesce(sum(x.subtotal), 0) as gross_sales,
             coalesce(sum(x.discount), 0) as discount,
             coalesce(sum(x.voucher_discount), 0) as voucher, coalesce(sum(x.tax), 0) as tax,
             coalesce(sum(x.total), 0) as revenue, coalesce(sum(x.cost_total), 0) as cost,
             coalesce(sum(x.rounding), 0) as rounding
        from ${table} x
       where x.tenant_id = sh.tenant_id and x.shift_id = sh.id ${only}`;
    // A shift's row = the sales rung up in it minus the voids done in it (UMK-1962). The shift a voided
    // sale was rung up in keeps that sale, so a closed shift's row never changes. Each part is
    // aggregated apart (lateral), so none multiplies another's rows.
    const rows = await this.rows(sql`
      select sh.id, sh.actor_kind, st.name as staff_name,
             to_char(sh.opened_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as opened_at,
             to_char(sh.closed_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as closed_at,
             sh.opening_cash, sh.expected_cash, sh.counted_cash,
             c.cash_in, c.cash_out, c.receivable_payments, c.void_refunds,
             c.expenses, c.expense_reversals, c.manual_in, c.manual_out, c.collector_deposits,
             s.n - v.n as sales_count, s.gross_sales - v.gross_sales as gross_sales,
             s.discount - v.discount as discount, s.voucher - v.voucher as voucher,
             s.tax - v.tax as tax, s.revenue - v.revenue as revenue, s.cost - v.cost as cost,
             s.rounding - v.rounding as rounding, v.n as void_count
        from pos.shifts sh
        left join pos.staff st on st.tenant_id = sh.tenant_id and st.id = sh.actor_id
        cross join lateral (${sums(sql`pos.sales`, FINAL)}) s
        cross join lateral (${sums(sql`pos.sale_voids`)}) v
        cross join lateral (
          select coalesce(sum(e.amount) filter (where e.direction = 'in'), 0) as cash_in,
                 coalesce(sum(e.amount) filter (where e.direction = 'out'), 0) as cash_out,
                 coalesce(sum(e.amount) filter (where e.direction = 'in' and e.kind = 'receivable_payment'), 0)
                   as receivable_payments,
                 coalesce(sum(e.amount) filter (where e.direction = 'out' and e.kind = 'void_refund'), 0)
                   as void_refunds,
                 coalesce(sum(e.amount) filter (where e.direction = 'out' and e.kind = 'expense'), 0)
                   as expenses,
                 coalesce(sum(e.amount) filter (where e.direction = 'in' and e.kind = 'expense_reversal'), 0)
                   as expense_reversals,
                 coalesce(sum(e.amount) filter (where e.direction = 'in' and e.kind = 'manual_in'), 0)
                   as manual_in,
                 coalesce(sum(e.amount) filter (where e.direction = 'out' and e.kind = 'manual_out'), 0)
                   as manual_out,
                 coalesce(sum(e.amount) filter (where e.direction = 'in' and e.kind = 'collector_deposit'), 0)
                   as collector_deposits
            from pos.shift_cash_entries e
           where e.tenant_id = sh.tenant_id and e.shift_id = sh.id) c
       where sh.tenant_id = ${tenantId} and sh.opened_at >= ${start} and sh.opened_at < ${end}
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
        receivablePayments: n(r.receivable_payments),
        voidRefunds: n(r.void_refunds),
        // Paid from the drawer (expenses and supplier payments, UMK-1984) and voided ones put back.
        expenses: n(r.expenses),
        expenseReversals: n(r.expense_reversals),
        // Cash put in or taken out of the drawer by hand (UMK-1924 U3).
        manualIn: n(r.manual_in),
        manualOut: n(r.manual_out),
        // Collectors' outside-shift cash received into the drawer ("Setoran penagih").
        collectorDeposits: n(r.collector_deposits),
        voidCount: n(r.void_count),
        cashIn: n(r.cash_in),
        cashOut: n(r.cash_out),
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
        | 'voucher'
        | 'tax'
        | 'revenue'
        | 'cost'
        | 'grossProfit'
        | 'rounding'
        | 'voidCount',
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
        voucher: sum('voucher'),
        tax: sum('tax'),
        revenue: sum('revenue'),
        cost: sum('cost'),
        grossProfit: sum('grossProfit'),
        rounding: sum('rounding'),
        voidCount: sum('voidCount'),
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
