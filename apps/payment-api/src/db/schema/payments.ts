import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, payment, rupiah, tenantId, updatedAt } from './_base';

/** Forward-only; the allowed moves and the rank are in src/payments/transitions.ts. */
export const PAYMENT_STATUSES = [
  'created',
  'pending',
  'paid',
  'failed',
  'expired',
  'cancelled',
  'voided',
  'refund_pending',
  'refunded',
  'refund_failed',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const paymentStatus = payment.enum('payment_status', PAYMENT_STATUSES);

/** What the payer is shown for an online payment (a QR string, a VA number). Opaque to payment-api. */
export type Checkout = Record<string, string>;

export const payments = payment
  .table(
    'payments',
    {
      // Also the reference and the idempotency key we give the PG.
      id: id(),
      tenantId: tenantId(),
      // The caller's order (a POS sale, a receivable). Opaque here.
      orderRef: text('order_ref').notNull(),
      // The caller's attempt number for this order (1, 2, …). A new attempt only once the old one is closed.
      attempt: integer('attempt').notNull().default(1),
      // An adapter's method name. Text, not an enum: a new adapter needs no migration.
      method: text('method').notNull(),
      amount: rupiah('amount').notNull(),
      status: paymentStatus('status').notNull(),
      // Needs the owner's attention (refund refused, bill missing at the PG). A flag, not a status.
      needsReview: boolean('needs_review').notNull().default(false),
      reviewReason: text('review_reason'),
      idempotencyKey: text('idempotency_key').notNull(),
      // sha256 of the charge request: the same key with another request is refused, not replayed.
      requestHash: text('request_hash').notNull(),
      // The PG's own id for this payment. Null for CASHAC.
      providerRef: text('provider_ref'),
      // The PG receipt that paid this payment, and the PG's fee on it (reported apart from the gross amount).
      paidReceiptRef: text('paid_receipt_ref'),
      feeAmount: rupiah('fee_amount'),
      checkout: jsonb('checkout').$type<Checkout>(),
      expiresAt: timestamp('expires_at', { withTimezone: true }),
      paidAt: timestamp('paid_at', { withTimezone: true }),
      // Last time the PG was asked about this payment (manual sync is throttled on it).
      lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
      // First time the PG said it has no bill for a `created` payment. `failed` needs a second such answer later.
      notFoundAt: timestamp('not_found_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('payments_tenant_idempotency_key').on(
        t.tenantId,
        t.idempotencyKey,
      ),
      // One live payment per order, enforced by the database: no split payment, no double charge.
      uniqueIndex('payments_tenant_order_live')
        .on(t.tenantId, t.orderRef)
        .where(sql`${t.status} in ('created', 'pending', 'paid')`),
      // An attempt number is used once per order, whatever key it came with.
      uniqueIndex('payments_tenant_order_attempt').on(
        t.tenantId,
        t.orderRef,
        t.attempt,
      ),
      index('payments_tenant_status_created').on(
        t.tenantId,
        t.status,
        t.createdAt,
      ),
      // The reconciliation sweep reads in-flight payments across tenants.
      index('payments_in_flight')
        .on(t.status, t.updatedAt)
        .where(sql`${t.status} in ('created', 'pending', 'refund_pending')`),
      check('payments_amount_non_negative', sql`${t.amount} >= 0`),
      check('payments_attempt_positive', sql`${t.attempt} >= 1`),
    ],
  )
  .enableRLS();

// Audit trail: one row per status change (and per review flag). Rows are only ever inserted.
export const paymentEvents = payment
  .table(
    'payment_events',
    {
      id: id(),
      tenantId: tenantId(),
      paymentId: uuid('payment_id')
        .notNull()
        .references(() => payments.id, { onDelete: 'restrict' }),
      // Null for the first row (the payment was created); equal to `toStatus` for a note without a move.
      fromStatus: paymentStatus('from_status'),
      toStatus: paymentStatus('to_status').notNull(),
      // charge, webhook, sync, reconciliation, cancel, void, refund, manual_refund, system
      source: text('source').notNull(),
      // Caller-supplied reference of who asked; `system` for a webhook, the reconciliation or an automatic refund.
      actorRef: text('actor_ref').notNull(),
      // Supervisor the caller verified (PIN). Required for a void or refund a person asks for.
      approvedBy: text('approved_by'),
      // One of the fixed cancel reasons (payments.schemas.ts), so reports can count per reason.
      reasonCode: text('reason_code'),
      note: text('note'),
      createdAt: createdAt(),
    },
    (t) => [index('payment_events_tenant_payment').on(t.tenantId, t.paymentId)],
  )
  .enableRLS();

export const RECEIPT_KINDS = [
  'late_payment',
  'duplicate',
  'amount_mismatch',
] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];
export type ReceiptRefundStatus = 'none' | 'pending' | 'refunded' | 'failed';

// Money the PG received that pays no payment: it came after the bill was closed, a second time, or in the
// wrong amount. Outside the one-live-payment index on purpose, so it can ALWAYS be recorded; it is flagged for
// the owner and refunded by the system.
export const unmatchedReceipts = payment
  .table(
    'unmatched_receipts',
    {
      // Also the idempotency key of its refund at the PG.
      id: id(),
      tenantId: tenantId(),
      // The bill the money came in on. Its status is not changed by this receipt.
      paymentId: uuid('payment_id')
        .notNull()
        .references(() => payments.id, { onDelete: 'restrict' }),
      // The PG's id for this receipt: the same receipt is recorded (and refunded) once.
      receiptRef: text('receipt_ref').notNull(),
      kind: text('kind').$type<ReceiptKind>().notNull(),
      grossAmount: rupiah('gross_amount').notNull(),
      feeAmount: rupiah('fee_amount').notNull().default(0),
      // On the owner's review list until the money is back with the payer.
      needsReview: boolean('needs_review').notNull().default(true),
      refundStatus: text('refund_status')
        .$type<ReceiptRefundStatus>()
        .notNull()
        .default('none'),
      // `system` for the automatic refund: no supervisor approves it, and the audit says so.
      refundActor: text('refund_actor'),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('unmatched_receipts_payment_receipt').on(
        t.paymentId,
        t.receiptRef,
      ),
      index('unmatched_receipts_tenant_review').on(t.tenantId, t.needsReview),
    ],
  )
  .enableRLS();

// Notices for the calling service (pos-api completes or cancels its order). Written in the same transaction
// as the status change; a dispatcher delivers and retries them (not built yet).
export const outbox = payment
  .table(
    'outbox',
    {
      id: id(),
      tenantId: tenantId(),
      paymentId: uuid('payment_id')
        .notNull()
        .references(() => payments.id, { onDelete: 'restrict' }),
      // payment.<status>, payment.needs_review, payment.unmatched_receipt
      topic: text('topic').notNull(),
      payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
      attempts: integer('attempts').notNull().default(0),
      deliveredAt: timestamp('delivered_at', { withTimezone: true }),
      createdAt: createdAt(),
    },
    (t) => [
      index('outbox_undelivered')
        .on(t.createdAt)
        .where(sql`${t.deliveredAt} is null`),
    ],
  )
  .enableRLS();

export const WEBHOOK_STATES = [
  'received',
  'processed',
  'unmatched',
  'failed',
  // Gave up after the configured number of attempts; needs a person. Other events are not held behind it.
  'parked',
] as const;
export type WebhookState = (typeof WEBHOOK_STATES)[number];

// Webhook inbox: every verified PG notification is stored before it is processed, once per (provider, event).
export const webhookEvents = payment
  .table(
    'webhook_events',
    {
      id: id(),
      // Null until the event is matched to one of our payments: the tenant comes from that row, never from
      // the payload. The column exists so the tenant purge covers this table too.
      tenantId: uuid('tenant_id'),
      provider: text('provider').notNull(),
      eventId: text('event_id').notNull(),
      // Our payment id, as the PG sent it back. Text: an unknown or malformed reference is kept, not dropped.
      reference: text('reference'),
      paymentId: uuid('payment_id').references(() => payments.id, {
        onDelete: 'restrict',
      }),
      body: text('body').notNull(),
      state: text('state').$type<WebhookState>().notNull().default('received'),
      attempts: integer('attempts').notNull().default(0),
      nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
      processedAt: timestamp('processed_at', { withTimezone: true }),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex('webhook_events_provider_event').on(t.provider, t.eventId),
      index('webhook_events_retry').on(t.state, t.nextAttemptAt),
    ],
  )
  .enableRLS();
