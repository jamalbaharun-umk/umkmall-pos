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
  ne,
  sql,
} from 'drizzle-orm';
import { loadEnv } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  type CancelReason,
  type PaymentSyncKind,
  paymentSyncIssues,
  receivablePayments,
  receivables,
  type RefundStatus,
  sales,
  saleVoids,
} from '../db/schema';
import { cashMethodId, cashRounding } from '../sales/cash';
import { takeNumber } from '../sales/numbers';
import { StockService } from '../stock/stock.service';
import { restoreVoucher } from '../vouchers/vouchers.controller';
import {
  type Bank,
  isInFlight,
  isOnlineMethod,
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

/** How often `settle` reads a sale again after an answer turned out stale, or after a switch to cash. */
const MAX_ROUNDS = 4;

/**
 * How many bills one sale may get (UMK-2042): the first and the new ones the cashier asks for. The switch to
 * cash is not refused by it. A placeholder until the owner decides.
 */
export const MAX_PAYMENT_ATTEMPTS = 5;

/**
 * The request for a new bill that holds a sale's intent (UMK-2042): the attempt its screen showed and the
 * `payment_renew_at` it wrote, which is what it may clear or act on. A request whose intent was replaced or
 * dropped touches nothing of the one there now.
 */
export type RenewTicket = { from: number; at: Date | null };

const sameTime = (a: Date | null, b: Date | null) =>
  a !== null && b !== null && a.getTime() === b.getTime();

/** Our own refusal, counted and parked like payment-api's: the pos row and the payment do not agree. */
const refused = (code: string) => new PaymentApiError('rejected', null, code);

export type SaleOutcome =
  'completed' | 'void' | 'awaiting_payment' | 'cancelled' | 'not_found';

/**
 * How a sale's payment is looked at:
 * - `charge`: the cashier's request (first or repeated) asks payment-api to charge.
 * - `reconcile`: the job looks the payment up and gives an unanswered charge up after `afterMs`.
 * - `read`: the waiting screen's poll: payment-api's stored status, nothing is asked of the PG.
 * - `sync`: the manual check: payment-api asks the PG first.
 * - `cancel`: the cashier gives the sale up: the bill is closed first.
 * - `cash`: the cashier takes cash for a sale that waits for a PG payment: the bill is closed first.
 * - `renew`: the cashier asks for a new bill (QR, VA, link) for the same sale: the bill is closed first.
 */
export type SettleMode =
  'charge' | 'reconcile' | 'read' | 'sync' | 'cancel' | 'cash' | 'renew';

/** The sale's status afterwards, and the payment of its current attempt when payment-api was asked. */
export type SaleSettlement = {
  outcome: SaleOutcome;
  payment: Payment | null;
  /** payment-api's code when it refused to bill the store at the PG at all (see GATE_REFUSALS). */
  refusedCode?: string;
};

/**
 * payment-api's refusals of a PG charge that say the STORE may not charge there (UMK-2019): its gateway
 * account is not active, the method is off, or the mode does not fit. No bill exists after one of these.
 */
const GATE_REFUSALS = new Set([
  'merchant_not_active',
  'method_disabled',
  'live_disabled',
  'merchant_mode_mismatch',
]);

/** How long a store's banks are kept in memory, and for how many stores at most. */
export const BANKS_CACHE_MS = 30_000;
const BANKS_CACHE_STORES = 1000;

/**
 * payment-api's refusals of a charge whose bank does not fit the method (UMK-2037). pos-api checks the bank
 * before the sale is written; these are payment-api's own answer when that check could not be made or its
 * list has changed since. No bill exists after one of these either.
 */
export const BANK_REFUSALS = new Set([
  'bank_required',
  'bank_unknown',
  'bank_not_supported',
]);

/** A refund's state at payment-api as pos-api keeps it on the void record. */
const refundStatusOf = (payment: Payment): RefundStatus | null =>
  payment.status === 'refund_pending'
    ? 'pending'
    : payment.status === 'refunded'
      ? 'succeeded'
      : payment.status === 'refund_failed'
        ? 'failed'
        : null;

export type TickResult = {
  completed: number;
  cancelled: number;
  recorded: number;
  voided: number;
  /** Pending PG refunds that settled (succeeded or refused). */
  refunds: number;
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
  /**
   * How old an intent for a new bill must be before anybody takes it over (the job, or another request): the
   * job's wait plus several payment-api timeouts, as the request that wrote it makes a few calls in a row.
   */
  private readonly renewStrandedMs: number;
  private readonly intervalMs: number;
  private readonly maxAttempts: number;
  private readonly onlineAllowed: boolean;
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<TickResult> | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly client: PaymentsClient,
    private readonly stock: StockService,
  ) {
    const env = loadEnv();
    this.afterMs = env.POS_PAYMENT_RECONCILE_AFTER_SECONDS * 1000;
    this.renewStrandedMs = this.afterMs + 4 * env.PAYMENT_API_TIMEOUT_MS;
    this.intervalMs = env.POS_PAYMENT_RECONCILE_INTERVAL_SECONDS * 1000;
    this.maxAttempts = env.POS_PAYMENT_SYNC_MAX_ATTEMPTS;
    this.onlineAllowed = env.onlinePaymentsAllowed;
  }

  /** False when PAYMENT_API_URL is unset: nothing is sent and sales complete in one step. */
  get enabled(): boolean {
    return this.client.enabled;
  }

  /**
   * Whether a payment method of kind `online` may be created and sold with: payment-api is on AND this
   * environment may use the fake gateway (`onlinePaymentsAllowed`). Asked when a method is created and
   * again at every sale, so a method that exists in the database does not sell where it must not.
   */
  get onlineEnabled(): boolean {
    return this.enabled && this.onlineAllowed;
  }

  /**
   * The banks a sale with this gateway method chooses from (UMK-2037): empty when the method needs none.
   * Null when payment-api gives no answer: the caller goes on without the check, and payment-api's own
   * check of the charge decides (`BANK_REFUSALS`). Called before the sale's transaction, never inside one.
   *
   * Kept per store for `BANKS_CACHE_MS`, so a busy till does not ask payment-api before every online sale.
   * The price of a list that changed meanwhile, for at most that long: a bank the gateway added is refused
   * here (422 on `bank`, nothing written), and one it removed passes here and is refused by payment-api's own
   * check of the charge, after the sale is written (it is then cancelled at once with its stock back). Only an
   * answer is kept, never "no answer".
   */
  private readonly banksCache = new Map<
    string,
    { at: number; byMethod: Map<string, Bank[]> }
  >();

  async banksOf(tenantId: string, method: string): Promise<Bank[] | null> {
    const now = Date.now();
    let known = this.banksCache.get(tenantId);
    if (!known || now - known.at >= BANKS_CACHE_MS) {
      try {
        const { accounts } = await this.client.merchantAccounts(tenantId);
        known = {
          at: now,
          byMethod: new Map(
            accounts.flatMap((a) => a.methods).map((m) => [m.method, m.banks]),
          ),
        };
      } catch (error) {
        if (!(error instanceof PaymentApiError)) throw error;
        return null;
      }
      // Bounded: emptied when full; a store that sells online asks again after BANKS_CACHE_MS anyway.
      if (this.banksCache.size >= BANKS_CACHE_STORES) this.banksCache.clear();
      this.banksCache.set(tenantId, known);
    }
    return known.byMethod.get(method) ?? [];
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
   * Step 2 of a sale, by `mode` (see SettleMode). The charge key is `<sale id>:<attempt>`.
   *
   * A sale is completed on a `paid` payment and cancelled only on a payment that payment-api says is closed.
   * When there is no payment at all, the job (and a cancel, and a switch to cash) first asks payment-api to
   * CLOSE the charge key: a charge of ours that is still on its way then answers the cancelled payment and
   * can never be paid.
   *
   * A switch to cash (`switchCashPaid` set, see `requestCashSwitch`) is done by the cashier's own request
   * (mode `cash`, with the cash tendered in `cashPaid`): it closes the PG bill, and once that is closed
   * unpaid the sale becomes a cash sale with the next attempt number and is charged as `cash`. No other
   * worker closes a bill for a switch. A poll, a check or a repeat of the sale that meets a switch in
   * progress changes nothing; the job finishes one whose request died after the bill was closed for it
   * (payment `cancelled`). A bill the payer paid first completes the sale as the PG sale it was.
   *
   * A new bill for the same sale (UMK-2042, `paymentRenewAt` set, see `requestRenew`) is made by the cashier's
   * own request (mode `renew`, with its `RenewTicket`): it closes the bill, and once
   * that is closed unpaid the sale moves to the next attempt, which that request then charges with the same
   * method, bank and amount. The new attempt is never charged before the old bill is closed, so a sale never
   * has two live bills (payment-api's own index refuses a second one too). A request whose sale is already
   * past the ticket's attempt closes nothing: it charges the current attempt, which answers the bill that attempt has.
   * No other worker acts on the intent, and none cancels the sale while it is set; the job takes back one
   * that is older than its wait (the request is gone).
   *
   * The sale is read without a lock, so an answer may be stale by the time it is applied: `applyToSale`
   * refuses it (`stale`) when the sale has moved to another attempt, or would be cancelled while a switch to
   * cash or a new bill is asked, and the sale is read again.
   *
   * Throws PaymentApiError when payment-api gave no usable answer (`unavailable`) or one that does not fit
   * the sale (`rejected`): the sale has not moved then.
   */
  async settle(
    tenantId: string,
    saleId: string,
    mode: SettleMode,
    now: Date = new Date(),
    cashPaid?: number,
    ticket?: RenewTicket,
  ): Promise<SaleSettlement> {
    const renewFrom = ticket?.from;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      // A cancel takes a switch to cash and a new bill back first, in every round: one asked meanwhile loses.
      if (mode === 'cancel') {
        await this.dropCashSwitch(tenantId, saleId);
        await this.dropRenew(tenantId, saleId);
      }
      let sale = await this.saleForSettle(tenantId, saleId);
      if (!sale) return { outcome: 'not_found', payment: null };
      // Completed, voided or cancelled already: nothing is asked and nothing moves (M16).
      if (sale.status !== 'awaiting_payment' || !this.enabled)
        return { outcome: sale.status, payment: null };
      if (!sale.method) throw refused('no_method_code');
      // The cashier's request keeps its own intent alive: another request that failed may have taken it back.
      if (
        mode === 'cash' &&
        cashPaid !== undefined &&
        isOnlineMethod(sale.method) &&
        sale.switchCashPaid === null
      ) {
        await this.requestCashSwitch(tenantId, saleId, cashPaid);
        sale = (await this.saleForSettle(tenantId, saleId)) ?? sale;
        if (sale.status !== 'awaiting_payment' || !sale.method) continue;
      }
      // So does the request for a new bill, while the sale is still at the attempt its screen shows.
      if (
        mode === 'renew' &&
        sale.attempt === renewFrom &&
        sale.renewAt === null &&
        sale.switchCashPaid === null
      ) {
        const asked = await this.requestRenew(tenantId, saleId, renewFrom);
        if (asked.result === 'requested' && ticket) ticket.at = asked.at;
        sale = (await this.saleForSettle(tenantId, saleId)) ?? sale;
        if (sale.status !== 'awaiting_payment' || !sale.method) continue;
      }
      // The job meets an intent for a new bill only when the request that wrote it is gone: it is taken
      // back, and the sale is then judged like any other.
      if (
        mode === 'reconcile' &&
        sale.renewAt !== null &&
        now.getTime() - sale.renewAt.getTime() >= this.renewStrandedMs
      ) {
        // Only the intent it read: one written since belongs to a request at work.
        await this.dropRenew(tenantId, saleId, sale.renewAt);
        continue;
      }

      const switching = sale.switchCashPaid !== null;
      const renewing = sale.renewAt !== null;
      // This request replaces the bill of the attempt its screen shows, while the intent is its own.
      const replacing =
        mode === 'renew' &&
        sale.attempt === renewFrom &&
        sameTime(sale.renewAt, ticket?.at ?? null);
      // The request for a new bill finds the sale past that attempt: the new attempt is charged (a repeat
      // answers the bill it already has).
      const renewed =
        mode === 'renew' &&
        renewFrom !== undefined &&
        sale.attempt > renewFrom &&
        isOnlineMethod(sale.method);
      // Only a cancel, the cashier's own cash request and their request for a new bill close a bill.
      const closing =
        mode === 'cancel' || (mode === 'cash' && switching) || replacing;
      const actor = actorRef(sale.actorKind, sale.actorId);
      const charge = {
        orderRef: saleId,
        attempt: sale.attempt,
        method: sale.method as PaymentMethodCode,
        // What the customer owes: a cash total is rounded up to Rp100 (UMK-1993), `rounding` is 0 otherwise.
        amount: sale.total + sale.rounding,
        actorRef: actor,
        // UMK-2037: the bank is part of the PG attempt's charge (and of its key's fingerprint), so every
        // charge and close of that attempt carries it. The cash attempt of a switched sale has none.
        ...(sale.bank && isOnlineMethod(sale.method)
          ? { bank: sale.bank }
          : {}),
      };
      let payment: Payment | null;
      let refusedCode: string | undefined;
      // A cash sale past its first attempt was switched to cash: the cashier said the cash was received, so
      // every worker charges it (as it finishes a switch), and none gives it up for want of a payment.
      const cashOfSwitch = !isOnlineMethod(sale.method) && sale.attempt > 1;
      if (
        !closing &&
        !switching &&
        !renewing &&
        (mode === 'charge' || cashOfSwitch || renewed)
      ) {
        payment = await this.client
          .charge(tenantId, charge)
          .catch((error: unknown) => {
            // The store may not charge at this PG, so no bill was made. The charge key is closed and the
            // sale cancelled now, with its stock back, instead of waiting for the job to give it up.
            if (
              !(error instanceof PaymentApiError) ||
              error.kind !== 'rejected' ||
              !(
                GATE_REFUSALS.has(error.code ?? '') ||
                BANK_REFUSALS.has(error.code ?? '')
              ) ||
              !isOnlineMethod(charge.method)
            )
              throw error;
            refusedCode = error.code ?? undefined;
            return this.client.close(tenantId, charge);
          });
      } else {
        payment = await this.client.findByKey(
          tenantId,
          `${saleId}:${sale.attempt}`,
        );
        if (!payment) {
          // Give the cashier time to repeat the request before the sale is given up; a poll never gives up.
          const giveUp =
            closing ||
            (mode === 'reconcile' &&
              now.getTime() - sale.attemptAt.getTime() >= this.afterMs);
          if (!giveUp) return { outcome: 'awaiting_payment', payment: null };
          // The job gives the sale up. It closes nothing FOR a switch to cash: one that was asked and
          // never got as far as a bill is taken back first, so the sale is cancelled, not made a cash sale.
          if (mode === 'reconcile' && switching) {
            await this.dropCashSwitch(tenantId, saleId);
            continue;
          }
          // Nor for a new bill: an intent the job did not take back above is a request still at work.
          if (mode === 'reconcile' && renewing)
            return { outcome: 'awaiting_payment', payment: null };
          payment = await this.client.close(tenantId, charge);
        }
      }
      // Whatever it says, it must be this sale's payment for this amount.
      if (payment.orderRef !== saleId || payment.amount !== charge.amount)
        throw refused('payment_mismatch');
      if (isInFlight(payment)) {
        if (closing) payment = await this.closeBill(tenantId, payment, actor);
        else if (mode === 'sync' && isOnlineMethod(sale.method))
          payment = await this.client.sync(tenantId, payment.id);
      }
      if (payment.status === 'paid') {
        const outcome = await this.applyToSale(
          tenantId,
          saleId,
          'completed',
          payment.id,
          sale.attempt,
          // A sale that waited for a PG payment counts from when the payer paid; any other from now.
          isOnlineMethod(payment.method) ? payment.paidAt : null,
          { byJob: mode === 'reconcile' },
        );
        if (outcome === 'stale') continue;
        return { outcome, payment };
      }
      // A PG payment still open: the sale waits until payment-api pays or closes it.
      if (!CLOSED_UNPAID.has(payment.status))
        return { outcome: 'awaiting_payment', payment };
      if (renewing) {
        // The bill is closed unpaid and a new one is asked. Only the request that asked moves the sale to
        // the next attempt (the next round charges it); nobody else cancels the sale under it.
        if (!replacing) return { outcome: 'awaiting_payment', payment };
        await this.turnToNextAttempt(
          tenantId,
          saleId,
          sale.attempt,
          sale.renewAt,
        );
        continue;
      }
      if (!switching) {
        const outcome = await this.applyToSale(
          tenantId,
          saleId,
          'cancelled',
          payment.id,
          sale.attempt,
          null,
          {
            cancelReason: refusedCode
              ? 'gateway_refused'
              : mode === 'cancel'
                ? 'cashier'
                : payment.status === 'expired' || payment.status === 'failed'
                  ? payment.status
                  : 'unpaid',
            refusedCode,
          },
        );
        if (outcome === 'stale') continue;
        return { outcome, payment, refusedCode };
      }
      // The PG attempt is closed unpaid and the cashier took cash. Their own request turns the sale into a
      // cash sale, and so does the job when the bill was closed for the switch (`cancelled`: only the
      // cashier's request closes a bill of a sale that has an intent; that request died after it).
      if (mode === 'reconcile' && payment.status !== 'cancelled') {
        // The bill ended by itself (expired, failed) and the request that asked for cash is gone: the
        // intent would keep the sale waiting for ever. The job takes it back and the next round cancels
        // the sale. A request that is still at work asks again (see above) or finds the sale cancelled.
        await this.dropCashSwitch(tenantId, saleId);
        continue;
      }
      // A poll or a check leaves the sale as it is: the switch is not theirs to do, and the sale is not
      // cancelled under a cashier who holds the customer's cash.
      if (mode !== 'cash' && mode !== 'reconcile')
        return { outcome: 'awaiting_payment', payment };
      // The next round charges the cash attempt.
      await this.turnToCash(tenantId, saleId, sale.attempt);
    }
    const sale = await this.saleForSettle(tenantId, saleId);
    return { outcome: sale?.status ?? 'not_found', payment: null };
  }

  private async saleForSettle(tenantId: string, saleId: string) {
    const [sale] = await this.db
      .select({
        status: sales.status,
        total: sales.total,
        rounding: sales.rounding,
        actorId: sales.actorId,
        actorKind: sales.actorKind,
        method: sales.paymentMethodCode,
        bank: sales.paymentBank,
        attempt: sales.paymentAttempt,
        attemptAt: sales.paymentAttemptAt,
        switchCashPaid: sales.switchCashPaid,
        renewAt: sales.paymentRenewAt,
      })
      .from(sales)
      .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)));
    return sale ?? null;
  }

  /** `settle` for the callers that need only the sale's status afterwards. */
  async settleSale(
    tenantId: string,
    saleId: string,
    mode: SettleMode,
    now: Date = new Date(),
  ): Promise<SaleOutcome> {
    return (await this.settle(tenantId, saleId, mode, now)).outcome;
  }

  /**
   * Closes an unpaid bill at payment-api, which asks the PG first. The payer paid a moment earlier
   * (`already_paid`): the payment is `paid` and is answered as such.
   */
  private async closeBill(
    tenantId: string,
    payment: Payment,
    actor: string,
  ): Promise<Payment> {
    try {
      return await this.client.cancelPending(tenantId, payment.id, actor);
    } catch (error) {
      if (
        error instanceof PaymentApiError &&
        error.kind === 'rejected' &&
        error.code === 'already_paid'
      )
        return this.client.get(tenantId, payment.id);
      throw error;
    }
  }

  /**
   * The cashier takes cash for a sale that waits for a PG payment: the cash tendered is written on the sale
   * BEFORE the bill is closed, so no worker that finds the bill closed cancels the sale. Returns what the
   * sale is now; `settle` does the rest.
   */
  async requestCashSwitch(
    tenantId: string,
    saleId: string,
    paid: number,
  ): Promise<
    'not_found' | 'not_awaiting' | 'not_online' | 'underpaid' | 'requested'
  > {
    return this.db.transaction(async (tx) => {
      const [sale] = await tx
        .select({
          status: sales.status,
          total: sales.total,
          method: sales.paymentMethodCode,
        })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
        .for('update');
      if (!sale) return 'not_found' as const;
      if (sale.status !== 'awaiting_payment') return 'not_awaiting' as const;
      if (!isOnlineMethod(sale.method)) return 'not_online' as const;
      if (paid < sale.total + cashRounding(sale.total))
        return 'underpaid' as const;
      // Cash wins over a new bill asked at the same time: that request finds its intent gone.
      await tx
        .update(sales)
        .set({ switchCashPaid: paid, paymentRenewAt: null })
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)));
      return 'requested' as const;
    });
  }

  /**
   * The cashier asks for a new bill for a sale that waits for a PG payment (UMK-2042): the intent is written
   * on the sale BEFORE the current bill is closed, so no worker that finds the bill closed cancels the sale.
   * `from` is the attempt the cashier's screen shows: a sale that is past it (`moved`) was renewed already.
   * An intent another request wrote is never overwritten (`renewing`) unless it is stranded (older than
   * `renewStrandedMs`). Returns what the sale is now and, when written, the intent's time (the request's
   * ticket, see `RenewTicket`); `settle` (mode `renew`) does the rest.
   */
  async requestRenew(
    tenantId: string,
    saleId: string,
    from: number,
  ): Promise<
    | {
        result:
          | 'not_found'
          | 'not_awaiting'
          | 'not_online'
          | 'switching'
          | 'renewing'
          | 'moved'
          | 'limit';
        at: null;
      }
    | { result: 'requested'; at: Date }
  > {
    const no = <T extends string>(result: T) => ({ result, at: null });
    return this.db.transaction(async (tx) => {
      const [sale] = await tx
        .select({
          status: sales.status,
          method: sales.paymentMethodCode,
          attempt: sales.paymentAttempt,
          switchCashPaid: sales.switchCashPaid,
          renewAt: sales.paymentRenewAt,
          // The intent's age is read on the database's clock, the clock that wrote it.
          stranded: sql<boolean>`${sales.paymentRenewAt} < clock_timestamp() - make_interval(secs => ${this.renewStrandedMs / 1000})`,
        })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
        .for('update');
      if (!sale) return no('not_found');
      if (sale.status !== 'awaiting_payment') return no('not_awaiting');
      if (!isOnlineMethod(sale.method)) return no('not_online');
      if (sale.switchCashPaid !== null) return no('switching');
      if (sale.attempt !== from) return no('moved');
      if (sale.renewAt !== null && !sale.stranded) return no('renewing');
      if (sale.attempt >= MAX_PAYMENT_ATTEMPTS) return no('limit');
      // Milliseconds only: the time comes back as a JS Date, and it is compared as one (`dropRenew`).
      const [row] = await tx
        .update(sales)
        .set({
          paymentRenewAt: sql`date_trunc('milliseconds', clock_timestamp())`,
        })
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
        .returning({ at: sales.paymentRenewAt });
      return { result: 'requested' as const, at: row.at as Date };
    });
  }

  /**
   * The request for a new bill got no usable answer and said so: the intent is taken back, so the sale is
   * judged by its bill again (still open: it waits; closed: the next look cancels it). Only the request's own
   * intent: one it never wrote, or that was replaced, belongs to another request and stays.
   */
  async abandonRenew(tenantId: string, saleId: string, ticket: RenewTicket) {
    if (ticket.at) await this.dropRenew(tenantId, saleId, ticket.at);
  }

  /** `at`: only the intent written at that time. Without it (a cancel, which wins) whatever intent there is. */
  private async dropRenew(tenantId: string, saleId: string, at?: Date) {
    await this.db
      .update(sales)
      .set({ paymentRenewAt: null })
      .where(
        and(
          eq(sales.tenantId, tenantId),
          eq(sales.id, saleId),
          // Compared at the millisecond a JS Date holds (a value written elsewhere may carry microseconds).
          at
            ? sql`date_trunc('milliseconds', ${sales.paymentRenewAt}) = ${at.toISOString()}::timestamptz`
            : isNotNull(sales.paymentRenewAt),
        ),
      );
  }

  /**
   * The bill of `attempt` is closed unpaid and a new one was asked: the sale moves to the next attempt, which
   * the caller then charges. Under the sale's row lock, and only while it is still that attempt with the
   * intent set, so two workers move it once. Stock and voucher stay taken; method, bank and amount stay.
   */
  private async turnToNextAttempt(
    tenantId: string,
    saleId: string,
    attempt: number,
    renewAt: Date | null,
  ) {
    return this.db.transaction(async (tx) => {
      const mine = and(eq(sales.tenantId, tenantId), eq(sales.id, saleId));
      const [sale] = await tx
        .select({
          status: sales.status,
          attempt: sales.paymentAttempt,
          renewAt: sales.paymentRenewAt,
          switchCashPaid: sales.switchCashPaid,
        })
        .from(sales)
        .where(mine)
        .for('update');
      if (
        !sale ||
        sale.status !== 'awaiting_payment' ||
        sale.attempt !== attempt ||
        !sameTime(sale.renewAt, renewAt) ||
        sale.switchCashPaid !== null
      )
        return;
      await tx
        .update(sales)
        .set({
          paymentAttempt: attempt + 1,
          paymentAttemptAt: sql`now()`,
          paymentRenewAt: null,
        })
        .where(mine);
    });
  }

  /**
   * The cashier's cash request got no usable answer and said so: the switch is taken back, so nothing turns
   * the sale into a cash sale later, behind the cashier's back. A sale that is a cash sale already is past
   * this (its `switchCashPaid` is null) and is not touched.
   */
  async abandonCashSwitch(tenantId: string, saleId: string) {
    await this.dropCashSwitch(tenantId, saleId);
  }

  /** The switch to cash is off: the sale waits for its PG payment as before. */
  private async dropCashSwitch(tenantId: string, saleId: string) {
    await this.db
      .update(sales)
      .set({ switchCashPaid: null })
      .where(
        and(
          eq(sales.tenantId, tenantId),
          eq(sales.id, saleId),
          isNotNull(sales.switchCashPaid),
        ),
      );
  }

  /**
   * The PG attempt closed unpaid and the cashier took cash: the sale becomes a cash sale (Tunai, rounded up
   * to Rp100) with the next attempt number. Under the sale's row lock, and only while it is still that
   * attempt with the switch asked, so two workers turn it once.
   */
  private async turnToCash(tenantId: string, saleId: string, attempt: number) {
    return this.db.transaction(async (tx) => {
      const mine = and(eq(sales.tenantId, tenantId), eq(sales.id, saleId));
      const [sale] = await tx
        .select({
          status: sales.status,
          total: sales.total,
          attempt: sales.paymentAttempt,
          paid: sales.switchCashPaid,
        })
        .from(sales)
        .where(mine)
        .for('update');
      if (
        !sale ||
        sale.status !== 'awaiting_payment' ||
        sale.attempt !== attempt ||
        sale.paid === null
      )
        return;
      const rounding = cashRounding(sale.total);
      await tx
        .update(sales)
        .set({
          paymentMethodId: await cashMethodId(tx, tenantId),
          paymentMethodCode: 'cash',
          rounding,
          paid: sale.paid,
          change: Math.max(sale.paid - sale.total - rounding, 0),
          paymentAttempt: attempt + 1,
          paymentAttemptAt: sql`now()`,
          // The cashier holds the cash now: the sale counts from this moment.
          paidAt: sql`now()`,
          switchCashPaid: null,
          paymentRenewAt: null,
        })
        .where(mine);
    });
  }

  /**
   * The one write of step 2: under the sale's row lock, and only while the sale still awaits payment AND is
   * still what the caller read before it asked payment-api. `attempt` is the attempt the payment belongs to:
   * a sale that moved on to another attempt (it was switched to cash) is not touched by the old attempt's
   * answer, and a sale is never cancelled while a switch to cash is asked. Both answer `stale`.
   *
   * A sale that is completed here gets its receipt number here (`takeNumber`), and is reported from the moment it was paid (`paid_at`): `paidAt`, a PG
   * payment's own paid time, kept between the sale's creation and now (payment-api's clock is not ours);
   * without one (a payment taken at the cashier, or a PG payment that came with no usable time) it is now.
   *
   * `how` is kept for the till that was away (UMK-2046): whether the job completed the sale, and why a sale
   * was cancelled.
   */
  private async applyToSale(
    tenantId: string,
    saleId: string,
    to: 'completed' | 'cancelled',
    paymentId: string,
    attempt: number,
    paidAt: string | null = null,
    how: {
      byJob?: boolean;
      cancelReason?: CancelReason;
      refusedCode?: string;
    } = {},
  ): Promise<SaleOutcome | 'stale'> {
    return this.db.transaction(async (tx) => {
      const [sale] = await tx
        .select({
          status: sales.status,
          actorId: sales.actorId,
          voucherId: sales.voucherId,
          attempt: sales.paymentAttempt,
          switchCashPaid: sales.switchCashPaid,
          renewAt: sales.paymentRenewAt,
        })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
        .for('update');
      if (!sale) return 'not_found';
      // Another worker applied the same answer first. A cancelled sale is never completed.
      if (sale.status !== 'awaiting_payment') return sale.status;
      if (sale.attempt !== attempt) return 'stale';
      if (to === 'cancelled' && sale.switchCashPaid !== null) return 'stale';
      // Nor while a new bill is asked for it (UMK-2042): its bill was closed to be replaced.
      if (to === 'cancelled' && sale.renewAt !== null) return 'stale';
      if (to === 'completed') {
        // UMK-2038: the receipt number is taken here, in the write that completes the sale and under its
        // row lock, so receipts are numbered in the order they are completed and a sale that is cancelled
        // never took one.
        const { number } = await takeNumber(tx, tenantId, 'receipt');
        await tx
          .update(sales)
          .set({
            status: 'completed',
            number,
            // The clock, not the transaction's start: `paid-since` pages through sales in this order.
            completedAt: sql`clock_timestamp()`,
            settledByJob: how.byJob === true,
            paymentId,
            switchCashPaid: null,
            paymentRenewAt: null,
            paidAt: paidAt
              ? sql`greatest(${sales.createdAt}, least(${paidAt}::timestamptz, now()))`
              : sql`now()`,
          })
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
        .set({
          status: 'cancelled',
          cancelledAt: sql`clock_timestamp()`,
          cancelReason: how.cancelReason ?? null,
          paymentRefusedCode: how.refusedCode ?? null,
          paymentId,
          switchCashPaid: null,
          paymentRenewAt: null,
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
        refundStatus: saleVoids.refundStatus,
      })
      .from(saleVoids)
      .where(mine);
    if (!v) return false;
    if (!v.pending) return true;

    const [sale] = await this.db
      .select({ paymentId: sales.paymentId })
      .from(sales)
      .where(and(eq(sales.tenantId, tenantId), eq(sales.id, v.saleId)));
    if (v.refundStatus !== null) {
      // A sale paid through a PG: its one payment is REFUNDED, never voided. A repeat (the first answer
      // was lost) first looks: a refund already asked is not asked a second time.
      if (!sale?.paymentId) throw refused('no_payment');
      let payment = await this.client.get(tenantId, sale.paymentId);
      if (payment.status === 'paid')
        payment = await this.client.refund(tenantId, sale.paymentId, {
          reasonCode: v.reasonCode,
          note: v.note ?? undefined,
          actorRef: actorRef(v.actorKind, v.actorId),
          approvedBy: actorRef(v.approvedByKind, v.approvedBy),
        });
      if (!refundStatusOf(payment)) throw refused('payment_mismatch');
      await this.db
        .update(saleVoids)
        .set({ paymentSyncPending: false })
        .where(mine);
      await this.setRefundStatus(tenantId, voidId, payment);
      return true;
    }
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

  /** The refund record of a sale (a void whose money goes back through the PG) and the sale's payment. */
  private async refundOf(tenantId: string, saleId: string) {
    const [row] = await this.db
      .select({
        id: saleVoids.id,
        reasonCode: saleVoids.reasonCode,
        note: saleVoids.note,
        approvedBy: saleVoids.approvedBy,
        approvedByKind: saleVoids.approvedByKind,
        pending: saleVoids.paymentSyncPending,
        refundStatus: saleVoids.refundStatus,
        paymentId: sales.paymentId,
      })
      .from(saleVoids)
      .innerJoin(
        sales,
        and(
          eq(sales.tenantId, saleVoids.tenantId),
          eq(sales.id, saleVoids.saleId),
        ),
      )
      .where(
        and(
          eq(saleVoids.tenantId, tenantId),
          eq(saleVoids.saleId, saleId),
          isNotNull(saleVoids.refundStatus),
        ),
      );
    return row ?? null;
  }

  private async setRefundStatus(
    tenantId: string,
    voidId: string,
    payment: Payment,
  ): Promise<RefundStatus> {
    const refundStatus = refundStatusOf(payment);
    if (!refundStatus) throw refused('payment_mismatch');
    // A refund that succeeded stays so: an older answer (a follower that read before it) changes nothing.
    const mine = and(
      eq(saleVoids.tenantId, tenantId),
      eq(saleVoids.id, voidId),
    );
    await this.db
      .update(saleVoids)
      .set({ refundStatus })
      .where(and(mine, ne(saleVoids.refundStatus, 'succeeded')));
    const [row] = await this.db
      .select({ refundStatus: saleVoids.refundStatus })
      .from(saleVoids)
      .where(mine);
    return row?.refundStatus ?? refundStatus;
  }

  /**
   * Where a sale's PG refund stands, taken from a payment the caller already has or asked from payment-api
   * (which follows a pending refund at the PG itself). Null when the sale has no refund.
   */
  async followRefund(
    tenantId: string,
    saleId: string,
    known?: Payment,
  ): Promise<RefundStatus | null> {
    const refund = await this.refundOf(tenantId, saleId);
    if (!refund) return null;
    // Not asked at payment-api yet, or settled for good: nothing to learn.
    if (refund.pending || refund.refundStatus === 'succeeded' || !this.enabled)
      return refund.refundStatus;
    if (!refund.paymentId) throw refused('no_payment');
    const payment =
      known?.id === refund.paymentId
        ? known
        : await this.client.get(tenantId, refund.paymentId);
    return this.setRefundStatus(tenantId, refund.id, payment);
  }

  /**
   * Asks a refused refund again (V4), with the refund's own reason; `actor` is who retries (the owner) and
   * `approvedBy` whose PIN approved this retry (UMK-2040). A refund not sent yet is sent as it was approved;
   * one that is pending or done is answered as it stands.
   */
  async retryRefund(
    tenantId: string,
    saleId: string,
    actor: string,
    approvedBy: string,
  ): Promise<RefundStatus | null> {
    const refund = await this.refundOf(tenantId, saleId);
    if (!refund) return null;
    if (refund.pending) {
      await this.syncVoid(tenantId, refund.id);
      return (await this.refundOf(tenantId, saleId))?.refundStatus ?? null;
    }
    const current = await this.followRefund(tenantId, saleId);
    if (current !== 'failed' || !refund.paymentId) return current;
    const payment = await this.client.refund(tenantId, refund.paymentId, {
      reasonCode: refund.reasonCode,
      note: refund.note ?? undefined,
      actorRef: actor,
      approvedBy,
    });
    return this.setRefundStatus(tenantId, refund.id, payment);
  }

  /**
   * The store returned the money of a refused refund by hand (V4). `actor` holds `sales.void` and is both
   * who did it and who approved it. payment-api refuses it unless the refund was refused by the PG.
   */
  async markRefundManual(
    tenantId: string,
    saleId: string,
    note: string,
    actor: string,
  ): Promise<RefundStatus | null> {
    const refund = await this.refundOf(tenantId, saleId);
    if (!refund) return null;
    if (refund.pending || !refund.paymentId) throw refused('not_refund_failed');
    const payment = await this.client.markRefundedManually(
      tenantId,
      refund.paymentId,
      { note, actorRef: actor, approvedBy: actor },
    );
    return this.setRefundStatus(tenantId, refund.id, payment);
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
                lt(
                  sales.paymentAttemptAt,
                  new Date(now.getTime() - this.afterMs),
                ),
                notParked('sale', sales.id),
              ),
            )
            .orderBy(asc(sales.paymentAttemptAt))
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
      {
        // A PG refund that was accepted and is still on its way: payment-api follows it at the PG, and
        // this reads where it stands. The row id is the SALE's.
        kind: 'refund',
        rows: () =>
          this.db
            .select({ id: saleVoids.saleId, tenantId: saleVoids.tenantId })
            .from(saleVoids)
            .where(
              and(
                eq(saleVoids.refundStatus, 'pending'),
                eq(saleVoids.paymentSyncPending, false),
                notParked('refund', saleVoids.saleId),
              ),
            )
            .orderBy(asc(saleVoids.createdAt))
            .limit(SWEEP_LIMIT),
        work: async (row) => {
          const status = await this.followRefund(row.tenantId, row.id);
          if (status && status !== 'pending') result.refunds += 1;
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
  refunds: 0,
  failed: 0,
  stopped: false,
};

/** An error for a log line: its class, and payment-api's code and status when it has them. Nothing else. */
function describe(error: unknown): string {
  if (error instanceof PaymentApiError)
    return `${error.name} ${error.kind}${error.code ? ` ${error.code}` : ''}${error.status ? ` (${error.status})` : ''}`;
  return (error as Error)?.name ?? 'Error';
}
