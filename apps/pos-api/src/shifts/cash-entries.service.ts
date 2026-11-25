import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fieldError, formatRupiah, Rupiah } from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import {
  CASH_DIRECTIONS,
  MANUAL_CASH_REASON_CODES,
  MANUAL_CASH_REASON_LABELS,
  MANUAL_CASH_REASONS,
  type ManualCashReason,
  manualCashEntries,
  staff,
} from '../db/schema';
import { isUniqueViolation } from '../staff/http';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import { lockOpenShift, recordShiftCash } from './cash-ledger';
import { ShiftsService } from './shifts.service';

const reasonsOf = (direction: 'in' | 'out'): readonly ManualCashReason[] =>
  MANUAL_CASH_REASONS[direction];

export const CashEntryInput = z
  .object({
    direction: z.enum(CASH_DIRECTIONS, {
      errorMap: () => ({ message: 'Pilih kas masuk atau kas keluar' }),
    }),
    amount: Rupiah.positive('Harus lebih dari 0'),
    reason: z.enum(MANUAL_CASH_REASON_CODES, {
      errorMap: () => ({ message: 'Pilih salah satu alasan' }),
    }),
    note: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((i, ctx) => {
    if (!reasonsOf(i.direction).includes(i.reason))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Pilih salah satu alasan',
      });
    else if (i.reason === 'lainnya' && !i.note)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'Catatan wajib diisi untuk alasan Lainnya',
      });
  });
export type CashEntryInput = z.infer<typeof CashEntryInput>;

/** Same key + same request → the first entry; same key + another request → refused. */
const requestHash = (i: CashEntryInput) =>
  createHash('sha256')
    .update(JSON.stringify([i.direction, i.amount, i.reason, i.note ?? null]))
    .digest('hex');

const KEY_REUSED = 'Kunci ini sudah dipakai untuk catatan kas lain';
const NO_SHIFT = 'Buka shift dulu untuk mencatat kas masuk atau keluar';

const m = manualCashEntries;
const columns = {
  id: m.id,
  shiftId: m.shiftId,
  direction: m.direction,
  reason: m.reason,
  amount: m.amount,
  note: m.note,
  drawerCashBefore: m.drawerCashBefore,
  actorId: m.actorId,
  actorKind: m.actorKind,
  actorName: sql<string>`case when ${m.actorKind} = 'owner' then 'Pemilik'
    else coalesce(${staff.name}, 'Staf') end`,
  createdAt: m.createdAt,
};

/**
 * Manual drawer cash (UMK-1924 U3): cash a cashier puts into or takes out of the open drawer by hand.
 * This file is the only writer of `pos.manual_cash_entries` and of the shift ledger kinds `manual_in` /
 * `manual_out` (guard in src/guards.spec.ts); the ledger row itself is inserted by cash-ledger.ts under
 * the shift's row lock, which also refuses a cash-out for a session kind that is not a person at the till.
 */
@Injectable()
export class CashEntriesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly shifts: ShiftsService,
  ) {}

  /** The pick-lists a form shows, per direction. */
  reasons() {
    const list = (direction: 'in' | 'out') =>
      reasonsOf(direction).map((reason) => ({
        reason,
        label: MANUAL_CASH_REASON_LABELS[reason],
        noteRequired: reason === 'lainnya',
      }));
    return { in: list('in'), out: list('out') };
  }

  private async get(tenantId: string, id: string) {
    const [row] = await this.db
      .select(columns)
      .from(m)
      .leftJoin(
        staff,
        and(eq(staff.tenantId, m.tenantId), eq(staff.id, m.actorId)),
      )
      .where(and(eq(m.tenantId, tenantId), eq(m.id, id)));
    if (!row) throw new NotFoundException();
    return {
      ...row,
      reasonLabel: MANUAL_CASH_REASON_LABELS[row.reason],
      drawerCashAfter:
        row.drawerCashBefore +
        (row.direction === 'in' ? row.amount : -row.amount),
    };
  }

  private async byKey(db: Db | Tx, tenantId: string, key: string) {
    const [prior] = await db
      .select({ id: m.id, hash: m.requestHash })
      .from(m)
      .where(and(eq(m.tenantId, tenantId), eq(m.idempotencyKey, key)));
    return prior ?? null;
  }

  async create(s: PosSession, key: string, input: CashEntryInput) {
    const hash = requestHash(input);
    const replay = (prior: { id: string; hash: string }) => {
      if (prior.hash !== hash) throw fieldError('idempotencyKey', KEY_REUSED);
      return prior.id;
    };
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        // The shift's row lock first (the lock a sale and the close take), then the key: a duplicate in
        // flight waits here and then finds the first entry, instead of being judged against a drawer
        // the first one already changed.
        await lockOpenShift(tx, s);
        // A retry (double tap, network replay) finds the first entry and changes nothing, also once
        // the shift has closed.
        const prior = await this.byKey(tx, s.tenantId, key);
        if (prior) return replay(prior);
        const newId = randomUUID();
        // Writes the movement into the locked shift's ledger; 422 without an open shift.
        const shiftId = await recordShiftCash(
          tx,
          s,
          {
            direction: input.direction,
            kind: input.direction === 'in' ? 'manual_in' : 'manual_out',
            amount: input.amount,
            refId: newId,
            note: input.note || undefined,
          },
          NO_SHIFT,
        );
        // Under the shift's lock the figure cannot move: what the drawer held before this movement.
        const after = await this.shifts.expectedCashOf(tx, s.tenantId, shiftId);
        const drawerCashBefore =
          input.direction === 'in'
            ? after - input.amount
            : after + input.amount;
        // More than the drawer holds cannot be taken out: refused, and the ledger row rolls back.
        if (input.direction === 'out' && input.amount > drawerCashBefore)
          throw fieldError(
            'amount',
            `Jumlah lebih besar dari uang di laci (${formatRupiah(Math.max(drawerCashBefore, 0))})`,
          );
        // Claims the key: a concurrent duplicate fails here and rolls its ledger entry back.
        await tx.insert(manualCashEntries).values({
          id: newId,
          tenantId: s.tenantId,
          shiftId,
          direction: input.direction,
          reason: input.reason,
          note: input.note || null,
          amount: input.amount,
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
    return this.get(s.tenantId, id);
  }
}
