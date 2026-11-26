import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah } from './_base';
import { products } from './catalog';
import { purchaseOrderLines, purchaseOrders } from './purchasing';
import { ACTOR_KINDS, shifts } from './sales';
import { stockBatches } from './stock';
import { tenants } from './tenants';

// UMK-1970 (design feature 29): what is paid to a supplier for an approved purchase, and the goods sent back.
// The purchase's debt = total − Σ returns − Σ live payments, floored at 0; its payment status follows from it.
// Written only by src/purchasing/purchase-payments.service.ts, under the purchase's row lock. Never updated
// except a payment's void columns, never deleted (a payment is corrected by voiding it: a reversal line).

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

/** `drawer`: cash out of the actor's open shift (a `purchase_payment` ledger entry); `outside`: no drawer. */
export const PURCHASE_PAYMENT_SOURCES = ['drawer', 'outside'] as const;
export type PurchasePaymentSource = (typeof PURCHASE_PAYMENT_SOURCES)[number];

export const purchasePayments = pos
  .table(
    'purchase_payments',
    {
      id: id(),
      tenantId: tenantId(),
      orderId: uuid('order_id')
        .notNull()
        .references(() => purchaseOrders.id, { onDelete: 'restrict' }),
      amount: rupiah('amount').notNull(),
      source: text('source', { enum: PURCHASE_PAYMENT_SOURCES }).notNull(),
      note: text('note'),
      // The drawer the cash left (source `drawer` only) and what it held just before.
      shiftId: uuid('shift_id'),
      drawerCashBefore: rupiah('drawer_cash_before'),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      idempotencyKey: text('idempotency_key').notNull(),
      requestHash: text('request_hash').notNull(),
      createdAt: createdAt(),
      voidedAt: timestamp('voided_at', { withTimezone: true }),
      voidedById: uuid('voided_by_id'),
      voidedByKind: text('voided_by_kind', { enum: ACTOR_KINDS }),
      voidReason: text('void_reason'),
      // A voided drawer payment: true = its cash went back into its (still open) shift, false = into the store
      // cash (the shift had closed); null for an outside payment or one not voided.
      drawerReversed: boolean('drawer_reversed'),
    },
    (t) => [
      index('purchase_payments_order_idx').on(t.tenantId, t.orderId),
      uniqueIndex('purchase_payments_tenant_key_uq').on(
        t.tenantId,
        t.idempotencyKey,
      ),
      foreignKey({
        columns: [t.tenantId, t.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }).onDelete('restrict'),
      check(
        'purchase_payments_ck',
        sql`${t.amount} > 0 and ${t.source} in ('drawer', 'outside')
          and (${t.source} = 'drawer') = (${t.shiftId} is not null)`,
      ),
    ],
  )
  .enableRLS();

/** Why goods go back to the supplier; `lainnya` needs a note. */
export const PURCHASE_RETURN_REASONS = [
  'rusak',
  'kedaluwarsa',
  'salah_kirim',
  'lainnya',
] as const;
export type PurchaseReturnReason = (typeof PURCHASE_RETURN_REASONS)[number];
export const PURCHASE_RETURN_REASON_LABELS: Record<
  PurchaseReturnReason,
  string
> = {
  rusak: 'Barang rusak',
  kedaluwarsa: 'Kedaluwarsa',
  salah_kirim: 'Salah kirim',
  lainnya: 'Lainnya',
};

export const purchaseReturns = pos
  .table(
    'purchase_returns',
    {
      id: id(),
      tenantId: tenantId(),
      orderId: uuid('order_id')
        .notNull()
        .references(() => purchaseOrders.id, { onDelete: 'restrict' }),
      reason: text('reason', { enum: PURCHASE_RETURN_REASONS }).notNull(),
      note: text('note'),
      // Σ qty × batch cost of the lines: what the debt goes down by.
      total: rupiah('total').notNull(),
      // The part of `total` above the debt at the time: money the supplier owes back, outside the system.
      refundDue: rupiah('refund_due').notNull().default(0),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      idempotencyKey: text('idempotency_key').notNull(),
      requestHash: text('request_hash').notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index('purchase_returns_order_idx').on(t.tenantId, t.orderId),
      uniqueIndex('purchase_returns_tenant_key_uq').on(
        t.tenantId,
        t.idempotencyKey,
      ),
      check(
        'purchase_returns_ck',
        sql`${t.total} > 0 and ${t.refundDue} >= 0 and ${t.refundDue} <= ${t.total}`,
      ),
    ],
  )
  .enableRLS();

export const purchaseReturnLines = pos
  .table(
    'purchase_return_lines',
    {
      id: id(),
      tenantId: tenantId(),
      returnId: uuid('return_id')
        .notNull()
        .references(() => purchaseReturns.id, { onDelete: 'restrict' }),
      orderLineId: uuid('order_line_id')
        .notNull()
        .references(() => purchaseOrderLines.id, { onDelete: 'restrict' }),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'restrict' }),
      // The stock batch the purchase line was received as; the units leave exactly this batch.
      batchId: uuid('batch_id')
        .notNull()
        .references(() => stockBatches.id, { onDelete: 'restrict' }),
      qty: integer('qty').notNull(),
      unitCost: rupiah('unit_cost').notNull(),
    },
    (t) => [
      index('purchase_return_lines_return_idx').on(t.tenantId, t.returnId),
      check(
        'purchase_return_lines_ck',
        sql`${t.qty} > 0 and ${t.unitCost} >= 0`,
      ),
    ],
  )
  .enableRLS();
