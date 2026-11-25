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

// Append-only payment ledger (Lakasir allowed edit/delete).
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
      check(
        'receivable_payments_ck',
        sql`${t.amount} > 0 and ${t.amount} <= ${t.restBefore}`,
      ),
    ],
  )
  .enableRLS();
