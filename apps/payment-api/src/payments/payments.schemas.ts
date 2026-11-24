import { z } from 'zod';
import { Paging, Reference, Rupiah } from '../common/validation';
import { PAYMENT_STATUSES } from '../db/schema';

export const IdempotencyKey = z
  .string({ required_error: 'Idempotency-Key header is required' })
  .regex(/^[A-Za-z0-9_.:-]{8,200}$/, 'Idempotency-Key header is not valid');

/** Generic terms only: an order reference and an actor reference, never a sale, a shift or a cashier. */
export const ChargeBody = z.object({
  orderRef: Reference,
  // Checked against the adapter registry, not an enum here: a new adapter needs no schema change.
  method: z.string().trim().min(1, 'Required').max(50),
  amount: Rupiah,
  actorRef: Reference,
});
export type ChargeInput = z.infer<typeof ChargeBody>;

/** No amount: a void or refund is always for the full payment. */
export const CancelBody = z.object({
  reason: z.string().trim().min(1, 'Required').max(500),
  actorRef: Reference,
  // The supervisor whose PIN the caller verified. payment-api stores it and refuses a cancel without it.
  approvedBy: Reference,
});
export type CancelInput = z.infer<typeof CancelBody>;

export const ListQuery = z.object({
  orderRef: Reference.optional(),
  idempotencyKey: IdempotencyKey.optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  ...Paging,
});
export type ListInput = z.infer<typeof ListQuery>;
