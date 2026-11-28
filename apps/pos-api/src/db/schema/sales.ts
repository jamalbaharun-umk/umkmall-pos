import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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

export const ACTOR_KINDS = ['owner', 'cashier', 'agent'] as const;
/** How a row UMKMall's agent recorded names its actor on screens and receipts (UMK-1981). */
export const AGENT_LABEL = 'Agent UMKMall';

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
      // UMK-2120, design 40 screen 7: opened by the owner's first cash action, and when the owner checked or
      // corrected its opening cash on the till.
      openedAutomatically: boolean('opened_automatically')
        .notNull()
        .default(false),
      openingCheckedAt: ts('opening_checked_at'),
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

/**
 * payment-api's methods an online payment method may carry (UMK-1991). Only the local fake gateway's until
 * the legal gate (UMK-1977); a real provider adds its methods here, with a migration for the check below.
 */
export const GATEWAY_METHODS = [
  'fake_qris',
  'fake_va',
  'fake_checkout',
] as const;

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
      // UMK-1991: paid through a payment gateway (dynamic QRIS, VA). `gateway_method` is payment-api's method
      // for it (`fake_qris`, `fake_va`, `fake_checkout`), set exactly when the kind is online.
      isOnline: boolean('is_online').notNull().default(false),
      gatewayMethod: text('gateway_method'),
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
        sql`${t.isCash}::int + ${t.isDebit}::int + ${t.isCredit}::int + ${t.isWallet}::int + ${t.isOnline}::int = 1`,
      ),
      check(
        'payment_methods_online_ck',
        sql`${t.isOnline} = (${t.gatewayMethod} is not null)`,
      ),
      // Only a method this version can charge: a sale with any other would wait for a payment for ever.
      check(
        'payment_methods_gateway_method_ck',
        sql`${t.gatewayMethod} is null or ${t.gatewayMethod} in (${sql.raw(
          GATEWAY_METHODS.map((m) => `'${m}'`).join(', '),
        )})`,
      ),
    ],
  )
  .enableRLS();

// Per-store sale settings and the two counters (one row, upserted by every sale): the receipt number, taken
// when a sale is COMPLETED, and the hold number, taken when a sale is created to wait for its payment.
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
      // UMK-2038: "Menunggu #n". Its own counter, so a sale that is cancelled leaves no gap in the receipts.
      lastHoldNumber: integer('last_hold_number').notNull().default(0),
      // The store day (Asia/Jakarta) `last_hold_number` counts in: the first hold number taken on another
      // day is 1 again, so the numbers stay short. Null until the first one is taken.
      holdNumberDay: date('hold_number_day'),
      // Feature 39: the owner's optional daily sales target (rupiah), and when the tax was first saved, at any rate
      // including 0% (never moved after; null until the owner saves it).
      dailyTarget: rupiah('daily_target'),
      taxSetAt: timestamp('tax_set_at', { withTimezone: true }),
    },
    (t) => [
      check('sales_settings_tax_ck', sql`${t.taxBps} between 0 and 10000`),
      check(
        'sales_settings_target_ck',
        sql`${t.dailyTarget} is null or ${t.dailyTarget} > 0`,
      ),
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
/**
 * Why a sale that awaited its payment was cancelled (UMK-2046):
 * - `cashier`: someone at the till gave it up ("Batalkan").
 * - `expired`: the QR or VA ran out unpaid. `failed`: the gateway said the payment failed.
 * - `gateway_refused`: the store may not charge at the gateway, so no bill was made.
 * - `unpaid`: no payment was ever recorded for it and the job gave it up, or its bill was closed otherwise.
 */
export const CANCEL_REASONS = [
  'cashier',
  'expired',
  'failed',
  'gateway_refused',
  'unpaid',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
/** A sale that was rung up: what lists, reports and shift totals count. */
export const FINAL_SALE_STATUSES = ['completed', 'void'] as const;

export const sales = pos
  .table(
    'sales',
    {
      id: id(),
      tenantId: tenantId(),
      // The receipt number: gap-free per store over completed sales. Given in the write that completes the
      // sale (UMK-2038), so it is null while the sale awaits its payment and stays null when it is cancelled.
      // (A sale cancelled before UMK-2038 kept the number it was created with: old gaps stay gaps.)
      number: integer('number'),
      // What a sale is called while it waits for its payment ("Menunggu #n"): null for a sale that was
      // completed in the transaction that created it (payment-api off, kasbon).
      holdNumber: integer('hold_number'),
      // The store day the hold number was taken on: hold numbers start at 1 every day, so a sale that waits
      // is one of a kind by (store, day, number). Set exactly when `hold_number` is.
      holdDay: date('hold_day'),
      shiftId: uuid('shift_id').notNull(),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      paymentMethodId: uuid('payment_method_id').notNull(),
      idempotencyKey: text('idempotency_key').notNull(),
      // sha256 of the normalized request: the same key with a different body is refused, not replayed.
      requestHash: text('request_hash'),
      subtotal: rupiah('subtotal').notNull(),
      // Every manual discount: the lines' (UMK-1990) plus the order's. Revenue = subtotal − discount − voucher + tax.
      discount: rupiah('discount').notNull().default(0),
      // UMK-1990: the part of `discount` given on lines (Σ sale_lines.discount); the rest is the order discount.
      lineDiscount: rupiah('line_discount').notNull().default(0),
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
      // UMK-1990 (ruling 2026-11-26): who approved by PIN an order discount above 30% of what it came off; null
      // when none was needed.
      discountApprovedBy: uuid('discount_approved_by'),
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
      // UMK-2037: the bank the customer chose for a PG method that needs one (a virtual account), as the
      // cashier sent it and payment-api knows it. Sent with every charge of the PG attempt; null otherwise.
      paymentBank: text('payment_bank'),
      // Which try at paying this sale: the charge key at payment-api is `<sale id>:<attempt>`. The switch from
      // a PG method to cash starts a new one, and so does a new QR, VA or link for the same sale (UMK-2042);
      // `payment_attempt_at` is when it started (the job waits from then before it gives an unanswered charge
      // up).
      paymentAttempt: integer('payment_attempt').notNull().default(1),
      paymentAttemptAt: ts('payment_attempt_at').notNull().defaultNow(),
      // The cashier asked to take cash instead of the PG payment: the cash tendered. While it is set, the PG
      // attempt closing unpaid turns the sale into a cash sale instead of cancelling it.
      switchCashPaid: rupiah('switch_cash_paid'),
      // UMK-2042: the cashier asked for a new bill (QR, VA, link) for this sale, and when. While it is set, the
      // current bill closing unpaid does not cancel the sale: the request that wrote it moves the sale to the
      // next attempt. Never set together with `switch_cash_paid`.
      paymentRenewAt: ts('payment_renew_at'),
      cancelledAt: ts('cancelled_at'),
      // The moment the sale counts from in every report and list (owner ruling 2026-11-25): when it was
      // PAID. That is when it was rung up, except for a sale that waited for a payment gateway: the
      // gateway's paid time, or the moment the cashier took cash instead.
      paidAt: ts('paid_at').notNull().defaultNow(),
      // When pos-api WROTE the completion (its own clock), which is also when the receipt number was given.
      // Not a reporting date (that is `paid_at`): it answers "what was completed since I last looked"
      // (UMK-2046), because a payment learned late is dated in the past by `paid_at`.
      completedAt: ts('completed_at'),
      // The job completed the sale (UMK-2046), not a request of the person at the till: a cash or EDC sale
      // whose payment could not be confirmed when it was rung up.
      settledByJob: boolean('settled_by_job').notNull().default(false),
      // Why a sale was cancelled, when known (CANCEL_REASONS); null on a sale cancelled before UMK-2046.
      cancelReason: text('cancel_reason', { enum: CANCEL_REASONS }),
      // payment-api's code when it refused to bill the sale at all (`gateway_refused`: GATE_REFUSALS or
      // BANK_REFUSALS, UMK-2055), so a repeat of the request answers what the first one did.
      paymentRefusedCode: text('payment_refused_code'),
      createdAt: createdAt(),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      // A receipt has its number and the time it was completed; a waiting sale has its hold number.
      check(
        'sales_number_ck',
        sql`(${t.status} not in ('completed', 'void') or (${t.number} is not null and ${t.completedAt} is not null))
          and (${t.status} <> 'awaiting_payment' or ${t.holdNumber} is not null)`,
      ),
      check(
        'sales_hold_day_ck',
        sql`(${t.holdNumber} is null) = (${t.holdDay} is null)
          and (${t.cancelReason} is null or ${t.status} = 'cancelled')`,
      ),
      check(
        'sales_status_ck',
        sql`${t.status} in ('completed', 'void', 'awaiting_payment', 'cancelled')
          and (${t.status} = 'void') = (${t.voidedAt} is not null)
          and (${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
      ),
      check(
        'sales_attempt_ck',
        sql`${t.paymentAttempt} >= 1 and (${t.switchCashPaid} is null or ${t.status} = 'awaiting_payment')
          and (${t.paymentRenewAt} is null or (${t.status} = 'awaiting_payment' and ${t.switchCashPaid} is null))`,
      ),
      // The job's sweep of sales still waiting for their payment.
      index('sales_awaiting_idx')
        .on(t.paymentAttemptAt)
        .where(sql`${t.status} = 'awaiting_payment'`),
      uniqueIndex('sales_tenant_idempotency_uq').on(
        t.tenantId,
        t.idempotencyKey,
      ),
      uniqueIndex('sales_tenant_number_uq').on(t.tenantId, t.number),
      uniqueIndex('sales_tenant_hold_day_number_uq').on(
        t.tenantId,
        t.holdDay,
        t.holdNumber,
      ),
      // `GET /sales/paid-since` pages through a store's ended sales in exactly this order.
      index('sales_tenant_ended_idx').on(
        t.tenantId,
        sql`coalesce(${t.cancelledAt}, ${t.completedAt})`,
        t.id,
      ),
      index('sales_tenant_created_idx').on(t.tenantId, t.createdAt),
      index('sales_tenant_paid_idx').on(t.tenantId, t.paidAt),
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
      check(
        'sales_line_discount_ck',
        sql`${t.lineDiscount} >= 0 and ${t.lineDiscount} <= ${t.discount}`,
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
      // UMK-1990: the line discount in rupiah, off `line_total` (which stays qty × unit_price); the line was
      // charged `line_total - discount`. `discount_percent` when it was given as a percent (1-99), for the label.
      discount: rupiah('discount').notNull().default(0),
      discountPercent: integer('discount_percent'),
      // Who approved a discount above DISCOUNT_APPROVAL_BPS by PIN (owner or staff id); null below it.
      discountApprovedBy: uuid('discount_approved_by'),
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
      // Never 100%: a discounted line keeps at least Rp1.
      check(
        'sale_lines_discount_ck',
        sql`${t.discount} >= 0 and (${t.discount} = 0 or ${t.discount} < ${t.lineTotal})
          and (${t.discountPercent} is null or ${t.discountPercent} between 1 and 99)`,
      ),
    ],
  )
  .enableRLS();

/** What a PIN approval covers: one line of a product (its discount or a lower manual price), or the order discount. */
export const DISCOUNT_APPROVAL_SCOPES = ['line', 'order'] as const;
export type DiscountApprovalScope = (typeof DISCOUNT_APPROVAL_SCOPES)[number];

/**
 * UMK-1990: a PIN approval of a manual reduction above 30% (`DISCOUNT_APPROVAL_BPS`). The approver (the owner or
 * staff holding `sales.price_override`) types their own PIN at the till; the row lets the actor who asked take at
 * most `max_bps` off, once, until `expires_at`: scope `line`, off one line of `product_id` (a line discount, or a
 * manual price below the server's, ruling 2026-11-26); scope `order`, off the order (the order discount, of the
 * subtotal after line discounts; no product). Taken (`used_at`, `sale_id`) inside the sale's transaction. No PIN is
 * kept here: only the approver's own hashed PIN is checked.
 */
export const discountApprovals = pos
  .table(
    'discount_approvals',
    {
      id: id(),
      tenantId: tenantId(),
      // The session actor who asked and may use it.
      actorId: uuid('actor_id').notNull(),
      approverId: uuid('approver_id').notNull(),
      approverKind: text('approver_kind', {
        enum: ['owner', 'cashier'],
      }).notNull(),
      scope: text('scope', { enum: DISCOUNT_APPROVAL_SCOPES })
        .notNull()
        .default('line'),
      // The line's product; null for an order approval.
      productId: uuid('product_id').references(() => products.id, {
        onDelete: 'restrict',
      }),
      // The largest reduction approved, in basis points of the line's total (of the order's, for `order`).
      maxBps: integer('max_bps').notNull(),
      // The largest reduction approved, in rupiah (PR 72 review): the approval covers at most this much off, so one
      // asked for a small cart cannot take a large one. The route requires it for every new approval; the column stays
      // nullable (the check requires it for `order` only) so a line approval issued before PR 72, which has none, stays
      // valid until it expires, bound to its share alone.
      maxAmount: rupiah('max_amount'),
      expiresAt: ts('expires_at').notNull(),
      usedAt: ts('used_at'),
      saleId: uuid('sale_id'),
      createdAt: createdAt(),
    },
    (t) => [
      index('discount_approvals_tenant_actor_idx').on(t.tenantId, t.actorId),
      foreignKey({
        columns: [t.tenantId, t.saleId],
        foreignColumns: [sales.tenantId, sales.id],
      }).onDelete('restrict'),
      check(
        'discount_approvals_ck',
        sql`${t.maxBps} between 1 and 9999 and (${t.usedAt} is null) = (${t.saleId} is null)`,
      ),
      check(
        'discount_approvals_scope_ck',
        sql`${t.scope} in ('line', 'order') and (${t.scope} = 'order') = (${t.productId} is null)`,
      ),
      check(
        'discount_approvals_amount_ck',
        sql`(${t.maxAmount} is null or ${t.maxAmount} >= 1) and (${t.scope} = 'line' or ${t.maxAmount} is not null)`,
      ),
    ],
  )
  .enableRLS();
