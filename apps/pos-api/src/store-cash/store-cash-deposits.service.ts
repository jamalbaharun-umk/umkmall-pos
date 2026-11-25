import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  fieldError,
  formatRupiah,
  Paging,
  Rupiah,
  UuidField,
} from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import { staff, storeCashDeposits } from '../db/schema';
import { isUniqueViolation } from '../staff/http';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import { recordStoreCash } from './store-cash-ledger';

export const DepositInput = z
  .object({
    // The staff member who collected the cash and hands it over.
    collectorId: UuidField,
    amount: Rupiah.positive('Harus lebih dari 0'),
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type DepositInput = z.infer<typeof DepositInput>;

export const DepositListQuery = z.object({ ...Paging });

/** Same key + same request → the first deposit; same key + another request → refused. */
const requestHash = (i: DepositInput) =>
  createHash('sha256')
    .update(JSON.stringify([i.collectorId, i.amount, i.note ?? null]))
    .digest('hex');

const KEY_REUSED = 'Kunci ini sudah dipakai untuk setoran lain';

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
};

/**
 * Handover of a collector's outside-shift cash to the store safe (UMK-1924 U3). This file is the only
 * writer of `pos.store_cash_deposits` and of the store ledger kind `collector_deposit` (guard in
 * src/guards.spec.ts); the ledger row itself is inserted by `recordStoreCash`. Every query filters the
 * session's tenant.
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
    }>(sql`
      select x.actor_id as collector_id, x.actor_kind as collector_kind,
             case when x.actor_kind = 'owner' then 'Pemilik' else coalesce(st.name, 'Staf') end
               as collector_name,
             x.collected, coalesce(h.handed_over, 0) as handed_over
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

  /** The actor (the receiver) takes `amount` of the collector's outstanding cash into the store safe. */
  async create(s: PosSession, key: string, input: DepositInput) {
    const hash = requestHash(input);
    const replay = (prior: { id: string; hash: string }) => {
      if (prior.hash !== hash) throw fieldError('idempotencyKey', KEY_REUSED);
      return prior.id;
    };
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        // Nobody clears their own outstanding: someone else receives the cash.
        if (input.collectorId === s.actorId)
          throw fieldError(
            'collectorId',
            'Setoran harus diterima oleh orang lain, bukan penyetor sendiri',
          );
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
        const [cash] = await this.collectors(s.tenantId, tx, who.id);
        const outstanding =
          cash?.collectorKind === 'cashier' ? cash.outstanding : 0;
        if (outstanding <= 0)
          throw fieldError(
            'amount',
            'Tidak ada uang yang belum disetor oleh staf ini',
          );
        if (input.amount > outstanding)
          throw fieldError(
            'amount',
            `Jumlah melebihi uang yang belum disetor (${formatRupiah(outstanding)})`,
          );
        const newId = randomUUID();
        // The ledger line: the cash changes holder (collector → safe); the store's balance does not move.
        await recordStoreCash(tx, s, {
          direction: 'transfer',
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
