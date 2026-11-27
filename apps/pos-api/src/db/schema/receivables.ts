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
import { members } from './members';
import { ACTOR_KINDS, paymentMethods, sales } from './sales';
import { tenants } from './tenants';

// U7 credit sales (ported from Lakasir receivables, receivable_payments). Balance changes only under
// the receivable's row lock. Composite (tenant_id, id) FKs keep every row inside one store.

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

// One per credit sale. Its items are the sale's own sale_lines. Settled ⇔ rest = 0.
export const receivables = pos
  .table(
    'receivables',
    {
      id: id(),
      tenantId: tenantId(),
      saleId: uuid('sale_id').notNull(),
      memberId: uuid('member_id').notNull(),
      total: rupiah('total').notNull(),
      rest: rupiah('rest').notNull(),
      // A calendar date in the store's timezone (common/store-day.ts); returned as 'YYYY-MM-DD', no time.
      dueDate: date('due_date', { mode: 'string' }).notNull(),
      lastPaymentAt: timestamp('last_payment_at', { withTimezone: true }),
      // Set when the sale is voided (UMK-1962): `rest` drops to 0 and what was still owed is kept here.
      cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
      cancelledAmount: rupiah('cancelled_amount').notNull().default(0),
      createdAt: createdAt(),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      uniqueIndex('receivables_sale_uq').on(t.saleId),
      index('receivables_tenant_member_idx').on(t.tenantId, t.memberId),
      foreignKey({
        columns: [t.tenantId, t.saleId],
        foreignColumns: [sales.tenantId, sales.id],
      }).onDelete('restrict'),
      foreignKey({
        columns: [t.tenantId, t.memberId],
        foreignColumns: [members.tenantId, members.id],
      }).onDelete('restrict'),
      check(
        'receivables_ck',
        sql`${t.total} > 0 and ${t.rest} between 0 and ${t.total}`,
      ),
      check(
        'receivables_cancel_ck',
        sql`${t.cancelledAmount} between 0 and ${t.total}
          and (${t.cancelledAt} is not null or ${t.cancelledAmount} = 0)
          and (${t.cancelledAt} is null or ${t.rest} = 0)`,
      ),
    ],
  )
  .enableRLS();

/**
 * Why a payment was corrected (UMK-1971, design feature 31); `other` needs a note. Sent to payment-api as its own
 * cancel reasons by `CORRECTION_CANCEL_REASON` (src/receivables/receivable-corrections.service.ts).
 */
export const CORRECTION_REASONS = [
  'wrong_amount',
  'wrong_method',
  'wrong_customer',
  'duplicate',
  'other',
] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

// Append-only payment ledger (Lakasir allowed edit/delete). A wrong payment is corrected by a REVERSAL row
// (`reverses_id`, negative amount) plus, optionally, a new payment (`replaces_id`); no row is ever changed, so
// remaining = total − Σ amount, and a closed day or shift keeps its figures (UMK-1971).
export const receivablePayments = pos
  .table(
    'receivable_payments',
    {
      id: id(),
      tenantId: tenantId(),
      receivableId: uuid('receivable_id').notNull(),
      amount: rupiah('amount').notNull(),
      paymentMethodId: uuid('payment_method_id').notNull(),
      restBefore: rupiah('rest_before').notNull(),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      // Idempotency-Key of the request and a hash of its body (null for a kasbon's down payment).
      idempotencyKey: text('idempotency_key'),
      requestHash: text('request_hash'),
      // A cash instalment taken while its collector (actor_id, at created_at) had no open shift
      // (owner ruling 2026-11-24, UMK-1963): it is in no shift's cash ledger and no expected cash.
      // A payment taken in a shift is linked by its pos.shift_cash_entries row instead; never both.
      collectedOutsideShift: boolean('collected_outside_shift')
        .notNull()
        .default(false),
      // UMK-1991: this payment's number on its receivable (1, 2, …); its payment in payment-api has the order
      // reference `<receivable id>:<seq>`. Null = taken while payment-api was off, never sent.
      seq: integer('seq'),
      // The payment in payment-api; null with a `seq` = not recorded there yet (the job repeats it).
      paymentId: uuid('payment_id'),
      // payment-api's method, fixed when the payment was taken (set with `seq`).
      paymentMethodCode: text('payment_method_code'),
      // UMK-1971: on a reversal row, the payment it cancels (at most one reversal per payment). Its `amount` is
      // minus that payment's, its `rest_before` the rest just before the correction, its actor who corrected.
      reversesId: uuid('reverses_id'),
      // On the new payment of a correction: the payment it replaces (its reversal is the row before it).
      replacesId: uuid('replaces_id'),
      // A reversal's reason, note and the approver whose void PIN was checked.
      reasonCode: text('reason_code', { enum: CORRECTION_REASONS }),
      note: text('note'),
      approvedBy: uuid('approved_by'),
      approvedByKind: text('approved_by_kind', { enum: ACTOR_KINDS }),
      // A reversal whose original payment is still to be voided in payment-api (the job repeats it).
      paymentSyncPending: boolean('payment_sync_pending')
        .notNull()
        .default(false),
      createdAt: createdAt(),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      index('receivable_payments_receivable_idx').on(t.receivableId),
      uniqueIndex('receivable_payments_seq_uq')
        .on(t.tenantId, t.receivableId, t.seq)
        .where(sql`${t.seq} is not null`),
      index('receivable_payments_unrecorded_idx')
        .on(t.createdAt)
        .where(sql`${t.seq} is not null and ${t.paymentId} is null`),
      uniqueIndex('receivable_payments_tenant_key_uq')
        .on(t.tenantId, t.idempotencyKey)
        .where(sql`${t.idempotencyKey} is not null`),
      foreignKey({
        columns: [t.tenantId, t.receivableId],
        foreignColumns: [receivables.tenantId, receivables.id],
      }).onDelete('restrict'),
      foreignKey({
        columns: [t.tenantId, t.paymentMethodId],
        foreignColumns: [paymentMethods.tenantId, paymentMethods.id],
      }).onDelete('restrict'),
      // One reversal per payment, one replacement per payment: a second correction fails here too. The links
      // are `no action` (checked at the end of a statement), so the purge's one delete of a store's rows passes.
      uniqueIndex('receivable_payments_reverses_uq')
        .on(t.tenantId, t.reversesId)
        .where(sql`${t.reversesId} is not null`),
      uniqueIndex('receivable_payments_replaces_uq')
        .on(t.tenantId, t.replacesId)
        .where(sql`${t.replacesId} is not null`),
      foreignKey({
        name: 'receivable_payments_reverses_fk',
        columns: [t.tenantId, t.reversesId],
        foreignColumns: [t.tenantId, t.id],
      }).onDelete('no action'),
      foreignKey({
        name: 'receivable_payments_replaces_fk',
        columns: [t.tenantId, t.replacesId],
        foreignColumns: [t.tenantId, t.id],
      }).onDelete('no action'),
      check(
        'receivable_payments_ck',
        sql`(${t.reversesId} is null and ${t.amount} > 0 and ${t.amount} <= ${t.restBefore})
          or (${t.reversesId} is not null and ${t.amount} < 0 and ${t.replacesId} is null and ${t.seq} is null
            and ${t.reasonCode} is not null and ${t.approvedBy} is not null and ${t.approvedByKind} is not null)`,
      ),
    ],
  )
  .enableRLS();
