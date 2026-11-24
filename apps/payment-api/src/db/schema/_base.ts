import { bigint, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

// Every table lives in the `payment` schema of the payment database, owned by the payment_app role.
export const payment = pgSchema('payment');

// Money is integer rupiah. mode 'number' is exact up to 9e15 rupiah, far above any payment.
export const rupiah = (name: string) => bigint(name, { mode: 'number' });

export const id = () => uuid('id').primaryKey().defaultRandom();

// The tenant lives in the caller's database (pos.tenants), so this is a plain uuid with no foreign key.
// Every table carries it: the purge finds tenant tables by this column.
export const tenantId = () => uuid('tenant_id').notNull();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
