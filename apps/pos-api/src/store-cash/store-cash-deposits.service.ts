import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  codedError,
  formatRupiah,
  Paging,
  Rupiah,
  UuidField,
} from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import { shifts, staff, storeCashDeposits } from '../db/schema';
import { assertPersonAtTill, recordShiftCashAt } from '../shifts/cash-ledger';
import { shiftActorName, shiftNumber } from '../shifts/shift-read';
import { isUniqueViolation } from '../staff/http';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import { recordStoreCash } from './store-cash-ledger';

export const DepositInput = z
  .object({
    // The staff member who collected the cash and hands it over.
    collectorId: UuidField.transform((v) => v.toLowerCase()),
    amount: Rupiah.positive('Harus lebih dari 0'),
    note: z.string().trim().max(200).optional(),
    // An owner may name the open shift whose drawer takes the cash; everyone else uses their own.
    shiftId: UuidField.transform((v) => v.toLowerCase()).optional(),
  })
  .strict();
export type DepositInput = z.infer<typeof DepositInput>;

export const DepositListQuery = z.object({ ...Paging });

/** Same key + same request → the first deposit; same key + another request → refused. */
const requestHash = (i: DepositInput) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        i.collectorId,
        i.amount,
        i.note ?? null,
        // Only when named, so a key from before this field replays as it did.
        ...(i.shiftId ? [i.shiftId] : []),
      ]),
    )
    .digest('hex');

const KEY_REUSED = 'Kunci ini sudah dipakai untuk setoran lain';
const NO_SHIFT = 'Buka shift dulu agar uang setoran masuk laci';
const SELF =
  'Penagih tidak bisa mencatat setorannya sendiri. Minta kasir atau pemilik yang menerima uang';
const selfDeposit = () => codedError('SELF_DEPOSIT', 'collectorId', SELF);

const d = storeCashDeposits;
const collector = alias(staff, 'collector');
const receiver = alias(staff, 'receiver');
const columns = {
  id: d.id,
  collectorId: d.collectorId,
  collectorName: sql<string>`coalesce(${collector.name}, 'Staf')`,
  amount: d.amount,
  note: d.note,
  outstandingBefore: d.outstandingBefore,
  receivedById: d.receivedById,
  receivedByKind: d.receivedByKind,
  receivedByName: sql<string>`case when ${d.receivedByKind} = 'owner' then 'Pemilik'
    else coalesce(${receiver.name}, 'Staf') end`,
  // The drawer the cash went into; all three null on a handover from before the drawer rule.
  shiftId: d.shiftId,
  shiftNumber: sql<
    number | null
  >`case when shifts.id is not null then ${shiftNumber} end`,
  shiftActorName: sql<
    string | null
  >`case when shifts.id is not null then ${shiftActorName} end`,
  createdAt: d.createdAt,
};
const present = <T extends { amount: number; outstandingBefore: number }>(
  r: T,
) => ({ ...r, outstandingAfter: r.outstandingBefore - r.amount });

export type CollectorCash = {
  collectorId: string;
  collectorKind: 'owner' | 'cashier';
  collectorName: string;
  /** Cash taken outside every shift (store ledger `in`, kind `receivable_payment`). */
  collected: number;
  /** Of that, handed over to the store safe. */
  handedOver: number;
  outstanding: number;
  /** Still on the staff list (neither removed nor switched off); always true for an owner. */
  active: boolean;
};

/**
 * "Setoran penagih" (UMK-1924 U3, design fitur 21): a collector's outside-shift cash is received into an
 * open shift drawer. One deposit is, in one transaction, the audit row, a shift ledger `in` (the drawer
 * now holds the cash) and a store ledger `out` (it is no longer outside every drawer), so the cash is
 * counted once. This file is the only writer of `pos.store_cash_deposits` and of the kind
 * `collector_deposit` in both ledgers (guard in src/guards.spec.ts); the ledger rows themselves are
 * inserted by `recordShiftCashAt` and `recordStoreCash`. Every query filters the session's tenant.
 *
 * Refusals carry a `code`: `SHIFT_REQUIRED`, `SHIFT_NOT_YOURS`, `SELF_DEPOSIT`, `NOTHING_OUTSTANDING`,
 * `DEPOSIT_EXCEEDS_OUTSTANDING` (both with `outstanding`), `IDEMPOTENCY_KEY_REUSED`, `AGENT_FORBIDDEN`.
 */
@Injectable()
export class StoreCashDepositsService {
  constructor(@InjectDb() private readonly db: Db) {}

  private rows(db: Db | Tx = this.db) {
    return db
      .select(columns)
      .from(d)
      .leftJoin(
        collector,
        and(
          eq(collector.tenantId, d.tenantId),
          eq(collector.id, d.collectorId),
        ),
      )
      .leftJoin(
        receiver,
        and(eq(receiver.tenantId, d.tenantId), eq(receiver.id, d.receivedById)),
      )
      .leftJoin(
        shifts,
        and(eq(shifts.tenantId, d.tenantId), eq(shifts.id, d.shiftId)),
      );
  }

  private async get(tenantId: string, id: string) {
    const [row] = await this.rows().where(
      and(eq(d.tenantId, tenantId), eq(d.id, id)),
    );
    if (!row) throw new NotFoundException();
    return present(row);
  }

  /** The audit list, newest first. */
  async list(tenantId: string, q: z.infer<typeof DepositListQuery>) {
    const where = eq(d.tenantId, tenantId);
    const [data, [{ total }]] = await Promise.all([
      this.rows()
        .where(where)
        .orderBy(desc(d.createdAt), desc(d.id))
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db.select({ total: count() }).from(d).where(where),
    ]);
    return { data: data.map(present), total, page: q.page, perPage: q.perPage };
  }

  /**
   * "Setoran saya": what the actor themself collected outside a shift, handed over and still holds, and
   * the deposits in their name, newest first. Only the actor's own rows (`collector_id` = the session's
   * actor), and of a deposit only what its collector may know: no other staff member's id.
   */
  async mine(s: PosSession, q: z.infer<typeof DepositListQuery>) {
    const where = and(eq(d.tenantId, s.tenantId), eq(d.collectorId, s.actorId));
    const [[cash], data, [{ total }]] = await Promise.all([
      this.collectors(s.tenantId, this.db, s.actorId),
      this.rows()
        .where(where)
        .orderBy(desc(d.createdAt), desc(d.id))
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db.select({ total: count() }).from(d).where(where),
    ]);
    return {
      collectorId: s.actorId,
      collected: cash?.collected ?? 0,
      handedOver: cash?.handedOver ?? 0,
      outstanding: cash?.outstanding ?? 0,
      data: data.map((r) => ({
        id: r.id,
        amount: r.amount,
        note: r.note,
        receivedByKind: r.receivedByKind,
        receivedByName: r.receivedByName,
        shiftId: r.shiftId,
        shiftNumber: r.shiftNumber,
        createdAt: r.createdAt,
      })),
      total,
      page: q.page,
      perPage: q.perPage,
    };
  }

  /**
   * What each collector of this store took outside a shift, handed over, and still holds; one collector
   * when `collectorId` is given. Most outstanding first.
   */
  async collectors(
    tenantId: string,
    db: Db | Tx = this.db,
    collectorId?: string,
  ): Promise<CollectorCash[]> {
    const only = collectorId ? sql`and x.actor_id = ${collectorId}` : sql``;
    const rows = await db.execute<{
      collector_id: string;
      collector_kind: 'owner' | 'cashier';
      collector_name: string;
      collected: string;
      handed_over: string;
      active: boolean;
    }>(sql`
      select x.actor_id as collector_id, x.actor_kind as collector_kind,
             case when x.actor_kind = 'owner' then 'Pemilik' else coalesce(st.name, 'Staf') end
               as collector_name,
             x.collected, coalesce(h.handed_over, 0) as handed_over,
             case when x.actor_kind = 'owner' then true
                  else coalesce(st.active and st.deleted_at is null, false) end as active
        from (
          select e.actor_id, e.actor_kind, sum(e.amount) as collected
            from pos.store_cash_entries e
           where e.tenant_id = ${tenantId} and e.direction = 'in' and e.kind = 'receivable_payment'
           group by e.actor_id, e.actor_kind) x
        left join pos.staff st on st.tenant_id = ${tenantId} and st.id = x.actor_id
        left join lateral (
          select sum(dep.amount) as handed_over from pos.store_cash_deposits dep
           where dep.tenant_id = ${tenantId} and dep.collector_id = x.actor_id
             and x.actor_kind = 'cashier') h on true
       where true ${only}
       order by x.collected - coalesce(h.handed_over, 0) desc, x.actor_id`);
    return rows.map((r) => {
      const collected = Number(r.collected);
      const handedOver = Number(r.handed_over);
      return {
        collectorId: r.collector_id,
        collectorKind: r.collector_kind,
        collectorName: r.collector_name,
        collected,
        handedOver,
        outstanding: collected - handedOver,
        active: r.active,
      };
    });
  }

  private async byKey(db: Db | Tx, tenantId: string, key: string) {
    const [prior] = await db
      .select({ id: d.id, hash: d.requestHash })
      .from(d)
      .where(and(eq(d.tenantId, tenantId), eq(d.idempotencyKey, key)));
    return prior ?? null;
  }

  /**
   * The actor (the receiver) takes `amount` of the collector's outstanding cash into an open shift
   * drawer: their own, or the open shift an owner names.
   */
  async create(s: PosSession, key: string, input: DepositInput) {
    // An agent never records a deposit: refused before any lock or lookup.
    assertPersonAtTill(s.kind);
    const hash = requestHash(input);
    const replay = (prior: { id: string; hash: string }) => {
      if (prior.hash !== hash)
        throw codedError(
          'IDEMPOTENCY_KEY_REUSED',
          'idempotencyKey',
          KEY_REUSED,
        );
      return prior.id;
    };
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        // Nobody clears their own outstanding: someone else receives the cash.
        if (input.collectorId === s.actorId) throw selfDeposit();
        // The collector's staff row lock serialises the deposits in their name: the outstanding read
        // below cannot be handed over twice. A removed (soft-deleted) collector can still hand over.
        const [who] = await tx
          .select({ id: staff.id })
          .from(staff)
          .where(
            and(
              eq(staff.tenantId, s.tenantId),
              eq(staff.id, input.collectorId),
            ),
          )
          .for('update');
        // A retry (double tap, network replay) finds the first deposit and changes nothing. Read under
        // the lock: a duplicate in flight waits above and then finds the first deposit, instead of being
        // judged against an outstanding the first one already lowered.
        const prior = await this.byKey(tx, s.tenantId, key);
        if (prior) return replay(prior);
        if (!who) throw new NotFoundException();
        // Compared with the stored row's id, so a differently-cased uuid cannot slip past the check above.
        if (who.id === s.actorId) throw selfDeposit();
        const newId = randomUUID();
        // The drawer first (lock order: the collector's staff row, then the shift): the cash enters the
        // receiving shift's ledger under that shift's row lock, the lock its close takes, so the deposit
        // lands before the count or not at all. 422 `SHIFT_REQUIRED` without an open shift; whatever is
        // refused below rolls this row back.
        const shiftId = await recordShiftCashAt(
          tx,
          s,
          input.shiftId,
          {
            direction: 'in',
            kind: 'collector_deposit',
            amount: input.amount,
            refId: newId,
            note: input.note || undefined,
          },
          NO_SHIFT,
        );
        const [cash] = await this.collectors(s.tenantId, tx, who.id);
        const outstanding =
          cash?.collectorKind === 'cashier' ? cash.outstanding : 0;
        if (outstanding <= 0)
          throw codedError(
            'NOTHING_OUTSTANDING',
            'amount',
            'Tidak ada uang yang belum disetor oleh staf ini',
            { outstanding: 0 },
          );
        if (input.amount > outstanding)
          throw codedError(
            'DEPOSIT_EXCEEDS_OUTSTANDING',
            'amount',
            `Jumlah melebihi uang yang belum disetor (${formatRupiah(outstanding)})`,
            { outstanding },
          );
        // The store ledger line: the cash is in a drawer now, so it LEAVES the cash held outside every
        // drawer. An `out`, never a `transfer`: left in the store's balance it would be counted twice.
        await recordStoreCash(tx, s, {
          direction: 'out',
          kind: 'collector_deposit',
          amount: input.amount,
          refId: newId,
          note: input.note || undefined,
        });
        // Claims the key: a concurrent duplicate fails here and rolls its ledger line back.
        await tx.insert(storeCashDeposits).values({
          id: newId,
          tenantId: s.tenantId,
          collectorId: who.id,
          amount: input.amount,
          note: input.note || null,
          outstandingBefore: outstanding,
          receivedById: s.actorId,
          receivedByKind: s.kind,
          shiftId,
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
