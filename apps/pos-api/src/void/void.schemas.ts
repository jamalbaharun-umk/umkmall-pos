import { z } from 'zod';
import { UuidField } from '../common/validation';
import { VOID_REASONS } from '../db/schema';

/** A void PIN is exactly six digits, sent as a string (a number would lose leading zeros). */
export const VoidPin = z
  .string({
    required_error: 'Masukkan PIN',
    invalid_type_error: 'PIN harus 6 angka',
  })
  .regex(/^[0-9]{6}$/, 'PIN harus 6 angka');

/**
 * Full void only: the body carries no line, quantity or amount, and unknown keys are refused (strict).
 * `approverId` is the staff member or owner whose PIN is typed; they must hold `sales.void`.
 */
export const VoidInput = z
  .object({
    reasonCode: z.enum(VOID_REASONS, {
      required_error: 'Pilih alasan pembatalan',
      invalid_type_error: 'Pilih alasan pembatalan',
    }),
    note: z.string().trim().max(200).optional(),
    approverId: UuidField,
    pin: VoidPin,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.reasonCode === 'other' && !v.note)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'Tulis alasan pembatalan',
      });
  });
export type VoidInput = z.infer<typeof VoidInput>;

/**
 * UMK-2040: the retry of a refund the gateway refused is approved again, by the PIN of `approverId`, who
 * must be the store's owner (an admin's PIN is refused). The reason and note stay those of the refund.
 */
export const RefundRetryInput = z
  .object({ approverId: UuidField, pin: VoidPin })
  .strict();
export type RefundRetryInput = z.infer<typeof RefundRetryInput>;

/** UMK-1991: a refund the gateway refused, returned by the store itself. The note says how. */
export const ManualRefundInput = z
  .object({
    note: z
      .string({ required_error: 'Tulis cara uang dikembalikan' })
      .trim()
      .min(1, 'Tulis cara uang dikembalikan')
      .max(200),
  })
  .strict();

export const SetPinInput = z
  .object({
    pin: VoidPin,
    // Required when a PIN already exists.
    currentPin: VoidPin.optional(),
  })
  .strict();
export type SetPinInput = z.infer<typeof SetPinInput>;

/** UMK-2054: the owner's new PIN after "Lupa PIN" (no old PIN: the fresh sign-in stands in for it). */
export const ForgottenPinInput = z.object({ pin: VoidPin }).strict();
