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
import { staff } from './staff';
import { tenants } from './tenants';

// UMK-1963 the store's cash ledger ("kas toko"): cash the store holds outside every shift drawer.
// Balance = Σ in − Σ out. A `transfer` (legacy: a handover to a safe, before deposits went into a drawer)
// changes who holds the cash and not the balance; nothing writes it any more. Append-only: rows are
// inserted by src/store-cash/store-cash-ledger.ts only and never updated or deleted.

export const STORE_CASH_DIRECTIONS = ['in', 'out', 'transfer'] as const;

/**
 * What moved the cash; `ref_id` is that kind's source row. A new kind (a supplier payment, an expense,
 * a handover to or from a drawer) is added here and needs no migration.
 * - receivable_payment (in): ref_id = pos.receivable_payments.id, a cash kasbon instalment taken by an
 *   actor who cannot open a shift (`collected_outside_shift`). The cash is with that collector until
 *   a deposit hands it over.
 * - collector_deposit (out): ref_id = pos.store_cash_deposits.id, a collector's cash received into a
 *   shift drawer (UMK-1924 U3): it leaves the cash outside every drawer and enters that shift's ledger
 *   (kind `collector_deposit`, in), so it is counted once. Written only by
 *   src/store-cash/store-cash-deposits.service.ts. (`transfer` on rows from before the drawer rule.)
 * - expense_void (in): ref_id = pos.expenses.id, a voided drawer expense whose shift was already closed:
 *   the cash given back goes to the store, the closed shift never changes (owner ruling 2026-11-25).
 * - purchase_payment_void (in): ref_id = pos.purchase_payments.id, a voided drawer supplier payment whose shift
 *   was already closed (UMK-1970), the same rule as expense_void.
 * - receivable_reversal (out): ref_id = the reversal row in pos.receivable_payments (UMK-1971), a corrected cash
 *   instalment that was collected outside a shift: it lowers what that collector holds (the original payment's
 *   actor, not this row's), never below what they deposited.
 * - receivable_reversal_closed_shift (out): ref_id = the reversal row in pos.receivable_payments (UMK-1971), the cash
 *   of a corrected instalment whose shift is already closed (owner ruling 2026-11-26): the closed shift and today's
 *   drawer never change, the store's cash gives it back, as expense_void does the other way. Not a collector's.
 */
export const STORE_CASH_KINDS = [
  'receivable_payment',
  'collector_deposit',
  'expense_void',
  'purchase_payment_void',
  'receivable_reversal',
  'receivable_reversal_closed_shift',
] as const;

export const storeCashEntries = pos
  .table(
    'store_cash_entries',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      direction: text('direction', { enum: STORE_CASH_DIRECTIONS }).notNull(),
      kind: text('kind', { enum: STORE_CASH_KINDS }).notNull(),
      // Always positive; the direction carries the sign.
      amount: rupiah('amount').notNull(),
      refId: uuid('ref_id'),
      note: text('note'),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index('store_cash_entries_tenant_idx').on(t.tenantId, t.createdAt),
      // One entry per source row: a second insert for the same payment fails instead of counting twice.
      uniqueIndex('store_cash_entries_ref_uq')
        .on(t.tenantId, t.kind, t.refId)
        .where(sql`${t.refId} is not null`),
      check(
        'store_cash_entries_ck',
        sql`${t.amount} > 0 and ${t.direction} in ('in', 'out', 'transfer')`,
      ),
    ],
  )
  .enableRLS();

// UMK-1924 U3 the handover of a collector's outside-shift cash: who handed over (the collector), who
// received (the actor who recorded it), how much, and the shift drawer it went into. Its ledger lines are
// the `collector_deposit` entries (store ledger out, shift ledger in) whose ref_id is this row. Append-only.
// A collector's outstanding = Σ their `receivable_payment` entries − Σ the reversals of those (UMK-1971) − Σ their deposits.
export const storeCashDeposits = pos
  .table(
    'store_cash_deposits',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      // The staff member who collected the cash and hands it over.
      collectorId: uuid('collector_id').notNull(),
      amount: rupiah('amount').notNull(),
      note: text('note'),
      // The collector's outstanding just before this deposit.
      outstandingBefore: rupiah('outstanding_before').notNull(),
      receivedById: uuid('received_by_id').notNull(),
      receivedByKind: text('received_by_kind', { enum: ACTOR_KINDS }).notNull(),
      // The open shift whose drawer took the cash; null on a handover from before the drawer rule.
      shiftId: uuid('shift_id'),
      idempotencyKey: text('idempotency_key').notNull(),
      requestHash: text('request_hash').notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index('store_cash_deposits_collector_idx').on(t.tenantId, t.collectorId),
      uniqueIndex('store_cash_deposits_tenant_key_uq').on(
        t.tenantId,
        t.idempotencyKey,
      ),
      foreignKey({
        columns: [t.tenantId, t.collectorId],
        foreignColumns: [staff.tenantId, staff.id],
      }).onDelete('restrict'),
      foreignKey({
        columns: [t.tenantId, t.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }).onDelete('restrict'),
      check(
        'store_cash_deposits_ck',
        sql`${t.amount} > 0 and ${t.amount} <= ${t.outstandingBefore}`,
      ),
    ],
  )
  .enableRLS();
