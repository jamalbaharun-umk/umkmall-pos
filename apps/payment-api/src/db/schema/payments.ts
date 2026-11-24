import { sql } from 'drizzle-orm';
import {
  check,
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, payment, rupiah, tenantId, updatedAt } from './_base';

export const PAYMENT_STATUSES = [
  'pending',
  'paid',
  'failed',
  'expired',
  'voided',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const paymentStatus = payment.enum('payment_status', PAYMENT_STATUSES);

export const EVENT_TYPES = ['charged', 'voided', 'refunded'] as const;
export type PaymentEventType = (typeof EVENT_TYPES)[number];
export const paymentEventType = payment.enum('payment_event_type', EVENT_TYPES);

export const payments = payment
  .table(
    'payments',
    {
      id: id(),
      tenantId: tenantId(),
      // The caller's order (a POS sale today). Opaque here.
      orderRef: text('order_ref').notNull(),
      // An adapter's method name. Text, not an enum: a new adapter needs no migration.
      method: text('method').notNull(),
      amount: rupiah('amount').notNull(),
      status: paymentStatus('status').notNull(),
      idempotencyKey: text('idempotency_key').notNull(),
      // sha256 of the charge request: the same key with another request is refused, not replayed.
      requestHash: text('request_hash').notNull(),
      // The PG's own id for this payment. Null for CASHAC.
      providerRef: text('provider_ref'),
      paidAt: timestamp('paid_at', { withTimezone: true }),
      cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('payments_tenant_idempotency_key').on(
        t.tenantId,
        t.idempotencyKey,
      ),
      // One live payment per order: no split payment, no double charge.
      uniqueIndex('payments_tenant_order_live')
        .on(t.tenantId, t.orderRef)
        .where(sql`${t.status} in ('pending', 'paid')`),
      index('payments_tenant_order').on(t.tenantId, t.orderRef),
      index('payments_tenant_status_created').on(
        t.tenantId,
        t.status,
        t.createdAt,
      ),
      check('payments_amount_non_negative', sql`${t.amount} >= 0`),
    ],
  )
  .enableRLS();

// Audit trail: who did what to a payment, when and why. Rows are only ever inserted.
export const paymentEvents = payment
  .table(
    'payment_events',
    {
      id: id(),
      tenantId: tenantId(),
      paymentId: uuid('payment_id')
        .notNull()
        .references(() => payments.id, { onDelete: 'restrict' }),
      type: paymentEventType('type').notNull(),
      // Caller-supplied reference of who asked (a cashier or owner id in the POS).
      actorRef: text('actor_ref').notNull(),
      // Supervisor the caller verified (PIN). Required for void and refund, null for a charge.
      approvedBy: text('approved_by'),
      reason: text('reason'),
      createdAt: createdAt(),
    },
    (t) => [index('payment_events_tenant_payment').on(t.tenantId, t.paymentId)],
  )
  .enableRLS();
