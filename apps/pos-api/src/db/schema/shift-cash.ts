import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah } from './_base';
import { ACTOR_KINDS, shifts } from './sales';
import { tenants } from './tenants';

// UMK-1963 the shift's cash ledger: every movement of drawer cash that is not a sale.
// Expected cash = opening cash + cash sales (from pos.sales) + Σ in − Σ out.
// Append-only: rows are inserted for an OPEN shift only (src/shifts/cash-ledger.ts) and never updated
// or deleted, so a closed shift's figures cannot change.

export const CASH_DIRECTIONS = ['in', 'out'] as const;

/**
 * What moved the cash; `ref_id` is that kind's source row. A new kind (supplier payment, expense,
 * void cash out) is added here and needs no migration.
 * - receivable_payment (in): ref_id = pos.receivable_payments.id
 * - void_refund (out): ref_id = pos.sale_voids.id, the cash given back for a voided sale (UMK-1962)
 * - expense (out): ref_id = pos.expenses.id, an expense or supplier payment paid from the drawer
 *   (UMK-1984). Written only by src/expenses/expenses.service.ts.
 * - expense_reversal (in): ref_id = pos.expenses.id, a voided drawer expense whose shift is still open.
 * - manual_in / manual_out: ref_id = pos.manual_cash_entries.id, cash a cashier put into or took out of
 *   the drawer by hand (extra float, a bank deposit; UMK-1924 U3). Written only by
 *   src/shifts/cash-entries.service.ts.
 * - collector_deposit (in): ref_id = pos.store_cash_deposits.id, a collector's outside-shift cash received
 *   into this drawer ("Setoran penagih"). Written only by src/store-cash/store-cash-deposits.service.ts.
 * A supplier payment tied to a purchase order (UMK-1970) gets its own kind here when it is built.
 */
export const CASH_ENTRY_KINDS = [
  'receivable_payment',
  'void_refund',
  'expense',
  'expense_reversal',
  'manual_in',
  'manual_out',
  'collector_deposit',
] as const;

export const shiftCashEntries = pos
  .table(
    'shift_cash_entries',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      shiftId: uuid('shift_id').notNull(),
      direction: text('direction', { enum: CASH_DIRECTIONS }).notNull(),
      kind: text('kind', { enum: CASH_ENTRY_KINDS }).notNull(),
      // Always positive; the direction carries the sign.
      amount: rupiah('amount').notNull(),
      refId: uuid('ref_id'),
      note: text('note'),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index('shift_cash_entries_shift_idx').on(t.tenantId, t.shiftId),
      // One entry per source row: a second insert for the same payment fails instead of counting twice.
      uniqueIndex('shift_cash_entries_ref_uq')
        .on(t.tenantId, t.kind, t.refId)
        .where(sql`${t.refId} is not null`),
      foreignKey({
        columns: [t.tenantId, t.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }).onDelete('restrict'),
      check(
        'shift_cash_entries_ck',
        sql`${t.amount} > 0 and ${t.direction} in ('in', 'out')`,
      ),
    ],
  )
  .enableRLS();

// UMK-1924 U3 manual drawer cash: cash put into or taken out of an open drawer by hand, with its reason.
// One row per movement, with the request's idempotency key; its money is the shift ledger row of kind
// `manual_in` / `manual_out` whose ref_id is this row. Append-only.

/** The fixed reason list per direction (a proposal until a design names it); `lainnya` needs a note. */
export const MANUAL_CASH_REASONS = {
  in: ['tambah_modal', 'lainnya'],
  out: ['setor_bank', 'ambil_pemilik', 'lainnya'],
} as const;
export const MANUAL_CASH_REASON_CODES = [
  'tambah_modal',
  'setor_bank',
  'ambil_pemilik',
  'lainnya',
] as const;
export type ManualCashReason = (typeof MANUAL_CASH_REASON_CODES)[number];
export const MANUAL_CASH_REASON_LABELS: Record<ManualCashReason, string> = {
  tambah_modal: 'Tambah modal laci',
  setor_bank: 'Setor ke bank',
  ambil_pemilik: 'Diambil pemilik',
  lainnya: 'Lainnya',
};

export const manualCashEntries = pos
  .table(
    'manual_cash_entries',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      shiftId: uuid('shift_id').notNull(),
      direction: text('direction', { enum: CASH_DIRECTIONS }).notNull(),
      reason: text('reason', { enum: MANUAL_CASH_REASON_CODES }).notNull(),
      note: text('note'),
      amount: rupiah('amount').notNull(),
      // The shift's expected cash just before this movement.
      drawerCashBefore: rupiah('drawer_cash_before').notNull(),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      idempotencyKey: text('idempotency_key').notNull(),
      requestHash: text('request_hash').notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index('manual_cash_entries_shift_idx').on(t.tenantId, t.shiftId),
      uniqueIndex('manual_cash_entries_tenant_key_uq').on(
        t.tenantId,
        t.idempotencyKey,
      ),
      foreignKey({
        columns: [t.tenantId, t.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }).onDelete('restrict'),
      check(
        'manual_cash_entries_ck',
        sql`${t.amount} > 0 and ${t.direction} in ('in', 'out')`,
      ),
    ],
  )
  .enableRLS();
