import { bigint, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

// Every POS table lives in the `pos` schema, never `public` (UMKMall owns `public`).
export const pos = pgSchema('pos');

// Money is integer rupiah. mode 'number' is exact up to 9e15 rupiah, far above any POS total.
export const rupiah = (name: string) => bigint(name, { mode: 'number' });

export const id = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
