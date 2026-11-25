import {
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, updatedAt } from './_base';
import { tenants } from './tenants';

// UMK-1991: work for payment-api that keeps being REFUSED (not: payment-api unreachable). The job counts
// each refusal here and, after POS_PAYMENT_SYNC_MAX_ATTEMPTS, parks the row: it is no longer retried, so it
// cannot crowd out newer work, and the owner sees it (GET /payment-sync/issues) and can release it.
// A row is deleted when its work succeeds or the owner asks for a retry.

/**
 * What the work is about; `ref_id` is that row's id (pos.sales, pos.receivable_payments, pos.sale_voids).
 * `refund` is a pos.sale_voids row whose PG refund is still pending and is being followed.
 */
export const PAYMENT_SYNC_KINDS = [
  'sale',
  'receivable_payment',
  'void',
  'refund',
] as const;
export type PaymentSyncKind = (typeof PAYMENT_SYNC_KINDS)[number];

export const paymentSyncIssues = pos
  .table(
    'payment_sync_issues',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      kind: text('kind', { enum: PAYMENT_SYNC_KINDS }).notNull(),
      refId: uuid('ref_id').notNull(),
      attempts: integer('attempts').notNull().default(0),
      // payment-api's stable code or an error class. Never a message, a key or a body.
      lastError: text('last_error').notNull(),
      parkedAt: timestamp('parked_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      unique('payment_sync_issues_ref_uq').on(t.tenantId, t.kind, t.refId),
      index('payment_sync_issues_ref_idx').on(t.kind, t.refId),
    ],
  )
  .enableRLS();
