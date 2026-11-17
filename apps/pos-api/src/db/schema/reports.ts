import { text, uuid } from 'drizzle-orm/pg-core';
import { pos } from './_base';
import { tenants } from './tenants';

// U5: the store's timezone, used for every report day boundary (Lakasir kept it on the profile, unvalidated).
export const reportSettings = pos
  .table('report_settings', {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    timezone: text('timezone').notNull().default('Asia/Jakarta'),
  })
  .enableRLS();
