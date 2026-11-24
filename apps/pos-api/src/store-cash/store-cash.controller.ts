import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Paging, validate } from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import { staff, storeCashEntries } from '../db/schema';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

const StoreCashQuery = z.object({ ...Paging });

/** Reads of the store's cash ledger (UMK-1963). Rows are written by store-cash-ledger.ts only. */
@Injectable()
export class StoreCashService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** One page of entries, newest first, plus the totals of the whole ledger (not of the page). */
  async list(tenantId: string, q: z.infer<typeof StoreCashQuery>) {
    const e = storeCashEntries;
    const where = eq(e.tenantId, tenantId);
    const sum = (direction: 'in' | 'out') =>
      sql<string>`coalesce(sum(${e.amount}) filter (where ${e.direction} = ${direction}), 0)`;
    const [data, [totals]] = await Promise.all([
      this.db
        .select({
          id: e.id,
          direction: e.direction,
          kind: e.kind,
          amount: e.amount,
          refId: e.refId,
          note: e.note,
          actorId: e.actorId,
          actorKind: e.actorKind,
          actorName: sql<string>`case when ${e.actorKind} = 'owner' then 'Pemilik'
            else coalesce(${staff.name}, 'Staf') end`,
          createdAt: e.createdAt,
        })
        .from(e)
        .leftJoin(
          staff,
          and(eq(staff.tenantId, e.tenantId), eq(staff.id, e.actorId)),
        )
        .where(where)
        .orderBy(desc(e.createdAt), desc(e.id))
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db
        .select({ total: count(), cashIn: sum('in'), cashOut: sum('out') })
        .from(e)
        .where(where),
    ]);
    const cashIn = Number(totals.cashIn);
    const cashOut = Number(totals.cashOut);
    return {
      data,
      total: totals.total,
      page: q.page,
      perPage: q.perPage,
      summary: { cashIn, cashOut, balance: cashIn - cashOut },
    };
  }
}

@Controller('store-cash')
export class StoreCashController {
  constructor(private readonly storeCash: StoreCashService) {}

  // The store's money position is a report: `reports.view`, not `receivables.manage` (a collector sees
  // their own collections on the receivable, not what the whole store holds).
  @Get()
  @RequirePermission('reports.view')
  list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.storeCash.list(s.tenantId, validate(StoreCashQuery, query));
  }
}

@Module({
  controllers: [StoreCashController],
  providers: [StoreCashService],
})
export class StoreCashModule {}
