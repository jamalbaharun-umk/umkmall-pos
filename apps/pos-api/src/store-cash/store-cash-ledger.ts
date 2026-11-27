import { sql } from 'drizzle-orm';
import { codedError, formatRupiah } from '../common/validation';
import {
  type STORE_CASH_DIRECTIONS,
  type STORE_CASH_KINDS,
  storeCashEntries,
} from '../db/schema';
import type { Db } from '../db/db.module';
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
 * Store cash never goes negative through a correction (owner rulings 2026-11-27): an outflow written with
 * `mustCover` (a supplier refund voided out of the store cash, a kasbon reversal of a closed shift's instalment)
 * takes the store's cash lock (`lockStoreCash`, a transaction-scoped advisory lock per tenant), reads
 * `available` under it and is refused with `STORE_CASH_INSUFFICIENT` (with `available`) when the store does not
 * hold the amount. `available` is the cash actually in the store: the balance minus what cashier collectors still
 * hold undeposited (their outstanding); what the owner collected counts as in the store.
 *
 * Only `mustCover` outflows take the lock. A collector's deposit or the reversal of a cashier collector's instalment
 * lowers the balance and that collector's outstanding by the same amount, so `available` stays as it was; an inflow
 * only raises it. Every caller of `mustCover` locks the rows another writer could hold while waiting for this lock
 * (the purchase, the receivable, every shift it will write to) BEFORE writing here; after it, a caller writes only
 * rows it already holds or new rows (its audit line, the new payment). Keep it so: a shift locked after this lock
 * can deadlock with a deposit into that shift.
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

/** The store's cash lock, held until the transaction ends. Taken by every `mustCover` outflow, last. */
export async function lockStoreCash(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('pos.store_cash'), hashtext(${tenantId}))`,
  );
}

/**
 * The cash actually in the store: Σ in − Σ out (a `transfer` moved nothing) minus what each cashier collector still
 * holds undeposited (what they collected outside a shift, less reversals of those instalments, less their deposits;
 * the figure `StoreCashDepositsService.collectors` shows as `outstanding`). Never below zero.
 */
export async function storeCashAvailable(
  db: Db | Tx,
  tenantId: string,
): Promise<number> {
  const [row] = await db.execute<{ balance: string; held: string }>(sql`
    select
      (select coalesce(sum(case e.direction when 'in' then e.amount when 'out' then -e.amount else 0 end), 0)
         from pos.store_cash_entries e where e.tenant_id = ${tenantId}) as balance,
      (select coalesce(sum(greatest(x.collected - coalesce(h.handed_over, 0), 0)), 0)
         from (
           select c.actor_id, sum(c.amount) as collected
             from (
               select e.actor_id, e.amount
                 from pos.store_cash_entries e
                where e.tenant_id = ${tenantId} and e.direction = 'in' and e.kind = 'receivable_payment'
                  and e.actor_kind = 'cashier'
               union all
               select p.actor_id, -e.amount
                 from pos.store_cash_entries e
                 join pos.receivable_payments r on r.tenant_id = e.tenant_id and r.id = e.ref_id
                 join pos.receivable_payments p on p.tenant_id = r.tenant_id and p.id = r.reverses_id
                where e.tenant_id = ${tenantId} and e.direction = 'out' and e.kind = 'receivable_reversal'
                  and p.actor_kind = 'cashier') c
            group by c.actor_id) x
         left join lateral (
           select sum(dep.amount) as handed_over from pos.store_cash_deposits dep
            where dep.tenant_id = ${tenantId} and dep.collector_id = x.actor_id) h on true) as held`);
  return Math.max(Number(row.balance) - Number(row.held), 0);
}

/**
 * 422 `STORE_CASH_INSUFFICIENT` (with `available`) unless the store holds `amount`. Under `lockStoreCash` it is the
 * rule; without the lock it is an early refusal only (the kasbon correction runs it before asking for the PIN).
 */
export async function assertStoreCashCovers(
  db: Db | Tx,
  tenantId: string,
  amount: number,
): Promise<void> {
  const available = await storeCashAvailable(db, tenantId);
  if (amount > available)
    throw codedError(
      'STORE_CASH_INSUFFICIENT',
      '_',
      `Kas toko (${formatRupiah(available)}) kurang dari ${formatRupiah(amount)} yang harus dikeluarkan.`,
      { available },
    );
}

/**
 * Adds one movement to the store's cash, inside the caller's transaction. With `mustCover` (an `out` only) it takes
 * the store's cash lock and is refused (422 `STORE_CASH_INSUFFICIENT`, `available`) unless the store holds it.
 */
export async function recordStoreCash(
  tx: Tx,
  s: PosSession,
  entry: StoreCashEntry,
  opts: { mustCover?: boolean } = {},
): Promise<void> {
  if (opts.mustCover && entry.direction === 'out') {
    await lockStoreCash(tx, s.tenantId);
    await assertStoreCashCovers(tx, s.tenantId, entry.amount);
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
