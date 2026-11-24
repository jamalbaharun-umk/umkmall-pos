import type { PaymentStatus } from '../db/schema';

/**
 * Statuses only move forward by rank (design doc, rule 5). From rank 2 there is no way to `paid`: money that
 * arrives for a failed, expired or cancelled payment is recorded as an unmatched receipt instead.
 */
export const RANK: Record<PaymentStatus, number> = {
  created: 0,
  pending: 1,
  failed: 2,
  expired: 2,
  cancelled: 2,
  paid: 3,
  refund_pending: 4,
  refunded: 5,
  refund_failed: 5,
  voided: 5,
};

/**
 * The only status moves a payment may make. News that arrives late or out of order is ignored when the payment
 * is already further on.
 *
 * `created` may go wherever `pending` may: the PG can hold a bill whose answer we never stored (a timeout, or a
 * webhook that beat the charge response). `refund_failed → refund_pending` (the refund is tried again) is the
 * one move that lowers the rank; `refund_failed → refunded` is the owner marking the money as returned by hand.
 */
const MOVES: Record<PaymentStatus, readonly PaymentStatus[]> = {
  created: ['pending', 'paid', 'failed', 'expired', 'cancelled'],
  pending: ['paid', 'failed', 'expired', 'cancelled'],
  failed: [],
  expired: [],
  cancelled: [],
  paid: ['voided', 'refund_pending'],
  refund_pending: ['refunded', 'refund_failed'],
  refund_failed: ['refund_pending', 'refunded'],
  voided: [],
  refunded: [],
};

export const canMove = (from: PaymentStatus, to: PaymentStatus): boolean =>
  MOVES[from].includes(to);

/** Closed without payment. Money that shows up now is late: it never reopens the payment. */
export const CLOSED_UNPAID: readonly PaymentStatus[] = [
  'failed',
  'expired',
  'cancelled',
];

/** Still waiting on the PG: the reconciliation asks about these, and a tenant with one cannot be purged. */
export const IN_FLIGHT: readonly PaymentStatus[] = [
  'created',
  'pending',
  'refund_pending',
];
