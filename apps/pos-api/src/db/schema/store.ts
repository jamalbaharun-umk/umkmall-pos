import { sql } from 'drizzle-orm';
import { check, text, uuid } from 'drizzle-orm/pg-core';
import { pos, updatedAt } from './_base';
import { tenants } from './tenants';

// Store profile (Lakasir General Setting → About/Profile): one row per store, created on the first save.
export const BUSINESS_TYPES = [
  'retail',
  'wholesale',
  'fnb',
  'fashion',
  'pharmacy',
  'other',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const storeProfiles = pos
  .table(
    'store_profiles',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      name: text('name').notNull(),
      businessType: text('business_type', { enum: BUSINESS_TYPES }).notNull(),
      otherBusinessType: text('other_business_type'),
      address: text('address').notNull(),
      // Stored under tenants/<id>/ so the U8 purge's prefix delete removes it.
      logoKey: text('logo_key'),
      logoContentType: text('logo_content_type'),
      updatedAt: updatedAt(),
    },
    (t) => [
      check(
        'store_profiles_business_type_ck',
        sql`${t.businessType} in ('retail', 'wholesale', 'fnb', 'fashion', 'pharmacy', 'other')`,
      ),
    ],
  )
  .enableRLS();
