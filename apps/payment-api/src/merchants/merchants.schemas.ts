import { z } from 'zod';
import { Reference } from '../common/validation';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

/**
 * The draft: every field may be empty until the owner submits. Nothing else is accepted (`strict`), so an
 * identity number, a document or a bank account sent by mistake is refused and never stored.
 */
export const DraftBody = z
  .object({
    businessType: z
      .enum(['individual', 'company'])
      .nullish()
      .transform((v) => v ?? null),
    businessName: optionalText(120),
    email: optionalText(254).refine(
      (v) => v === null || z.string().email().safeParse(v).success,
      'Must be an email address',
    ),
    // Digits with an optional leading +, as the gateway will be given it.
    phone: optionalText(20).refine(
      (v) => v === null || /^\+?[0-9]{8,15}$/.test(v),
      'Must be a phone number',
    ),
  })
  .strict();
export type DraftInput = z.infer<typeof DraftBody>;

export const SubmitBody = z
  .object({
    // The owner agreed to UMKMall's terms in the caller's screen. Only `true` submits.
    termsAccepted: z.literal(true, {
      errorMap: () => ({ message: 'The terms must be accepted' }),
    }),
    actorRef: Reference,
  })
  .strict();
export type SubmitInput = z.infer<typeof SubmitBody>;

export const ToggleBody = z
  .object({
    enabled: z.boolean({
      required_error: 'Required',
      invalid_type_error: 'Must be true or false',
    }),
    actorRef: Reference,
  })
  .strict();
export type ToggleInput = z.infer<typeof ToggleBody>;
