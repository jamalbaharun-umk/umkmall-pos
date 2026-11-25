import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createHash, randomUUID } from 'node:crypto';
import { storeToday } from '../common/store-day';
import { fieldError } from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
  type ExpenseChanges,
  expenseEdits,
  expenses,
  staff,
  storeCashEntries,
  SUPPLIER_PAYMENT_CATEGORY,
} from '../db/schema';
import { ROW_CAP } from '../reports/reports.service';
import { recordStoreCash } from '../store-cash/store-cash-ledger';
import { recordShiftCash, recordShiftCashInShift } from '../shifts/cash-ledger';
import { ShiftsService } from '../shifts/shifts.service';
import { isUniqueViolation } from '../staff/http';
import { hasPermission } from '../staff/require-permission';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import type {
  ExpenseInput,
  ExpenseListQuery,
  ExpensePeriod,
  ExpenseUpdate,
  PeriodQuery,
} from './expenses.schemas';

const kindOf = (category: ExpenseCategory) =>
  category === SUPPLIER_PAYMENT_CATEGORY ? 'supplier_payment' : 'expense';

/** Same key + same request → the first expense; same key + another request → refused. */
const requestHash = (i: ExpenseInput) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        i.amount,
        i.category,
        i.source,
        i.note ?? null,
        i.date ?? null,
      ]),
    )
    .digest('hex');

const KEY_REUSED = 'Kunci ini sudah dipakai untuk pengeluaran lain';

/**
 * Whose expenses the actor works on (owner ruling 2026-11-25). With `reports.view` (owners hold every
 * permission) the store's whole log: no filter. With `expenses.manage` alone only the rows the actor
 * recorded; anyone else's id is not found (404), and lists and totals leave them out.
 */
export const ownScope = (s: PosSession): SQL | undefined =>
  hasPermission(s, 'reports.view')
    ? undefined
    : and(eq(expenses.actorId, s.actorId), eq(expenses.actorKind, s.kind));

// ---- Store-day arithmetic on 'YYYY-MM-DD' strings (UTC maths, no clock, no timezone) ----
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(Date.parse(d) + n * DAY);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY);
/** The same day one month earlier; the 31st of March becomes the last day of February. */
export function monthBefore(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  const lastOfPrevious = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m - 2, Math.min(day, lastOfPrevious)));
}

export type ResolvedPeriod = {
  period: ExpensePeriod | null;
  from: string;
  to: string;
  /** The span compared with: one period earlier, or the same number of days just before `from`. */
  previous: { from: string; to: string };
  /** `period` mode: how far back "the same moment one period ago" is (a Postgres interval). */
  step: '1 day' | '7 days' | '1 month' | null;
};

/** `today` | `week` (Monday → today) | `month` (the 1st → today), or the given `from`/`to`. */
export function resolvePeriod(q: PeriodQuery, today: string): ResolvedPeriod {
  if (q.from && q.to) {
    const days = daysBetween(q.from, q.to) + 1;
    return {
      period: null,
      from: q.from,
      to: q.to,
      previous: { from: addDays(q.from, -days), to: addDays(q.from, -1) },
      step: null,
    };
  }
  const period = q.period ?? 'today';
  if (period === 'today')
    return {
      period,
      from: today,
      to: today,
      previous: { from: addDays(today, -1), to: addDays(today, -1) },
      step: '1 day',
    };
  if (period === 'week') {
    const monday = addDays(
      today,
      -((new Date(Date.parse(today)).getUTCDay() + 6) % 7),
    );
    return {
      period,
      from: monday,
      to: today,
      previous: { from: addDays(monday, -7), to: addDays(today, -7) },
      step: '7 days',
    };
  }
  const first = `${today.slice(0, 8)}01`;
  return {
    period,
    from: first,
    to: today,
    previous: { from: monthBefore(first), to: monthBefore(today) },
    step: '1 month',
  };
}

const voider = alias(staff, 'voider');
const actorName = (kind: AnyColumn, name: AnyColumn) =>
  sql<string>`case when ${kind} = 'owner' then 'Pemilik' else coalesce(${name}, 'Staf') end`;

const columns = {
  id: expenses.id,
  kind: expenses.kind,
  category: expenses.category,
  amount: expenses.amount,
  note: expenses.note,
  date: expenses.expenseDate,
  source: expenses.source,
  shiftId: expenses.shiftId,
  drawerCashBefore: expenses.drawerCashBefore,
  actorId: expenses.actorId,
  actorKind: expenses.actorKind,
  actorName: actorName(expenses.actorKind, staff.name),
  createdAt: expenses.createdAt,
  updatedAt: expenses.updatedAt,
  voidedAt: expenses.voidedAt,
  voidedById: expenses.voidedById,
  voidedByName: sql<
    string | null
  >`case when ${expenses.voidedAt} is null then null
    when ${expenses.voidedByKind} = 'owner' then 'Pemilik' else coalesce(${voider.name}, 'Staf') end`,
  voidReason: expenses.voidReason,
  drawerReversed: expenses.drawerReversed,
  // Where the cash of a voided drawer expense went: back into its shift's drawer (still open), or
  // into the store cash (shift closed). Read from the ledgers; null when nothing was returned.
  cashReturnedTo: sql<'drawer' | 'store_cash' | null>`case
    when ${expenses.voidedAt} is null or ${expenses.source} <> 'drawer' then null
    when ${expenses.drawerReversed} then 'drawer'
    when exists (select 1 from ${storeCashEntries}
                  where ${storeCashEntries.tenantId} = ${expenses.tenantId}
                    and ${storeCashEntries.kind} = 'expense_void'
                    and ${storeCashEntries.refId} = ${expenses.id}) then 'store_cash'
    end`,
};

type Selected = {
  category: ExpenseCategory;
  amount: number;
  drawerCashBefore: number | null;
};
const present = <T extends Selected>(r: T) => ({
  ...r,
  categoryLabel: EXPENSE_CATEGORY_LABELS[r.category],
  // The design's warning: more was taken than the drawer should have held. Saved all the same.
  exceedsDrawerCash:
    r.drawerCashBefore !== null && r.amount > r.drawerCashBefore,
});

/**
 * The expense log (UMK-1984). This file is the only writer of `pos.expenses` and of the shift ledger
 * kinds `expense` / `expense_reversal` (guard in src/guards.spec.ts); the ledger rows themselves are
 * inserted by shifts/cash-ledger.ts under the shift's row lock. Every query filters the session's tenant,
 * and every route's read or write of a row also `ownScope` (the profit and loss report covers the store).
 */
@Injectable()
export class ExpensesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly shifts: ShiftsService,
  ) {}

  categories() {
    return EXPENSE_CATEGORIES.map((c) => ({
      category: c,
      label: EXPENSE_CATEGORY_LABELS[c],
      kind: kindOf(c),
    }));
  }

  /** Today's date in the store's timezone, 'YYYY-MM-DD'. */
  async today(tenantId: string, db: Db | Tx = this.db): Promise<string> {
    const [row] = await db.execute(
      sql`select to_char(${storeToday(tenantId)}, 'YYYY-MM-DD') as today`,
    );
    return (row as { today: string }).today;
  }

  private rows(db: Db | Tx = this.db) {
    return db
      .select(columns)
      .from(expenses)
      .leftJoin(
        staff,
        and(
          eq(staff.tenantId, expenses.tenantId),
          eq(staff.id, expenses.actorId),
        ),
      )
      .leftJoin(
        voider,
        and(
          eq(voider.tenantId, expenses.tenantId),
          eq(voider.id, expenses.voidedById),
        ),
      );
  }

  /** One expense the actor may see (`ownScope`), with its edit history, oldest edit first. */
  get(s: PosSession, id: string) {
    return this.read(s.tenantId, id, ownScope(s));
  }

  private async read(tenantId: string, id: string, scope?: SQL) {
    const [row] = await this.rows().where(
      and(eq(expenses.tenantId, tenantId), eq(expenses.id, id), scope),
    );
    if (!row) throw new NotFoundException();
    const edits = await this.db
      .select({
        id: expenseEdits.id,
        changes: expenseEdits.changes,
        actorId: expenseEdits.actorId,
        actorKind: expenseEdits.actorKind,
        actorName: actorName(expenseEdits.actorKind, staff.name),
        createdAt: expenseEdits.createdAt,
      })
      .from(expenseEdits)
      .leftJoin(
        staff,
        and(
          eq(staff.tenantId, expenseEdits.tenantId),
          eq(staff.id, expenseEdits.actorId),
        ),
      )
      .where(
        and(
          eq(expenseEdits.tenantId, tenantId),
          eq(expenseEdits.expenseId, id),
        ),
      )
      .orderBy(expenseEdits.createdAt, expenseEdits.id);
    return { ...present(row), edits };
  }

  private async byKey(db: Db | Tx, tenantId: string, key: string) {
    const [prior] = await db
      .select({
        id: expenses.id,
        hash: expenses.requestHash,
        actorId: expenses.actorId,
      })
      .from(expenses)
      .where(
        and(eq(expenses.tenantId, tenantId), eq(expenses.idempotencyKey, key)),
      );
    return prior ?? null;
  }

  async create(s: PosSession, key: string, input: ExpenseInput) {
    const hash = requestHash(input);
    const scoped = ownScope(s) !== undefined;
    const replay = (prior: { id: string; hash: string; actorId: string }) => {
      // Another actor's key is never a replay for someone who may not see that expense.
      if (prior.hash !== hash || (scoped && prior.actorId !== s.actorId))
        throw fieldError('idempotencyKey', KEY_REUSED);
      return prior.id;
    };
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        // A retry (double tap, network replay) finds the first expense and changes nothing.
        const prior = await this.byKey(tx, s.tenantId, key);
        if (prior) return replay(prior);
        const today = await this.today(s.tenantId, tx);
        const date = input.date ?? today;
        if (date > today)
          throw fieldError('date', 'Tanggal tidak boleh di masa depan');
        const drawer = input.source === 'drawer';
        // The cash leaves the drawer now, so the expense belongs to today.
        if (drawer && date !== today)
          throw fieldError(
            'date',
            'Pengeluaran dari laci selalu bertanggal hari ini',
          );
        const newId = randomUUID();
        let shiftId: string | null = null;
        let drawerCashBefore: number | null = null;
        if (drawer) {
          // Locks the actor's open shift (the lock a sale and the close take) and writes the cash-out.
          shiftId = await recordShiftCash(
            tx,
            s,
            {
              direction: 'out',
              kind: 'expense',
              amount: input.amount,
              refId: newId,
            },
            'Buka shift dulu untuk mencatat pengeluaran dari laci',
          );
          drawerCashBefore =
            (await this.shifts.expectedCashOf(tx, s.tenantId, shiftId)) +
            input.amount;
        }
        // Claims the key: a concurrent duplicate fails here and rolls its ledger entry back.
        await tx.insert(expenses).values({
          id: newId,
          tenantId: s.tenantId,
          kind: kindOf(input.category),
          category: input.category,
          amount: input.amount,
          note: input.note || null,
          expenseDate: date,
          source: input.source,
          shiftId,
          drawerCashBefore,
          actorId: s.actorId,
          actorKind: s.kind,
          idempotencyKey: key,
          requestHash: hash,
        });
        return newId;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const prior = await this.byKey(this.db, s.tenantId, key);
      if (!prior) throw e;
      id = replay(prior);
    }
    return this.read(s.tenantId, id);
  }

  async update(s: PosSession, id: string, input: ExpenseUpdate) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          source: expenses.source,
          category: expenses.category,
          note: expenses.note,
          amount: expenses.amount,
          date: expenses.expenseDate,
          voidedAt: expenses.voidedAt,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.tenantId, s.tenantId),
            eq(expenses.id, id),
            ownScope(s),
          ),
        )
        .for('update');
      if (!row) throw new NotFoundException();
      if (row.voidedAt)
        throw new ConflictException('Pengeluaran ini sudah dibatalkan');
      const amount = input.amount ?? row.amount;
      const date = input.date ?? row.date;
      if (row.source === 'drawer') {
        // The cash already left a drawer for this amount on this day; the ledger is append-only.
        if (amount !== row.amount)
          throw fieldError(
            'amount',
            'Jumlah pengeluaran dari laci tidak bisa diubah. Batalkan lalu catat ulang.',
          );
        if (date !== row.date)
          throw fieldError(
            'date',
            'Tanggal pengeluaran dari laci tidak bisa diubah',
          );
      } else if (date !== row.date && date > (await this.today(s.tenantId, tx)))
        throw fieldError('date', 'Tanggal tidak boleh di masa depan');
      const category = input.category ?? row.category;
      const note = input.note === undefined ? row.note : input.note || null;
      // The history: before and after of every field this edit really changed.
      const changes: ExpenseChanges = {
        ...(category !== row.category
          ? { category: { from: row.category, to: category } }
          : {}),
        ...(amount !== row.amount
          ? { amount: { from: row.amount, to: amount } }
          : {}),
        ...(note !== row.note ? { note: { from: row.note, to: note } } : {}),
        ...(date !== row.date ? { date: { from: row.date, to: date } } : {}),
      };
      // Nothing changed: no edit happened, so no history row and no new "last edited".
      if (Object.keys(changes).length === 0) return;
      await tx.insert(expenseEdits).values({
        tenantId: s.tenantId,
        expenseId: id,
        changes,
        actorId: s.actorId,
        actorKind: s.kind,
      });
      await tx
        .update(expenses)
        .set({
          category,
          kind: kindOf(category),
          note,
          amount,
          expenseDate: date,
          updatedAt: new Date(),
          updatedById: s.actorId,
          updatedByKind: s.kind,
        })
        .where(and(eq(expenses.tenantId, s.tenantId), eq(expenses.id, id)));
    });
    return this.read(s.tenantId, id);
  }

  /**
   * The soft delete. A drawer expense whose shift is still open gets one cash-in entry in that shift
   * (its expected cash is back where it was). A closed shift was counted with the expense in it and
   * never changes: the cash given back goes into the store cash ("kas toko"), one `expense_void`
   * entry by whoever voids (owner ruling 2026-11-25). Repeating the void changes nothing.
   */
  async voidExpense(s: PosSession, id: string, reason?: string) {
    await this.db.transaction(async (tx) => {
      // Lock order: the expense row first, then its shift.
      const [row] = await tx
        .select({
          source: expenses.source,
          amount: expenses.amount,
          shiftId: expenses.shiftId,
          voidedAt: expenses.voidedAt,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.tenantId, s.tenantId),
            eq(expenses.id, id),
            ownScope(s),
          ),
        )
        .for('update');
      if (!row) throw new NotFoundException();
      if (row.voidedAt) return;
      const drawerReversed =
        row.source === 'drawer' && row.shiftId
          ? await recordShiftCashInShift(tx, s, row.shiftId, {
              direction: 'in',
              kind: 'expense_reversal',
              amount: row.amount,
              refId: id,
            })
          : null;
      // Shift closed: the money is back in the store, outside every drawer. One entry per expense
      // (this row's lock, and the ledger's unique index on its source).
      if (drawerReversed === false)
        await recordStoreCash(tx, s, {
          direction: 'in',
          kind: 'expense_void',
          amount: row.amount,
          refId: id,
          note: reason || undefined,
        });
      await tx
        .update(expenses)
        .set({
          voidedAt: new Date(),
          voidedById: s.actorId,
          voidedByKind: s.kind,
          voidReason: reason || null,
          drawerReversed,
        })
        .where(and(eq(expenses.tenantId, s.tenantId), eq(expenses.id, id)));
    });
    return this.read(s.tenantId, id);
  }

  private inRange(tenantId: string, from: string, to: string) {
    return and(
      eq(expenses.tenantId, tenantId),
      gte(expenses.expenseDate, from),
      lte(expenses.expenseDate, to),
    );
  }

  /**
   * Totals of the live (not voided) rows dated `[from, to]`. `expenses` is what the profit and loss
   * report subtracts: supplier payments are NOT in it (their goods are cost of goods sold already).
   * `scope` narrows them to one actor's rows (the list's summary); the report passes none.
   */
  async totals(tenantId: string, from: string, to: string, scope?: SQL) {
    const rows = await this.db
      .select({
        category: expenses.category,
        total: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
        fromDrawer: sql<string>`coalesce(sum(${expenses.amount}) filter (where ${expenses.source} = 'drawer'), 0)`,
        n: count(),
      })
      .from(expenses)
      .where(
        and(this.inRange(tenantId, from, to), isNull(expenses.voidedAt), scope),
      )
      .groupBy(expenses.category);
    const byCategory = rows
      .map((r) => ({
        category: r.category,
        label: EXPENSE_CATEGORY_LABELS[r.category],
        kind: kindOf(r.category),
        total: Number(r.total),
        count: r.n,
        fromDrawer: Number(r.fromDrawer),
      }))
      .sort(
        (a, b) =>
          b.total - a.total ||
          EXPENSE_CATEGORIES.indexOf(a.category) -
            EXPENSE_CATEGORIES.indexOf(b.category),
      );
    const sum = (
      pick: (r: (typeof byCategory)[number]) => number,
      kind?: 'expense' | 'supplier_payment',
    ) =>
      byCategory
        .filter((r) => !kind || r.kind === kind)
        .reduce((a, r) => a + pick(r), 0);
    const all = sum((r) => r.total);
    const fromDrawer = sum((r) => r.fromDrawer);
    return {
      count: sum((r) => r.count),
      expenses: sum((r) => r.total, 'expense'),
      supplierPayments: sum((r) => r.total, 'supplier_payment'),
      fromDrawer,
      outside: all - fromDrawer,
      byCategory: byCategory.map(({ category, label, kind, total, count }) => ({
        category,
        label,
        kind,
        total,
        count,
      })),
    };
  }

  private statusFilter(status: ExpenseListQuery['status']) {
    return status === 'active'
      ? isNull(expenses.voidedAt)
      : status === 'voided'
        ? isNotNull(expenses.voidedAt)
        : undefined;
  }

  /**
   * One page, newest first, plus the totals of the whole range (live rows, not of the page). Rows and
   * totals are the actor's own unless they hold `reports.view` (`ownScope`).
   */
  async list(s: PosSession, q: ExpenseListQuery) {
    const tenantId = s.tenantId;
    const scope = ownScope(s);
    const range = resolvePeriod(q, await this.today(tenantId));
    const where = and(
      this.inRange(tenantId, range.from, range.to),
      this.statusFilter(q.status),
      scope,
    );
    const [data, [{ total }], summary] = await Promise.all([
      this.rows()
        .where(where)
        .orderBy(
          desc(expenses.expenseDate),
          desc(expenses.createdAt),
          desc(expenses.id),
        )
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db.select({ total: count() }).from(expenses).where(where),
      this.totals(tenantId, range.from, range.to, scope),
    ]);
    return {
      period: range.period,
      from: range.from,
      to: range.to,
      data: data.map(present),
      total,
      page: q.page,
      perPage: q.perPage,
      summary,
    };
  }

  /** The live rows of the range for the CSV, oldest first, capped like every line report. */
  async export(s: PosSession, q: PeriodQuery) {
    const tenantId = s.tenantId;
    const scope = ownScope(s);
    const range = resolvePeriod(q, await this.today(tenantId));
    const [rows, summary] = await Promise.all([
      this.rows()
        .where(
          and(
            this.inRange(tenantId, range.from, range.to),
            isNull(expenses.voidedAt),
            scope,
          ),
        )
        .orderBy(expenses.expenseDate, expenses.createdAt, expenses.id)
        .limit(ROW_CAP + 1),
      this.totals(tenantId, range.from, range.to, scope),
    ]);
    return {
      from: range.from,
      to: range.to,
      truncated: rows.length > ROW_CAP,
      rows: rows.slice(0, ROW_CAP).map(present),
      summary,
    };
  }
}
