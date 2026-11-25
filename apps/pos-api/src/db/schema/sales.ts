import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah } from './_base';
import { products } from './catalog';
import { members, vouchers } from './members';
import { tenants } from './tenants';

// U3 shifts and cash sales (ported from Lakasir cash_drawers, sellings, selling_details, payment_methods).
// Every sale belongs to a shift (Lakasir never set cash_drawer_id); all money is integer rupiah.
// Child rows use composite (tenant_id, id) FKs so a row can never join two stores.

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const ACTOR_KINDS = ['owner', 'cashier'] as const;

export const shifts = pos
  .table(
    'shifts',
    {
      id: id(),
      tenantId: tenantId(),
      // UMKMall user id (owner) or pos.staff id (cashier): the session's actor.
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      openingCash: rupiah('opening_cash').notNull(),
      openedAt: ts('opened_at').notNull().defaultNow(),
      closedAt: ts('closed_at'),
      countedCash: rupiah('counted_cash'),
      expectedCash: rupiah('expected_cash'),
      cashSales: rupiah('cash_sales'),
      salesCount: integer('sales_count'),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      // One open shift per actor.
      uniqueIndex('shifts_one_open_uq')
        .on(t.tenantId, t.actorId)
        .where(sql`${t.closedAt} is null`),
      index('shifts_tenant_opened_idx').on(t.tenantId, t.openedAt),
      check(
        'shifts_cash_ck',
        sql`${t.openingCash} >= 0 and (${t.countedCash} is null or ${t.countedCash} >= 0)`,
      ),
    ],
  )
  .enableRLS();

export const paymentMethods = pos
  .table(
    'payment_methods',
    {
      id: id(),
      tenantId: tenantId(),
      name: text('name').notNull(),
      // U7: exactly one kind (Lakasir allowed any combination). is_credit = kasbon (receivable).
      isCash: boolean('is_cash').notNull().default(false),
      isDebit: boolean('is_debit').notNull().default(false),
      isCredit: boolean('is_credit').notNull().default(false),
      isWallet: boolean('is_wallet').notNull().default(false),
      deletedAt: timestamp('deleted_at', { withTimezone: true }),
      createdAt: createdAt(),
    },
    (t) => [
      // Unique among live rows, ignoring case ("kasbon" = "Kasbon"); a deleted method's name can be used again.
      uniqueIndex('payment_methods_tenant_name_uq')
        .on(t.tenantId, sql`lower(${t.name})`)
        .where(sql`${t.deletedAt} is null`),
      unique().on(t.tenantId, t.id),
      check(
        'payment_methods_kind_ck',
        sql`${t.isCash}::int + ${t.isDebit}::int + ${t.isCredit}::int + ${t.isWallet}::int = 1`,
      ),
    ],
  )
  .enableRLS();

// Per-store sale settings and the receipt-number counter (one row, upserted by every sale).
export const salesSettings = pos
  .table(
    'sales_settings',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      // Tax in basis points (1000 = 10%), applied after discounts.
      taxBps: integer('tax_bps').notNull().default(0),
      lastSaleNumber: integer('last_sale_number').notNull().default(0),
    },
    (t) => [
      check('sales_settings_tax_ck', sql`${t.taxBps} between 0 and 10000`),
    ],
  )
  .enableRLS();

/**
 * `void`: cancelled in full by a pos.sale_voids row (UMK-1962); the sale's own figures stay as rung up.
 * UMK-1991, only with payment-api on: `awaiting_payment` = created (stock and voucher taken), its payment not
 * yet confirmed; `cancelled` = that payment closed unpaid, stock and voucher given back. Neither was ever a
 * receipt: both are outside every list, report and shift total (FINAL_SALE_STATUSES).
 */
export const SALE_STATUSES = [
  'completed',
  'void',
  'awaiting_payment',
  'cancelled',
] as const;
/** A sale that was rung up: what lists, reports and shift totals count. */
export const FINAL_SALE_STATUSES = ['completed', 'void'] as const;

export const sales = pos
  .table(
    'sales',
    {
      id: id(),
      tenantId: tenantId(),
      number: integer('number').notNull(),
      shiftId: uuid('shift_id').notNull(),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      paymentMethodId: uuid('payment_method_id').notNull(),
      idempotencyKey: text('idempotency_key').notNull(),
      // sha256 of the normalized request: the same key with a different body is refused, not replayed.
      requestHash: text('request_hash'),
      subtotal: rupiah('subtotal').notNull(),
      discount: rupiah('discount').notNull().default(0),
      // U7: member (required for a credit sale) and the voucher applied, with its discount.
      memberId: uuid('member_id'),
      voucherId: uuid('voucher_id'),
      voucherDiscount: rupiah('voucher_discount').notNull().default(0),
      taxBps: integer('tax_bps').notNull().default(0),
      tax: rupiah('tax').notNull().default(0),
      total: rupiah('total').notNull(),
      // UMK-1993: what a CASH sale adds to reach the next Rp100 (0-99); 0 for every other method. It is
      // outside `total` (not taxed, not product revenue); the customer owes `total + rounding`.
      rounding: rupiah('rounding').notNull().default(0),
      paid: rupiah('paid').notNull(),
      change: rupiah('change').notNull(),
      costTotal: rupiah('cost_total').notNull(),
      // Actor who set a client price or discount (needs sales.price_override); null when none was used.
      overrideBy: uuid('override_by'),
      // Lakasir's order note, typed by the cashier; shown on the receipt.
      note: text('note'),
      status: text('status', { enum: SALE_STATUSES })
        .notNull()
        .default('completed'),
      voidedAt: ts('voided_at'),
      // UMK-1991: the payment in payment-api (another database, so no FK). Null for a kasbon sale (its
      // payments are on pos.receivable_payments) and for a sale made while payment-api was off.
      paymentId: uuid('payment_id'),
      // payment-api's method for this sale, fixed when the sale was made: a later edit of the payment
      // method's kind never changes what is charged. Null exactly when the sale takes no payment there.
      paymentMethodCode: text('payment_method_code'),
      cancelledAt: ts('cancelled_at'),
      createdAt: createdAt(),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      check(
        'sales_status_ck',
        sql`${t.status} in ('completed', 'void', 'awaiting_payment', 'cancelled')
          and (${t.status} = 'void') = (${t.voidedAt} is not null)
          and (${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
      ),
      // The job's sweep of sales still waiting for their payment.
      index('sales_awaiting_idx')
        .on(t.createdAt)
        .where(sql`${t.status} = 'awaiting_payment'`),
      uniqueIndex('sales_tenant_idempotency_uq').on(
        t.tenantId,
        t.idempotencyKey,
      ),
      uniqueIndex('sales_tenant_number_uq').on(t.tenantId, t.number),
      index('sales_tenant_created_idx').on(t.tenantId, t.createdAt),
      index('sales_shift_idx').on(t.shiftId),
      foreignKey({
        columns: [t.tenantId, t.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }).onDelete('restrict'),
      foreignKey({
        columns: [t.tenantId, t.paymentMethodId],
        foreignColumns: [paymentMethods.tenantId, paymentMethods.id],
      }).onDelete('restrict'),
      foreignKey({
        columns: [t.tenantId, t.memberId],
        foreignColumns: [members.tenantId, members.id],
      }).onDelete('restrict'),
      foreignKey({
        columns: [t.tenantId, t.voucherId],
        foreignColumns: [vouchers.tenantId, vouchers.id],
      }).onDelete('restrict'),
      // Underpaid (paid < total + rounding) only as a credit sale, which needs a member. `rounding` is
      // counted once: in the amount due, never in `total`.
      check(
        'sales_money_ck',
        sql`${t.subtotal} >= 0 and ${t.discount} >= 0 and ${t.voucherDiscount} >= 0
          and ${t.discount} + ${t.voucherDiscount} <= ${t.subtotal} and ${t.tax} >= 0
          and ${t.total} = ${t.subtotal} - ${t.discount} - ${t.voucherDiscount} + ${t.tax}
          and ${t.rounding} between 0 and 99
          and (${t.rounding} = 0 or (${t.total} + ${t.rounding}) % 100 = 0)
          and ${t.change} = greatest(${t.paid} - ${t.total} - ${t.rounding}, 0) and ${t.costTotal} >= 0
          and (${t.paid} >= ${t.total} + ${t.rounding} or ${t.memberId} is not null)`,
      ),
    ],
  )
  .enableRLS();

export const saleLines = pos
  .table(
    'sale_lines',
    {
      id: id(),
      tenantId: tenantId(),
      saleId: uuid('sale_id').notNull(),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'restrict' }),
      name: text('name').notNull(), // snapshot for the receipt
      // In the line's unit (UMK-1985): 2 dus is qty 2, unit_qty 24, base_qty 48.
      qty: integer('qty').notNull(),
      // Unit name at the time of sale; null on a row from before UMK-1985 = the product's base unit.
      unit: text('unit'),
      // Base units per unit: 1 for the base unit.
      unitQty: integer('unit_qty').notNull().default(1),
      // What stock was drawn for: always qty × unit_qty.
      baseQty: integer('base_qty').generatedAlwaysAs(sql`qty * unit_qty`),
      // The unit's price before any wholesale tier; null on a row from before UMK-1985 = list_price.
      normalUnitPrice: rupiah('normal_unit_price'),
      // min_qty of the wholesale tier that set list_price; null = no tier.
      appliedTierMinQty: integer('applied_tier_min_qty'),
      listPrice: rupiah('list_price').notNull(), // the server's price per unit at the time of sale (tier applied)
      unitPrice: rupiah('unit_price').notNull(), // charged; differs only with an override
      lineTotal: rupiah('line_total').notNull(),
      costTotal: rupiah('cost_total').notNull(),
      priceOverriddenBy: uuid('price_overridden_by'),
    },
    (t) => [
      index('sale_lines_sale_idx').on(t.saleId),
      foreignKey({
        columns: [t.tenantId, t.saleId],
        foreignColumns: [sales.tenantId, sales.id],
      }).onDelete('restrict'),
      check(
        'sale_lines_ck',
        sql`${t.qty} > 0 and ${t.unitPrice} >= 0 and ${t.lineTotal} = ${t.unitPrice} * ${t.qty} and ${t.costTotal} >= 0`,
      ),
      check('sale_lines_unit_ck', sql`${t.unitQty} >= 1`),
    ],
  )
  .enableRLS();
