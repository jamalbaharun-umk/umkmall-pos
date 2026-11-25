import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  sql,
} from 'drizzle-orm';
import { loadEnv } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  type PaymentSyncKind,
  paymentSyncIssues,
  receivablePayments,
  receivables,
  sales,
  saleVoids,
} from '../db/schema';
import { StockService } from '../stock/stock.service';
import { restoreVoucher } from '../vouchers/vouchers.controller';
import {
  type Payment,
  PaymentApiError,
  type PaymentMethodCode,
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

/** Our own refusal, counted and parked like payment-api's: the pos row and the payment do not agree. */
const refused = (code: string) => new PaymentApiError('rejected', null, code);

export type SaleOutcome =
  'completed' | 'void' | 'awaiting_payment' | 'cancelled' | 'not_found';

export type TickResult = {
  completed: number;
  cancelled: number;
  recorded: number;
  voided: number;
  /** Rows payment-api refused (counted towards parking) or that failed here. */
  failed: number;
  /** payment-api gave no answer: the tick stopped there and left the rest for the next one. */
  stopped: boolean;
};

/**
 * Keeps pos-api and payment-api in step (UMK-1991): step 2 of a sale, the record of each kasbon payment, the
 * void of a voided sale's payments, and the job that repeats whatever a request could not finish.
 *
 * **No call to payment-api is made inside a database transaction or under a row lock.** Each unit of work
 * reads its pos row, asks payment-api, and only then writes: for a sale, in a short transaction that locks
 * the sale and applies the answer only if it still awaits payment. Two workers on one row (a request and the
 * job, two instances) are safe because payment-api decides: a charge and a void are idempotent there, and a
 * charge and a close of the same key race on its unique index, so both workers are given the same payment.
 *
 * The tenant id given to the client is the session's (from the caller) or the one on the pos row.
 */
@Injectable()
export class PaymentSync implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentSync.name);
  private readonly afterMs: number;
  private readonly intervalMs: number;
  private readonly maxAttempts: number;
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<TickResult> | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly client: PaymentsClient,
    private readonly stock: StockService,
  ) {
    const env = loadEnv();
    this.afterMs = env.POS_PAYMENT_RECONCILE_AFTER_SECONDS * 1000;
    this.intervalMs = env.POS_PAYMENT_RECONCILE_INTERVAL_SECONDS * 1000;
    this.maxAttempts = env.POS_PAYMENT_SYNC_MAX_ATTEMPTS;
  }

  /** False when PAYMENT_API_URL is unset: nothing is sent and sales complete in one step. */
  get enabled(): boolean {
    return this.client.enabled;
  }

  async onModuleInit() {
    if (!this.enabled) {
      // Turning payment-api off must not strand a sale: an awaiting sale can only be completed or cancelled
      // on payment-api's answer, and it blocks its shift from closing. Refuse to start instead.
      const [{ n }] = await this.db
        .select({ n: count() })
        .from(sales)
        .where(eq(sales.status, 'awaiting_payment'));
      if (n > 0)
        throw new Error(
          `PAYMENT_API_URL is unset but ${n} sale(s) still await payment: set it again until the job has completed or cancelled them`,
        );
      return;
    }
    if (this.intervalMs === 0) return;
    // tick() never rejects; the catch is the last line of defence against an unhandled rejection.
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) =>
        this.logger.error(`tick failed: ${(error as Error).name}`),
      );
    }, this.intervalMs);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Let a running tick finish before the database pool closes.
    await this.current?.catch(() => undefined);
  }

  /**
   * Step 2 of a sale. `charge` (the cashier's request, first or repeated) asks payment-api to charge.
   * `reconcile` (the job) looks the payment up; when there is none and the sale has waited `afterMs`, it
   * asks payment-api to CLOSE the charge key, and cancels the sale only on that answer: a charge of ours
   * that is still on its way then answers the cancelled payment and can never be paid.
   *
   * Returns the sale's status afterwards. Throws PaymentApiError when payment-api gave no usable answer
   * (`unavailable`) or one that does not fit the sale (`rejected`): nothing has changed then.
   */
  async settleSale(
    tenantId: string,
    saleId: string,
    mode: 'charge' | 'reconcile',
    now: Date = new Date(),
  ): Promise<SaleOutcome> {
    const [sale] = await this.db
      .select({
        status: sales.status,
        total: sales.total,
        rounding: sales.rounding,
        actorId: sales.actorId,
        actorKind: sales.actorKind,
        method: sales.paymentMethodCode,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)));
    if (!sale) return 'not_found';
    // Completed, voided or cancelled already: nothing is asked and nothing moves (M16).
    if (sale.status !== 'awaiting_payment' || !this.enabled) return sale.status;
    if (!sale.method) throw refused('no_method_code');

    const charge = {
      orderRef: saleId,
      attempt: 1,
      method: sale.method as PaymentMethodCode,
      // What the customer owes: a cash total is rounded up to Rp100 (UMK-1993), `rounding` is 0 otherwise.
      amount: sale.total + sale.rounding,
      actorRef: actorRef(sale.actorKind, sale.actorId),
    };
    let payment: Payment | null;
    if (mode === 'charge') {
      payment = await this.client.charge(tenantId, charge);
    } else {
      payment = await this.client.findByKey(tenantId, `${saleId}:1`);
      if (!payment) {
        // Give the cashier time to repeat the request before the sale is given up.
        if (now.getTime() - sale.createdAt.getTime() < this.afterMs)
          return 'awaiting_payment';
        payment = await this.client.close(tenantId, charge);
      }
    }
    // Whatever it says, it must be this sale's payment for this amount.
    if (payment.orderRef !== saleId || payment.amount !== charge.amount)
      throw refused('payment_mismatch');
    const to =
      payment.status === 'paid'
        ? 'completed'
        : CLOSED_UNPAID.has(payment.status)
          ? 'cancelled'
          : null;
    // Not built: a PG payment still open. It stays awaiting until payment-api closes or pays it.
    if (!to) return 'awaiting_payment';
    return this.applyToSale(tenantId, saleId, to, payment.id);
  }

  /** The one write of step 2: under the sale's row lock, and only while the sale still awaits payment. */
  private async applyToSale(
    tenantId: string,
    saleId: string,
    to: 'completed' | 'cancelled',
    paymentId: string,
  ): Promise<SaleOutcome> {
    return this.db.transaction(async (tx) => {
      const [sale] = await tx
        .select({
          status: sales.status,
          actorId: sales.actorId,
          voucherId: sales.voucherId,
        })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
        .for('update');
      if (!sale) return 'not_found';
      // Another worker applied the same answer first. A cancelled sale is never completed.
      if (sale.status !== 'awaiting_payment') return sale.status;
      if (to === 'completed') {
        await tx
          .update(sales)
          .set({ status: 'completed', paymentId })
          .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)));
        return 'completed';
      }
      // The payment closed unpaid: what the sale took goes back.
      if (sale.voucherId) await restoreVoucher(tx, tenantId, sale.voucherId);
      await this.stock.restoreSale(tx, {
        tenantId,
        saleId,
        actorId: sale.actorId,
      });
      await tx
        .update(sales)
        .set({ status: 'cancelled', cancelledAt: sql`now()`, paymentId })
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
    return (await this.recordKasbon(tenantId, paymentId)) !== null;
  }

  /** Returns the payment-api payment id; null for a payment taken while payment-api was off (no `seq`). */
  private async recordKasbon(
    tenantId: string,
    id: string,
  ): Promise<string | null> {
    const mine = and(
      eq(receivablePayments.tenantId, tenantId),
      eq(receivablePayments.id, id),
    );
    const [p] = await this.db
      .select({
        receivableId: receivablePayments.receivableId,
        seq: receivablePayments.seq,
        amount: receivablePayments.amount,
        actorId: receivablePayments.actorId,
        actorKind: receivablePayments.actorKind,
        method: receivablePayments.paymentMethodCode,
        paymentId: receivablePayments.paymentId,
      })
      .from(receivablePayments)
      .where(mine);
    if (!p || p.seq === null) return null;
    if (p.paymentId) return p.paymentId;
    if (!p.method) throw refused('no_method_code');
    const orderRef = `${p.receivableId}:${p.seq}`;
    const payment = await this.client.charge(tenantId, {
      orderRef,
      attempt: 1,
      method: p.method as PaymentMethodCode,
      amount: p.amount,
      actorRef: actorRef(p.actorKind, p.actorId),
    });
    // `voided`: recorded and voided before (a void's retry). Anything else is not a CASHAC answer.
    if (
      (payment.status !== 'paid' && payment.status !== 'voided') ||
      payment.amount !== p.amount ||
      payment.orderRef !== orderRef
    )
      throw refused('payment_mismatch');
    // Two workers get the same payment for the same key, so the second write changes nothing.
    await this.db
      .update(receivablePayments)
      .set({ paymentId: payment.id })
      .where(and(mine, isNull(receivablePayments.paymentId)));
    return payment.id;
  }

  /**
   * Voids, in payment-api, every payment of a sale that pos-api has voided: the sale's own payment, or each
   * kasbon payment (recording first one that was not recorded yet). The reason, the actor and the approver
   * are the void's own; the approver's PIN was verified by the void. True when nothing is left to do.
   */
  async syncVoid(tenantId: string, voidId: string): Promise<boolean> {
    if (!this.enabled) return false;
    const mine = and(
      eq(saleVoids.tenantId, tenantId),
      eq(saleVoids.id, voidId),
    );
    const [v] = await this.db
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
      .where(mine);
    if (!v) return false;
    if (!v.pending) return true;

    const [sale] = await this.db
      .select({ paymentId: sales.paymentId })
      .from(sales)
      .where(and(eq(sales.tenantId, tenantId), eq(sales.id, v.saleId)));
    const ids: string[] = sale?.paymentId ? [sale.paymentId] : [];
    const kasbon = await this.db
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
      const id = await this.recordKasbon(tenantId, k.id);
      if (id) ids.push(id);
    }
    for (const id of ids) {
      // Idempotent at payment-api: a payment already voided is answered unchanged.
      const payment = await this.client.void(tenantId, id, {
        reasonCode: v.reasonCode,
        note: v.note ?? undefined,
        actorRef: actorRef(v.actorKind, v.actorId),
        approvedBy: actorRef(v.approvedByKind, v.approvedBy),
      });
      if (payment.status !== 'voided') throw refused('payment_mismatch');
    }
    await this.db
      .update(saleVoids)
      .set({ paymentSyncPending: false })
      .where(mine);
    return true;
  }

  /** After a commit, in a request: try once, and leave a failure to the job. Never throws. */
  async afterCommit(
    kind: PaymentSyncKind,
    id: string,
    work: () => Promise<unknown>,
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      await work();
    } catch (error) {
      this.logger.warn(`${kind} ${id} left for the job: ${describe(error)}`);
    }
  }

  /**
   * The job. A system sweep across stores (like the purge): it reads only ids and tenant ids, and each row is
   * then handled under its own tenant id. Never rejects. Stops at the first answer that says payment-api is
   * unreachable (the rest would only wait for the same timeout), and skips parked rows. `now` is a parameter
   * so a test need not wait.
   */
  tick(now: Date = new Date()): Promise<TickResult> {
    // One at a time in this process; a second caller gets the running tick's result.
    this.current ??= this.sweep(now)
      .catch((error: unknown): TickResult => {
        this.logger.error(`tick failed: ${describe(error)}`);
        return { ...EMPTY, failed: 1 };
      })
      .finally(() => {
        this.current = null;
      });
    return this.current;
  }

  private async sweep(now: Date): Promise<TickResult> {
    const result: TickResult = { ...EMPTY };
    if (!this.enabled) return result;
    const notParked = (
      kind: PaymentSyncKind,
      refId: unknown,
    ) => sql`not exists (
      select 1 from ${paymentSyncIssues}
      where ${paymentSyncIssues.kind} = ${kind} and ${paymentSyncIssues.refId} = ${refId}
        and ${paymentSyncIssues.parkedAt} is not null)`;
    type Row = { id: string; tenantId: string };
    const sweeps: {
      kind: PaymentSyncKind;
      rows: () => Promise<Row[]>;
      work: (row: Row) => Promise<void>;
    }[] = [
      {
        kind: 'sale',
        rows: () =>
          this.db
            .select({ id: sales.id, tenantId: sales.tenantId })
            .from(sales)
            .where(
              and(
                eq(sales.status, 'awaiting_payment'),
                lt(sales.createdAt, new Date(now.getTime() - this.afterMs)),
                notParked('sale', sales.id),
              ),
            )
            .orderBy(asc(sales.createdAt))
            .limit(SWEEP_LIMIT),
        work: async (row) => {
          const to = await this.settleSale(
            row.tenantId,
            row.id,
            'reconcile',
            now,
          );
          if (to === 'completed') result.completed += 1;
          if (to === 'cancelled') result.cancelled += 1;
        },
      },
      {
        kind: 'receivable_payment',
        rows: () =>
          this.db
            .select({
              id: receivablePayments.id,
              tenantId: receivablePayments.tenantId,
            })
            .from(receivablePayments)
            .where(
              and(
                isNotNull(receivablePayments.seq),
                isNull(receivablePayments.paymentId),
                notParked('receivable_payment', receivablePayments.id),
              ),
            )
            .orderBy(asc(receivablePayments.createdAt))
            .limit(SWEEP_LIMIT),
        work: async (row) => {
          if (await this.recordReceivablePayment(row.tenantId, row.id))
            result.recorded += 1;
        },
      },
      {
        kind: 'void',
        rows: () =>
          this.db
            .select({ id: saleVoids.id, tenantId: saleVoids.tenantId })
            .from(saleVoids)
            .where(
              and(
                eq(saleVoids.paymentSyncPending, true),
                notParked('void', saleVoids.id),
              ),
            )
            .orderBy(asc(saleVoids.createdAt))
            .limit(SWEEP_LIMIT),
        work: async (row) => {
          if (await this.syncVoid(row.tenantId, row.id)) result.voided += 1;
        },
      },
    ];

    for (const sweep of sweeps) {
      let rows: Row[];
      try {
        rows = await sweep.rows();
      } catch (error) {
        // Our own database: nothing to do but try again next tick.
        result.failed += 1;
        this.logger.error(`${sweep.kind} sweep failed: ${describe(error)}`);
        continue;
      }
      for (const row of rows) {
        try {
          await sweep.work(row);
          await this.clearIssue(row.tenantId, sweep.kind, row.id);
        } catch (error) {
          if (
            error instanceof PaymentApiError &&
            error.kind === 'unavailable'
          ) {
            this.logger.warn(
              `${sweep.kind} ${row.id}: ${describe(error)}; tick stopped`,
            );
            result.stopped = true;
            return result;
          }
          result.failed += 1;
          if (error instanceof PaymentApiError)
            await this.countRefusal(row, sweep.kind, error).catch(
              (e: unknown) =>
                this.logger.error(`${sweep.kind} ${row.id}: ${describe(e)}`),
            );
          else this.logger.error(`${sweep.kind} ${row.id}: ${describe(error)}`);
        }
      }
    }
    return result;
  }

  /** One more refusal for this row; parked (no longer swept) once it has `maxAttempts`. */
  private async countRefusal(
    row: { id: string; tenantId: string },
    kind: PaymentSyncKind,
    error: PaymentApiError,
  ) {
    const lastError = error.code ?? `http_${error.status ?? 'error'}`;
    const [issue] = await this.db
      .insert(paymentSyncIssues)
      .values({
        tenantId: row.tenantId,
        kind,
        refId: row.id,
        attempts: 1,
        lastError,
        parkedAt: this.maxAttempts <= 1 ? sql`now()` : null,
      })
      .onConflictDoUpdate({
        target: [
          paymentSyncIssues.tenantId,
          paymentSyncIssues.kind,
          paymentSyncIssues.refId,
        ],
        set: {
          attempts: sql`${paymentSyncIssues.attempts} + 1`,
          lastError,
          updatedAt: sql`now()`,
          parkedAt: sql`case when ${paymentSyncIssues.attempts} + 1 >= ${this.maxAttempts}
            then now() else null end`,
        },
      })
      .returning({
        attempts: paymentSyncIssues.attempts,
        parkedAt: paymentSyncIssues.parkedAt,
      });
    // The row's id, the code and the count. Never a key, a header or a body.
    if (issue.parkedAt)
      this.logger.error(
        `${kind} ${row.id} PARKED after ${issue.attempts} refusals: ${lastError}`,
      );
    else
      this.logger.warn(
        `${kind} ${row.id} refused (${issue.attempts}/${this.maxAttempts}): ${lastError}`,
      );
  }

  private async clearIssue(
    tenantId: string,
    kind: PaymentSyncKind,
    id: string,
  ) {
    await this.db
      .delete(paymentSyncIssues)
      .where(
        and(
          eq(paymentSyncIssues.tenantId, tenantId),
          eq(paymentSyncIssues.kind, kind),
          eq(paymentSyncIssues.refId, id),
        ),
      );
  }

  /** The store's rows payment-api keeps refusing, parked ones first. */
  async issues(tenantId: string) {
    return this.db
      .select({
        id: paymentSyncIssues.id,
        kind: paymentSyncIssues.kind,
        refId: paymentSyncIssues.refId,
        attempts: paymentSyncIssues.attempts,
        lastError: paymentSyncIssues.lastError,
        parkedAt: paymentSyncIssues.parkedAt,
        createdAt: paymentSyncIssues.createdAt,
        updatedAt: paymentSyncIssues.updatedAt,
      })
      .from(paymentSyncIssues)
      .where(eq(paymentSyncIssues.tenantId, tenantId))
      .orderBy(
        sql`${paymentSyncIssues.parkedAt} is null`,
        desc(paymentSyncIssues.updatedAt),
      )
      .limit(200);
  }

  /** Releases a parked row: its count starts again and the next tick tries it. 404 for another store's. */
  async retryIssue(tenantId: string, id: string) {
    const [gone] = await this.db
      .delete(paymentSyncIssues)
      .where(
        and(
          eq(paymentSyncIssues.tenantId, tenantId),
          eq(paymentSyncIssues.id, id),
        ),
      )
      .returning({ id: paymentSyncIssues.id });
    if (!gone) throw new NotFoundException();
    return { released: true };
  }
}

const EMPTY: TickResult = {
  completed: 0,
  cancelled: 0,
  recorded: 0,
  voided: 0,
  failed: 0,
  stopped: false,
};

/** An error for a log line: its class, and payment-api's code and status when it has them. Nothing else. */
function describe(error: unknown): string {
  if (error instanceof PaymentApiError)
    return `${error.name} ${error.kind}${error.code ? ` ${error.code}` : ''}${error.status ? ` (${error.status})` : ''}`;
  return (error as Error)?.name ?? 'Error';
}
