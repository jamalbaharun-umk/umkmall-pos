import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { fieldError } from '../common/validation';
import type { Db } from '../db/db.module';
import {
  type CASH_DIRECTIONS,
  type CASH_ENTRY_KINDS,
  shiftCashEntries,
  shifts,
} from '../db/schema';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';

/**
 * The shift's cash ledger (UMK-1963): every movement of drawer cash that is not a sale.
 * Expected cash = opening cash + cash sales + cash in − cash out.
 *
 * This file is the only place that inserts ledger rows (guard in src/guards.spec.ts). Each row is
 * written under the row lock of the actor's OPEN shift, the lock a sale and the close also take, so a
 * movement lands before the count or is refused, and a closed shift never changes.
 */

export type CashEntry = {
  direction: (typeof CASH_DIRECTIONS)[number];
  kind: (typeof CASH_ENTRY_KINDS)[number];
  /** Integer rupiah, positive. */
  amount: number;
  /** The source row of this kind (a receivable payment's id); one entry per source. */
  refId?: string;
  note?: string;
};

export type CashTotals = {
  cashIn: number;
  cashOut: number;
  /** Cash kasbon payments taken in the shift (part of cashIn). */
  receivablePayments: number;
  /** Cash given back for voided sales in the shift (part of cashOut). */
  voidRefunds: number;
};

export const NO_CASH: CashTotals = {
  cashIn: 0,
  cashOut: 0,
  receivablePayments: 0,
  voidRefunds: 0,
};

/** The actor's open shift, row-locked until the transaction ends; null when none is open. */
export async function lockOpenShift(tx: Tx, s: PosSession) {
  const [shift] = await tx
    .select({ id: shifts.id, openingCash: shifts.openingCash })
    .from(shifts)
    .where(
      and(
        eq(shifts.tenantId, s.tenantId),
        eq(shifts.actorId, s.actorId),
        isNull(shifts.closedAt),
      ),
    )
    .for('update');
  return shift ?? null;
}

/**
 * Adds one cash movement to the actor's open shift, inside the caller's transaction. Answers 422 with
 * `noShiftMessage` when the actor has no open shift. Returns the shift's id.
 *
 * Lock order: a caller that also locks its own row (a sale, a receivable, a purchase order) locks that
 * row first and calls this after; nothing locks a shift and then such a row. Stock batches and voucher
 * quota are taken after the shift, as a sale does.
 */
export async function recordShiftCash(
  tx: Tx,
  s: PosSession,
  entry: CashEntry,
  noShiftMessage: string,
): Promise<string> {
  const shift = await lockOpenShift(tx, s);
  if (!shift) throw fieldError('_', noShiftMessage);
  await tx.insert(shiftCashEntries).values({
    tenantId: s.tenantId,
    shiftId: shift.id,
    direction: entry.direction,
    kind: entry.kind,
    amount: entry.amount,
    refId: entry.refId ?? null,
    note: entry.note ?? null,
    actorId: s.actorId,
    actorKind: s.kind,
  });
  return shift.id;
}

/** Ledger totals per shift, one grouped query; a shift without entries is absent (use NO_CASH). */
export async function cashTotals(
  db: Db | Tx,
  tenantId: string,
  shiftIds: string[],
): Promise<Map<string, CashTotals>> {
  if (shiftIds.length === 0) return new Map();
  const e = shiftCashEntries;
  const sum = (cond: ReturnType<typeof sql>) =>
    sql<string>`coalesce(sum(${e.amount}) filter (where ${cond}), 0)`;
  const rows = await db
    .select({
      shiftId: e.shiftId,
      cashIn: sum(sql`${e.direction} = 'in'`),
      cashOut: sum(sql`${e.direction} = 'out'`),
      receivablePayments: sum(
        sql`${e.direction} = 'in' and ${e.kind} = 'receivable_payment'`,
      ),
      voidRefunds: sum(
        sql`${e.direction} = 'out' and ${e.kind} = 'void_refund'`,
      ),
    })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), inArray(e.shiftId, shiftIds)))
    .groupBy(e.shiftId);
  return new Map(
    rows.map((r) => [
      r.shiftId,
      {
        cashIn: Number(r.cashIn),
        cashOut: Number(r.cashOut),
        receivablePayments: Number(r.receivablePayments),
        voidRefunds: Number(r.voidRefunds),
      },
    ]),
  );
}

/** opening cash + cash sales + cash in − cash out. */
export const expectedCash = (
  openingCash: number,
  cashSales: number,
  cash: CashTotals,
) => openingCash + cashSales + cash.cashIn - cash.cashOut;
