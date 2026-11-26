import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  expenses,
  FINAL_SALE_STATUSES,
  MANUAL_CASH_REASON_LABELS,
  manualCashEntries,
  paymentMethods,
  receivablePayments,
  receivables,
  sales,
  saleVoids,
  shiftCashEntries,
  shifts,
  staff,
  storeCashDeposits,
} from '../db/schema';
import { isUniqueViolation } from '../staff/http';
import { hasPermission } from '../staff/require-permission';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import {
  cashTotals,
  expectedCash,
  lockOpenShift,
  NO_CASH,
} from './cash-ledger';
import { shiftActorName, shiftNumbers } from './shift-read';

const shiftColumns = {
  id: shifts.id,
  actorId: shifts.actorId,
  actorKind: shifts.actorKind,
  openingCash: shifts.openingCash,
  openedAt: shifts.openedAt,
  closedAt: shifts.closedAt,
  countedCash: shifts.countedCash,
  expectedCash: shifts.expectedCash,
  cashSales: shifts.cashSales,
  salesCount: shifts.salesCount,
};

/** For a select: the stored columns plus whose shift it is. `numbered` adds the shift's number. */
const shiftReadColumns = {
  ...shiftColumns,
  actorName: shiftActorName,
};

type ShiftRow = {
  openingCash: number;
  closedAt: Date | null;
  countedCash: number | null;
  expectedCash: number | null;
};

/** counted − expected (negative = cash short); null while the shift is open. */
const withDifference = <T extends ShiftRow>(s: T) => ({
  ...s,
  difference:
    s.countedCash === null || s.expectedCash === null
      ? null
      : s.countedCash - s.expectedCash,
});

/**
 * Cash shifts (Lakasir CashDrawer), one open per actor. Fixes flaw 4: the shift is required by every
 * sale and closing reconciles counted cash against the shift's own sales and its cash ledger
 * (cash-ledger.ts): expected cash = opening cash + cash sales + cash in − cash out.
 */
@Injectable()
export class ShiftsService {
  constructor(@InjectDb() private readonly db: Db) {}

  private async totals(db: Db | Tx, shiftId: string) {
    const [t] = await db
      .select({
        // Cash in the drawer: cash sales' paid − change and a kasbon's down payment (U7); debit/wallet none.
        // paid − change of a cash sale is total + rounding (UMK-1993), so the rounding is counted once.
        cashSales: sql<string>`coalesce(sum(case when ${paymentMethods.isCash} then ${sales.paid} - ${sales.change} when ${paymentMethods.isCredit} then ${sales.paid} else 0 end), 0)`,
        // Sales rung up in the shift. A voided one still counts here: its cash came in, and its return is
        // a ledger cash-out in the shift where the void was done (UMK-1962).
        salesCount: count(),
      })
      .from(sales)
      .innerJoin(paymentMethods, eq(paymentMethods.id, sales.paymentMethodId))
      // A sale awaiting its payment, or cancelled for want of one, was never a receipt (UMK-1991).
      .where(
        and(
          eq(sales.shiftId, shiftId),
          inArray(sales.status, [...FINAL_SALE_STATUSES]),
        ),
      );
    return { cashSales: Number(t.cashSales), salesCount: t.salesCount };
  }

  private async cashOf(db: Db | Tx, tenantId: string, shiftId: string) {
    return (await cashTotals(db, tenantId, [shiftId])).get(shiftId) ?? NO_CASH;
  }

  /**
   * What the drawer of this store's shift should hold right now. Inside a transaction that holds the
   * shift's row lock the figure cannot move (UMK-1984: the "more than the drawer holds" warning).
   */
  async expectedCashOf(db: Db | Tx, tenantId: string, shiftId: string) {
    const [shift] = await db
      .select({ openingCash: shifts.openingCash })
      .from(shifts)
      .where(and(eq(shifts.tenantId, tenantId), eq(shifts.id, shiftId)));
    if (!shift) throw new NotFoundException();
    const t = await this.totals(db, shiftId);
    const cash = await this.cashOf(db, tenantId, shiftId);
    return expectedCash(shift.openingCash, t.cashSales, cash);
  }

  /** Adds `number` (the store's n-th shift) to a page of shifts, with one query for the page. */
  private async numbered<T extends { id: string }>(
    db: Db | Tx,
    tenantId: string,
    rows: T[],
  ): Promise<(T & { number: number })[]> {
    const numbers = await shiftNumbers(
      db,
      tenantId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, number: numbers.get(r.id) ?? 0 }));
  }

  /** The actor's open shift with its running totals, or null. */
  async current(s: PosSession) {
    const [found] = await this.db
      .select(shiftReadColumns)
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, s.tenantId),
          eq(shifts.actorId, s.actorId),
          isNull(shifts.closedAt),
        ),
      );
    if (!found) return null;
    const [shift] = await this.numbered(this.db, s.tenantId, [found]);
    const [t, cash] = await Promise.all([
      this.totals(this.db, shift.id),
      this.cashOf(this.db, s.tenantId, shift.id),
    ]);
    return {
      ...withDifference(shift),
      ...t,
      ...cash,
      expectedCash: expectedCash(shift.openingCash, t.cashSales, cash),
    };
  }

  /** One shift of this store as a screen reads it (after a write). */
  private async read(db: Db | Tx, tenantId: string, id: string) {
    const [row] = await this.numbered(
      db,
      tenantId,
      await db
        .select(shiftReadColumns)
        .from(shifts)
        .where(and(eq(shifts.tenantId, tenantId), eq(shifts.id, id))),
    );
    return row;
  }

  async open(s: PosSession, openingCash: number) {
    try {
      const [{ id }] = await this.db
        .insert(shifts)
        .values({
          tenantId: s.tenantId,
          actorId: s.actorId,
          actorKind: s.kind,
          openingCash,
        })
        .returning({ id: shifts.id });
      const row = await this.read(this.db, s.tenantId, id);
      return { ...withDifference(row), ...NO_CASH };
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ConflictException('Shift Anda masih terbuka');
      throw e;
    }
  }

  /** Locks the shift row (the lock every sale and cash movement takes), so nothing lands after the count. */
  async close(s: PosSession, countedCash: number) {
    return this.db.transaction(async (tx) => {
      const shift = await lockOpenShift(tx, s);
      if (!shift) throw new ConflictException('Tidak ada shift yang terbuka');
      // Owner decision (UMK-1991): a shift does not close while a sale of it awaits payment. Under the
      // shift's row lock, which a new sale also takes, so none appears after this check.
      // UMK-2038: a waiting sale has no receipt number yet; it is named by its hold number.
      const waiting = await tx
        .select({ number: sales.holdNumber })
        .from(sales)
        .where(
          and(
            eq(sales.tenantId, s.tenantId),
            eq(sales.shiftId, shift.id),
            eq(sales.status, 'awaiting_payment'),
          ),
        )
        .orderBy(asc(sales.holdNumber));
      if (waiting.length)
        throw new ConflictException({
          message: `Masih ada penjualan yang menunggu pembayaran: ${waiting
            .map((w) => `#${w.number}`)
            .join(', ')}`,
          saleNumbers: waiting.map((w) => w.number),
        });
      const t = await this.totals(tx, shift.id);
      const cash = await this.cashOf(tx, s.tenantId, shift.id);
      await tx
        .update(shifts)
        .set({
          closedAt: new Date(),
          countedCash,
          expectedCash: expectedCash(shift.openingCash, t.cashSales, cash),
          cashSales: t.cashSales,
          salesCount: t.salesCount,
        })
        .where(eq(shifts.id, shift.id));
      const row = await this.read(tx, s.tenantId, shift.id);
      return { ...withDifference(row), ...cash };
    });
  }

  /** Cashiers see their own shifts; `reports.view` sees the store's. */
  private scope(s: PosSession): SQL {
    return hasPermission(s, 'reports.view')
      ? eq(shifts.tenantId, s.tenantId)
      : and(eq(shifts.tenantId, s.tenantId), eq(shifts.actorId, s.actorId))!;
  }

  async list(s: PosSession, page: number, perPage: number) {
    const where = this.scope(s);
    const [found, [{ total }]] = await Promise.all([
      this.db
        .select(shiftReadColumns)
        .from(shifts)
        .where(where)
        .orderBy(desc(shifts.openedAt))
        .limit(perPage)
        .offset((page - 1) * perPage),
      this.db.select({ total: count() }).from(shifts).where(where),
    ]);
    const rows = await this.numbered(this.db, s.tenantId, found);
    const cash = await cashTotals(
      this.db,
      s.tenantId,
      rows.map((r) => r.id),
    );
    return {
      data: rows.map((r) => ({
        ...withDifference(r),
        ...(cash.get(r.id) ?? NO_CASH),
      })),
      total,
    };
  }

  async get(s: PosSession, id: string) {
    const [row] = await this.numbered(
      this.db,
      s.tenantId,
      await this.db
        .select(shiftReadColumns)
        .from(shifts)
        .where(and(this.scope(s), eq(shifts.id, id))),
    );
    if (!row) throw new NotFoundException();
    const e = shiftCashEntries;
    // Who recorded the entry, and for a collector's deposit who handed the cash over: names only.
    const recorder = alias(staff, 'recorder');
    const collector = alias(staff, 'collector');
    // The `expense` entry an `expense_reversal` puts back (same expense, same shift).
    const undone = alias(shiftCashEntries, 'undone');
    const [cash, cashEntries] = await Promise.all([
      this.cashOf(this.db, s.tenantId, id),
      this.db
        .select({
          id: e.id,
          direction: e.direction,
          kind: e.kind,
          amount: e.amount,
          refId: e.refId,
          note: e.note,
          // Manual cash in/out only (UMK-1924 U3): why the cash moved.
          reason: manualCashEntries.reason,
          actorId: e.actorId,
          actorKind: e.actorKind,
          actorName: sql<string>`case when ${e.actorKind} = 'owner' then 'Pemilik'
            else coalesce(${recorder.name}, 'Staf') end`,
          collectorId: storeCashDeposits.collectorId,
          collectorName: collector.name,
          // Reversal markers (design fitur 20: "Dibatalkan", "Pembalik"), derived from rows the server
          // already writes: a voided expense, a void of a sale, a kasbon cancelled with its sale.
          expenseVoidedAt: expenses.voidedAt,
          undoneEntryId: undone.id,
          voidedSaleId: saleVoids.saleId,
          receivableCancelledAt: receivables.cancelledAt,
          createdAt: e.createdAt,
        })
        .from(e)
        .leftJoin(
          recorder,
          and(eq(recorder.tenantId, e.tenantId), eq(recorder.id, e.actorId)),
        )
        .leftJoin(
          storeCashDeposits,
          and(
            eq(storeCashDeposits.tenantId, e.tenantId),
            eq(storeCashDeposits.id, e.refId),
            eq(e.kind, 'collector_deposit'),
          ),
        )
        .leftJoin(
          collector,
          and(
            eq(collector.tenantId, e.tenantId),
            eq(collector.id, storeCashDeposits.collectorId),
          ),
        )
        .leftJoin(
          expenses,
          and(
            eq(expenses.tenantId, e.tenantId),
            eq(expenses.id, e.refId),
            inArray(e.kind, ['expense', 'expense_reversal']),
          ),
        )
        .leftJoin(
          undone,
          and(
            eq(undone.tenantId, e.tenantId),
            eq(undone.refId, e.refId),
            eq(undone.kind, 'expense'),
            eq(e.kind, 'expense_reversal'),
          ),
        )
        .leftJoin(
          saleVoids,
          and(
            eq(saleVoids.tenantId, e.tenantId),
            eq(saleVoids.id, e.refId),
            eq(e.kind, 'void_refund'),
          ),
        )
        .leftJoin(
          receivablePayments,
          and(
            eq(receivablePayments.tenantId, e.tenantId),
            eq(receivablePayments.id, e.refId),
            eq(e.kind, 'receivable_payment'),
          ),
        )
        .leftJoin(
          receivables,
          and(
            eq(receivables.tenantId, e.tenantId),
            eq(receivables.id, receivablePayments.receivableId),
          ),
        )
        .leftJoin(
          manualCashEntries,
          and(
            eq(manualCashEntries.tenantId, e.tenantId),
            eq(manualCashEntries.id, e.refId),
            inArray(e.kind, ['manual_in', 'manual_out']),
          ),
        )
        .where(and(eq(e.tenantId, s.tenantId), eq(e.shiftId, id)))
        .orderBy(asc(e.createdAt), asc(e.id)),
    ]);
    return {
      ...withDifference(row),
      ...cash,
      cashEntries: cashEntries.map(
        ({
          expenseVoidedAt,
          undoneEntryId,
          voidedSaleId,
          receivableCancelledAt,
          ...c
        }) => ({
          ...c,
          reasonLabel: c.reason ? MANUAL_CASH_REASON_LABELS[c.reason] : null,
          // This entry's source was undone later.
          reversed:
            (c.kind === 'expense' && expenseVoidedAt !== null) ||
            (c.kind === 'receivable_payment' && receivableCancelledAt !== null),
          // This entry undoes something: an expense's cash-out (`entryId`: that ledger row), or a
          // sale's cash (a sale's cash is not a ledger row, so no `entryId`).
          reversalOf:
            c.kind === 'expense_reversal' && c.refId
              ? {
                  type: 'expense' as const,
                  id: c.refId,
                  entryId: undoneEntryId,
                }
              : c.kind === 'void_refund' && voidedSaleId
                ? { type: 'sale' as const, id: voidedSaleId, entryId: null }
                : null,
        }),
      ),
    };
  }
}
