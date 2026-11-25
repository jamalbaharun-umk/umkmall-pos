import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { loadEnv } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  paymentMethods,
  receivablePayments,
  receivables,
  sales,
  saleVoids,
} from '../db/schema';
import { StockService, type Tx } from '../stock/stock.service';
import { restoreVoucher } from '../vouchers/vouchers.controller';
import {
  type Payment,
  PaymentApiError,
  paymentMethodCode,
  PaymentsClient,
} from './payments.client';

/** How an actor or an approver is named to payment-api: `owner:<id>` or `cashier:<id>`. */
export const actorRef = (kind: string, id: string) => `${kind}:${id}`;

/** A payment that will never become `paid`: the sale it was for is cancelled. */
const CLOSED_UNPAID = new Set([
  'failed',
  'expired',
  'cancelled',
  'voided',
  'refund_pending',
  'refunded',
  'refund_failed',
]);

const SWEEP_LIMIT = 100;

export type SaleOutcome =
  'completed' | 'void' | 'awaiting_payment' | 'cancelled' | 'not_found';

export type TickResult = {
  completed: number;
  cancelled: number;
  recorded: number;
  voided: number;
  failed: number;
};

/**
 * Keeps pos-api and payment-api in step (UMK-1991): step 2 of a sale, the record of each kasbon payment, the
 * void of a voided sale's payments, and the job that repeats whatever a request could not finish.
 *
 * Each unit of work is one transaction holding the row lock of the pos row it is about (the sale, the kasbon
 * payment, the void) for the whole call to payment-api. So a request and the job take turns on a row, the
 * second finds the work done, and a sale is completed or cancelled exactly once. Every call to payment-api is
 * idempotent there (charge by key, void by state), so repeating one is always safe.
 *
 * The tenant id given to the client is the session's (from the caller) or the one on the locked pos row.
 */
@Injectable()
export class PaymentSync implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentSync.name);
  private readonly afterMs: number;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly client: PaymentsClient,
    private readonly stock: StockService,
  ) {
    const env = loadEnv();
    this.afterMs = env.POS_PAYMENT_RECONCILE_AFTER_SECONDS * 1000;
    this.intervalMs = env.POS_PAYMENT_RECONCILE_INTERVAL_SECONDS * 1000;
  }

  /** False when PAYMENT_API_URL is unset: nothing is sent and sales complete in one step. */
  get enabled(): boolean {
    return this.client.enabled;
  }

  onModuleInit() {
    if (!this.enabled || this.intervalMs === 0) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Step 2 of a sale. `charge` (the cashier's request, first or repeated): asks payment-api to charge.
   * `reconcile` (the job): only looks the payment up, and cancels a sale whose charge never arrived once it
   * has waited `afterMs`. Returns the sale's status afterwards. Throws PaymentApiError when payment-api gave
   * no usable answer: nothing has changed then.
   */
  async settleSale(
    tenantId: string,
    saleId: string,
    mode: 'charge' | 'reconcile',
    now: Date = new Date(),
  ): Promise<SaleOutcome> {
    return this.db.transaction(async (tx) => {
      const [sale] = await tx
        .select({
          status: sales.status,
          total: sales.total,
          rounding: sales.rounding,
          actorId: sales.actorId,
          actorKind: sales.actorKind,
          voucherId: sales.voucherId,
          paymentMethodId: sales.paymentMethodId,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
        .for('update');
      if (!sale) return 'not_found';
      // Completed, voided or cancelled already: nothing is asked and nothing moves (M16).
      if (sale.status !== 'awaiting_payment' || !this.enabled)
        return sale.status;

      const [method] = await tx
        .select({
          isCash: paymentMethods.isCash,
          isDebit: paymentMethods.isDebit,
          isWallet: paymentMethods.isWallet,
        })
        .from(paymentMethods)
        .where(
          and(
            eq(paymentMethods.tenantId, tenantId),
            eq(paymentMethods.id, sale.paymentMethodId),
          ),
        );
      const code = paymentMethodCode(method);
      if (!code) throw new Error('awaiting sale without a payment method kind');
      // What the customer owes: a cash total is rounded up to Rp100 (UMK-1993), `rounding` is 0 otherwise.
      const amount = sale.total + sale.rounding;

      let payment: Payment | null;
      if (mode === 'charge') {
        payment = await this.client.charge(tenantId, {
          orderRef: saleId,
          attempt: 1,
          method: code,
          amount,
          actorRef: actorRef(sale.actorKind, sale.actorId),
        });
      } else {
        payment = await this.client.findByKey(tenantId, `${saleId}:1`);
        // Too young to judge: a charge of ours may still be on its way.
        if (!payment && now.getTime() - sale.createdAt.getTime() < this.afterMs)
          return 'awaiting_payment';
      }

      if (payment?.status === 'paid') {
        if (payment.amount !== amount || payment.orderRef !== saleId)
          throw new PaymentApiError('unavailable', null, 'payment_mismatch');
        await tx
          .update(sales)
          .set({ status: 'completed', paymentId: payment.id })
          .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)));
        return 'completed';
      }
      // Not built: a PG payment still open. It stays awaiting until payment-api closes or pays it.
      if (payment && !CLOSED_UNPAID.has(payment.status))
        return 'awaiting_payment';

      // No payment after the waiting time, or one that closed unpaid: what the sale took goes back.
      if (sale.voucherId) await restoreVoucher(tx, tenantId, sale.voucherId);
      await this.stock.restoreSale(tx, {
        tenantId,
        saleId,
        actorId: sale.actorId,
      });
      await tx
        .update(sales)
        .set({
          status: 'cancelled',
          cancelledAt: sql`now()`,
          paymentId: payment?.id ?? null,
        })
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)));
      return 'cancelled';
    });
  }

  /**
   * Records one kasbon payment (down payment or instalment) in payment-api, order reference
   * `<receivableId>:<seq>`. Called after the pos transaction committed; a failure leaves `payment_id` null
   * for the job. True when the payment is recorded (now or before).
   */
  async recordReceivablePayment(
    tenantId: string,
    paymentId: string,
  ): Promise<boolean> {
    if (!this.enabled) return false;
    return this.db.transaction((tx) =>
      this.recordReceivablePaymentIn(tx, tenantId, paymentId).then(
        (id) => id !== null,
      ),
    );
  }

  /** Returns the payment-api payment id; null for a payment taken while payment-api was off (no `seq`). */
  private async recordReceivablePaymentIn(
    tx: Tx,
    tenantId: string,
    paymentId: string,
  ): Promise<string | null> {
    const [p] = await tx
      .select({
        receivableId: receivablePayments.receivableId,
        seq: receivablePayments.seq,
        amount: receivablePayments.amount,
        actorId: receivablePayments.actorId,
        actorKind: receivablePayments.actorKind,
        paymentMethodId: receivablePayments.paymentMethodId,
        paymentId: receivablePayments.paymentId,
      })
      .from(receivablePayments)
      .where(
        and(
          eq(receivablePayments.tenantId, tenantId),
          eq(receivablePayments.id, paymentId),
        ),
      )
      .for('update');
    if (!p || p.seq === null) return null;
    if (p.paymentId) return p.paymentId;
    const [method] = await tx
      .select({
        isCash: paymentMethods.isCash,
        isDebit: paymentMethods.isDebit,
        isWallet: paymentMethods.isWallet,
      })
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.tenantId, tenantId),
          eq(paymentMethods.id, p.paymentMethodId),
        ),
      );
    const code = paymentMethodCode(method);
    if (!code) throw new Error('kasbon payment without a payment method kind');
    const payment = await this.client.charge(tenantId, {
      orderRef: `${p.receivableId}:${p.seq}`,
      attempt: 1,
      method: code,
      amount: p.amount,
      actorRef: actorRef(p.actorKind, p.actorId),
    });
    // `voided`: recorded and voided before (a void's retry). Anything else is not a CASHAC answer.
    if (
      (payment.status !== 'paid' && payment.status !== 'voided') ||
      payment.amount !== p.amount
    )
      throw new PaymentApiError('unavailable', null, 'payment_mismatch');
    await tx
      .update(receivablePayments)
      .set({ paymentId: payment.id })
      .where(
        and(
          eq(receivablePayments.tenantId, tenantId),
          eq(receivablePayments.id, paymentId),
        ),
      );
    return payment.id;
  }

  /**
   * Voids, in payment-api, every payment of a sale that pos-api has voided: the sale's own payment, or each
   * kasbon payment (recording first one that was not recorded yet). The reason, the actor and the approver
   * are the void's own; the approver's PIN was verified by the void. True when nothing is left to do.
   */
  async syncVoid(tenantId: string, voidId: string): Promise<boolean> {
    if (!this.enabled) return false;
    return this.db.transaction(async (tx) => {
      const [v] = await tx
        .select({
          saleId: saleVoids.saleId,
          reasonCode: saleVoids.reasonCode,
          note: saleVoids.note,
          actorId: saleVoids.actorId,
          actorKind: saleVoids.actorKind,
          approvedBy: saleVoids.approvedBy,
          approvedByKind: saleVoids.approvedByKind,
          pending: saleVoids.paymentSyncPending,
        })
        .from(saleVoids)
        .where(and(eq(saleVoids.tenantId, tenantId), eq(saleVoids.id, voidId)))
        .for('update');
      if (!v) return false;
      if (!v.pending) return true;

      const [sale] = await tx
        .select({ paymentId: sales.paymentId })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, v.saleId)));
      const ids: string[] = sale?.paymentId ? [sale.paymentId] : [];
      const kasbon = await tx
        .select({ id: receivablePayments.id })
        .from(receivablePayments)
        .innerJoin(
          receivables,
          and(
            eq(receivables.tenantId, receivablePayments.tenantId),
            eq(receivables.id, receivablePayments.receivableId),
          ),
        )
        .where(
          and(
            eq(receivablePayments.tenantId, tenantId),
            eq(receivables.saleId, v.saleId),
            isNotNull(receivablePayments.seq),
          ),
        )
        .orderBy(asc(receivablePayments.seq));
      for (const k of kasbon) {
        const id = await this.recordReceivablePaymentIn(tx, tenantId, k.id);
        if (id) ids.push(id);
      }
      for (const id of ids) {
        const payment = await this.client.void(tenantId, id, {
          reasonCode: v.reasonCode,
          note: v.note ?? undefined,
          actorRef: actorRef(v.actorKind, v.actorId),
          approvedBy: actorRef(v.approvedByKind, v.approvedBy),
        });
        if (payment.status !== 'voided')
          throw new PaymentApiError('unavailable', null, 'payment_mismatch');
      }
      await tx
        .update(saleVoids)
        .set({ paymentSyncPending: false })
        .where(and(eq(saleVoids.tenantId, tenantId), eq(saleVoids.id, voidId)));
      return true;
    });
  }

  /** After a commit, in a request: try once, and leave a failure to the job. Never throws. */
  async afterCommit(what: string, work: () => Promise<unknown>): Promise<void> {
    if (!this.enabled) return;
    try {
      await work();
    } catch (error) {
      this.logger.warn(`${what} left for the job: ${(error as Error).name}`);
    }
  }

  /**
   * The job. A system sweep across stores (like the purge): it reads only ids and tenant ids, and each row is
   * then handled under its own tenant id. `now` is a parameter so a test need not wait.
   */
  async tick(now: Date = new Date()): Promise<TickResult> {
    const result: TickResult = {
      completed: 0,
      cancelled: 0,
      recorded: 0,
      voided: 0,
      failed: 0,
    };
    if (!this.enabled || this.running) return result;
    this.running = true;
    try {
      const attempt = async (what: string, work: () => Promise<void>) => {
        try {
          await work();
        } catch (error) {
          result.failed += 1;
          const e = error as PaymentApiError;
          this.logger.warn(
            `${what}: ${e.name}${e.code ? ` ${e.code}` : ''}${e.status ? ` (${e.status})` : ''}`,
          );
        }
      };

      const waiting = await this.db
        .select({ id: sales.id, tenantId: sales.tenantId })
        .from(sales)
        .where(
          and(
            eq(sales.status, 'awaiting_payment'),
            lt(sales.createdAt, new Date(now.getTime() - this.afterMs)),
          ),
        )
        .orderBy(asc(sales.createdAt))
        .limit(SWEEP_LIMIT);
      for (const s of waiting)
        await attempt('sale awaiting payment', async () => {
          const outcome = await this.settleSale(
            s.tenantId,
            s.id,
            'reconcile',
            now,
          );
          if (outcome === 'completed') result.completed += 1;
          if (outcome === 'cancelled') result.cancelled += 1;
        });

      const unrecorded = await this.db
        .select({
          id: receivablePayments.id,
          tenantId: receivablePayments.tenantId,
        })
        .from(receivablePayments)
        .where(
          and(
            isNotNull(receivablePayments.seq),
            isNull(receivablePayments.paymentId),
          ),
        )
        .orderBy(asc(receivablePayments.createdAt))
        .limit(SWEEP_LIMIT);
      for (const p of unrecorded)
        await attempt('kasbon payment', async () => {
          if (await this.recordReceivablePayment(p.tenantId, p.id))
            result.recorded += 1;
        });

      const voids = await this.db
        .select({ id: saleVoids.id, tenantId: saleVoids.tenantId })
        .from(saleVoids)
        .where(eq(saleVoids.paymentSyncPending, true))
        .orderBy(asc(saleVoids.createdAt))
        .limit(SWEEP_LIMIT);
      for (const v of voids)
        await attempt('void', async () => {
          if (await this.syncVoid(v.tenantId, v.id)) result.voided += 1;
        });
    } finally {
      this.running = false;
    }
    return result;
  }
}
