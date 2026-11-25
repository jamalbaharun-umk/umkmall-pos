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
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  FINAL_SALE_STATUSES,
  paymentMethods,
  sales,
  shiftCashEntries,
  shifts,
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

  /** The actor's open shift with its running totals, or null. */
  async current(s: PosSession) {
    const [shift] = await this.db
      .select(shiftColumns)
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, s.tenantId),
          eq(shifts.actorId, s.actorId),
          isNull(shifts.closedAt),
        ),
      );
    if (!shift) return null;
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

  async open(s: PosSession, openingCash: number) {
    try {
      const [row] = await this.db
        .insert(shifts)
        .values({
          tenantId: s.tenantId,
          actorId: s.actorId,
          actorKind: s.kind,
          openingCash,
        })
        .returning(shiftColumns);
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
      const waiting = await tx
        .select({ number: sales.number })
        .from(sales)
        .where(
          and(
            eq(sales.tenantId, s.tenantId),
            eq(sales.shiftId, shift.id),
            eq(sales.status, 'awaiting_payment'),
          ),
        )
        .orderBy(asc(sales.number));
      if (waiting.length)
        throw new ConflictException({
          message: `Masih ada penjualan yang menunggu pembayaran: ${waiting
            .map((w) => `#${w.number}`)
            .join(', ')}`,
          saleNumbers: waiting.map((w) => w.number),
        });
      const t = await this.totals(tx, shift.id);
      const cash = await this.cashOf(tx, s.tenantId, shift.id);
      const [row] = await tx
        .update(shifts)
        .set({
          closedAt: new Date(),
          countedCash,
          expectedCash: expectedCash(shift.openingCash, t.cashSales, cash),
          cashSales: t.cashSales,
          salesCount: t.salesCount,
        })
        .where(eq(shifts.id, shift.id))
        .returning(shiftColumns);
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
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select(shiftColumns)
        .from(shifts)
        .where(where)
        .orderBy(desc(shifts.openedAt))
        .limit(perPage)
        .offset((page - 1) * perPage),
      this.db.select({ total: count() }).from(shifts).where(where),
    ]);
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
    const [row] = await this.db
      .select(shiftColumns)
      .from(shifts)
      .where(and(this.scope(s), eq(shifts.id, id)));
    if (!row) throw new NotFoundException();
    const e = shiftCashEntries;
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
          createdAt: e.createdAt,
        })
        .from(e)
        .where(and(eq(e.tenantId, s.tenantId), eq(e.shiftId, id)))
        .orderBy(asc(e.createdAt), asc(e.id)),
    ]);
    return { ...withDifference(row), ...cash, cashEntries };
  }
}
