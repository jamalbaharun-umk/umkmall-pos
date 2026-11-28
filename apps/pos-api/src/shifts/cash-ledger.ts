import { ForbiddenException } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/record';
import { codedError } from '../common/validation';
import type { Db } from '../db/db.module';
import {
  type CASH_DIRECTIONS,
  type CASH_ENTRY_KINDS,
  shiftCashEntries,
  shifts,
  staff,
} from '../db/schema';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import { shiftNumbers } from './shift-read';

/**
 * The shift's cash ledger (UMK-1963): every movement of drawer cash that is not a sale.
 * Expected cash = opening cash + cash sales + cash in − cash out.
 *
 * This file is the only place that inserts ledger rows (guard in src/guards.spec.ts). Each row is
 * written under the row lock of an OPEN shift, the lock a sale and the close also take, so a movement
 * lands before the count or is refused, and a closed shift never changes. The shift is the actor's own
 * (`recordShiftCash`, `recordShiftCashIfOpen`) or, for a correction of one of its entries, the shift
 * that entry is in (`recordShiftCashInShift`, UMK-1984).
 *
 * Cash leaves a drawer only for a session kind on `DRAWER_CASH_OUT_ACTOR_KINDS` (owner ruling: an agent
 * never takes cash out of a drawer). Every writer below checks it before its first query. Cash recorded
 * by hand (a manual entry in either direction, a collector's deposit) is for the same kinds only: its
 * services call `assertPersonAtTill` first (design fitur 20 and 21).
 *
 * Refusals carry a stable `code` next to their message: `SHIFT_REQUIRED`, `SHIFT_NOT_YOURS`,
 * `AGENT_FORBIDDEN`.
 *
 * Solo-owner mode (UMK-2120): the owner of a store without active staff is never refused for want of a shift.
 * Every path that takes the actor's drawer for a cash action goes through `lockDrawerShift`, which opens the
 * owner's shift inside the action's transaction (opening cash: `autoOpeningCash`) and audits it as automatic.
 */

/**
 * The session kinds that may take cash OUT of a drawer: people at the till. An allow-list, so a kind
 * added to tenancy/session.ts later (an agent session, UMK-1983) is refused until it is added here on
 * purpose. Never add an agent kind.
 */
export const DRAWER_CASH_OUT_ACTOR_KINDS: readonly string[] = [
  'owner',
  'cashier',
];

/** 403 when `kind` may not move cash in `direction`; cash in is open to every session kind. */
export function assertMayMoveDrawerCash(
  kind: string,
  direction: (typeof CASH_DIRECTIONS)[number],
): void {
  if (direction === 'out' && !DRAWER_CASH_OUT_ACTOR_KINDS.includes(kind))
    throw notAtTill(
      'Uang keluar dari laci hanya bisa dicatat dari POS oleh kasir atau pemilik',
    );
}

/** The usual 403 body plus the code a screen (or an agent) can act on. */
const notAtTill = (message: string) =>
  new ForbiddenException({
    message,
    error: 'Forbidden',
    statusCode: 403,
    code: 'AGENT_FORBIDDEN',
  });

/**
 * 403 unless `kind` is a person at the till. For cash recorded by hand in EITHER direction (a manual
 * cash entry, a collector's deposit): an agent records none of them. Called before any query.
 */
export function assertPersonAtTill(kind: string): void {
  if (!DRAWER_CASH_OUT_ACTOR_KINDS.includes(kind))
    throw notAtTill(
      'Uang laci hanya bisa dicatat dari POS oleh kasir atau pemilik',
    );
}

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
  /** Expenses and supplier payments paid from the drawer (part of cashOut, UMK-1984). */
  expenses: number;
  /** Voided drawer expenses put back while the shift was open (part of cashIn). */
  expenseReversals: number;
  /** Cash put into the drawer by hand (part of cashIn, UMK-1924 U3). */
  manualIn: number;
  /** Cash taken out of the drawer by hand (part of cashOut). */
  manualOut: number;
  /** Collectors' outside-shift cash received into the drawer, "Setoran penagih" (part of cashIn). */
  collectorDeposits: number;
  /** Suppliers paid for a purchase from the drawer (part of cashOut, UMK-1970). */
  purchasePayments: number;
  /** Those payments voided while the shift was open, their cash back in the drawer (part of cashIn). */
  purchasePaymentReversals: number;
  /** Cash of corrected kasbon instalments taken back out of the drawer (part of cashOut, UMK-1971). */
  receivableReversals: number;
  /** Money suppliers handed back after a return, into the drawer (part of cashIn, UMK-1970). */
  purchaseRefunds: number;
  /** Those refunds voided while the shift was open, their cash out of the drawer again (part of cashOut). */
  purchaseRefundReversals: number;
};

export const NO_CASH: CashTotals = {
  cashIn: 0,
  cashOut: 0,
  receivablePayments: 0,
  voidRefunds: 0,
  expenses: 0,
  expenseReversals: 0,
  manualIn: 0,
  manualOut: 0,
  collectorDeposits: 0,
  purchasePayments: 0,
  purchasePaymentReversals: 0,
  receivableReversals: 0,
  purchaseRefunds: 0,
  purchaseRefundReversals: 0,
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
 * Solo-owner mode (UMK-2120): true when `s` is the store's owner (an `owner` session, or UMKMall's agent acting
 * as the owner) and the store has no staff member that is active and not deleted. Read in the caller's
 * transaction on every call, never cached: the first staff member ends the mode at once. A cashier session is
 * never solo.
 */
export async function isSoloOwner(
  tx: Db | Tx,
  s: PosSession,
): Promise<boolean> {
  if (s.kind !== 'owner' && s.kind !== 'agent') return false;
  const [member] = await tx
    .select({ id: staff.id })
    .from(staff)
    .where(
      and(
        eq(staff.tenantId, s.tenantId),
        eq(staff.active, true),
        isNull(staff.deletedAt),
      ),
    )
    .limit(1);
  return !member;
}

/**
 * The cash an automatically opened shift starts with: the counted cash of the store's most recently closed
 * shift (the drawer's last count), 0 when the store never closed one. Cash the owner took at that close
 * ("Diambil pemilik", a manual cash-out) can only be recorded while the shift is open, so it left the drawer
 * before the count and is already out of the counted cash: it is not subtracted again. Never negative: the
 * counted cash is checked `>= 0` by the database.
 */
export async function autoOpeningCash(tx: Tx, tenantId: string) {
  const [last] = await tx
    .select({ countedCash: shifts.countedCash })
    .from(shifts)
    .where(and(eq(shifts.tenantId, tenantId), isNotNull(shifts.closedAt)))
    .orderBy(desc(shifts.closedAt), desc(shifts.id))
    .limit(1);
  return Math.max(0, last?.countedCash ?? 0);
}

/**
 * Opens the actor's shift inside the caller's transaction and returns it row-locked, as `lockOpenShift` would.
 * Written with `on conflict do nothing` on `shifts_one_open_uq` (one open shift per actor): a concurrent first
 * action waits on the other's uncommitted row and then finds and locks that shift, so two first actions open
 * one shift. The audit row (`shift_open`, `automatic: true`) is written only by the transaction whose insert
 * won, and commits or rolls back with the action.
 */
async function autoOpenShift(tx: Tx, s: PosSession, trigger: string) {
  const openingCash = await autoOpeningCash(tx, s.tenantId);
  const [created] = await tx
    .insert(shifts)
    .values({
      tenantId: s.tenantId,
      actorId: s.actorId,
      actorKind: s.kind,
      openingCash,
      openedAutomatically: true,
    })
    .onConflictDoNothing({
      target: [shifts.tenantId, shifts.actorId],
      where: isNull(shifts.closedAt),
    })
    .returning({ id: shifts.id });
  if (created) {
    const number = (await shiftNumbers(tx, s.tenantId, [created.id])).get(
      created.id,
    );
    await recordAudit(tx, s, 'shift_open', {
      target: { type: 'shift', id: created.id, label: `Shift #${number}` },
      details: {
        shiftId: created.id,
        openingCash,
        automatic: true,
        trigger,
      },
    });
  }
  return lockOpenShift(tx, s);
}

/**
 * The actor's drawer for a cash action, row-locked: the open shift, or, in solo-owner mode (`isSoloOwner`), a
 * shift opened now for this action (UMK-2120, owner decision 2026-11-28). Null when the actor has no open shift
 * and may not have one opened: the caller answers its usual `SHIFT_REQUIRED`. `trigger` names the action for
 * the audit row (a ledger kind, or `sale`).
 *
 * Called where the caller already locks the open shift, so the lock order stays: the caller's own row (a sale
 * being voided, a receivable) → this shift → voucher → stock batches.
 */
export async function lockDrawerShift(tx: Tx, s: PosSession, trigger: string) {
  const open = await lockOpenShift(tx, s);
  if (open) return open;
  if (!(await isSoloOwner(tx, s))) return null;
  return autoOpenShift(tx, s, trigger);
}

/**
 * The drawer a hand-recorded movement goes into, row-locked: the actor's own open shift, or the open
 * shift `shiftId` of this store when an OWNER names one (design fitur 20: "bila dua shift buka, pengguna
 * memilih shift"). A cashier's cash only ever goes into their own shift. Null when the actor has no
 * open shift and names none (and is not a solo owner, whose shift `lockDrawerShift` opens); 422
 * `SHIFT_NOT_YOURS` for a shift the actor may not use, a closed one, or one of another store (the lookup
 * filters the session's tenant).
 */
export async function lockShiftForCash(
  tx: Tx,
  s: PosSession,
  shiftId?: string,
  trigger = 'manual',
) {
  if (!shiftId) return lockDrawerShift(tx, s, trigger);
  if (s.kind !== 'owner') {
    const own = await lockOpenShift(tx, s);
    if (own?.id !== shiftId)
      throw codedError(
        'SHIFT_NOT_YOURS',
        'shiftId',
        'Uang hanya bisa dicatat di shift Anda sendiri',
      );
    return own;
  }
  const [shift] = await tx
    .select({ id: shifts.id, openingCash: shifts.openingCash })
    .from(shifts)
    .where(
      and(
        eq(shifts.tenantId, s.tenantId),
        eq(shifts.id, shiftId),
        isNull(shifts.closedAt),
      ),
    )
    .for('update');
  if (!shift)
    throw codedError(
      'SHIFT_NOT_YOURS',
      'shiftId',
      'Shift ini sudah ditutup atau tidak ditemukan',
    );
  return shift;
}

async function insertEntry(
  tx: Tx,
  s: PosSession,
  shiftId: string,
  entry: CashEntry,
) {
  await tx.insert(shiftCashEntries).values({
    tenantId: s.tenantId,
    shiftId,
    direction: entry.direction,
    kind: entry.kind,
    amount: entry.amount,
    refId: entry.refId ?? null,
    note: entry.note ?? null,
    actorId: s.actorId,
    actorKind: s.kind,
  });
}

/**
 * Adds one cash movement to the actor's open shift, inside the caller's transaction, and returns the
 * shift's id; returns null and writes nothing when the actor has no open shift. In solo-owner mode the shift
 * is opened for it (`lockDrawerShift`), so the owner of a store without staff is never refused.
 *
 * Lock order: a caller that also locks its own row (a sale, a receivable, a purchase order) locks that
 * row first and calls this after; nothing locks a shift and then such a row. Stock batches and voucher
 * quota are taken after the shift, as a sale does.
 */
export async function recordShiftCashIfOpen(
  tx: Tx,
  s: PosSession,
  entry: CashEntry,
): Promise<string | null> {
  assertMayMoveDrawerCash(s.kind, entry.direction);
  const shift = await lockDrawerShift(tx, s, entry.kind);
  if (!shift) return null;
  await insertEntry(tx, s, shift.id, entry);
  return shift.id;
}

/** `recordShiftCashIfOpen` for a movement that needs a drawer: 422 with `noShiftMessage` without a shift. */
export async function recordShiftCash(
  tx: Tx,
  s: PosSession,
  entry: CashEntry,
  noShiftMessage: string,
): Promise<string> {
  const shiftId = await recordShiftCashIfOpen(tx, s, entry);
  if (!shiftId) throw codedError('SHIFT_REQUIRED', '_', noShiftMessage);
  return shiftId;
}

/**
 * `recordShiftCash` for cash recorded by hand: into the drawer `lockShiftForCash` picks (the actor's
 * own open shift, or the open shift an owner names). 422 `SHIFT_REQUIRED` with `noShiftMessage` when
 * there is none.
 */
export async function recordShiftCashAt(
  tx: Tx,
  s: PosSession,
  shiftId: string | undefined,
  entry: CashEntry,
  noShiftMessage: string,
): Promise<string> {
  assertMayMoveDrawerCash(s.kind, entry.direction);
  const shift = await lockShiftForCash(tx, s, shiftId, entry.kind);
  if (!shift) throw codedError('SHIFT_REQUIRED', '_', noShiftMessage);
  await insertEntry(tx, s, shift.id, entry);
  return shift.id;
}

/**
 * Adds one cash movement to the shift `shiftId` when it is still open, whoever the actor is, and
 * returns true; returns false and writes nothing when that shift is closed (a closed shift never
 * changes) or is not this store's. For a correction of an earlier entry of that shift (a voided
 * drawer expense, UMK-1984). The caller locks its own row first, as with `recordShiftCashIfOpen`.
 */
export async function recordShiftCashInShift(
  tx: Tx,
  s: PosSession,
  shiftId: string,
  entry: CashEntry,
): Promise<boolean> {
  assertMayMoveDrawerCash(s.kind, entry.direction);
  const [shift] = await tx
    .select({ id: shifts.id })
    .from(shifts)
    .where(
      and(
        eq(shifts.tenantId, s.tenantId),
        eq(shifts.id, shiftId),
        isNull(shifts.closedAt),
      ),
    )
    .for('update');
  if (!shift) return false;
  await insertEntry(tx, s, shift.id, entry);
  return true;
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
      expenses: sum(sql`${e.direction} = 'out' and ${e.kind} = 'expense'`),
      expenseReversals: sum(
        sql`${e.direction} = 'in' and ${e.kind} = 'expense_reversal'`,
      ),
      manualIn: sum(sql`${e.direction} = 'in' and ${e.kind} = 'manual_in'`),
      manualOut: sum(sql`${e.direction} = 'out' and ${e.kind} = 'manual_out'`),
      collectorDeposits: sum(
        sql`${e.direction} = 'in' and ${e.kind} = 'collector_deposit'`,
      ),
      purchasePayments: sum(
        sql`${e.direction} = 'out' and ${e.kind} = 'purchase_payment'`,
      ),
      purchasePaymentReversals: sum(
        sql`${e.direction} = 'in' and ${e.kind} = 'purchase_payment_reversal'`,
      ),
      receivableReversals: sum(
        sql`${e.direction} = 'out' and ${e.kind} = 'receivable_reversal'`,
      ),
      purchaseRefunds: sum(
        sql`${e.direction} = 'in' and ${e.kind} = 'purchase_refund'`,
      ),
      purchaseRefundReversals: sum(
        sql`${e.direction} = 'out' and ${e.kind} = 'purchase_refund_reversal'`,
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
        expenses: Number(r.expenses),
        expenseReversals: Number(r.expenseReversals),
        manualIn: Number(r.manualIn),
        manualOut: Number(r.manualOut),
        collectorDeposits: Number(r.collectorDeposits),
        purchasePayments: Number(r.purchasePayments),
        purchasePaymentReversals: Number(r.purchasePaymentReversals),
        receivableReversals: Number(r.receivableReversals),
        purchaseRefunds: Number(r.purchaseRefunds),
        purchaseRefundReversals: Number(r.purchaseRefundReversals),
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
