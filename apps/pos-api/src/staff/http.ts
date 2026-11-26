import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';

/** Validate a request body: 422 `{ message, errors }` in Indonesian, never echoing values. */
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): z.infer<T> {
  return validate(schema, body) as z.infer<T>;
}

const Uuid = z.string().uuid();

/**
 * A path id that is not a UUID is no row of this store: 404, not a 500 from Postgres. Answers the id in lower
 * case, the form Postgres and the session hold: an upper-case uuid still matches its row, so a comparison with
 * the session's actor id must not depend on the caller's spelling (UMK-2054).
 */
export function parseId(id: string): string {
  if (!Uuid.safeParse(id).success) throw new NotFoundException();
  return id.toLowerCase();
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code === '23505' || e?.cause?.code === '23505';
}
