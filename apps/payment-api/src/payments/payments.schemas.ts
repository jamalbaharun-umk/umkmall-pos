import { z } from 'zod';
import { Paging, Reference, Rupiah } from '../common/validation';
import { PAYMENT_STATUSES } from '../db/schema';

export const IdempotencyKey = z
  .string({ required_error: 'Idempotency-Key header is required' })
  .regex(/^[A-Za-z0-9_.:-]{1,200}$/, 'Idempotency-Key header is not valid');

/** Generic terms only: an order reference and an actor reference, never a sale, a shift or a cashier. */
export const ChargeBody = z.object({
  orderRef: Reference,
  // Checked against the adapter registry, not an enum here: a new adapter needs no schema change.
  method: z.string().trim().min(1, 'Required').max(50),
  amount: Rupiah,
  // Which try at paying this order (1, 2, …). The caller's Idempotency-Key is the order reference plus this
  // number; a new attempt is accepted only once the previous payment is closed.
  attempt: z
    .number({ invalid_type_error: 'Must be a whole number' })
    .int('Must be a whole number')
    .min(1)
    .max(1000)
    .default(1),
  actorRef: Reference,
});
export type ChargeInput = z.infer<typeof ChargeBody>;

/** Why a payment is voided or refunded. Fixed codes, so reports can count per reason. */
export const CANCEL_REASONS = [
  'wrong_item_or_qty',
  'wrong_payment_method',
  'customer_cancelled',
  'duplicate_transaction',
  'goods_returned',
  'other',
] as const;

const note = z.string().trim().max(500).optional();
const noteForOther = (
  v: { reasonCode?: string; note?: string },
  ctx: z.RefinementCtx,
) => {
  if (v.reasonCode === 'other' && !v.note)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['note'],
      message: 'Required when the reason is other',
    });
};

/** Void or refund. No amount: always the full payment. */
export const CancelBody = z
  .object({
    reasonCode: z.enum(CANCEL_REASONS, { required_error: 'Required' }),
    note,
    actorRef: Reference,
    // The supervisor whose PIN the caller verified. payment-api stores it and refuses a cancel without it.
    approvedBy: Reference,
  })
  .superRefine(noteForOther);
export type CancelInput = z.infer<typeof CancelBody>;

/**
 * `POST /payments/:id/cancel`, where payment-api picks the path. Closing an unpaid bill needs only the actor;
 * a void or refund also needs the reason and the supervisor (checked once the path is known).
 */
export const AnyCancelBody = z
  .object({
    reasonCode: z.enum(CANCEL_REASONS).optional(),
    note,
    actorRef: Reference,
    approvedBy: Reference.optional(),
  })
  .superRefine(noteForOther);
export type AnyCancelInput = z.infer<typeof AnyCancelBody>;

/** The owner returned the money by hand after the PG refused the refund. */
export const ManualRefundBody = z.object({
  note: z.string().trim().min(1, 'Required').max(500),
  actorRef: Reference,
  approvedBy: Reference,
});
export type ManualRefundInput = z.infer<typeof ManualRefundBody>;

export const ListQuery = z.object({
  orderRef: Reference.optional(),
  idempotencyKey: IdempotencyKey.optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  needsReview: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  ...Paging,
});
export type ListInput = z.infer<typeof ListQuery>;

export const ReceiptListQuery = z.object({
  needsReview: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  ...Paging,
});
export type ReceiptListInput = z.infer<typeof ReceiptListQuery>;
