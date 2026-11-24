import {
  type STORE_CASH_DIRECTIONS,
  type STORE_CASH_KINDS,
  storeCashEntries,
} from '../db/schema';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';

/**
 * The store's cash ledger, "kas toko" (UMK-1963): cash the store holds outside every shift drawer.
 * Balance = Σ in − Σ out.
 *
 * This file is the only place that inserts ledger rows (guard in src/guards.spec.ts), and nothing
 * updates or deletes them. An entry is written inside the transaction of the movement it records (a
 * receivable payment's), so the two exist together or not at all; the unique index on the source row
 * refuses a second entry for the same source.
 */

export type StoreCashEntry = {
  direction: (typeof STORE_CASH_DIRECTIONS)[number];
  kind: (typeof STORE_CASH_KINDS)[number];
  /** Integer rupiah, positive. */
  amount: number;
  /** The source row of this kind (a receivable payment's id); one entry per source. */
  refId?: string;
  note?: string;
};

/** Adds one movement to the store's cash, inside the caller's transaction. Takes no lock. */
export async function recordStoreCash(
  tx: Tx,
  s: PosSession,
  entry: StoreCashEntry,
): Promise<void> {
  await tx.insert(storeCashEntries).values({
    tenantId: s.tenantId,
    direction: entry.direction,
    kind: entry.kind,
    amount: entry.amount,
    refId: entry.refId ?? null,
    note: entry.note ?? null,
    actorId: s.actorId,
    actorKind: s.kind,
  });
}
