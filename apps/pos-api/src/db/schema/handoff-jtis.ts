import { text, timestamp } from 'drizzle-orm/pg-core';
import { pos } from './_base';

// Spent UMKMall handoff token ids (each accepted once). No tenant_id: a jti is spent before the tenant
// may exist and identifies no store or person. Rows past expires_at are pruned by the exchange.
export const handoffJtis = pos
  .table('handoff_jtis', {
    jti: text('jti').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  })
  .enableRLS();
