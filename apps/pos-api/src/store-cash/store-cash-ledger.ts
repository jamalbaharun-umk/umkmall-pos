import { eq, sql } from 'drizzle-orm';
import { codedError, formatRupiah } from '../common/validation';
import {
  type STORE_CASH_DIRECTIONS,
  type STORE_CASH_KINDS,
  storeCashEntries,
} from '../db/schema';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';

/**
 * The store's cash ledger, "kas toko" (UMK-1963): cash the store holds outside every shift drawer.
 * Balance = Σ in − Σ out. A collector's deposit into a shift drawer is an `out` here (and an `in` in
 * that shift's ledger); a `transfer` is a legacy handover to a safe and leaves the balance as it was.
 *
 * This file is the only place that inserts ledger rows (guard in src/guards.spec.ts), and nothing
 * updates or deletes them. An entry is written inside the transaction of the movement it records (a
 * receivable payment's, a deposit's), so the two exist together or not at all; the unique index on the source row
 * refuses a second entry for the same source.
 *
 * Every `out` takes the store's cash lock first (a transaction-scoped advisory lock per tenant, `lockStoreCash`),
 * so outflows are written one at a time. An outflow that must be covered (`mustCover`, owner ruling 2026-11-27:
 * kas toko never goes negative through a correction) reads the balance under that lock and is refused with
 * `STORE_CASH_INSUFFICIENT` (with `available`) when the store does not hold it. Callers take their row locks
 * (purchase, staff, shift) before writing here, so this lock is always the last one taken.
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

/** The store's cash lock, held until the transaction ends. Taken by every outflow. */
export async function lockStoreCash(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('pos.store_cash'), hashtext(${tenantId}))`,
  );
}

/** Σ in − Σ out of the store's cash (a `transfer` moved nothing). */
export async function storeCashBalance(
  tx: Tx,
  tenantId: string,
): Promise<number> {
  const e = storeCashEntries;
  const [row] = await tx
    .select({
      balance: sql<string>`coalesce(sum(case ${e.direction} when 'in' then ${e.amount} when 'out' then -${e.amount} else 0 end), 0)`,
    })
    .from(e)
    .where(eq(e.tenantId, tenantId));
  return Number(row.balance);
}

/**
 * Adds one movement to the store's cash, inside the caller's transaction. An `out` takes the store's cash lock;
 * with `mustCover` it is refused (422 `STORE_CASH_INSUFFICIENT`, `available`) when it would take the balance
 * below zero.
 */
export async function recordStoreCash(
  tx: Tx,
  s: PosSession,
  entry: StoreCashEntry,
  opts: { mustCover?: boolean } = {},
): Promise<void> {
  if (entry.direction === 'out') {
    await lockStoreCash(tx, s.tenantId);
    if (opts.mustCover) {
      const available = Math.max(await storeCashBalance(tx, s.tenantId), 0);
      if (entry.amount > available)
        throw codedError(
          'STORE_CASH_INSUFFICIENT',
          '_',
          `Kas toko (${formatRupiah(available)}) kurang dari ${formatRupiah(entry.amount)} yang harus dikeluarkan.`,
          { available },
        );
    }
  }
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
