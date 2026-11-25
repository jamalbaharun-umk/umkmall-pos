import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah, updatedAt } from './_base';
import { receivablePayments } from './receivables';
import { ACTOR_KINDS, paymentMethods, sales, shifts } from './sales';
import { tenants } from './tenants';

// UMK-1962 void of a full sale. The sale and its lines are never edited (only `sales.status` moves to
// `void`); the void is its own reversing record, written once per sale in one transaction with the stock,
// voucher, receivable and drawer changes (src/void/void.service.ts).

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Stored as a code so reports can count voids per reason. The same codes as payment-api's cancel reasons. */
export const VOID_REASONS = [
  'wrong_item_or_qty',
  'wrong_payment_method',
  'customer_cancelled',
  'duplicate_transaction',
  'goods_returned',
  'other',
] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

/** Where the PG refund of a sale paid through a gateway stands (UMK-1991). */
export const REFUND_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * The 6-digit PIN an approver (a staff member or the owner, so no FK to pos.staff) types to approve a
 * void, with its lockout state. Read and written only in src/void/void-pin.ts (guard test).
 */
export const voidPins = pos
  .table(
    'void_pins',
    {
      tenantId: tenantId(),
      // UMKMall user id (owner) or pos.staff id (cashier), as in a session.
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      pinHash: text('pin_hash').notNull(), // scrypt with its own salt, see staff/secrets.ts
      failures: integer('failures').notNull().default(0),
      lockedUntil: ts('locked_until'),
      // The owner's last unlock of this approver.
      unlockedAt: ts('unlocked_at'),
      unlockedBy: uuid('unlocked_by'),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.actorId] }),
      check('void_pins_ck', sql`${t.failures} >= 0`),
    ],
  )
  .enableRLS();

/**
 * One row per voided sale: the audit record (who started, who approved, why, when) and the reversal
 * (the sale's figures, all positive). Reports subtract them on the day and in the shift of the void
 * (`created_at`, `shift_id`); the sale stays in the figures of its own day and shift.
 */
export const saleVoids = pos
  .table(
    'sale_voids',
    {
      id: id(),
      tenantId: tenantId(),
      saleId: uuid('sale_id').notNull(),
      idempotencyKey: text('idempotency_key').notNull(),
      // sha256 of sale id, reason, note and approver. Never the PIN.
      requestHash: text('request_hash').notNull(),
      reasonCode: text('reason_code', { enum: VOID_REASONS }).notNull(),
      note: text('note'),
      // Who started the void (the session's actor) and who approved it by PIN.
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      approvedBy: uuid('approved_by').notNull(),
      approvedByKind: text('approved_by_kind', { enum: ACTOR_KINDS }).notNull(),
      // The actor's open shift when the void was done: its drawer paid the cash back, and the shift report
      // shows the reversal there. Null only when no cash left a drawer and the actor had no open shift.
      shiftId: uuid('shift_id'),
      // Money given back: from the drawer, and by transfer (never touches a drawer).
      cashReturned: rupiah('cash_returned').notNull().default(0),
      transferReturned: rupiah('transfer_returned').notNull().default(0),
      // Kasbon: what the customer still owed and no longer does.
      receivableCancelled: rupiah('receivable_cancelled').notNull().default(0),
      // The reversed figures, copied from the sale (cost is the cost stored at the sale, not today's).
      subtotal: rupiah('subtotal').notNull(),
      discount: rupiah('discount').notNull(),
      voucherDiscount: rupiah('voucher_discount').notNull(),
      tax: rupiah('tax').notNull(),
      total: rupiah('total').notNull(),
      // UMK-1993: the sale's cash rounding, given back with the total (outside `total`).
      rounding: rupiah('rounding').notNull().default(0),
      costTotal: rupiah('cost_total').notNull(),
      // UMK-1991: the sale's payments in payment-api are still to be voided (set with payment-api on; the
      // request clears it after the commit, else the job does).
      paymentSyncPending: boolean('payment_sync_pending')
        .notNull()
        .default(false),
      // UMK-1991: set exactly when the sale was paid through a PG: its money goes back by a refund at the
      // gateway, which can be pending or refused. Null = a plain void (the store returned the money itself).
      refundStatus: text('refund_status', { enum: REFUND_STATUSES }),
      createdAt: createdAt(),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      index('sale_voids_payment_sync_idx')
        .on(t.createdAt)
        .where(sql`${t.paymentSyncPending}`),
      // A sale is voided at most once.
      uniqueIndex('sale_voids_sale_uq').on(t.tenantId, t.saleId),
      uniqueIndex('sale_voids_tenant_key_uq').on(t.tenantId, t.idempotencyKey),
      index('sale_voids_tenant_created_idx').on(t.tenantId, t.createdAt),
      foreignKey({
        columns: [t.tenantId, t.saleId],
        foreignColumns: [sales.tenantId, sales.id],
      }).onDelete('restrict'),
      foreignKey({
        columns: [t.tenantId, t.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }).onDelete('restrict'),
      check(
        'sale_voids_ck',
        sql`${t.cashReturned} >= 0 and ${t.transferReturned} >= 0 and ${t.receivableCancelled} >= 0
          and ${t.cashReturned} + ${t.transferReturned} + ${t.receivableCancelled} = ${t.total} + ${t.rounding}
          and ${t.rounding} between 0 and 99
          and (${t.cashReturned} = 0 or ${t.shiftId} is not null)
          and (${t.reasonCode} <> 'other' or ${t.note} is not null)`,
      ),
      check(
        'sale_voids_refund_ck',
        sql`${t.refundStatus} is null or ${t.refundStatus} in ('pending', 'succeeded', 'failed')`,
      ),
      // The job's sweep of refunds the gateway has not settled yet.
      index('sale_voids_refund_pending_idx')
        .on(t.createdAt)
        .where(sql`${t.refundStatus} = 'pending'`),
    ],
  )
  .enableRLS();

/**
 * What was given back, one row per payment received: the sale's own payment, or each kasbon payment
 * (down payment and instalments). `from_drawer` = cash out of the open shift; otherwise by transfer.
 */
export const saleVoidReturns = pos
  .table(
    'sale_void_returns',
    {
      id: id(),
      tenantId: tenantId(),
      voidId: uuid('void_id').notNull(),
      // The kasbon payment given back; null for the sale's own payment.
      receivablePaymentId: uuid('receivable_payment_id'),
      paymentMethodId: uuid('payment_method_id').notNull(),
      amount: rupiah('amount').notNull(),
      fromDrawer: boolean('from_drawer').notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index('sale_void_returns_void_idx').on(t.tenantId, t.voidId),
      foreignKey({
        columns: [t.tenantId, t.voidId],
        foreignColumns: [saleVoids.tenantId, saleVoids.id],
      }).onDelete('restrict'),
      foreignKey({
        name: 'sale_void_returns_receivable_payment_fk',
        columns: [t.tenantId, t.receivablePaymentId],
        foreignColumns: [receivablePayments.tenantId, receivablePayments.id],
      }).onDelete('restrict'),
      foreignKey({
        columns: [t.tenantId, t.paymentMethodId],
        foreignColumns: [paymentMethods.tenantId, paymentMethods.id],
      }).onDelete('restrict'),
      check('sale_void_returns_ck', sql`${t.amount} > 0`),
    ],
  )
  .enableRLS();
