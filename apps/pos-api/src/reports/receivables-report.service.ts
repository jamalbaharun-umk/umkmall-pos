import { Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { codedError } from '../common/validation';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { FINAL_SALE_STATUSES } from '../db/schema';
import type { ReceivableFilter } from './reports.schemas';
import { ReportsService, ROW_CAP } from './reports.service';

/** One CSV file holds at most this many kasbon rows (design feature 28, owner decision). */
export const EXPORT_MAX_ROWS = 10_000;
export const EXPORT_TOO_LARGE =
  'Laporan terlalu besar untuk satu file (lebih dari 10.000 baris). Persempit pilihan atau pilih satu pelanggan, lalu ekspor lagi.';

type Row = Record<string, unknown>;
/** A kasbon sale is never charged at a gateway, so it is always a receipt; the filter keeps that explicit. */
const FINAL_LIST = sql.raw(FINAL_SALE_STATUSES.map((s) => `'${s}'`).join(', '));
const n = (v: unknown) => Number(v ?? 0);
const days = (v: unknown) => (v == null ? null : Number(v));

/**
 * The status of open kasbon by the store's calendar date (design feature 28): `due` when its due date is today or
 * earlier, with `overdueDays` = store today − due date (a date difference, never hours; 0 = due today); `not_due`
 * otherwise, also without a due date.
 */
export type ReceivableStatus = 'due' | 'not_due';

/**
 * "Laporan kasbon" (UMK-1964): who still owes, how much, and who is overdue. Read only. Remaining = kasbon total −
 * Σ its rows in the append-only payment book (`pos.receivable_payments`); a voided kasbon (`cancelled_at`) and a
 * settled one are in no figure. Every query filters the session's tenant.
 */
@Injectable()
export class ReceivablesReportService {
  /** A field so a test can prove the limit without writing 10.001 kasbon. */
  exportMaxRows = EXPORT_MAX_ROWS;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly reports: ReportsService,
  ) {}

  private async rows(q: SQL): Promise<Row[]> {
    return [...(await this.db.execute(q))] as Row[];
  }

  /**
   * The store's open kasbon, one row each: total, paid (from the book), remaining and the store-day status.
   * `today` is the store's calendar date in `tz`.
   */
  private open(tenantId: string, tz: string, memberId?: string) {
    const today = sql`((now() at time zone ${tz})::date)`;
    return sql`(
      select r.id, r.member_id, m.name as member_name, s.number as sale_number,
             to_char(r.created_at at time zone ${tz}, 'YYYY-MM-DD') as created_on,
             to_char(r.due_date, 'YYYY-MM-DD') as due_date,
             r.total, coalesce(p.paid, 0) as paid, r.total - coalesce(p.paid, 0) as rest,
             case when r.due_date is not null and r.due_date <= ${today}
                  then ${today} - r.due_date end as overdue_days
        from pos.receivables r
        join pos.members m on m.tenant_id = r.tenant_id and m.id = r.member_id
        join pos.sales s on s.tenant_id = r.tenant_id and s.id = r.sale_id and s.status in (${FINAL_LIST})
        left join lateral (
          select sum(rp.amount) as paid from pos.receivable_payments rp
           where rp.tenant_id = r.tenant_id and rp.receivable_id = r.id) p on true
       where r.tenant_id = ${tenantId} and r.cancelled_at is null
         and r.total - coalesce(p.paid, 0) > 0
         ${memberId ? sql`and r.member_id = ${memberId}` : sql``})`;
  }

  /**
   * Cash collectors took outside every shift and have not deposited yet (the "Setoran penagih" rule: Σ store
   * ledger `in` of kind `receivable_payment` − Σ store ledger `out` of kind `receivable_reversal`, the corrected
   * ones (UMK-1971) − Σ deposits). It already lowered the customers' remaining.
   */
  private async collectorHeld(tenantId: string) {
    const [r] = await this.rows(sql`
      select (select coalesce(sum(e.amount), 0) from pos.store_cash_entries e
               where e.tenant_id = ${tenantId} and e.direction = 'in' and e.kind = 'receivable_payment')
           - (select coalesce(sum(e.amount), 0) from pos.store_cash_entries e
               where e.tenant_id = ${tenantId} and e.direction = 'out' and e.kind = 'receivable_reversal')
           - (select coalesce(sum(d.amount), 0) from pos.store_cash_deposits d
               where d.tenant_id = ${tenantId}) as held`);
    return n(r.held);
  }

  /** The summary tiles; also the dashboard card. */
  async summary(tenantId: string) {
    const tz = await this.reports.timezone(tenantId);
    const local = sql`(now() at time zone ${tz})`;
    const [[r], paid, collectorHeld] = await Promise.all([
      this.rows(sql`
        select to_char(${local}, 'YYYY-MM-DD') as today,
               coalesce(sum(o.rest), 0) as total_rest,
               coalesce(sum(o.rest) filter (where o.overdue_days is not null), 0) as due_rest,
               count(distinct o.member_id) as customers,
               count(distinct o.member_id) filter (where o.overdue_days is not null) as due_customers
          from ${this.open(tenantId, tz)} o`),
      this.reports.receivablePaid(
        tenantId,
        sql`(date_trunc('month', ${local}) at time zone ${tz})`,
        sql`now()`,
      ),
      this.collectorHeld(tenantId),
    ]);
    return {
      timezone: tz,
      today: r.today as string,
      totalRest: n(r.total_rest),
      dueRest: n(r.due_rest),
      customers: n(r.customers),
      dueCustomers: n(r.due_customers),
      // Instalments received this calendar month in the store's timezone (the sales report's "Piutang dibayar").
      paidThisMonth: paid,
      collectorHeld,
    };
  }

  /**
   * The dashboard card "Piutang menurut umur" (design feature 35): what is still owed, by how late it is on the store's
   * calendar date. `Belum jatuh tempo` has a due date after today; a kasbon due today counts as late 0 days and is in
   * `1 sampai 7 hari`, so the three late buckets add up to the summary's `dueRest` and every bucket to its `totalRest`.
   */
  async aging(tenantId: string) {
    const tz = await this.reports.timezone(tenantId);
    const [r] = await this.rows(sql`
      select to_char((now() at time zone ${tz}), 'YYYY-MM-DD') as today,
             count(distinct o.member_id) as customers,
             coalesce(sum(o.rest), 0) as total,
             coalesce(sum(o.rest) filter (where o.overdue_days is null), 0) as a_amount,
             count(distinct o.member_id) filter (where o.overdue_days is null) as a_customers,
             coalesce(sum(o.rest) filter (where o.overdue_days between 0 and 7), 0) as b_amount,
             count(distinct o.member_id) filter (where o.overdue_days between 0 and 7) as b_customers,
             coalesce(sum(o.rest) filter (where o.overdue_days between 8 and 30), 0) as c_amount,
             count(distinct o.member_id) filter (where o.overdue_days between 8 and 30) as c_customers,
             coalesce(sum(o.rest) filter (where o.overdue_days > 30), 0) as d_amount,
             count(distinct o.member_id) filter (where o.overdue_days > 30) as d_customers
        from ${this.open(tenantId, tz)} o`);
    const bucket = (key: string, label: string, k: 'a' | 'b' | 'c' | 'd') => ({
      key,
      label,
      amount: n(r[`${k}_amount`]),
      customers: n(r[`${k}_customers`]),
    });
    return {
      timezone: tz,
      today: r.today as string,
      total: n(r.total),
      customers: n(r.customers),
      buckets: [
        bucket('not_due', 'Belum jatuh tempo', 'a'),
        bucket('late_1_7', '1 sampai 7 hari', 'b'),
        bucket('late_8_30', '8 sampai 30 hari', 'c'),
        bucket('late_over_30', 'Lebih dari 30 hari', 'd'),
      ],
    };
  }

  /** Summary plus the customers who still owe, the most overdue first. */
  async list(tenantId: string, filter: ReceivableFilter) {
    const tz = await this.reports.timezone(tenantId);
    const having =
      filter === 'due'
        ? sql`having max(o.overdue_days) is not null`
        : filter === 'not_due'
          ? sql`having max(o.overdue_days) is null`
          : sql``;
    const [summary, rows] = await Promise.all([
      this.summary(tenantId),
      this.rows(sql`
        select o.member_id, o.member_name, count(*) as kasbon_count, sum(o.total) as total,
               sum(o.paid) as paid, sum(o.rest) as rest,
               coalesce(sum(o.rest) filter (where o.overdue_days is not null), 0) as due_rest,
               min(o.due_date) as oldest_due_date, max(o.overdue_days) as overdue_days
          from ${this.open(tenantId, tz)} o
         group by o.member_id, o.member_name
         ${having}
         order by max(o.overdue_days) desc nulls last, min(o.due_date) nulls last, sum(o.rest) desc,
                  o.member_name, o.member_id
         limit ${ROW_CAP + 1}`),
    ]);
    return {
      filter,
      summary,
      truncated: rows.length > ROW_CAP,
      rows: rows.slice(0, ROW_CAP).map((r) => {
        const overdueDays = days(r.overdue_days);
        return {
          memberId: r.member_id as string,
          name: r.member_name as string,
          kasbonCount: n(r.kasbon_count),
          total: n(r.total),
          paid: n(r.paid),
          rest: n(r.rest),
          dueRest: n(r.due_rest),
          oldestDueDate: (r.oldest_due_date as string | null) ?? null,
          overdueDays,
          status: overdueDays === null ? 'not_due' : 'due',
        };
      }),
    };
  }

  /** One customer's open kasbon with their payments (oldest first). 404 when the member is not this store's. */
  async customer(tenantId: string, memberId: string) {
    const tz = await this.reports.timezone(tenantId);
    const [member] = await this.rows(
      sql`select id, name from pos.members where tenant_id = ${tenantId} and id = ${memberId}`,
    );
    if (!member) throw new NotFoundException();
    const kasbon = await this.rows(sql`
      select o.* from ${this.open(tenantId, tz, memberId)} o
       order by o.due_date nulls last, o.created_on, o.sale_number`);
    const ids = kasbon.map((k) => k.id as string);
    const payments = ids.length
      ? await this.rows(sql`
          select rp.id, rp.receivable_id, rp.amount, pm.name as method, rp.collected_outside_shift,
                 to_char(rp.created_at at time zone ${tz}, 'YYYY-MM-DD') as paid_on
            from pos.receivable_payments rp
            join pos.payment_methods pm on pm.tenant_id = rp.tenant_id and pm.id = rp.payment_method_id
           where rp.tenant_id = ${tenantId}
             and rp.receivable_id in (${sql.join(
               ids.map((id) => sql`${id}::uuid`),
               sql`, `,
             )})
           order by rp.created_at, rp.id`)
      : [];
    const receivables = kasbon.map((k) => {
      const overdueDays = days(k.overdue_days);
      return {
        id: k.id as string,
        saleNumber: n(k.sale_number),
        createdOn: k.created_on as string,
        dueDate: (k.due_date as string | null) ?? null,
        total: n(k.total),
        paid: n(k.paid),
        rest: n(k.rest),
        overdueDays,
        status: overdueDays === null ? 'not_due' : 'due',
        payments: payments
          .filter((p) => p.receivable_id === k.id)
          .map((p) => ({
            id: p.id as string,
            paidOn: p.paid_on as string,
            amount: n(p.amount),
            method: p.method as string,
            // Taken by a collector outside a shift: with them until a deposit is received.
            byCollector: p.collected_outside_shift === true,
          })),
      };
    });
    return {
      timezone: tz,
      memberId: member.id as string,
      name: member.name as string,
      rest: receivables.reduce((a, r) => a + r.rest, 0),
      receivables,
    };
  }

  /**
   * CSV rows: one per open kasbon, the most overdue first. Columns: customer, kasbon, paid, remaining, due date,
   * days late. Never the phone number. More than `exportMaxRows` rows answers 422 `EXPORT_TOO_LARGE`.
   */
  async csvRows(tenantId: string, filter: ReceivableFilter, memberId?: string) {
    const tz = await this.reports.timezone(tenantId);
    const where =
      filter === 'due'
        ? sql`where o.overdue_days is not null`
        : filter === 'not_due'
          ? sql`where o.overdue_days is null`
          : sql``;
    const rows = await this.rows(sql`
      select o.member_name, o.total, o.paid, o.rest, o.due_date, o.overdue_days
        from ${this.open(tenantId, tz, memberId)} o
        ${where}
       order by o.overdue_days desc nulls last, o.due_date nulls last, o.member_name, o.sale_number
       limit ${this.exportMaxRows + 1}`);
    if (rows.length > this.exportMaxRows)
      throw codedError('EXPORT_TOO_LARGE', '_', EXPORT_TOO_LARGE, {
        maxRows: this.exportMaxRows,
      });
    return rows.map((r) => [
      r.member_name as string,
      n(r.total),
      n(r.paid),
      n(r.rest),
      (r.due_date as string | null) ?? null,
      days(r.overdue_days) ?? 0,
    ]);
  }
}
