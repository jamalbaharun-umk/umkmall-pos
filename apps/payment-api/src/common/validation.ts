import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';

/**
 * The one shape every refusal of input takes: `{ message, errors: { <field>: "<message>" } }`.
 * Messages are English: the caller is a service, which owns the copy its users see.
 * Values the caller sent are never echoed.
 */
export type FieldErrors = Record<string, string>;

export function fieldError(field: string, message: string): HttpException {
  return new HttpException(
    { message, errors: { [field]: message } },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

// zod's defaults for these two quote the received value; everything else names only types and limits.
const errorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
      return { message: 'Invalid value' };
    default:
      return { message: ctx.defaultError };
  }
};

/** Parses at the boundary; a refusal answers 422 with one message per field. */
export function validate<O, I = O>(
  schema: z.ZodType<O, z.ZodTypeDef, I>,
  input: unknown,
): O {
  const result = schema.safeParse(input, { errorMap });
  if (result.success) return result.data;
  const errors: FieldErrors = {};
  for (const issue of result.error.issues)
    errors[issue.path.join('.') || '_'] ??= issue.message;
  const first = Object.values(errors)[0];
  throw new HttpException(
    {
      message: Object.keys(errors).length === 1 ? first : 'Invalid input',
      errors,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

/** Integer rupiah ≥ 0, never a float or a numeric string. */
export const Rupiah = z
  .number({
    required_error: 'Required',
    invalid_type_error: 'Must be an integer number of rupiah',
  })
  .int('Must be an integer number of rupiah')
  .nonnegative('Must not be negative')
  .max(1_000_000_000_000, 'Too large');

/** A caller-supplied reference (order, actor, supervisor): opaque, trimmed, bounded. */
export const Reference = z.string().trim().min(1, 'Required').max(200);

export const Paging = {
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
};

export const isUuid = (value: string) =>
  z.string().uuid().safeParse(value).success;
