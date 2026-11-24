import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  CancelContext,
  ChargeResult,
  GatewayUnreachableError,
  PaymentAdapter,
  PaymentRef,
  Receipt,
  StatusResult,
} from '../adapters/adapter';
import { AdapterRegistry } from '../adapters/adapters.module';
import { Clock, PaymentSettings } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  outbox,
  paymentEvents,
  payments,
  PaymentStatus,
  ReceiptKind,
  unmatchedReceipts,
} from '../db/schema';
import { canMove, CLOSED_UNPAID } from './transitions';

export type PaymentRow = typeof payments.$inferSelect;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** What caused a status change (stored on the audit row). */
export type Source =
  | 'charge'
  | 'webhook'
  | 'sync'
  | 'reconciliation'
  | 'cancel'
  | 'void'
  | 'refund'
  | 'manual_refund'
  | 'system';

export const SYSTEM_ACTOR = 'system';

export interface MoveMeta {
  source: Source;
  actorRef?: string;
  approvedBy?: string | null;
  reasonCode?: string | null;
  note?: string | null;
  /** Flags the payment needs_review with this reason, in the same write. */
  review?: string;
  /** The reason for review is resolved (the money is back with the payer). */
  clearReview?: boolean;
  patch?: Partial<
    Pick<
      PaymentRow,
      'providerRef' | 'checkout' | 'expiresAt' | 'paidReceiptRef' | 'feeAmount'
    >
  >;
}

/** What `settle` must still do with the PG once its transaction is committed. */
interface FollowUp {
  row: PaymentRow;
  refundPayment: boolean;
  refundReceipts: string[];
}

export const toRef = (p: PaymentRow): PaymentRef => ({
  id: p.id,
  tenantId: p.tenantId,
  orderRef: p.orderRef,
  method: p.method,
  amount: p.amount,
  providerRef: p.providerRef,
  expiresAt: p.expiresAt,
});

const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as Partial<T>;

const SYSTEM_REFUND: CancelContext = {
  reasonCode: 'unmatched_receipt',
  note: 'automatic refund of money that matches no payment',
  actorRef: SYSTEM_ACTOR,
  approvedBy: SYSTEM_ACTOR,
};

/**
 * The payment state machine and every conversation with an adapter about a payment's state.
 *
 * `settle` is the ONE way a payment learns what the PG knows. Webhook, manual sync and reconciliation all call
 * it; it locks the payment row, asks the adapter, and moves the status at most once. Whoever comes second finds
 * the payment already moved and changes nothing.
 *
 * Queries here find a payment by id alone when the caller is a webhook or the reconciliation: the tenant then
 * comes from our own row, never from what the PG sent. Routes for a calling service pass `tenantId` and get the
 * usual tenant filter.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly adapters: AdapterRegistry,
    private readonly settings: PaymentSettings,
    private readonly clock: Clock,
  ) {}

  adapterOf(row: Pick<PaymentRow, 'method'>): PaymentAdapter {
    const adapter = this.adapters.get(row.method);
    // A stored method whose adapter was removed from the deploy: a server fault, never a client error.
    if (!adapter) throw new Error('No adapter for a stored payment method');
    return adapter;
  }

  /** `select … for update`: held until the transaction ends, so one status change happens at a time. */
  async lock(
    tx: Tx,
    id: string,
    tenantId?: string,
  ): Promise<PaymentRow | undefined> {
    const [row] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, id),
          tenantId ? eq(payments.tenantId, tenantId) : undefined,
        ),
      )
      .for('update');
    return row;
  }

  /**
   * Moves a locked payment to `to` and writes, in the same transaction, its audit row and the outbox notice
   * for the calling service. A move the transition table does not allow changes nothing and is logged.
   */
  async move(
    tx: Tx,
    row: PaymentRow,
    to: PaymentStatus,
    meta: MoveMeta,
  ): Promise<PaymentRow> {
    if (!canMove(row.status, to)) {
      this.logger.warn(
        `refused move ${row.status} → ${to} for payment ${row.id} (${meta.source})`,
      );
      return row;
    }
    const now = this.clock.now();
    const [updated] = await tx
      .update(payments)
      .set({
        ...defined(meta.patch ?? {}),
        status: to,
        paidAt: to === 'paid' ? now : row.paidAt,
        needsReview: meta.review
          ? true
          : meta.clearReview
            ? false
            : row.needsReview,
        reviewReason: meta.review ?? row.reviewReason,
        updatedAt: now,
      })
      .where(eq(payments.id, row.id))
      .returning();
    await this.audit(tx, row, to, meta, now);
    await this.notify(tx, updated, `payment.${to}`, now);
    return updated;
  }

  private async audit(
    tx: Tx,
    row: PaymentRow,
    to: PaymentStatus,
    meta: MoveMeta,
    now: Date,
  ) {
    await tx.insert(paymentEvents).values({
      tenantId: row.tenantId,
      paymentId: row.id,
      fromStatus: row.status,
      toStatus: to,
      source: meta.source,
      actorRef: meta.actorRef ?? SYSTEM_ACTOR,
      approvedBy: meta.approvedBy ?? null,
      reasonCode: meta.reasonCode ?? null,
      note: meta.note ?? meta.review ?? null,
      createdAt: now,
    });
  }

  /** Flags a payment for the owner without changing its status. Once per reason. */
  private async flag(
    tx: Tx,
    row: PaymentRow,
    reason: string,
    source: Source,
  ): Promise<PaymentRow> {
    if (row.needsReview && row.reviewReason === reason) return row;
    const now = this.clock.now();
    const [updated] = await tx
      .update(payments)
      .set({ needsReview: true, reviewReason: reason, updatedAt: now })
      .where(eq(payments.id, row.id))
      .returning();
    await this.audit(tx, row, row.status, { source, note: reason }, now);
    await this.notify(tx, updated, 'payment.needs_review', now);
    return updated;
  }

  private async notify(
    tx: Tx,
    p: PaymentRow,
    topic: string,
    now: Date,
    extra: Record<string, unknown> = {},
  ) {
    await tx.insert(outbox).values({
      tenantId: p.tenantId,
      paymentId: p.id,
      topic,
      // The receiver completes or cancels its order idempotently by paymentId.
      payload: {
        paymentId: p.id,
        orderRef: p.orderRef,
        attempt: p.attempt,
        method: p.method,
        amount: p.amount,
        status: p.status,
        needsReview: p.needsReview,
        reviewReason: p.reviewReason,
        ...extra,
      },
      createdAt: now,
    });
  }

  /**
   * Asks the adapter where the payment stands and applies the answer, under the row lock.
   * Returns undefined when there is no such payment (for this tenant, when one is given).
   * Throws what the adapter throws (a PG that is down): nothing was changed, the caller retries later.
   */
  async settle(
    id: string,
    source: Source,
    tenantId?: string,
  ): Promise<PaymentRow | undefined> {
    const outcome = await this.db.transaction(
      async (tx): Promise<FollowUp | undefined> => {
        const row = await this.lock(tx, id, tenantId);
        if (!row) return undefined;
        const quiet = { row, refundPayment: false, refundReceipts: [] };
        // CASHAC never waits on anyone. A voided payment was never at a PG.
        if (this.adapterOf(row).kind === 'cashac' || row.status === 'voided')
          return quiet;
        const now = this.clock.now();
        // A cashier's screen polls: the PG is asked at most once per interval per payment, and in between the
        // stored status is the answer (with `lastSyncedAt` saying how old it is).
        if (
          source === 'sync' &&
          row.lastSyncedAt &&
          now.getTime() - row.lastSyncedAt.getTime() <
            this.settings.syncMinIntervalMs
        )
          return quiet;

        const answer = await this.adapterOf(row).getStatus(toRef(row));
        await tx
          .update(payments)
          .set({ lastSyncedAt: now })
          .where(eq(payments.id, row.id));
        return this.apply(tx, { ...row, lastSyncedAt: now }, answer, source);
      },
    );
    if (!outcome) return undefined;
    // Refunds are a second conversation with the PG, after `refund_pending` is committed.
    for (const receiptId of outcome.refundReceipts)
      await this.executeReceiptRefund(receiptId);
    return outcome.refundPayment ? this.executeRefund(id) : outcome.row;
  }

  /** The transition rules: what a PG answer does to a locked payment in each status. */
  async apply(
    tx: Tx,
    before: PaymentRow,
    answer: StatusResult,
    source: Source,
  ): Promise<FollowUp> {
    let row = before;
    let refundPayment = false;
    const receipts = answer.receipts ?? [];
    const patch = {
      providerRef: answer.providerRef,
      expiresAt: answer.expiresAt,
      checkout: answer.checkout,
    };

    if (row.status === 'refund_pending') {
      const request = await this.refundRequest(tx, row.id);
      const refund = request ? answer.refunds?.[request.id] : undefined;
      if (refund === 'succeeded')
        row = await this.move(tx, row, 'refunded', {
          source,
          clearReview: true,
        });
      else if (refund === 'failed')
        row = await this.move(tx, row, 'refund_failed', {
          source,
          review: 'refund_failed',
        });
      // The PG has no refund on record: our request never arrived. Ask again (idempotent on the key).
      else if (refund === undefined) refundPayment = true;
    } else if (row.status === 'created' || row.status === 'pending') {
      row = await this.applyOpen(tx, row, answer, receipts, patch, source);
    }

    // Every receipt that is not the one that paid this payment is money without a payment: late (the bill
    // was closed), a second payment, or the wrong amount. It is recorded outside the live-payment index, so
    // this can never fail on it, and the payment's own status does not change.
    const refundReceipts: string[] = [];
    for (const receipt of receipts) {
      if (receipt.id === row.paidReceiptRef) continue;
      const kind: ReceiptKind =
        receipt.grossAmount !== row.amount
          ? 'amount_mismatch'
          : CLOSED_UNPAID.includes(row.status)
            ? 'late_payment'
            : 'duplicate';
      const id = await this.recordUnmatched(tx, row, receipt, kind, source);
      if (id) refundReceipts.push(id);
    }
    // Refunds of unmatched money still on their way.
    const waiting = await tx
      .select()
      .from(unmatchedReceipts)
      .where(
        and(
          eq(unmatchedReceipts.paymentId, row.id),
          eq(unmatchedReceipts.refundStatus, 'pending'),
        ),
      );
    for (const u of waiting) {
      if (refundReceipts.includes(u.id)) continue;
      const refund = answer.refunds?.[u.id];
      if (refund === undefined) refundReceipts.push(u.id);
      else if (refund !== 'pending')
        await this.closeReceiptRefund(tx, u.id, refund);
    }
    return { row, refundPayment, refundReceipts };
  }

  private async applyOpen(
    tx: Tx,
    row: PaymentRow,
    answer: StatusResult,
    receipts: Receipt[],
    patch: MoveMeta['patch'],
    source: Source,
  ): Promise<PaymentRow> {
    // A receipt for the exact gross amount pays a payment that is still open on our side, whatever else the PG
    // says about the bill (the caller still holds the order for it).
    const paying = receipts.find((r) => r.grossAmount === row.amount);
    if (paying)
      return this.move(tx, row, 'paid', {
        source,
        patch: {
          ...patch,
          paidReceiptRef: paying.id,
          feeAmount: paying.feeAmount,
        },
      });
    switch (answer.status) {
      case 'paid':
        // Paid at the PG, but not in the amount we charged: never marked paid (the receipts become unmatched).
        return row;
      case 'pending':
        return row.status === 'created'
          ? this.move(tx, row, 'pending', { source, patch })
          : row;
      case 'expired': {
        // Never on our clock alone: the PG said unpaid, AND the grace period for a payment on its way is over.
        const expiresAt = row.expiresAt ?? answer.expiresAt;
        const waitUntil = expiresAt
          ? expiresAt.getTime() + this.settings.expiryGraceMs
          : 0;
        return this.clock.now().getTime() < waitUntil
          ? row
          : this.move(tx, row, 'expired', { source });
      }
      case 'cancelled':
      case 'failed':
        return this.move(tx, row, answer.status, { source });
      case 'not_found': {
        if (row.status === 'pending')
          return this.flag(tx, row, 'missing_at_gateway', source);
        // One "no such bill" proves nothing (the PG may lag, or still accept the timed-out request).
        // Failed only when a second lookup, at least the configured time later, says the same.
        const now = this.clock.now();
        if (!row.notFoundAt) {
          await tx
            .update(payments)
            .set({ notFoundAt: now })
            .where(eq(payments.id, row.id));
          return { ...row, notFoundAt: now };
        }
        return now.getTime() - row.notFoundAt.getTime() >=
          this.settings.notFoundConfirmMs
          ? this.move(tx, row, 'failed', {
              source,
              note: 'no bill at the gateway on two lookups',
            })
          : row;
      }
    }
  }

  /** Records unmatched money once per PG receipt. Returns its id when it is new and must be refunded. */
  private async recordUnmatched(
    tx: Tx,
    row: PaymentRow,
    receipt: Receipt,
    kind: ReceiptKind,
    source: Source,
  ): Promise<string | undefined> {
    const now = this.clock.now();
    const autoRefund =
      this.settings.lateAutoRefund && this.adapterOf(row).supportsRefund;
    const [inserted] = await tx
      .insert(unmatchedReceipts)
      .values({
        tenantId: row.tenantId,
        paymentId: row.id,
        receiptRef: receipt.id,
        kind,
        grossAmount: receipt.grossAmount,
        feeAmount: receipt.feeAmount,
        refundStatus: autoRefund ? 'pending' : 'none',
        refundActor: autoRefund ? SYSTEM_ACTOR : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted) return undefined;
    await this.audit(
      tx,
      row,
      row.status,
      {
        source,
        note: `unmatched receipt (${kind})${autoRefund ? ', refund requested by system' : ''}`,
      },
      now,
    );
    await this.notify(tx, row, 'payment.unmatched_receipt', now, {
      unmatchedReceiptId: inserted.id,
      kind,
      grossAmount: receipt.grossAmount,
    });
    return autoRefund ? inserted.id : undefined;
  }

  private async closeReceiptRefund(
    tx: Tx,
    id: string,
    result: 'succeeded' | 'failed',
  ) {
    await tx
      .update(unmatchedReceipts)
      .set({
        refundStatus: result === 'succeeded' ? 'refunded' : 'failed',
        // Off the owner's list only once the money is back.
        needsReview: result !== 'succeeded',
        updatedAt: this.clock.now(),
      })
      .where(eq(unmatchedReceipts.id, id));
  }

  /**
   * Creates the bill at the PG for a payment already committed as `created`.
   * - The PG refuses, or certainly was never reached: `failed`, so the cashier can pick another method at once.
   * - Unknown outcome (a timeout): ask the PG by our reference; use the bill when it exists, else create it
   *   again with the same reference. Still unknown: the payment stays `created` for the reconciliation, which
   *   fails it only after two lookups say there is no bill.
   */
  async startCharge(row: PaymentRow): Promise<PaymentRow> {
    const adapter = this.adapterOf(row);
    const ref = toRef(row);
    let result: ChargeResult | undefined;
    try {
      result = await adapter.charge(ref);
    } catch (error) {
      if (error instanceof GatewayUnreachableError) {
        result = { status: 'failed' };
      } else {
        this.logger.warn(
          `charge outcome unknown for payment ${row.id}: ${(error as Error).name}`,
        );
        try {
          const found = await this.settle(row.id, 'charge');
          if (found && found.status !== 'created') return found;
          result = await adapter.charge(ref);
        } catch (again) {
          this.logger.error(
            `charge still unknown for payment ${row.id}: ${(again as Error).name}`,
          );
        }
      }
    }
    const answer = result;
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, row.id);
      // A webhook can beat the charge response: the payment is then already further on.
      if (!current || current.status !== 'created' || !answer)
        return current ?? row;
      return this.move(tx, current, answer.status, {
        source: 'charge',
        patch: {
          providerRef: answer.providerRef,
          expiresAt: answer.expiresAt,
          checkout: answer.checkout,
        },
      });
    });
  }

  /** The audit row of the refund now under way; its id is that refund's idempotency key at the PG. */
  private async refundRequest(tx: Tx, paymentId: string) {
    const [request] = await tx
      .select()
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.paymentId, paymentId),
          eq(paymentEvents.toStatus, 'refund_pending'),
        ),
      )
      .orderBy(desc(paymentEvents.createdAt), desc(paymentEvents.id))
      .limit(1);
    return request;
  }

  /**
   * Sends the refund of a `refund_pending` payment to the PG and stores the answer. Safe to repeat: the PG
   * dedupes on the payment id, and a payment no longer `refund_pending` is left alone. When the PG cannot be
   * reached the payment stays `refund_pending` and the reconciliation tries again.
   */
  async executeRefund(id: string): Promise<PaymentRow | undefined> {
    return this.db.transaction(async (tx) => {
      const row = await this.lock(tx, id);
      if (!row || row.status !== 'refund_pending') return row;
      const request = await this.refundRequest(tx, id);
      const context: CancelContext = {
        reasonCode: request?.reasonCode ?? 'other',
        note: request?.note ?? null,
        actorRef: request?.actorRef ?? SYSTEM_ACTOR,
        approvedBy: request?.approvedBy ?? SYSTEM_ACTOR,
      };
      let status: 'pending' | 'succeeded' | 'failed';
      try {
        ({ status } = await this.adapterOf(row).refund(
          toRef(row),
          {
            // One key per refund request: a retry after a refusal is a new refund at the PG, while a
            // repeated call for the same request is the same one.
            key: request?.id ?? row.id,
            receiptId: row.paidReceiptRef,
            amount: row.amount,
          },
          context,
        ));
      } catch (error) {
        this.logger.warn(
          `refund not confirmed for payment ${id}: ${(error as Error).name}`,
        );
        return row;
      }
      if (status === 'succeeded')
        return this.move(tx, row, 'refunded', {
          source: 'refund',
          clearReview: true,
        });
      if (status === 'failed')
        return this.move(tx, row, 'refund_failed', {
          source: 'refund',
          review: 'refund_failed',
        });
      return row;
    });
  }

  /**
   * Refunds one unmatched receipt, as `system` (no supervisor: nobody chose this refund, the rule did).
   * Once per receipt: the row is locked, and the PG dedupes on the receipt row's id.
   */
  async executeReceiptRefund(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(unmatchedReceipts)
        .where(eq(unmatchedReceipts.id, id))
        .for('update');
      if (!receipt || receipt.refundStatus !== 'pending') return;
      const [row] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, receipt.paymentId));
      try {
        const { status } = await this.adapterOf(row).refund(
          toRef(row),
          {
            key: receipt.id,
            receiptId: receipt.receiptRef,
            amount: receipt.grossAmount,
          },
          SYSTEM_REFUND,
        );
        if (status !== 'pending') await this.closeReceiptRefund(tx, id, status);
      } catch (error) {
        // Stays `pending`: the reconciliation asks again.
        this.logger.warn(
          `refund of unmatched receipt ${id} not confirmed: ${(error as Error).name}`,
        );
      }
    });
  }
}
