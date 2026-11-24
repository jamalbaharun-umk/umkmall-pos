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
 */
export const CASH_ENTRY_KINDS = ['receivable_payment', 'void_refund'] as const;

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
