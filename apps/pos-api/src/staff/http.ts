import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { z } from 'zod';

/** Validate a request body: 422 naming the bad fields, never echoing their values. */
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success)
    throw new UnprocessableEntityException({
      message: 'Invalid input',
      fields: r.error.issues.map((i) => i.path.join('.')),
    });
  return r.data as z.infer<T>;
}

const Uuid = z.string().uuid();

/** A path id that is not a UUID is no row of this store: 404, not a 500 from Postgres. */
export function parseId(id: string): string {
  if (!Uuid.safeParse(id).success) throw new NotFoundException();
  return id;
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code === '23505' || e?.cause?.code === '23505';
}
