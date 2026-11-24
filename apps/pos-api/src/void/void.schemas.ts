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

export const SetPinInput = z
  .object({
    pin: VoidPin,
    // Required when a PIN already exists.
    currentPin: VoidPin.optional(),
  })
  .strict();
export type SetPinInput = z.infer<typeof SetPinInput>;
