import {
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Paging, validate } from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import { staff, storeCashEntries } from '../db/schema';
import { IdempotencyKey } from '../sales/sales.schemas';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  DepositInput,
  DepositListQuery,
  StoreCashDepositsService,
} from './store-cash-deposits.service';

const StoreCashQuery = z.object({ ...Paging });

/** Reads of the store's cash ledger (UMK-1963). Rows are written by store-cash-ledger.ts only. */
@Injectable()
export class StoreCashService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly deposits: StoreCashDepositsService,
  ) {}

  /** One page of entries, newest first, plus the totals of the whole ledger (not of the page). */
  async list(tenantId: string, q: z.infer<typeof StoreCashQuery>) {
    const e = storeCashEntries;
    const where = eq(e.tenantId, tenantId);
    const sum = (direction: 'in' | 'out') =>
      sql<string>`coalesce(sum(${e.amount}) filter (where ${e.direction} = ${direction}), 0)`;
    const [data, [totals], collectors] = await Promise.all([
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
      this.deposits.collectors(tenantId),
    ]);
    const cashIn = Number(totals.cashIn);
    const cashOut = Number(totals.cashOut);
    return {
      data,
      total: totals.total,
      page: q.page,
      perPage: q.perPage,
      // A `transfer` (a collector's deposit into the safe) is neither in nor out: the balance stays.
      summary: {
        cashIn,
        cashOut,
        balance: cashIn - cashOut,
        // Of the balance: still with the collectors, and already handed over to the safe.
        outstanding: collectors.reduce((a, c) => a + c.outstanding, 0),
        handedOver: collectors.reduce((a, c) => a + c.handedOver, 0),
      },
      // Per collector: taken outside a shift, handed over, still outstanding (UMK-1924 U3).
      collectors,
    };
  }
}

@Controller('store-cash')
export class StoreCashController {
  constructor(
    private readonly storeCash: StoreCashService,
    private readonly deposits: StoreCashDepositsService,
  ) {}

  // The store's money position is a report: `reports.view`, not `receivables.manage` (a collector sees
  // their own collections on the receivable, not what the whole store holds).
  @Get()
  @RequirePermission('reports.view')
  list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.storeCash.list(s.tenantId, validate(StoreCashQuery, query));
  }

  /** What each collector still holds: the list the receiver of a handover picks from. */
  @Get('collectors')
  @RequirePermission('store_cash.manage')
  async collectors(@CurrentSession() s: PosSession) {
    return { data: await this.deposits.collectors(s.tenantId) };
  }

  /** The handover audit: who handed over, who received, how much. */
  @Get('deposits')
  @RequirePermission('reports.view')
  listDeposits(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.deposits.list(s.tenantId, validate(DepositListQuery, query));
  }

  /** The actor receives a collector's outside-shift cash into the store safe (UMK-1924 U3). */
  @Post('deposits')
  @RequirePermission('store_cash.manage')
  deposit(
    @CurrentSession() s: PosSession,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { idempotencyKey } = validate(
      z.object({ idempotencyKey: IdempotencyKey }),
      { idempotencyKey: key },
    );
    return this.deposits.create(
      s,
      idempotencyKey,
      validate(DepositInput, body),
    );
  }
}

@Module({
  controllers: [StoreCashController],
  providers: [StoreCashService, StoreCashDepositsService],
})
export class StoreCashModule {}
