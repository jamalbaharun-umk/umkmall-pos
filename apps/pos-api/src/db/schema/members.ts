import { sql } from 'drizzle-orm';
import {
  check,
  date,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah, updatedAt } from './_base';
import { tenants } from './tenants';

// U7 members and vouchers (ported from Lakasir members, vouchers). Members are the store's customers' PII: never logged, erased by the U8 purge.

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

export const members = pos
  .table(
    'members',
    {
      id: id(),
      tenantId: tenantId(),
      name: text('name').notNull(),
      code: text('code').notNull(),
      phone: text('phone'),
      address: text('address'),
      deletedAt: deletedAt(),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      uniqueIndex('members_tenant_code_uq')
        .on(t.tenantId, t.code)
        .where(sql`${t.deletedAt} is null`),
    ],
  )
  .enableRLS();

export const VOUCHER_TYPES = ['percentage', 'flat'] as const;

export const vouchers = pos
  .table(
    'vouchers',
    {
      id: id(),
      tenantId: tenantId(),
      name: text('name').notNull(),
      code: text('code').notNull(),
      type: text('type', { enum: VOUCHER_TYPES }).notNull(),
      // Percent (1–100) for `percentage`, rupiah for `flat`.
      nominal: rupiah('nominal').notNull(),
      kuota: integer('kuota').notNull(),
      // Inclusive dates in the store's day (its timezone, common/store-day.ts).
      startDate: date('start_date').notNull(),
      expired: date('expired').notNull(),
      minimalBuying: rupiah('minimal_buying').notNull().default(0),
      deletedAt: deletedAt(),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      uniqueIndex('vouchers_tenant_code_uq')
        .on(t.tenantId, t.code)
        .where(sql`${t.deletedAt} is null`),
      check(
        'vouchers_ck',
        sql`${t.kuota} >= 0 and ${t.minimalBuying} >= 0 and ${t.nominal} > 0
          and (${t.type} <> 'percentage' or ${t.nominal} <= 100) and ${t.expired} >= ${t.startDate}`,
      ),
    ],
  )
  .enableRLS();
