import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah, updatedAt } from './_base';
import { ACTOR_KINDS, shifts } from './sales';
import { tenants } from './tenants';

// UMK-1984 the expense log: money the store paid out that is not a sale's refund.

/**
 * The record kind. A `supplier_payment` pays for goods: it is listed with the expenses and can take
 * cash out of a drawer, but it is NOT an expense of the profit and loss report (the goods' cost is
 * already counted as cost of goods sold when they are sold). UMK-1970 (a supplier payment tied to a
 * purchase order) adds to this kind; it must stay out of the P&L expenses.
 */
export const EXPENSE_KINDS = ['expense', 'supplier_payment'] as const;

/** The fixed category list (owner-approved design); the label is what screens and CSV show. */
export const EXPENSE_CATEGORIES = [
  'bayar_pemasok',
  'listrik_air',
  'sewa',
  'gaji',
  'transport',
  'lainnya',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  bayar_pemasok: 'Bayar pemasok',
  listrik_air: 'Listrik & air',
  sewa: 'Sewa',
  gaji: 'Gaji',
  transport: 'Transport',
  lainnya: 'Lainnya',
};

/** The one category that is a supplier payment, not an expense. */
export const SUPPLIER_PAYMENT_CATEGORY: ExpenseCategory = 'bayar_pemasok';

/** Where the money came from: the cashier's open drawer, or anywhere else (no drawer effect). */
export const EXPENSE_SOURCES = ['drawer', 'outside'] as const;

export const expenses = pos
  .table(
    'expenses',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      kind: text('kind', { enum: EXPENSE_KINDS }).notNull(),
      category: text('category', { enum: EXPENSE_CATEGORIES }).notNull(),
      amount: rupiah('amount').notNull(),
      note: text('note'),
      // A calendar date in the store's timezone (common/store-day.ts), 'YYYY-MM-DD': the day the
      // expense counts in. A drawer expense is always dated the day it was recorded.
      expenseDate: date('expense_date', { mode: 'string' }).notNull(),
      source: text('source', { enum: EXPENSE_SOURCES }).notNull(),
      // Drawer only: the shift whose ledger has this expense's cash-out entry (ref_id = this row).
      shiftId: uuid('shift_id'),
      // Drawer only: that shift's expected cash just before this expense, kept so a replay answers the
      // same "more than the drawer holds" warning as the first request.
      drawerCashBefore: rupiah('drawer_cash_before'),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      idempotencyKey: text('idempotency_key').notNull(),
      requestHash: text('request_hash').notNull(),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
      // Last edit (category, note; amount and date of an outside expense). Null = never edited.
      updatedById: uuid('updated_by_id'),
      updatedByKind: text('updated_by_kind', { enum: ACTOR_KINDS }),
      // Soft delete: a voided expense stays as a row, out of every total.
      voidedAt: timestamp('voided_at', { withTimezone: true }),
      voidedById: uuid('voided_by_id'),
      voidedByKind: text('voided_by_kind', { enum: ACTOR_KINDS }),
      voidReason: text('void_reason'),
      // Drawer only, set by the void: true = its shift was still open and got a cash-in entry
      // (`expense_reversal`); false = the shift was already closed and stays as it was counted.
      drawerReversed: boolean('drawer_reversed'),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      index('expenses_tenant_date_idx').on(t.tenantId, t.expenseDate),
      uniqueIndex('expenses_tenant_key_uq').on(t.tenantId, t.idempotencyKey),
      foreignKey({
        columns: [t.tenantId, t.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }).onDelete('restrict'),
      check('expenses_amount_ck', sql`${t.amount} > 0`),
      check(
        'expenses_kind_ck',
        sql`(${t.kind} = 'supplier_payment') = (${t.category} = 'bayar_pemasok')`,
      ),
      check(
        'expenses_source_ck',
        sql`(${t.source} = 'drawer') = (${t.shiftId} is not null)
          and (${t.source} = 'drawer') = (${t.drawerCashBefore} is not null)`,
      ),
      check(
        'expenses_void_ck',
        sql`(${t.voidedAt} is null) = (${t.voidedById} is null)
          and (${t.voidedAt} is null) = (${t.voidedByKind} is null)
          and (${t.voidedAt} is not null or ${t.voidReason} is null)
          and (${t.drawerReversed} is not null) = (${t.voidedAt} is not null and ${t.source} = 'drawer')`,
      ),
    ],
  )
  .enableRLS();

/** One edited field: what it was and what it became. A cleared note is `null`. */
export type ExpenseChange<T> = { from: T; to: T };
export type ExpenseChanges = {
  category?: ExpenseChange<ExpenseCategory>;
  amount?: ExpenseChange<number>;
  note?: ExpenseChange<string | null>;
  date?: ExpenseChange<string>;
};

// The edit history of an expense: one append-only row per edit that changed something, with the
// before and after value of every changed field, who and when. Never updated or deleted.
export const expenseEdits = pos
  .table(
    'expense_edits',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      expenseId: uuid('expense_id').notNull(),
      changes: jsonb('changes').$type<ExpenseChanges>().notNull(),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index('expense_edits_expense_idx').on(t.tenantId, t.expenseId),
      foreignKey({
        columns: [t.tenantId, t.expenseId],
        foreignColumns: [expenses.tenantId, expenses.id],
      }).onDelete('restrict'),
    ],
  )
  .enableRLS();
