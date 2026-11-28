import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  codedError,
  formatRupiah,
  Rupiah,
  UuidField,
} from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import {
  AGENT_LABEL,
  CASH_DIRECTIONS,
  MANUAL_CASH_REASON_CODES,
  MANUAL_CASH_REASON_LABELS,
  MANUAL_CASH_REASONS,
  type ManualCashReason,
  manualCashEntries,
  staff,
} from '../db/schema';
import { recordAudit } from '../audit/record';
import { isUniqueViolation } from '../staff/http';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import {
  assertPersonAtTill,
  lockShiftForCash,
  recordShiftCashAt,
} from './cash-ledger';
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
    // An owner may name the open shift whose drawer the cash is for; everyone else uses their own.
    shiftId: UuidField.transform((v) => v.toLowerCase()).optional(),
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
    .update(
      JSON.stringify([
        i.direction,
        i.amount,
        i.reason,
        i.note ?? null,
        // Only when named, so a key from before this field replays as it did.
        ...(i.shiftId ? [i.shiftId] : []),
      ]),
    )
    .digest('hex');

const KEY_REUSED = 'Kunci ini sudah dipakai untuk catatan kas lain';
const NO_SHIFT = 'Buka shift dulu untuk mencatat kas masuk atau keluar';

/**
 * Thrown inside the transaction when the key turns up after the drawer lock: rolls back everything the lock
 * wrote (a solo owner's automatically opened shift and its audit row), then the first entry is answered.
 */
class KeyAnswered extends Error {
  constructor(readonly id: string) {
    super('idempotency key already answered');
  }
}

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
    when ${m.actorKind} = 'agent' then ${AGENT_LABEL}
    else coalesce(${staff.name}, 'Staf') end`,
  createdAt: m.createdAt,
};

/**
 * Manual drawer cash (UMK-1924 U3): cash a cashier puts into or takes out of the open drawer by hand.
 * This file is the only writer of `pos.manual_cash_entries` and of the shift ledger kinds `manual_in` /
 * `manual_out` (guard in src/guards.spec.ts); the ledger row itself is inserted by cash-ledger.ts under
 * the shift's row lock. Only a person at the till records either direction (design fitur 20: an agent
 * records neither cash out nor cash in). Refusals carry a `code`: `SHIFT_REQUIRED`, `SHIFT_NOT_YOURS`,
 * `DRAWER_INSUFFICIENT` (with `drawerCash`), `IDEMPOTENCY_KEY_REUSED`, `AGENT_FORBIDDEN`.
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
      .select({ id: m.id, hash: m.requestHash, actorId: m.actorId })
      .from(m)
      .where(and(eq(m.tenantId, tenantId), eq(m.idempotencyKey, key)));
    return prior ?? null;
  }

  async create(s: PosSession, key: string, input: CashEntryInput) {
    // Agent sessions never record drawer cash by hand, in or out: refused before any lock or lookup.
    assertPersonAtTill(s.kind);
    const hash = requestHash(input);
    // A key answers only the actor who first sent it: a colleague who sends the same key (and body) is
    // refused like any other reuse, and never gets the first actor's entry.
    const replay = (prior: { id: string; hash: string; actorId: string }) => {
      if (prior.hash !== hash || prior.actorId !== s.actorId)
        throw codedError(
          'IDEMPOTENCY_KEY_REUSED',
          'idempotencyKey',
          KEY_REUSED,
        );
      return prior.id;
    };
    // The key first: a retry (double tap, network replay) answers the first entry and changes nothing,
    // also once its shift has closed. Before the shift lock, which refuses a named shift that is closed
    // (`SHIFT_NOT_YOURS`): a retry is never judged against the shift's state now.
    const done = await this.byKey(this.db, s.tenantId, key);
    if (done) return this.get(s.tenantId, replay(done));
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        // The key again before the drawer lock: in solo-owner mode the lock may open a shift, and a
        // duplicate must not open one (UMK-2120 review).
        const early = await this.byKey(tx, s.tenantId, key);
        if (early) return replay(early);
        // The shift's row lock (the lock a sale and the close take), then the key again: a duplicate in
        // flight waits here and then finds the first entry, instead of being judged against a drawer
        // the first one already changed.
        await lockShiftForCash(
          tx,
          s,
          input.shiftId,
          input.direction === 'in' ? 'manual_in' : 'manual_out',
        );
        const prior = await this.byKey(tx, s.tenantId, key);
        // A duplicate that waited behind a shift close finds no open shift, and a solo owner's lock opens a
        // new one: rolled back, so the replay leaves no empty shift and no audit row behind.
        if (prior) throw new KeyAnswered(replay(prior));
        const newId = randomUUID();
        // Writes the movement into the locked shift's ledger; 422 without an open shift.
        const shiftId = await recordShiftCashAt(
          tx,
          s,
          input.shiftId,
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
          throw codedError(
            'DRAWER_INSUFFICIENT',
            'amount',
            `Jumlah lebih besar dari uang di laci (${formatRupiah(Math.max(drawerCashBefore, 0))})`,
            // What the drawer holds now, so the form can show the new limit.
            { drawerCash: Math.max(drawerCashBefore, 0) },
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
        // The note is free text: not copied into the log.
        await recordAudit(
          tx,
          s,
          input.direction === 'in' ? 'drawer_cash_in' : 'drawer_cash_out',
          {
            target: { type: 'shift', id: shiftId },
            details: {
              shiftId,
              amount: input.amount,
              reason: input.reason,
              drawerCashBefore,
            },
          },
        );
        return newId;
      });
    } catch (e) {
      if (e instanceof KeyAnswered) return this.get(s.tenantId, e.id);
      if (!isUniqueViolation(e)) throw e;
      const prior = await this.byKey(this.db, s.tenantId, key);
      if (!prior) throw e;
      id = replay(prior);
    }
    return this.get(s.tenantId, id);
  }
}
