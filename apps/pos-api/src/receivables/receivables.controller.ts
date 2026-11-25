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
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import {
  fieldError,
  formatRupiah,
  Paging,
  Rupiah,
  UuidField,
  validate,
} from '../common/validation';
import { storeToday } from '../common/store-day';
import { IdempotencyKey } from '../sales/sales.schemas';
import { type Db, InjectDb } from '../db/db.module';
import {
  members,
  paymentMethods,
  receivablePayments,
  receivables,
  saleLines,
  sales,
  shiftCashEntries,
  staff,
} from '../db/schema';
import { isUniqueViolation, parseId } from '../staff/http';
import { hasPermission, RequirePermission } from '../staff/require-permission';
import { PaymentSync } from '../payments-client/payment-sync.service';
import { recordShiftCashIfOpen } from '../shifts/cash-ledger';
import type { Tx } from '../stock/stock.service';
import { recordStoreCash } from '../store-cash/store-cash-ledger';
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
  // `settled` = paid in full; `cancelled` = its sale was voided (UMK-1962).
  status: z.enum(['open', 'settled', 'cancelled']).optional(),
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

/**
 * Cash instalments of the receivable that were taken while the collector had no open shift (UMK-1963):
 * money that is in no shift's expected cash, so it is shown as its own amount.
 */
const outsideShiftCollected = sql<string>`(
  select coalesce(sum(${receivablePayments.amount}), 0) from ${receivablePayments}
  where ${receivablePayments.tenantId} = ${receivables.tenantId}
    and ${receivablePayments.receivableId} = ${receivables.id}
    and ${receivablePayments.collectedOutsideShift})`.mapWith(Number);

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
  cancelledAt: receivables.cancelledAt,
  cancelledAmount: receivables.cancelledAmount,
  outsideShiftCollected,
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
    /** UMK-1991: payment-api is on, so the down payment gets its number (`seq` 1) and is recorded there. */
    recordInPaymentApi: boolean;
  },
): Promise<string | null> {
  const [r] = await tx
    .insert(receivables)
    .values({
      tenantId: s.tenantId,
      saleId: sale.id,
      memberId: sale.memberId,
      total: sale.total,
      rest: sale.total - sale.paid,
      // Lakasir's default: two weeks after the sale's day in the store's timezone; a date, no time.
      dueDate: sql`(${storeToday(s.tenantId)} + 14)`,
      lastPaymentAt: sale.paid > 0 ? new Date() : null,
    })
    .returning({ id: receivables.id });
  if (sale.paid === 0) return null;
  const [down] = await tx
    .insert(receivablePayments)
    .values({
      tenantId: s.tenantId,
      receivableId: r.id,
      amount: sale.paid,
      paymentMethodId: sale.cashMethodId,
      restBefore: sale.total,
      actorId: s.actorId,
      actorKind: s.kind,
      seq: sale.recordInPaymentApi ? 1 : null,
    })
    .returning({ id: receivablePayments.id });
  return sale.recordInPaymentApi ? down.id : null;
}

/**
 * Cancels the receivable of a voided kasbon sale, inside the void's transaction (UMK-1962). Takes the
 * receivable's row lock (the one a payment takes), so a payment lands wholly before or is refused after.
 * What was still owed is cancelled; the payments already received are returned for the void to give back.
 */
export async function cancelReceivable(
  tx: Tx,
  tenantId: string,
  saleId: string,
) {
  const [r] = await tx
    .select({ id: receivables.id, rest: receivables.rest })
    .from(receivables)
    .where(
      and(eq(receivables.tenantId, tenantId), eq(receivables.saleId, saleId)),
    )
    .for('update');
  if (!r) return null;
  const payments = await tx
    .select({
      id: receivablePayments.id,
      amount: receivablePayments.amount,
      paymentMethodId: receivablePayments.paymentMethodId,
      isCash: paymentMethods.isCash,
    })
    .from(receivablePayments)
    .innerJoin(
      paymentMethods,
      and(
        eq(paymentMethods.tenantId, receivablePayments.tenantId),
        eq(paymentMethods.id, receivablePayments.paymentMethodId),
      ),
    )
    .where(
      and(
        eq(receivablePayments.tenantId, tenantId),
        eq(receivablePayments.receivableId, r.id),
      ),
    )
    .orderBy(asc(receivablePayments.createdAt), asc(receivablePayments.id));
  await tx
    .update(receivables)
    // now() is the transaction's start time: the same instant as the void's own row.
    .set({ rest: 0, cancelledAt: sql`now()`, cancelledAmount: r.rest })
    .where(and(eq(receivables.tenantId, tenantId), eq(receivables.id, r.id)));
  return { id: r.id, cancelled: r.rest, payments };
}

/** Receivables (Lakasir ReceivableResource + ReceivablePaymentService), append-only payments. */
@Injectable()
export class ReceivablesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly payments: PaymentSync,
  ) {}

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
      q.status === 'settled'
        ? and(eq(receivables.rest, 0), isNull(receivables.cancelledAt))
        : undefined,
      q.status === 'cancelled' ? isNotNull(receivables.cancelledAt) : undefined,
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
          openRest: sql<string>`coalesce(sum(${receivables.rest}) filter (where ${receivables.rest} > 0), 0)`,
          openCount: sql<string>`count(*) filter (where ${receivables.rest} > 0)`,
          outsideShiftCollected: sql<string>`coalesce(sum(${outsideShiftCollected}), 0)`,
        })
        .from(receivables)
        .innerJoin(sales, eq(sales.id, receivables.saleId))
        .innerJoin(members, eq(members.id, receivables.memberId))
        .where(search),
    ]);
    return {
      data,
      total,
      page: q.page,
      perPage: q.perPage,
      summary: {
        openRest: Number(summary.openRest),
        openCount: Number(summary.openCount),
        // Cash taken without an open shift, over the same search: in no shift's expected cash.
        outsideShiftCollected: Number(summary.outsideShiftCollected),
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
          // Who collected it and when; a payment is in one shift's ledger (`shiftId`), or was taken
          // without a shift (`collectedOutsideShift`), or never reached a drawer ledger (down payment,
          // debit, wallet: both empty).
          actorId: receivablePayments.actorId,
          actorKind: receivablePayments.actorKind,
          actorName: sql<string>`case when ${receivablePayments.actorKind} = 'owner' then 'Pemilik'
            else coalesce(${staff.name}, 'Staf') end`,
          collectedOutsideShift: receivablePayments.collectedOutsideShift,
          shiftId: shiftCashEntries.shiftId,
          createdAt: receivablePayments.createdAt,
        })
        .from(receivablePayments)
        .innerJoin(
          paymentMethods,
          eq(paymentMethods.id, receivablePayments.paymentMethodId),
        )
        .leftJoin(
          staff,
          and(
            eq(staff.tenantId, receivablePayments.tenantId),
            eq(staff.id, receivablePayments.actorId),
          ),
        )
        .leftJoin(
          shiftCashEntries,
          and(
            eq(shiftCashEntries.tenantId, receivablePayments.tenantId),
            eq(shiftCashEntries.kind, 'receivable_payment'),
            eq(shiftCashEntries.refId, receivablePayments.id),
          ),
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
    const recorded = await this.db
      .transaction(async (tx): Promise<string | null> => {
        // Row lock: two payments on one receivable apply one after the other.
        const [r] = await tx
          .select({
            rest: receivables.rest,
            cancelledAt: receivables.cancelledAt,
          })
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
          return null;
        }
        if (r.cancelledAt)
          throw fieldError(
            'amount',
            'Piutang ini sudah dibatalkan bersama struknya',
          );
        if (r.rest === 0) throw fieldError('amount', 'Piutang sudah lunas');
        if (input.amount > r.rest)
          throw fieldError(
            'amount',
            `Pembayaran melebihi sisa piutang (${formatRupiah(r.rest)})`,
          );
        const method = await this.method(tx, s.tenantId, input.paymentMethodId);
        // Cash taken while the actor has an open shift goes into that drawer: a ledger entry raises the
        // shift's expected cash (UMK-1963). An actor who can open a shift (`sales.create`; every owner)
        // must open one first. Only an actor who cannot (e.g. `receivables.manage` alone) collects
        // outside a shift (owner ruling 2026-11-24): the payment is marked and the cash goes into the
        // store's cash ledger, so no shift ever counts it. Decided once, here, under the shift's row
        // lock: a cash payment is in a shift's ledger or in the store's, never both, never neither.
        // Debit and wallet money is in none.
        const paymentId = randomUUID();
        // UMK-1991: this payment's number on the receivable, under the receivable's row lock. Its payment
        // in payment-api has the order reference `<receivableId>:<seq>`.
        const [{ next }] = await tx
          .select({
            next: sql<number>`coalesce(max(${receivablePayments.seq}), 0) + 1`.mapWith(
              Number,
            ),
          })
          .from(receivablePayments)
          .where(
            and(
              eq(receivablePayments.tenantId, s.tenantId),
              eq(receivablePayments.receivableId, id),
            ),
          );
        const cashIn = {
          direction: 'in',
          kind: 'receivable_payment',
          amount: input.amount,
          refId: paymentId,
        } as const;
        const shiftId = method.isCash
          ? await recordShiftCashIfOpen(tx, s, cashIn)
          : null;
        const outsideShift = method.isCash && !shiftId;
        if (outsideShift) {
          if (hasPermission(s, 'sales.create'))
            throw fieldError(
              '_',
              'Buka shift dulu sebelum menerima pembayaran tunai',
            );
          await recordStoreCash(tx, s, cashIn);
        }
        await tx.insert(receivablePayments).values({
          id: paymentId,
          tenantId: s.tenantId,
          receivableId: id,
          amount: input.amount,
          paymentMethodId: method.id,
          restBefore: r.rest,
          actorId: s.actorId,
          actorKind: s.kind,
          idempotencyKey: key,
          requestHash: hash,
          collectedOutsideShift: outsideShift,
          seq: this.payments.enabled ? next : null,
        });
        await tx
          .update(receivables)
          .set({ rest: r.rest - input.amount, lastPaymentAt: new Date() })
          .where(eq(receivables.id, id));
        return this.payments.enabled ? paymentId : null;
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
    // The money is taken and committed; its record in payment-api follows (the job repeats a failure).
    if (recorded)
      await this.payments.afterCommit('kasbon payment', () =>
        this.payments.recordReceivablePayment(s.tenantId, recorded),
      );
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
      .select({
        id: paymentMethods.id,
        isCash: paymentMethods.isCash,
        isCredit: paymentMethods.isCredit,
      })
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
    return { id: m.id, isCash: m.isCash };
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
