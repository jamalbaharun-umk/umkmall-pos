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
  /** Σ returns at batch cost. */
  returned: number;
  /** due date − the store's today, in days (negative once past); null without a due date. */
  dueInDays: number | null;
};

export type Debt = {
  paid: number;
  returned: number;
  /** What is still owed, never below 0; null for a draft or a cancelled purchase (no debt yet / any more). */
  remaining: number | null;
  /** Payments and returns above the total: money the supplier owes back, outside the system. */
  credit: number;
  paymentStatus: PaymentStatus | null;
  /** Days past the due date while something is still owed; null when not late. */
  overdueDays: number | null;
  dueInDays: number | null;
};

export function debtOf(o: DebtInput): Debt {
  if (o.status !== 'approved')
    return {
      paid: o.paid,
      returned: o.returned,
      remaining: null,
      credit: 0,
      paymentStatus: null,
      overdueDays: null,
      dueInDays: o.dueInDays,
    };
  const remaining = Math.max(0, o.total - o.returned - o.paid);
  const paymentStatus: PaymentStatus =
    remaining === 0 ? 'lunas' : o.paid > 0 ? 'sebagian' : 'belum_bayar';
  const late =
    paymentStatus !== 'lunas' && o.dueInDays !== null && o.dueInDays < 0;
  return {
    paid: o.paid,
    returned: o.returned,
    remaining,
    credit: Math.max(0, o.paid + o.returned - o.total),
    paymentStatus,
    overdueDays: late ? -o.dueInDays! : null,
    dueInDays: o.dueInDays,
  };
}

/** Σ live payments of the purchase row in scope (`purchase_orders` in the outer query). */
export const paidSql = sql<string>`coalesce((select sum(pp.amount) from pos.purchase_payments pp
  where pp.tenant_id = ${purchaseOrders.tenantId} and pp.order_id = ${purchaseOrders.id}
    and pp.voided_at is null), 0)`;

/** Σ returns (at batch cost) of the purchase row in scope. */
export const returnedSql = sql<string>`coalesce((select sum(pr.total) from pos.purchase_returns pr
  where pr.tenant_id = ${purchaseOrders.tenantId} and pr.order_id = ${purchaseOrders.id}), 0)`;

/** due date − the store's today (store timezone), in days; null without a due date. */
export const dueInDaysSql = (tenantId: string): SQL<number | null> =>
  sql<
    number | null
  >`(${purchaseOrders.dueDate} - ${storeToday(tenantId)})::int`;

/** Reads the three figures off a row selected with the fragments above. */
export const debtFromRow = (r: {
  status: DebtInput['status'];
  total: number;
  paid: string | number;
  returned: string | number;
  dueInDays: number | null;
}) =>
  debtOf({
    status: r.status,
    total: r.total,
    paid: Number(r.paid),
    returned: Number(r.returned),
    dueInDays: r.dueInDays === null ? null : Number(r.dueInDays),
  });
