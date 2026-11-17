import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { paymentMethods, sales, shifts } from '../db/schema';
import { isUniqueViolation } from '../staff/http';
import { hasPermission } from '../staff/require-permission';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';

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
 * sale and closing reconciles counted cash against the shift's own sales.
 */
@Injectable()
export class ShiftsService {
  constructor(@InjectDb() private readonly db: Db) {}

  private async totals(db: Db | Tx, shiftId: string) {
    const [t] = await db
      .select({
        // Cash in the drawer: cash sales' paid − change and a kasbon's down payment (U7); debit/wallet none.
        cashSales: sql<string>`coalesce(sum(case when ${paymentMethods.isCash} then ${sales.paid} - ${sales.change} when ${paymentMethods.isCredit} then ${sales.paid} else 0 end), 0)`,
        salesCount: count(),
      })
      .from(sales)
      .innerJoin(paymentMethods, eq(paymentMethods.id, sales.paymentMethodId))
      .where(eq(sales.shiftId, shiftId));
    return { cashSales: Number(t.cashSales), salesCount: t.salesCount };
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
    const t = await this.totals(this.db, shift.id);
    return {
      ...withDifference(shift),
      ...t,
      expectedCash: shift.openingCash + t.cashSales,
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
      return withDifference(row);
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ConflictException('Shift Anda masih terbuka');
      throw e;
    }
  }

  /** Locks the shift row (the lock every sale takes), so no sale lands after the count. */
  async close(s: PosSession, countedCash: number) {
    return this.db.transaction(async (tx) => {
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
      if (!shift)
        throw new UnprocessableEntityException('Tidak ada shift yang terbuka');
      const t = await this.totals(tx, shift.id);
      const [row] = await tx
        .update(shifts)
        .set({
          closedAt: new Date(),
          countedCash,
          expectedCash: shift.openingCash + t.cashSales,
          cashSales: t.cashSales,
          salesCount: t.salesCount,
        })
        .where(eq(shifts.id, shift.id))
        .returning(shiftColumns);
      return withDifference(row);
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
    return { data: rows.map(withDifference), total };
  }

  async get(s: PosSession, id: string) {
    const [row] = await this.db
      .select(shiftColumns)
      .from(shifts)
      .where(and(this.scope(s), eq(shifts.id, id)));
    if (!row) throw new NotFoundException();
    return withDifference(row);
  }
}
