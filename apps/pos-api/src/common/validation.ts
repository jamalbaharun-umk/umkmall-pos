import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';

/**
 * The one shape every refusal of input takes: `{ message, errors: { <field>: "<Indonesian message>" } }`.
 * `message` is safe to show as a toast; `errors` maps a dotted field path (`lines.0.qty`) to its message.
 * Values the client sent are never echoed.
 */
export type FieldErrors = Record<string, string>;

export function fieldError(
  field: string,
  message: string,
  status: number = HttpStatus.UNPROCESSABLE_ENTITY,
): HttpException {
  return new HttpException({ message, errors: { [field]: message } }, status);
}

const rp = (n: number | bigint) => `Rp${Number(n).toLocaleString('id-ID')}`;

/** Indonesian messages for zod's built-in checks; a schema's own message (refine, regex) wins. */
const errorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      // A schema's own required_error / invalid_type_error arrives as defaultError and wins.
      if (
        ctx.defaultError !== 'Required' &&
        !ctx.defaultError.startsWith('Expected ')
      )
        return { message: ctx.defaultError };
      return {
        message:
          issue.received === 'undefined' || issue.received === 'null'
            ? 'Wajib diisi'
            : issue.expected === 'number' || issue.expected === 'integer'
              ? 'Harus berupa angka'
              : 'Format tidak valid',
      };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string')
        return {
          message:
            Number(issue.minimum) <= 1
              ? 'Wajib diisi'
              : `Minimal ${issue.minimum} karakter`,
        };
      if (issue.type === 'array') return { message: 'Wajib diisi' };
      return {
        message: issue.inclusive
          ? `Minimal ${issue.minimum}`
          : `Harus lebih dari ${issue.minimum}`,
      };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string')
        return { message: `Maksimal ${issue.maximum} karakter` };
      if (issue.type === 'array')
        return { message: `Maksimal ${issue.maximum} baris` };
      return { message: `Maksimal ${issue.maximum}` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Pilihan tidak valid' };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: 'Isian tidak dikenal' };
    case z.ZodIssueCode.invalid_string:
      return { message: 'Format tidak valid' };
    case z.ZodIssueCode.not_multiple_of:
      return { message: 'Harus bilangan bulat' };
    default:
      return { message: ctx.defaultError };
  }
};

/** Parses at the boundary; a refusal answers 422 with one Indonesian message per field. */
export function validate<O, I = O>(
  schema: z.ZodType<O, z.ZodTypeDef, I>,
  input: unknown,
): O {
  const result = schema.safeParse(input, { errorMap });
  if (result.success) return result.data;
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    // Unknown keys are reported on each key, so a form can point at them.
    const paths =
      issue.code === z.ZodIssueCode.unrecognized_keys
        ? issue.keys.map((k) => [...issue.path, k].join('.'))
        : [issue.path.join('.') || '_'];
    for (const p of paths) errors[p] ??= issue.message;
  }
  const first = Object.values(errors)[0];
  throw new HttpException(
    {
      message:
        Object.keys(errors).length === 1 ? first : 'Periksa kembali isian kamu',
      errors,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

// ---- Shared field schemas (Indonesian messages) ----

/** Integer rupiah ≥ 0, never a float or a numeric string. */
export const Rupiah = z
  .number({ invalid_type_error: 'Harus berupa angka' })
  .int('Harus bilangan bulat rupiah')
  .nonnegative('Tidak boleh negatif')
  .max(1_000_000_000_000, `Maksimal ${rp(1_000_000_000_000)}`);

/** A real calendar date `YYYY-MM-DD` (2026-02-31 is refused, not rolled over into March). */
export const LocalDate = z
  .string({ required_error: 'Wajib diisi' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD')
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().startsWith(d);
  }, 'Tanggal tidak valid');

/** Indonesian phone: digits, optional leading +, 8–15 digits (spaces and dashes allowed). */
export const Phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 -]{6,18}[0-9]$/, 'Nomor telepon tidak valid')
  .refine(
    (p) =>
      p.replace(/\D/g, '').length >= 8 && p.replace(/\D/g, '').length <= 15,
    'Nomor telepon tidak valid',
  );

export const UuidField = z.string().uuid('Pilihan tidak valid');

export const formatRupiah = rp;
