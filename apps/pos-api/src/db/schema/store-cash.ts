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
import { ACTOR_KINDS } from './sales';
import { staff } from './staff';
import { tenants } from './tenants';

// UMK-1963 the store's cash ledger ("kas toko"): cash the store holds outside every shift drawer.
// Balance = Σ in − Σ out; a `transfer` changes who holds the cash and not the balance. Append-only: rows are inserted by src/store-cash/store-cash-ledger.ts only
// and never updated or deleted.

export const STORE_CASH_DIRECTIONS = ['in', 'out', 'transfer'] as const;

/**
 * What moved the cash; `ref_id` is that kind's source row. A new kind (a supplier payment, an expense,
 * a handover to or from a drawer) is added here and needs no migration.
 * - receivable_payment (in): ref_id = pos.receivable_payments.id, a cash kasbon instalment taken by an
 *   actor who cannot open a shift (`collected_outside_shift`). The cash is with that collector until
 *   a deposit hands it over.
 * - collector_deposit (transfer): ref_id = pos.store_cash_deposits.id, a collector's cash handed over
 *   to the store safe (UMK-1924 U3). Written only by src/store-cash/store-cash-deposits.service.ts.
 */
export const STORE_CASH_KINDS = [
  'receivable_payment',
  'collector_deposit',
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

// UMK-1924 U3 the handover of a collector's outside-shift cash to the store safe: who handed over
// (the collector), who received (the actor who recorded it), how much. Its ledger line is the
// `collector_deposit` transfer whose ref_id is this row. Append-only.
// A collector's outstanding = Σ their `receivable_payment` entries − Σ their deposits.
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
      check(
        'store_cash_deposits_ck',
        sql`${t.amount} > 0 and ${t.amount} <= ${t.outstandingBefore}`,
      ),
    ],
  )
  .enableRLS();
