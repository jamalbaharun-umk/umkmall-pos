import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { PaymentAdapter } from '../adapters/adapter';
import { AdapterRegistry } from '../adapters/adapters.module';
import { fieldError, isUuid } from '../common/validation';
import { Clock, PaymentSettings } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { paymentEvents, payments, unmatchedReceipts } from '../db/schema';
import { MerchantsService } from '../merchants/merchants.service';
import type {
  AnyCancelInput,
  CancelInput,
  ChargeInput,
  ListInput,
  ManualRefundInput,
  ReceiptListInput,
} from './payments.schemas';
import { CancelBody } from './payments.schemas';
import { PaymentRow, SettlementService, toRef } from './settlement.service';
import { validate } from '../common/validation';

const refusal = (
  code: string,
  message: string,
  meta?: Record<string, unknown>,
) => new ConflictException({ message, code, ...(meta ? { meta } : {}) });

const notFound = () =>
  new NotFoundException({ message: 'Payment not found', code: 'not_found' });

const gatewayDown = () =>
  new ServiceUnavailableException({
    message: 'Payment gateway unavailable',
    code: 'gateway_unavailable',
  });

/** What a caller sees. No tenant id (the caller sent it) and no request hash. */
function view(p: PaymentRow, adapter: PaymentAdapter | undefined) {
  return {
    id: p.id,
    orderRef: p.orderRef,
    attempt: p.attempt,
    method: p.method,
    kind: adapter?.kind ?? null,
    amount: p.amount,
    feeAmount: p.feeAmount,
    status: p.status,
    needsReview: p.needsReview,
    reviewReason: p.reviewReason,
    idempotencyKey: p.idempotencyKey,
    providerRef: p.providerRef,
    checkout: p.checkout,
    expiresAt: p.expiresAt,
    paidAt: p.paidAt,
    // How fresh `status` is for an online payment (manual sync asks the PG at most once per interval).
    lastSyncedAt: p.lastSyncedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** The fingerprint of a charge request: the same key with another request is refused, not replayed. */
const hashOf = (input: ChargeInput) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        input.orderRef,
        input.attempt,
        input.method,
        input.amount,
        input.actorRef,
      ]),
    )
    .digest('hex');

/**
 * The API a calling service uses. Every query filters `tenantId`, which only ever comes from the service
 * guard; another tenant's payment id answers 404, exactly like an id that does not exist.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly adapters: AdapterRegistry,
    private readonly settlement: SettlementService,
    private readonly settings: PaymentSettings,
    private readonly clock: Clock,
    private readonly merchants: MerchantsService,
  ) {}

  /**
   * Creates the payment for one attempt at paying an order, and charges it. The caller's idempotency key is
   * the order reference plus the attempt number: the same key always answers the same payment (also once it
   * has expired), and a new attempt is accepted only when the previous one is closed.
   */
  async charge(tenantId: string, key: string, input: ChargeInput) {
    const adapter = this.adapters.get(input.method);
    if (!adapter)
      throw fieldError(
        'method',
        input.method === 'kasbon'
          ? 'Kasbon is a receivable at the caller, not a payment method'
          : 'Unknown payment method',
      );
    const requestHash = hashOf(input);

    // A PG charge needs the store's gateway account to be active with this method on (UMK-2019). Only a NEW
    // charge is refused: a key that already has a payment still answers it, whatever the account is now.
    const gate = await this.merchants.chargeRefusal(tenantId, adapter);
    if (gate) {
      const [known] = await this.db
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, tenantId),
            eq(payments.idempotencyKey, key),
          ),
        );
      if (!known) throw gate;
      return this.replay(tenantId, key, requestHash, input);
    }

    const now = this.clock.now();
    const claimed = await this.db.transaction(async (tx) => {
      // The row is written as `created` before any PG is called: it claims the idempotency key, the attempt
      // number and the order's one live-payment slot. A duplicate (also a concurrent one) inserts nothing.
      const [row] = await tx
        .insert(payments)
        .values({
          tenantId,
          orderRef: input.orderRef,
          attempt: input.attempt,
          method: input.method,
          amount: input.amount,
          status: 'created',
          idempotencyKey: key,
          requestHash,
          expiresAt:
            adapter.kind === 'online'
              ? new Date(now.getTime() + this.settings.qrTtlMs)
              : null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) return null;
      await tx.insert(paymentEvents).values({
        tenantId,
        paymentId: row.id,
        toStatus: 'created',
        source: 'charge',
        actorRef: input.actorRef,
        createdAt: now,
      });
      // CASHAC never calls out, so it is settled in the same transaction: no `created` row is left behind.
      if (adapter.kind === 'cashac') {
        const result = await adapter.charge(toRef(row));
        return this.settlement.move(tx, row, result.status, {
          source: 'charge',
          actorRef: input.actorRef,
        });
      }
      return row;
    });

    if (!claimed) return this.replay(tenantId, key, requestHash, input);

    // The PG is called only after `created` is committed: a webhook that comes back at once finds the row.
    const settled =
      adapter.kind === 'cashac'
        ? claimed
        : await this.settlement.startCharge(claimed);
    return { created: true, payment: await this.detail(settled) };
  }

  /**
   * Closes a charge key that has no payment: the caller gave up on a charge whose answer it never got, and
   * must be sure that charge can never be paid later. Takes the charge's own key and body. When no payment
   * has the key, a `cancelled` one is written under it, in one transaction, claiming the key and the attempt
   * exactly as a charge would; a charge that arrives later with the same key answers that cancelled payment
   * and never pays. When a payment already has the key (the charge did arrive), it is answered unchanged,
   * whatever its status: a `paid` one stays paid, and the caller completes its order.
   *
   * The unique index on (tenant, key) decides between a close and a charge that race: one of them inserts,
   * the other waits for it and answers its row.
   */
  async close(tenantId: string, key: string, input: ChargeInput) {
    if (!this.adapters.get(input.method))
      throw fieldError('method', 'Unknown payment method');
    const requestHash = hashOf(input);
    const now = this.clock.now();
    const closed = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(payments)
        .values({
          tenantId,
          orderRef: input.orderRef,
          attempt: input.attempt,
          method: input.method,
          amount: input.amount,
          status: 'created',
          idempotencyKey: key,
          requestHash,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) return null;
      await tx.insert(paymentEvents).values({
        tenantId,
        paymentId: row.id,
        toStatus: 'created',
        source: 'close',
        actorRef: input.actorRef,
        createdAt: now,
      });
      // Never charged: no adapter is called. Closed in the transaction that created it.
      return this.settlement.move(tx, row, 'cancelled', {
        source: 'close',
        actorRef: input.actorRef,
        note: 'closed by the caller: no charge had arrived under this key',
      });
    });
    if (!closed) return this.replay(tenantId, key, requestHash, input);
    return { created: true, payment: await this.detail(closed) };
  }

  private async replay(
    tenantId: string,
    key: string,
    requestHash: string,
    input: ChargeInput,
  ) {
    const [existing] = await this.db
      .select()
      .from(payments)
      .where(
        and(eq(payments.tenantId, tenantId), eq(payments.idempotencyKey, key)),
      );
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw refusal(
          'idempotency_key_reused',
          'Idempotency-Key was already used for another request',
        );
      // The first request may have died between `created` and the PG's answer: look for the bill (never
      // create a second one from a replay).
      const current =
        existing.status === 'created'
          ? await this.settlement
              .settle(existing.id, 'charge', tenantId)
              .catch(() => existing)
          : existing;
      return {
        created: false,
        payment: await this.detail(current ?? existing),
      };
    }
    const [sameAttempt] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.orderRef, input.orderRef),
          eq(payments.attempt, input.attempt),
        ),
      );
    if (sameAttempt)
      throw refusal(
        'attempt_already_used',
        'This attempt number was already used for the order with another key',
      );
    throw refusal(
      'order_has_live_payment',
      'This order already has a payment that is waiting or paid; a new attempt needs it closed first',
    );
  }

  async get(tenantId: string, id: string) {
    return this.detail(await this.find(tenantId, id));
  }

  async list(tenantId: string, q: ListInput) {
    const where = and(
      eq(payments.tenantId, tenantId),
      q.orderRef ? eq(payments.orderRef, q.orderRef) : undefined,
      q.idempotencyKey
        ? eq(payments.idempotencyKey, q.idempotencyKey)
        : undefined,
      q.status ? eq(payments.status, q.status) : undefined,
      q.needsReview === undefined
        ? undefined
        : eq(payments.needsReview, q.needsReview),
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(payments)
      .where(where);
    const rows = await this.db
      .select()
      .from(payments)
      .where(where)
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage);
    return {
      items: rows.map((p) => view(p, this.adapters.get(p.method))),
      page: q.page,
      perPage: q.perPage,
      total,
    };
  }

  /** Money that matched no payment: the owner's "needs review" list, with where its refund stands. */
  async listUnmatched(tenantId: string, q: ReceiptListInput) {
    const where = and(
      eq(unmatchedReceipts.tenantId, tenantId),
      q.needsReview === undefined
        ? undefined
        : eq(unmatchedReceipts.needsReview, q.needsReview),
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(unmatchedReceipts)
      .where(where);
    const rows = await this.db
      .select({
        id: unmatchedReceipts.id,
        paymentId: unmatchedReceipts.paymentId,
        orderRef: payments.orderRef,
        kind: unmatchedReceipts.kind,
        grossAmount: unmatchedReceipts.grossAmount,
        feeAmount: unmatchedReceipts.feeAmount,
        needsReview: unmatchedReceipts.needsReview,
        refundStatus: unmatchedReceipts.refundStatus,
        refundActor: unmatchedReceipts.refundActor,
        createdAt: unmatchedReceipts.createdAt,
      })
      .from(unmatchedReceipts)
      .innerJoin(payments, eq(payments.id, unmatchedReceipts.paymentId))
      .where(where)
      .orderBy(desc(unmatchedReceipts.createdAt), desc(unmatchedReceipts.id))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage);
    return { items: rows, page: q.page, perPage: q.perPage, total };
  }

  /** Manual status check: asks the PG through `settle` (throttled) and answers the stored status. */
  async sync(tenantId: string, id: string) {
    if (!isUuid(id)) throw notFound();
    const row = await this.gateway(() =>
      this.settlement.settle(id, 'sync', tenantId),
    );
    if (!row) throw notFound();
    return this.detail(row);
  }

  /**
   * payment-api picks the path. A paid payment is voided (CASHAC) or refunded (PG), which needs the reason and
   * the supervisor. A payment still waiting has its bill closed: that is neither a void nor a refund, and needs
   * only the actor.
   */
  async cancel(tenantId: string, id: string, input: AnyCancelInput) {
    const row = await this.find(tenantId, id);
    const adapter = this.settlement.adapterOf(row);
    if (row.status === 'created' || row.status === 'pending')
      return this.cancelPending(tenantId, id, input.actorRef);
    if (row.status === 'cancelled') return this.detail(row);
    const strict = validate(CancelBody, input);
    if (adapter.supportsVoid) return this.void(tenantId, id, strict);
    if (adapter.supportsRefund) return this.refund(tenantId, id, strict);
    throw refusal(
      'cancel_not_supported',
      'This payment method can be neither voided nor refunded',
    );
  }

  /**
   * Closes an unpaid bill. Only the PG's own answer counts: when it says the payer already paid, the cancel is
   * refused and the payment becomes `paid`. When the PG cannot close a QR at all, the cashier may still cancel
   * (configurable): the payment is `cancelled`, and money that later arrives on that QR is refunded.
   */
  private async cancelPending(tenantId: string, id: string, actorRef: string) {
    const outcome = await this.db.transaction(async (tx) => {
      const row = await this.settlement.lock(tx, id, tenantId);
      if (!row) throw notFound();
      if (row.status !== 'created' && row.status !== 'pending')
        return { row, paid: row.status === 'paid', follow: null };
      const adapter = this.settlement.adapterOf(row);
      if (!adapter.canCancel && !this.settings.cancelWithoutGatewayClose)
        throw refusal(
          'cancel_not_supported',
          'This bill cannot be closed at the gateway; it stays payable until it expires',
          { expiresAt: row.expiresAt },
        );
      const answer = await this.gateway(async () => {
        if (adapter.canCancel) await adapter.cancelPending?.(toRef(row));
        return adapter.getStatus(toRef(row));
      });
      // Paid in full: the cancel is refused. Money in another amount, or a "paid" without a receipt, does not
      // pay this payment, so the cancel goes on and that money is recorded (and refunded) as unmatched.
      if (answer.receipts?.some((r) => r.grossAmount === row.amount)) {
        const follow = await this.settlement.apply(tx, row, answer, 'cancel');
        return { row: follow.row, paid: follow.row.status === 'paid', follow };
      }
      // The bill is still open at the PG: it cannot close bills, or it did not close this one.
      const stillOpen = !adapter.canCancel || answer.status === 'pending';
      // Then the cashier may cancel anyway only when configured; otherwise the payment stays pending.
      if (stillOpen && !this.settings.cancelWithoutGatewayClose)
        throw gatewayDown();
      // The PG says paid but shows no receipt yet: the money is probably on its way. The cashier may still
      // cancel (it will be refunded as late money), but a person must look at this one.
      const paidUnseen =
        answer.status === 'paid' && !(answer.receipts ?? []).length;
      const cancelled = await this.settlement.move(tx, row, 'cancelled', {
        source: 'cancel',
        actorRef,
        review: paidUnseen ? 'paid_without_receipt' : undefined,
        note: stillOpen
          ? 'bill could not be closed at the gateway; later money on it is refunded'
          : null,
      });
      // Wrong-amount money already on the bill is recorded now.
      const follow = await this.settlement.apply(
        tx,
        cancelled,
        answer,
        'cancel',
      );
      return { row: follow.row, paid: false, follow };
    });
    for (const receiptId of outcome.follow?.refundReceipts ?? [])
      await this.settlement.executeReceiptRefund(receiptId);
    if (outcome.paid)
      throw refusal(
        'already_paid',
        'The payer already paid this bill; it cannot be cancelled',
      );
    return this.detail(outcome.row);
  }

  /** CASHAC only: the store returns the money itself. No outbound call. */
  async void(tenantId: string, id: string, input: CancelInput) {
    if (!isUuid(id)) throw notFound();
    const updated = await this.db.transaction(async (tx) => {
      const row = await this.settlement.lock(tx, id, tenantId);
      if (!row) throw notFound();
      const adapter = this.settlement.adapterOf(row);
      if (!adapter.supportsVoid)
        throw refusal(
          'void_not_supported',
          'This payment method cannot be voided; refund it instead',
        );
      // A second void answers the first: no second audit row, nothing to undo twice at the caller.
      if (row.status === 'voided') return row;
      if (row.status !== 'paid')
        throw refusal('not_cancellable', 'Only a paid payment can be voided');
      await adapter.void(toRef(row), { ...input, note: input.note ?? null });
      return this.settlement.move(tx, row, 'voided', {
        source: 'void',
        actorRef: input.actorRef,
        approvedBy: input.approvedBy,
        reasonCode: input.reasonCode,
        note: input.note ?? null,
      });
    });
    return this.detail(updated);
  }

  /**
   * PG payments only. `refund_pending` is committed first, then the PG is asked (idempotent on the payment id).
   * A second request answers the refund already under way. A refused refund can be asked again.
   */
  async refund(tenantId: string, id: string, input: CancelInput) {
    if (!isUuid(id)) throw notFound();
    const requested = await this.db.transaction(async (tx) => {
      const row = await this.settlement.lock(tx, id, tenantId);
      if (!row) throw notFound();
      if (!this.settlement.adapterOf(row).supportsRefund)
        throw refusal(
          'refund_not_supported',
          'This payment method cannot be refunded; void it instead',
        );
      if (row.status === 'refund_pending' || row.status === 'refunded')
        return row;
      if (row.status !== 'paid' && row.status !== 'refund_failed')
        throw refusal(
          'not_cancellable',
          'Only a paid payment can be refunded; cancel a payment that is still waiting',
        );
      return this.settlement.move(tx, row, 'refund_pending', {
        source: 'refund',
        actorRef: input.actorRef,
        approvedBy: input.approvedBy,
        reasonCode: input.reasonCode,
        note: input.note ?? null,
        // This refund's idempotency key at the PG, fixed for as long as it is under way.
        patch: { refundKey: randomUUID() },
      });
    });
    const after =
      requested.status === 'refund_pending'
        ? await this.settlement.executeRefund(id)
        : requested;
    return this.detail(after ?? requested);
  }

  /** The owner returned the money by hand after the PG refused the refund. Needs a note; audited. */
  async markRefundedManually(
    tenantId: string,
    id: string,
    input: ManualRefundInput,
  ) {
    if (!isUuid(id)) throw notFound();
    const updated = await this.db.transaction(async (tx) => {
      const row = await this.settlement.lock(tx, id, tenantId);
      if (!row) throw notFound();
      if (!this.settings.manualRefundMark)
        throw refusal(
          'manual_refund_disabled',
          'Marking a refund as returned by hand is turned off',
        );
      if (row.status !== 'refund_failed')
        throw refusal(
          'not_refund_failed',
          'Only a refund the gateway refused can be marked as returned by hand',
        );
      return this.settlement.move(tx, row, 'refunded', {
        source: 'manual_refund',
        actorRef: input.actorRef,
        approvedBy: input.approvedBy,
        note: input.note,
        clearReview: true,
      });
    });
    return this.detail(updated);
  }

  private async find(tenantId: string, id: string): Promise<PaymentRow> {
    if (!isUuid(id)) throw notFound();
    const [row] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.id, id)));
    if (!row) throw notFound();
    return row;
  }

  /** An adapter failure (a PG that is down) answers 503 and never leaks the adapter's error. */
  private async gateway<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`adapter call failed: ${(error as Error).name}`);
      throw gatewayDown();
    }
  }

  private async detail(p: PaymentRow) {
    const scope = and(
      eq(paymentEvents.tenantId, p.tenantId),
      eq(paymentEvents.paymentId, p.id),
    );
    const events = await this.db
      .select({
        fromStatus: paymentEvents.fromStatus,
        toStatus: paymentEvents.toStatus,
        source: paymentEvents.source,
        actorRef: paymentEvents.actorRef,
        approvedBy: paymentEvents.approvedBy,
        reasonCode: paymentEvents.reasonCode,
        note: paymentEvents.note,
        createdAt: paymentEvents.createdAt,
      })
      .from(paymentEvents)
      .where(scope)
      .orderBy(asc(paymentEvents.createdAt), asc(paymentEvents.id));
    const unmatched = await this.db
      .select({
        id: unmatchedReceipts.id,
        kind: unmatchedReceipts.kind,
        grossAmount: unmatchedReceipts.grossAmount,
        needsReview: unmatchedReceipts.needsReview,
        refundStatus: unmatchedReceipts.refundStatus,
        refundActor: unmatchedReceipts.refundActor,
      })
      .from(unmatchedReceipts)
      .where(
        and(
          eq(unmatchedReceipts.tenantId, p.tenantId),
          eq(unmatchedReceipts.paymentId, p.id),
        ),
      )
      .orderBy(asc(unmatchedReceipts.createdAt), asc(unmatchedReceipts.id));
    const adapter = this.adapters.get(p.method);
    return {
      ...view(p, adapter),
      // What the caller's screen needs to know about this method (D13: can the QR be closed?).
      capabilities: adapter
        ? {
            supportsVoid: adapter.supportsVoid,
            supportsRefund: adapter.supportsRefund,
            canCancel: adapter.canCancel,
            singleUseQr: adapter.singleUseQr,
          }
        : null,
      events,
      unmatchedReceipts: unmatched,
    };
  }
}
