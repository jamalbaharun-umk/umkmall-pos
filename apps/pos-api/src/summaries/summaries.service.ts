import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { AGENT_LABEL, FINAL_SALE_STATUSES, salesSettings } from '../db/schema';
import { ReceivablesReportService } from '../reports/receivables-report.service';
import { ReportsService } from '../reports/reports.service';

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const FINAL_LIST = sql.raw(FINAL_SALE_STATUSES.map((s) => `'${s}'`).join(', '));

/** The most rows a list inside a summary carries: a picture shows the top, the menu's list has the rest. */
export const TOP = 5;

/**
 * The read-only summaries above each menu (design feature 39). Every query filters the session's tenant; the
 * caller (controller) decides what the actor may see, and passes `money` = holds `reports.view` for the figures
 * that reveal cost or profit (they come back `null` without it). Dates are the store's days in its timezone.
 * Daily totals follow the report rule (sales by `paid_at` minus voids by the day they were done); the shares per
 * menu (customer, method, category, cashier) count completed receipts, a voided one leaves them.
 */
@Injectable()
export class SummariesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly reports: ReportsService,
    private readonly receivables: ReceivablesReportService,
  ) {}

  private async rows(q: SQL): Promise<Row[]> {
    return [...(await this.db.execute(q))] as Row[];
  }

  /** Store-local "now" and the start of its current month as a timestamptz. */
  private clock(tz: string) {
    const local = sql`(now() at time zone ${tz})`;
    return {
      today: sql`(${local}::date)`,
      monthStart: sql`(date_trunc('month', ${local}) at time zone ${tz})`,
    };
  }

  /** The last `count` store days (oldest first, today last) with the net sales total and receipt count of each. */
  async dayTotals(tenantId: string, tz: string, count: number) {
    const { today } = this.clock(tz);
    const rows = await this.rows(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day,
             (select coalesce(sum(s.total), 0) from pos.sales s
               where s.tenant_id = ${tenantId} and s.status in (${FINAL_LIST})
                 and (s.paid_at at time zone ${tz})::date = d.day)
           - (select coalesce(sum(v.total), 0) from pos.sale_voids v
               where v.tenant_id = ${tenantId} and (v.created_at at time zone ${tz})::date = d.day) as total,
             (select count(*) from pos.sales s
               where s.tenant_id = ${tenantId} and s.status in (${FINAL_LIST})
                 and (s.paid_at at time zone ${tz})::date = d.day)
           - (select count(*) from pos.sale_voids v
               where v.tenant_id = ${tenantId} and (v.created_at at time zone ${tz})::date = d.day) as receipts
        from generate_series(${today} - ${count - 1}::int, ${today}, interval '1 day') as d(day)
       order by d.day`);
    return rows.map((r) => ({
      date: r.day as string,
      total: n(r.total),
      count: n(r.receipts),
    }));
  }

  async salesHistory(tenantId: string) {
    const tz = await this.reports.timezone(tenantId);
    const { today } = this.clock(tz);
    const days = await this.dayTotals(tenantId, tz, 7);
    const methods = await this.rows(sql`
      select pm.name, sum(x.amount) as amount
        from (select s.payment_method_id as pm_id, s.total as amount
                from pos.sales s
               where s.tenant_id = ${tenantId} and s.status in (${FINAL_LIST})
                 and (s.paid_at at time zone ${tz})::date = ${today}
              union all
              select s.payment_method_id, -v.total
                from pos.sale_voids v
                join pos.sales s on s.tenant_id = v.tenant_id and s.id = v.sale_id
               where v.tenant_id = ${tenantId}
                 and (v.created_at at time zone ${tz})::date = ${today}) x
        join pos.payment_methods pm on pm.tenant_id = ${tenantId} and pm.id = x.pm_id
       group by pm.id, pm.name
      having sum(x.amount) > 0
       order by amount desc, pm.name`);
    const now = days[days.length - 1];
    return {
      timezone: tz,
      today: { count: now.count, total: now.total },
      days,
      methods: methods.map((m) => ({
        name: m.name as string,
        amount: n(m.amount),
      })),
    };
  }

  /** `money`: the spend per top customer (else their receipt count only); `withKasbon`: the kasbon still owed. */
  async members(tenantId: string, money: boolean, withKasbon: boolean) {
    const tz = await this.reports.timezone(tenantId);
    const { monthStart } = this.clock(tz);
    const [[count], top, [fresh], kasbon] = await Promise.all([
      this.rows(
        sql`select count(*) as n from pos.members where tenant_id = ${tenantId} and deleted_at is null`,
      ),
      this.rows(sql`
        select m.name, count(*) as receipts, sum(s.total) as amount
          from pos.sales s
          join pos.members m on m.tenant_id = s.tenant_id and m.id = s.member_id
         where s.tenant_id = ${tenantId} and s.status = 'completed' and s.paid_at >= ${monthStart}
           and m.deleted_at is null
         group by m.id, m.name
         order by ${money ? sql`amount` : sql`receipts`} desc, m.name
         limit ${TOP}`),
      this.rows(sql`
        select count(*) filter (where first_paid >= ${monthStart}) as fresh,
               count(*) filter (where first_paid < ${monthStart}) as returning
          from (select member_id, min(paid_at) as first_paid
                  from pos.sales
                 where tenant_id = ${tenantId} and status = 'completed' and member_id is not null
                 group by member_id
                having count(*) filter (where paid_at >= ${monthStart}) > 0) m`),
      withKasbon
        ? this.receivables.summary(tenantId).then((s) => s.totalRest)
        : Promise.resolve(null),
    ]);
    return {
      total: n(count.n),
      kasbonRest: kasbon,
      top: top.map((r) => ({
        name: r.name as string,
        receipts: n(r.receipts),
        amount: money ? n(r.amount) : null,
      })),
      newCount: n(fresh.fresh),
      returningCount: n(fresh.returning),
    };
  }

  /** Stock-tracked products on the shelf: `ok`, `low` (at or under its minimum) and `out` (nothing left). */
  async products(tenantId: string, money: boolean) {
    const [status] = await this.rows(sql`
      select count(*) as total,
             count(*) filter (where on_hand <= 0) as out,
             count(*) filter (where on_hand > 0 and on_hand <= low_stock_threshold) as low,
             count(*) filter (where on_hand > low_stock_threshold) as ok,
             count(*) filter (where cost_price = 0) as no_cost
        from (select p.cost_price, p.low_stock_threshold,
                     coalesce((select sum(b.qty_remaining) from pos.stock_batches b
                                where b.tenant_id = p.tenant_id and b.product_id = p.id), 0) as on_hand
                from pos.products p
               where p.tenant_id = ${tenantId} and p.deleted_at is null and p.is_active
                 and p.type = 'product') x`);
    const margins = money
      ? await this.rows(sql`
          select name, round((selling_price - cost_price) * 100.0 / selling_price) as percent
            from pos.products
           where tenant_id = ${tenantId} and deleted_at is null and is_active and type = 'product'
             and cost_price > 0 and selling_price > 0
           order by percent desc, name
           limit ${TOP}`)
      : null;
    return {
      total: n(status.total),
      stock: { ok: n(status.ok), low: n(status.low), out: n(status.out) },
      attention: n(status.low) + n(status.out),
      margins: margins
        ? margins.map((r) => ({
            name: r.name as string,
            percent: n(r.percent),
          }))
        : null,
      noCost: money ? n(status.no_cost) : null,
    };
  }

  /** This month's use per method; the rupiah per method only with `money`, else the counts. */
  async paymentMethods(tenantId: string, money: boolean) {
    const tz = await this.reports.timezone(tenantId);
    const { monthStart } = this.clock(tz);
    const [rows, [active]] = await Promise.all([
      this.rows(sql`
        select pm.name, count(*) as uses, sum(s.total) as amount
          from pos.sales s
          join pos.payment_methods pm on pm.tenant_id = s.tenant_id and pm.id = s.payment_method_id
         where s.tenant_id = ${tenantId} and s.status = 'completed' and s.paid_at >= ${monthStart}
         group by pm.id, pm.name
         order by ${money ? sql`amount` : sql`uses`} desc, pm.name`),
      this.rows(
        sql`select count(*) as n from pos.payment_methods where tenant_id = ${tenantId} and deleted_at is null`,
      ),
    ]);
    return {
      activeCount: n(active.n),
      methods: rows.map((r) => ({
        name: r.name as string,
        uses: n(r.uses),
        amount: money ? n(r.amount) : null,
      })),
    };
  }

  /** The latest approved stock opname: counted minus system, per product, and what the shortage was worth. */
  async stockOpname(tenantId: string, money: boolean) {
    const [latest] = await this.rows(sql`
      select id, to_char(approved_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as approved_at
        from pos.stock_opnames
       where tenant_id = ${tenantId} and status = 'approved'
       order by approved_at desc nulls last, created_at desc
       limit 1`);
    if (!latest) return { opname: null };
    const lines = await this.rows(sql`
      select p.name, l.counted_qty - l.system_qty as diff, p.cost_price
        from pos.stock_opname_lines l
        join pos.products p on p.tenant_id = l.tenant_id and p.id = l.product_id
       where l.tenant_id = ${tenantId} and l.opname_id = ${latest.id as string}
         and l.counted_qty <> l.system_qty
       order by abs(l.counted_qty - l.system_qty) desc, p.name`);
    const diffs = lines.map((l) => n(l.diff));
    return {
      opname: {
        id: latest.id as string,
        approvedAt: latest.approved_at as string,
      },
      shortQty: diffs.filter((d) => d < 0).reduce((a, d) => a + d, 0),
      overQty: diffs.filter((d) => d > 0).reduce((a, d) => a + d, 0),
      shortValue: money
        ? lines
            .filter((l) => n(l.diff) < 0)
            .reduce((a, l) => a + n(l.diff) * n(l.cost_price), 0)
        : null,
      lines: lines
        .slice(0, 8)
        .map((l) => ({ name: l.name as string, diff: n(l.diff) })),
    };
  }

  /** Vouchers still valid: quota used against the full quota (remaining + used), and redemptions of the last 7 days. */
  async vouchers(tenantId: string) {
    const tz = await this.reports.timezone(tenantId);
    const { today } = this.clock(tz);
    const [rows, days] = await Promise.all([
      this.rows(sql`
        select v.name, v.code, v.kuota as remaining,
               (select count(*) from pos.sales s
                 where s.tenant_id = v.tenant_id and s.voucher_id = v.id
                   and s.status in ('completed', 'awaiting_payment')) as used
          from pos.vouchers v
         where v.tenant_id = ${tenantId} and v.deleted_at is null and v.expired >= ${today}
         order by used desc, v.name
         limit 8`),
      this.rows(sql`
        select to_char(d.day, 'YYYY-MM-DD') as day,
               (select count(*) from pos.sales s
                 where s.tenant_id = ${tenantId} and s.voucher_id is not null and s.status = 'completed'
                   and (s.paid_at at time zone ${tz})::date = d.day) as redeemed
          from generate_series(${today} - 6, ${today}, interval '1 day') as d(day)
         order by d.day`),
    ]);
    return {
      vouchers: rows.map((r) => ({
        name: r.name as string,
        code: r.code as string,
        used: n(r.used),
        quota: n(r.used) + n(r.remaining),
      })),
      days: days.map((d) => ({ date: d.day as string, count: n(d.redeemed) })),
    };
  }

  async categories(tenantId: string, money: boolean) {
    const tz = await this.reports.timezone(tenantId);
    const { monthStart } = this.clock(tz);
    const cats = await this.rows(sql`
      select c.id, c.name,
             (select count(*) from pos.products p
               where p.tenant_id = c.tenant_id and p.category_id = c.id and p.deleted_at is null) as products
        from pos.categories c
       where c.tenant_id = ${tenantId}
       order by c.name`);
    const revenue = new Map<string, number>();
    const stock = new Map<string, number>();
    if (money) {
      for (const r of await this.rows(sql`
        select p.category_id as id, sum(l.line_total - l.discount) as amount
          from pos.sale_lines l
          join pos.sales s on s.tenant_id = l.tenant_id and s.id = l.sale_id
          join pos.products p on p.tenant_id = l.tenant_id and p.id = l.product_id
         where s.tenant_id = ${tenantId} and s.status = 'completed' and s.paid_at >= ${monthStart}
         group by p.category_id`))
        revenue.set(r.id as string, n(r.amount));
      for (const r of await this.rows(sql`
        select p.category_id as id, sum(b.qty_remaining * b.unit_cost) as amount
          from pos.stock_batches b
          join pos.products p on p.tenant_id = b.tenant_id and p.id = b.product_id
         where b.tenant_id = ${tenantId} and p.deleted_at is null
         group by p.category_id`))
        stock.set(r.id as string, n(r.amount));
    }
    return {
      categories: cats.map((c) => ({
        name: c.name as string,
        products: n(c.products),
        revenue: money ? (revenue.get(c.id as string) ?? 0) : null,
        stockValue: money ? (stock.get(c.id as string) ?? 0) : null,
      })),
    };
  }

  /**
   * This month's receipts per cashier (the owner is "Pemilik"), their rupiah only with `money`, and receipts per
   * hour of the store day.
   */
  async staff(tenantId: string, money: boolean) {
    const tz = await this.reports.timezone(tenantId);
    const { monthStart } = this.clock(tz);
    const [cashiers, hours] = await Promise.all([
      this.rows(sql`
        select case s.actor_kind when 'owner' then 'Pemilik'
                                 when 'agent' then ${AGENT_LABEL}
                                 else coalesce(st.name, 'Staf') end as name,
               count(*) as receipts, sum(s.total) as amount
          from pos.sales s
          left join pos.staff st on st.tenant_id = s.tenant_id and st.id = s.actor_id
         where s.tenant_id = ${tenantId} and s.status = 'completed' and s.paid_at >= ${monthStart}
         group by 1
         order by ${money ? sql`amount` : sql`receipts`} desc, 1
         limit 8`),
      this.rows(sql`
        select extract(hour from s.paid_at at time zone ${tz})::int as hour, count(*) as receipts
          from pos.sales s
         where s.tenant_id = ${tenantId} and s.status = 'completed' and s.paid_at >= ${monthStart}
         group by 1`),
    ]);
    const perHour = Array.from({ length: 24 }, () => 0);
    for (const h of hours) perHour[n(h.hour)] = n(h.receipts);
    return {
      cashiers: cashiers.map((c) => ({
        name: c.name as string,
        receipts: n(c.receipts),
        amount: money ? n(c.amount) : null,
      })),
      hours: perHour,
    };
  }

  /** Approved purchases per month, the last six store months (oldest first). */
  async suppliers(tenantId: string) {
    const tz = await this.reports.timezone(tenantId);
    const { today } = this.clock(tz);
    const [months, [count]] = await Promise.all([
      this.rows(sql`
        select to_char(m.month, 'YYYY-MM') as month,
               (select coalesce(sum(o.total), 0) from pos.purchase_orders o
                 where o.tenant_id = ${tenantId} and o.status = 'approved'
                   and date_trunc('month', o.approved_at at time zone ${tz}) = m.month) as total
          from generate_series(date_trunc('month', ${today}::timestamp) - interval '5 months',
                               date_trunc('month', ${today}::timestamp), interval '1 month') as m(month)
         order by m.month`),
      this.rows(
        sql`select count(*) as n from pos.suppliers where tenant_id = ${tenantId} and deleted_at is null`,
      ),
    ]);
    return {
      supplierCount: n(count.n),
      months: months.map((m) => ({
        month: m.month as string,
        total: n(m.total),
      })),
    };
  }

  /** "Kelengkapan toko": the steps of setting the store up, each done or not. */
  async setup(tenantId: string) {
    const [r] = await this.rows(sql`
      select exists (select 1 from pos.store_profiles where tenant_id = ${tenantId} and name <> '') as profile,
             exists (select 1 from pos.products where tenant_id = ${tenantId} and deleted_at is null) as products,
             exists (select 1 from pos.payment_methods where tenant_id = ${tenantId} and deleted_at is null) as methods,
             exists (select 1 from pos.sales_settings where tenant_id = ${tenantId} and tax_set_at is not null) as tax`);
    const steps = [
      {
        key: 'profile',
        label: 'Profil dan struk',
        done: r.profile === true,
        to: '/pengaturan',
      },
      {
        key: 'products',
        label: 'Produk',
        done: r.products === true,
        to: '/catalog',
      },
      {
        key: 'methods',
        label: 'Metode pembayaran',
        done: r.methods === true,
        to: '/metode-pembayaran',
      },
      { key: 'tax', label: 'Pajak', done: r.tax === true, to: '/pengaturan' },
    ];
    return {
      steps,
      doneCount: steps.filter((s) => s.done).length,
      complete: steps.every((s) => s.done),
    };
  }

  /**
   * Today's net sales against the owner's target. `money` = the actor holds `reports.view`: only then the rupiah
   * figures (`target`, `today`) come back. A cashier without it sees only whether a target is set and the percent,
   * never the store's takings (GET /sales shows them only their own sales); with no target, no figure at all.
   */
  async dailyTarget(tenantId: string, money: boolean) {
    const [row] = await this.rows(
      sql`select daily_target from pos.sales_settings where tenant_id = ${tenantId}`,
    );
    const target = row?.daily_target == null ? null : n(row.daily_target);
    if (target === null && !money)
      return { set: false, target: null, today: null, percent: null };
    const tz = await this.reports.timezone(tenantId);
    const total = (await this.dayTotals(tenantId, tz, 1))[0].total;
    // Whole percent, may pass 100; none without a target.
    const percent = target
      ? Math.max(0, Math.floor((total * 100) / target))
      : null;
    return {
      set: target !== null,
      target: money ? target : null,
      today: money ? total : null,
      percent,
    };
  }

  async setDailyTarget(tenantId: string, target: number | null) {
    await this.db
      .insert(salesSettings)
      .values({ tenantId, dailyTarget: target })
      .onConflictDoUpdate({
        target: salesSettings.tenantId,
        set: { dailyTarget: target },
      });
    return this.dailyTarget(tenantId, true);
  }
}
