import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Headers,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  fieldError,
  formatRupiah,
  Paging,
  Rupiah,
  UuidField,
  validate,
} from '../common/validation';
import { IdempotencyKey } from '../sales/sales.schemas';
import { type Db, InjectDb } from '../db/db.module';
import {
  members,
  paymentMethods,
  receivablePayments,
  receivables,
  saleLines,
  sales,
} from '../db/schema';
import { isUniqueViolation, parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import type { Tx } from '../stock/stock.service';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

const PaymentInput = z
  .object({
    amount: Rupiah.positive('Harus lebih dari 0'),
    paymentMethodId: UuidField.optional(), // default: the store's Tunai
  })
  .strict();
type PaymentInput = z.infer<typeof PaymentInput>;

const ReceivableQuery = z.object({
  status: z.enum(['open', 'settled']).optional(),
  memberId: UuidField.optional(),
  // Member name, or a sale number ("12" or "#12").
  q: z.string().trim().max(60).optional(),
  ...Paging,
});

/** Same key + same request → the first result; same key + another request → refused. */
const requestHash = (receivableId: string, input: PaymentInput) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        receivableId,
        input.amount,
        input.paymentMethodId ?? null,
      ]),
    )
    .digest('hex');

const columns = {
  id: receivables.id,
  saleId: receivables.saleId,
  saleNumber: sales.number,
  memberId: receivables.memberId,
  memberName: members.name,
  total: receivables.total,
  rest: receivables.rest,
  dueDate: receivables.dueDate,
  lastPaymentAt: receivables.lastPaymentAt,
  createdAt: receivables.createdAt,
};

/**
 * A credit sale's receivable, inside the sale's transaction. Totals come from the server-computed
 * sale (Lakasir flaw 7 divided client prices); a down payment is recorded as the first payment.
 */
export async function createReceivable(
  tx: Tx,
  s: PosSession,
  sale: {
    id: string;
    memberId: string;
    total: number;
    paid: number;
    cashMethodId: string;
  },
) {
  const [r] = await tx
    .insert(receivables)
    .values({
      tenantId: s.tenantId,
      saleId: sale.id,
      memberId: sale.memberId,
      total: sale.total,
      rest: sale.total - sale.paid,
      // Lakasir's default: two weeks after the sale (store day, Asia/Jakarta).
      dueDate: sql`((now() at time zone 'Asia/Jakarta')::date + 14)`,
      lastPaymentAt: sale.paid > 0 ? new Date() : null,
    })
    .returning({ id: receivables.id });
  if (sale.paid > 0)
    await tx.insert(receivablePayments).values({
      tenantId: s.tenantId,
      receivableId: r.id,
      amount: sale.paid,
      paymentMethodId: sale.cashMethodId,
      restBefore: sale.total,
      actorId: s.actorId,
      actorKind: s.kind,
    });
}

/** Receivables (Lakasir ReceivableResource + ReceivablePaymentService), append-only payments. */
@Injectable()
export class ReceivablesService {
  constructor(@InjectDb() private readonly db: Db) {}

  private base() {
    return this.db
      .select(columns)
      .from(receivables)
      .innerJoin(sales, eq(sales.id, receivables.saleId))
      .innerJoin(members, eq(members.id, receivables.memberId));
  }

  /**
   * One page of receivables plus Lakasir's StatsReceivable: what is still owed over the search (any status),
   * so the summary does not change with the page or the open/settled tab.
   */
  async list(tenantId: string, q: z.infer<typeof ReceivableQuery>) {
    const number =
      q.q && /^#?\d{1,9}$/.test(q.q) ? Number(q.q.replace('#', '')) : null;
    const search = and(
      eq(receivables.tenantId, tenantId),
      q.memberId ? eq(receivables.memberId, q.memberId) : undefined,
      q.q
        ? or(
            ilike(
              members.name,
              `%${q.q.replace(/[\\%_]/g, (c: string) => `\\${c}`)}%`,
            ),
            number !== null ? eq(sales.number, number) : undefined,
          )
        : undefined,
    );
    const where = and(
      search,
      q.status === 'open' ? gt(receivables.rest, 0) : undefined,
      q.status === 'settled' ? eq(receivables.rest, 0) : undefined,
    );
    const [data, [{ total }], [summary]] = await Promise.all([
      this.base()
        .where(where)
        .orderBy(desc(receivables.createdAt), desc(receivables.id))
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db
        .select({ total: count() })
        .from(receivables)
        .innerJoin(sales, eq(sales.id, receivables.saleId))
        .innerJoin(members, eq(members.id, receivables.memberId))
        .where(where),
      this.db
        .select({
          openRest: sql<string>`coalesce(sum(${receivables.rest}), 0)`,
          openCount: count(),
        })
        .from(receivables)
        .innerJoin(sales, eq(sales.id, receivables.saleId))
        .innerJoin(members, eq(members.id, receivables.memberId))
        .where(and(search, gt(receivables.rest, 0))),
    ]);
    return {
      data,
      total,
      page: q.page,
      perPage: q.perPage,
      summary: {
        openRest: Number(summary.openRest),
        openCount: summary.openCount,
      },
    };
  }

  async get(tenantId: string, id: string) {
    const [row] = await this.base().where(
      and(eq(receivables.tenantId, tenantId), eq(receivables.id, id)),
    );
    if (!row) throw new NotFoundException();
    const [lines, payments] = await Promise.all([
      this.db
        .select({
          productId: saleLines.productId,
          name: saleLines.name,
          qty: saleLines.qty,
          unitPrice: saleLines.unitPrice,
          lineTotal: saleLines.lineTotal,
        })
        .from(saleLines)
        .where(
          and(
            eq(saleLines.tenantId, tenantId),
            eq(saleLines.saleId, row.saleId),
          ),
        )
        .orderBy(asc(saleLines.name)),
      this.db
        .select({
          id: receivablePayments.id,
          amount: receivablePayments.amount,
          restBefore: receivablePayments.restBefore,
          paymentMethod: paymentMethods.name,
          actorKind: receivablePayments.actorKind,
          createdAt: receivablePayments.createdAt,
        })
        .from(receivablePayments)
        .innerJoin(
          paymentMethods,
          eq(paymentMethods.id, receivablePayments.paymentMethodId),
        )
        .where(
          and(
            eq(receivablePayments.tenantId, tenantId),
            eq(receivablePayments.receivableId, id),
          ),
        )
        .orderBy(asc(receivablePayments.createdAt)),
    ]);
    return { ...row, lines, payments };
  }

  async pay(s: PosSession, id: string, key: string, input: PaymentInput) {
    const hash = requestHash(id, input);
    await this.db
      .transaction(async (tx) => {
        // Row lock: two payments on one receivable apply one after the other.
        const [r] = await tx
          .select({ rest: receivables.rest })
          .from(receivables)
          .where(
            and(eq(receivables.tenantId, s.tenantId), eq(receivables.id, id)),
          )
          .for('update');
        if (!r) throw new NotFoundException();
        // A retry (double tap, network replay) under the lock finds the first payment and changes nothing.
        const [prior] = await tx
          .select({ hash: receivablePayments.requestHash })
          .from(receivablePayments)
          .where(
            and(
              eq(receivablePayments.tenantId, s.tenantId),
              eq(receivablePayments.idempotencyKey, key),
            ),
          );
        if (prior) {
          if (prior.hash !== hash)
            throw fieldError(
              'idempotencyKey',
              'Kunci ini sudah dipakai untuk pembayaran lain',
            );
          return;
        }
        if (r.rest === 0) throw fieldError('amount', 'Piutang sudah lunas');
        if (input.amount > r.rest)
          throw fieldError(
            'amount',
            `Pembayaran melebihi sisa piutang (${formatRupiah(r.rest)})`,
          );
        const methodId = await this.method(
          tx,
          s.tenantId,
          input.paymentMethodId,
        );
        await tx.insert(receivablePayments).values({
          tenantId: s.tenantId,
          receivableId: id,
          amount: input.amount,
          paymentMethodId: methodId,
          restBefore: r.rest,
          actorId: s.actorId,
          actorKind: s.kind,
          idempotencyKey: key,
          requestHash: hash,
        });
        await tx
          .update(receivables)
          .set({ rest: r.rest - input.amount, lastPaymentAt: new Date() })
          .where(eq(receivables.id, id));
      })
      .catch((e: unknown) => {
        // The same key on another receivable (no shared row lock): the unique index refuses it.
        if (isUniqueViolation(e))
          throw fieldError(
            'idempotencyKey',
            'Kunci ini sudah dipakai untuk pembayaran lain',
          );
        throw e;
      });
    return this.get(s.tenantId, id);
  }

  /** A live, non-credit method of this store (a kasbon is not paid with another kasbon). */
  private async method(tx: Tx, tenantId: string, id?: string) {
    if (!id)
      await tx
        .insert(paymentMethods)
        .values({ tenantId, name: 'Tunai', isCash: true })
        .onConflictDoNothing();
    const [m] = await tx
      .select({ id: paymentMethods.id, isCredit: paymentMethods.isCredit })
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.tenantId, tenantId),
          isNull(paymentMethods.deletedAt),
          id ? eq(paymentMethods.id, id) : eq(paymentMethods.name, 'Tunai'),
        ),
      );
    if (!m)
      throw fieldError('paymentMethodId', 'Metode pembayaran tidak ditemukan');
    if (m.isCredit)
      throw fieldError(
        'paymentMethodId',
        'Piutang tidak dapat dibayar dengan kasbon',
      );
    return m.id;
  }
}

@Controller('receivables')
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get()
  @RequirePermission('receivables.manage')
  async list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.receivables.list(s.tenantId, validate(ReceivableQuery, query));
  }

  @Get(':id')
  @RequirePermission('receivables.manage')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.receivables.get(s.tenantId, parseId(id));
  }

  @Post(':id/payments')
  @RequirePermission('receivables.manage')
  pay(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { idempotencyKey } = validate(
      z.object({ idempotencyKey: IdempotencyKey }),
      { idempotencyKey: key },
    );
    return this.receivables.pay(
      s,
      parseId(id),
      idempotencyKey,
      validate(PaymentInput, body),
    );
  }
}

@Module({
  controllers: [ReceivablesController],
  providers: [ReceivablesService],
})
export class ReceivablesModule {}
