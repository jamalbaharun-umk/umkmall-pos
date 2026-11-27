import { sql, type SQL } from 'drizzle-orm';
import { storeToday } from '../common/store-day';
import { purchaseOrders } from '../db/schema';

/**
 * A purchase's debt to its supplier (UMK-1970, design feature 29). Pure: the figures come from the database
 * (`paidSql`, `returnedSql`, `dueInDaysSql`), this only combines them, so the list, the detail and the payment
 * check agree.
 */

export type PaymentStatus = 'belum_bayar' | 'sebagian' | 'lunas';

export type DebtInput = {
  status: 'draft' | 'approved' | 'cancelled';
  total: number;
  /** Σ live (not voided) payments. */
  paid: number;
  /** Σ returns at batch cost, the undone ones left out. */
  returned: number;
  /** Σ live (not voided) money the supplier handed back. */
  refunded?: number;
  /** due date − the store's today, in days (negative once past); null without a due date. */
  dueInDays: number | null;
};

export type Debt = {
  paid: number;
  returned: number;
  /** What is still owed, never below 0; null for a draft or a cancelled purchase (no debt yet / any more). */
  remaining: number | null;
  /** Payments and returns above the total: what the supplier owes back in all. */
  credit: number;
  /** Of that, what the supplier has handed back (live refunds); never above `credit`. */
  refunded: number;
  /** What is still to come back from the supplier: credit − refunded. */
  refundDue: number;
  paymentStatus: PaymentStatus | null;
  /** Days past the due date while something is still owed; null when not late. */
  overdueDays: number | null;
  dueInDays: number | null;
};

export function debtOf(o: DebtInput): Debt {
  const refunded = o.refunded ?? 0;
  if (o.status !== 'approved')
    return {
      paid: o.paid,
      returned: o.returned,
      remaining: null,
      credit: 0,
      refunded,
      refundDue: 0,
      paymentStatus: null,
      overdueDays: null,
      dueInDays: o.dueInDays,
    };
  const remaining = Math.max(0, o.total - o.returned - o.paid);
  const paymentStatus: PaymentStatus =
    remaining === 0 ? 'lunas' : o.paid > 0 ? 'sebagian' : 'belum_bayar';
  const late =
    paymentStatus !== 'lunas' && o.dueInDays !== null && o.dueInDays < 0;
  const credit = Math.max(0, o.paid + o.returned - o.total);
  return {
    paid: o.paid,
    returned: o.returned,
    remaining,
    credit,
    refunded,
    // Never negative: every write keeps refunded <= credit under the purchase's lock.
    refundDue: Math.max(0, credit - refunded),
    paymentStatus,
    overdueDays: late ? -o.dueInDays! : null,
    dueInDays: o.dueInDays,
  };
}

/**
 * The credit a purchase would have: what payments and returns put above its total. The writes that lower it (a void,
 * an undone return) refuse to go below what the supplier already handed back.
 */
export const creditOf = (total: number, paid: number, returned: number) =>
  Math.max(0, paid + returned - total);

/**
 * What each return (oldest first; an undone one counts 0) puts above the purchase's total, given the live payments
 * NOW: its share of what the supplier owes back (before refunds). Recomputed on every read, so a voided payment lowers it (never stored). The
 * running credit after return i is max(0, paid + Σ returns up to i − total); return i's share is its increase.
 */
export function refundsDue(
  total: number,
  paid: number,
  returnTotals: number[],
): number[] {
  let returned = 0;
  let credit = 0;
  return returnTotals.map((t) => {
    returned += t;
    const next = Math.max(0, paid + returned - total);
    const share = next - credit;
    credit = next;
    return share;
  });
}

/**
 * The outer row, always table-qualified. Drizzle writes a column of a single-table select unqualified ("id"), which
 * inside these subqueries would bind to the subquery's own table and silently count nothing.
 */
const PO = sql.raw('"purchase_orders"');

/** Σ live payments of the purchase row in scope (`purchase_orders` in the outer query). */
export const paidSql = sql<string>`coalesce((select sum(pp.amount) from pos.purchase_payments pp
  where pp.tenant_id = ${PO}.tenant_id and pp.order_id = ${PO}.id and pp.voided_at is null), 0)`;

/** Σ returns (at batch cost) of the purchase row in scope, the undone ones left out. */
export const returnedSql = sql<string>`coalesce((select sum(pr.total) from pos.purchase_returns pr
  where pr.tenant_id = ${PO}.tenant_id and pr.order_id = ${PO}.id
    and not exists (select 1 from pos.purchase_return_reversals rr
                     where rr.tenant_id = pr.tenant_id and rr.return_id = pr.id)), 0)`;

/** Σ live money the supplier handed back for the purchase row in scope. */
export const refundedSql = sql<string>`coalesce((select sum(rf.amount) from pos.purchase_refunds rf
  where rf.tenant_id = ${PO}.tenant_id and rf.order_id = ${PO}.id and rf.voided_at is null), 0)`;

/** due date − the store's today (store timezone), in days; null without a due date. */
export const dueInDaysSql = (tenantId: string): SQL<number | null> =>
  sql<
    number | null
  >`(${purchaseOrders.dueDate} - ${storeToday(tenantId)})::int`;

/** Reads the figures off a row selected with the fragments above. */
export const debtFromRow = (r: {
  status: DebtInput['status'];
  total: number;
  paid: string | number;
  returned: string | number;
  refunded?: string | number;
  dueInDays: number | null;
}) =>
  debtOf({
    status: r.status,
    total: r.total,
    paid: Number(r.paid),
    returned: Number(r.returned),
    refunded: Number(r.refunded ?? 0),
    dueInDays: r.dueInDays === null ? null : Number(r.dueInDays),
  });
