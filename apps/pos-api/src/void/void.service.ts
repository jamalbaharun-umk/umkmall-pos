import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { fieldError } from '../common/validation';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  ACTOR_KINDS,
  paymentMethods,
  receivablePayments,
  receivables,
  sales,
  saleVoidReturns,
  saleVoids,
  shifts,
  staff,
} from '../db/schema';
import { recordAudit } from '../audit/record';
import {
  cancelReceivable,
  standingPayment,
} from '../receivables/receivables.controller';
import { actorRef, PaymentSync } from '../payments-client/payment-sync.service';
import { isOnlineMethod } from '../payments-client/payments.client';
import {
  paymentHttpError,
  refusal,
} from '../payments-client/sale-payment.service';
import {
  isSoloOwner,
  lockOpenShift,
  recordShiftCash,
} from '../shifts/cash-ledger';
import { isUniqueViolation } from '../staff/http';
import { hasPermission } from '../staff/require-permission';
import { StockService, type Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import { restoreVoucher } from '../vouchers/vouchers.controller';
import { type Approver, VoidPins } from './void-pin';
import type { RefundRetryInput, VoidInput } from './void.schemas';

const NO_SHIFT = 'Buka shift dulu untuk membatalkan struk tunai';
const ALREADY_VOID = 'Struk ini sudah dibatalkan';
const KEY_REUSED = 'Kunci ini sudah dipakai untuk pembatalan lain';
// UMK-1991: only a receipt is voided. A sale awaiting payment is finished or cancelled by its payment.
const AWAITING = 'Penjualan ini masih menunggu pembayaran';
const NOT_A_RECEIPT = 'Penjualan ini dibatalkan sebelum dibayar';
// UMK-1991 (V5): a payment taken at the cashier is voided, a payment through a gateway is refunded.
const USE_REFUND =
  'Penjualan ini dibayar lewat pembayaran online: batalkan dengan refund';
const USE_VOID = 'Penjualan ini tidak dibayar lewat pembayaran online';

/** `void`: the store returns the money itself. `refund`: the payment gateway returns it. */
export type CancelMode = 'void' | 'refund';

const wrongMode = (mode: CancelMode) =>
  new ConflictException({
    message: mode === 'void' ? USE_REFUND : USE_VOID,
    code: mode === 'void' ? 'use_refund' : 'use_void',
  });

/** The request's fingerprint for a replay. The PIN is not part of it and is stored nowhere. */
const requestHash = (saleId: string, input: VoidInput) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        saleId,
        input.reasonCode,
        input.note || null,
        input.approverId,
      ]),
    )
    .digest('hex');

type Return = {
  amount: number;
  paymentMethodId: string;
  /** Cash out of the open shift's drawer; otherwise the store returns it by transfer. */
  fromDrawer: boolean;
  receivablePaymentId: string | null;
};

/**
 * Void of a full sale (UMK-1962), for CASHAC payments: cash, debit/wallet (EDC, transfer, the store's
 * QRIS) and kasbon. The sale and its lines stay as rung up; the sale moves to status `void` and a
 * pos.sale_voids row records the reversal and who started and approved it.
 *
 * Every timestamp of a void is the database's `now()`, which is the transaction's start time: the sale's
 * `voided_at`, the receivable's `cancelled_at`, the void's and the ledger entry's `created_at` are equal.
 *
 * One transaction, in this lock order (the order a sale and a kasbon payment use, so they cannot
 * deadlock): sale row, receivable row, the actor's open shift (cash ledger), voucher quota, stock batches.
 *
 * Checks run cheapest and safest first: validation, replay, sale state, open shift, then the approver's
 * PIN. A request that cannot succeed never costs a PIN attempt.
 *
 * UMK-1991: a sale paid through a payment gateway is cancelled by REFUND (`mode`), never by void. It is the
 * same record with `refund_status` set: the sale is reversed at once, the money counts as returned by
 * transfer (no drawer), and the refund is asked at payment-api after the commit like a void's payments.
 */
@Injectable()
export class VoidService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly pins: VoidPins,
    private readonly payments: PaymentSync,
  ) {}

  async void(
    s: PosSession,
    saleId: string,
    key: string,
    input: VoidInput,
    mode: CancelMode = 'void',
  ) {
    const hash = requestHash(saleId, input);
    const prior = await this.replay(s, saleId, key, hash);
    if (prior) return prior;

    await this.precheck(s, saleId, mode);
    const approver = await this.pins.verify(
      s.tenantId,
      input.approverId,
      input.pin,
    );

    let id: string;
    try {
      id = await this.db.transaction((tx) =>
        this.apply(tx, s, saleId, key, hash, input, approver, mode),
      );
    } catch (e) {
      // The same key raced in on another sale: the unique index refused this one.
      if (isUniqueViolation(e)) {
        const winner = await this.replay(s, saleId, key, hash);
        if (winner) return winner;
      }
      throw e;
    }
    // UMK-1991: the sale is voided here; now its payments in payment-api (the job repeats a failure).
    const voidId = id;
    await this.payments.afterCommit('void', voidId, () =>
      this.payments.syncVoid(s.tenantId, voidId),
    );
    return this.view(s, id);
  }

  /** The first result for this key, when it is the same request; another request under the key is refused. */
  private async replay(
    s: PosSession,
    saleId: string,
    key: string,
    hash: string,
  ) {
    const [prior] = await this.db
      .select({
        id: saleVoids.id,
        saleId: saleVoids.saleId,
        requestHash: saleVoids.requestHash,
      })
      .from(saleVoids)
      .where(
        and(
          eq(saleVoids.tenantId, s.tenantId),
          eq(saleVoids.idempotencyKey, key),
        ),
      );
    if (!prior) return null;
    if (prior.saleId !== saleId || prior.requestHash !== hash)
      throw fieldError('idempotencyKey', KEY_REUSED);
    return this.view(s, prior.id);
  }

  /**
   * Refusals that need no PIN, read without locks (the transaction decides again under its locks):
   * unknown sale 404, already voided 409, cash to give back but no open shift 422.
   */
  private async precheck(s: PosSession, saleId: string, mode: CancelMode) {
    const [sale] = await this.db
      .select({
        status: sales.status,
        code: sales.paymentMethodCode,
        total: sales.total,
        rounding: sales.rounding,
        isCash: paymentMethods.isCash,
        isCredit: paymentMethods.isCredit,
      })
      .from(sales)
      .innerJoin(
        paymentMethods,
        and(
          eq(paymentMethods.tenantId, sales.tenantId),
          eq(paymentMethods.id, sales.paymentMethodId),
        ),
      )
      .where(and(eq(sales.tenantId, s.tenantId), eq(sales.id, saleId)));
    if (!sale) throw new NotFoundException();
    if (sale.status === 'void') throw new ConflictException(ALREADY_VOID);
    if (sale.status === 'awaiting_payment')
      throw new ConflictException(AWAITING);
    if (sale.status === 'cancelled') throw new ConflictException(NOT_A_RECEIPT);
    if (isOnlineMethod(sale.code) !== (mode === 'refund'))
      throw wrongMode(mode);
    // A refund can only go through payment-api.
    if (mode === 'refund' && !this.payments.enabled)
      throw new ServiceUnavailableException({
        message: 'Layanan pembayaran tidak aktif',
        code: 'payment_unavailable',
      });

    let cashDue = sale.isCash ? sale.total + sale.rounding : 0;
    if (sale.isCredit) {
      const paid = await this.db
        .select({ amount: receivablePayments.amount })
        .from(receivablePayments)
        .innerJoin(
          receivables,
          and(
            eq(receivables.tenantId, receivablePayments.tenantId),
            eq(receivables.id, receivablePayments.receivableId),
          ),
        )
        .innerJoin(
          paymentMethods,
          and(
            eq(paymentMethods.tenantId, receivablePayments.tenantId),
            eq(paymentMethods.id, receivablePayments.paymentMethodId),
          ),
        )
        .where(
          and(
            eq(receivables.tenantId, s.tenantId),
            eq(receivables.saleId, saleId),
            eq(paymentMethods.isCash, true),
            standingPayment,
          ),
        );
      cashDue = paid.reduce((n, p) => n + p.amount, 0);
    }
    if (cashDue === 0) return;
    const [open] = await this.db
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, s.tenantId),
          eq(shifts.actorId, s.actorId),
          isNull(shifts.closedAt),
        ),
      );
    // A solo owner's void opens the shift in its transaction (UMK-2120, `lockDrawerShift`).
    if (!open && !(await isSoloOwner(this.db, s)))
      throw fieldError('_', NO_SHIFT);
  }

  private async apply(
    tx: Tx,
    s: PosSession,
    saleId: string,
    key: string,
    hash: string,
    input: VoidInput,
    approver: Approver,
    mode: CancelMode,
  ): Promise<string> {
    // The sale's row lock: two voids of one sale run one after the other, and the second finds it voided.
    const [sale] = await tx
      .select()
      .from(sales)
      .where(and(eq(sales.tenantId, s.tenantId), eq(sales.id, saleId)))
      .for('update');
    if (!sale) throw new NotFoundException();
    if (sale.status === 'void') {
      const [done] = await tx
        .select({
          id: saleVoids.id,
          key: saleVoids.idempotencyKey,
          hash: saleVoids.requestHash,
        })
        .from(saleVoids)
        .where(
          and(eq(saleVoids.tenantId, s.tenantId), eq(saleVoids.saleId, saleId)),
        );
      // The same request sent twice at once: the second returns the first's result.
      if (done && done.key === key && done.hash === hash) return done.id;
      throw new ConflictException(ALREADY_VOID);
    }
    if (sale.status === 'awaiting_payment')
      throw new ConflictException(AWAITING);
    if (sale.status === 'cancelled') throw new ConflictException(NOT_A_RECEIPT);
    const online = isOnlineMethod(sale.paymentMethodCode);
    if (online !== (mode === 'refund')) throw wrongMode(mode);

    const [method] = await tx
      .select({
        isCash: paymentMethods.isCash,
        isCredit: paymentMethods.isCredit,
      })
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.tenantId, s.tenantId),
          eq(paymentMethods.id, sale.paymentMethodId),
        ),
      );

    // What the customer paid on this receipt goes back by the way it came in.
    let returns: Return[] = [];
    let receivableCancelled = 0;
    if (method.isCredit) {
      const r = await cancelReceivable(tx, s.tenantId, saleId);
      if (!r) throw new Error('credit sale without a receivable');
      receivableCancelled = r.cancelled;
      returns = r.payments.map((p) => ({
        amount: p.amount,
        paymentMethodId: p.paymentMethodId,
        fromDrawer: p.isCash,
        receivablePaymentId: p.id,
      }));
    } else if (sale.total > 0) {
      // A cash sale gives back what it took in (paid − change = total + rounding, UMK-1993), not the
      // amount tendered. `rounding` is 0 for every other method.
      returns = [
        {
          amount: sale.total + sale.rounding,
          paymentMethodId: sale.paymentMethodId,
          fromDrawer: method.isCash,
          receivablePaymentId: null,
        },
      ];
    }
    const sum = (drawer: boolean) =>
      returns
        .filter((r) => r.fromDrawer === drawer)
        .reduce((n, r) => n + r.amount, 0);
    const cashReturned = sum(true);
    const transferReturned = sum(false);

    // Cash leaves the drawer of the shift that is open NOW (the actor's); the sale's own shift, open or
    // closed, is not touched. Money returned by transfer never reaches a drawer and needs no shift; the
    // actor's open shift, when there is one, is still recorded, so the shift report shows the reversal
    // in the shift where the void was done.
    const id = randomUUID();
    const shiftId =
      cashReturned > 0
        ? await recordShiftCash(
            tx,
            s,
            {
              direction: 'out',
              kind: 'void_refund',
              amount: cashReturned,
              refId: id,
            },
            NO_SHIFT,
          )
        : ((await lockOpenShift(tx, s))?.id ?? null);

    if (sale.voucherId) await restoreVoucher(tx, s.tenantId, sale.voucherId);
    await this.stock.restoreSale(tx, {
      tenantId: s.tenantId,
      saleId,
      actorId: s.actorId,
    });

    await tx.insert(saleVoids).values({
      id,
      tenantId: s.tenantId,
      saleId,
      idempotencyKey: key,
      requestHash: hash,
      reasonCode: input.reasonCode,
      note: input.note || null,
      actorId: s.actorId,
      actorKind: s.kind,
      approvedBy: approver.id,
      approvedByKind: approver.kind,
      shiftId,
      cashReturned,
      transferReturned,
      receivableCancelled,
      subtotal: sale.subtotal,
      discount: sale.discount,
      voucherDiscount: sale.voucherDiscount,
      tax: sale.tax,
      total: sale.total,
      rounding: sale.rounding,
      costTotal: sale.costTotal,
      paymentSyncPending: this.payments.enabled,
      // The gateway has the money: the refund is asked after this commit and can still be refused (V4).
      refundStatus: online ? 'pending' : null,
    });
    await recordAudit(tx, s, mode === 'refund' ? 'refund' : 'void', {
      target: {
        type: 'sale',
        id: saleId,
        label: sale.number ? `#${sale.number}` : undefined,
      },
      details: {
        saleId,
        reasonCode: input.reasonCode,
        total: sale.total,
        approvedBy: approver.id,
      },
    });
    if (returns.length)
      await tx
        .insert(saleVoidReturns)
        .values(
          returns.map((r) => ({ ...r, tenantId: s.tenantId, voidId: id })),
        );
    await tx
      .update(sales)
      .set({ status: 'void', voidedAt: sql`now()` })
      .where(and(eq(sales.tenantId, s.tenantId), eq(sales.id, saleId)));
    return id;
  }

  /** The refund of a sale the store may act on, as `view` answers it; 404 when the sale has none. */
  private async refundView(s: PosSession, saleId: string) {
    const [row] = await this.db
      .select({ id: saleVoids.id, refundStatus: saleVoids.refundStatus })
      .from(saleVoids)
      .where(
        and(eq(saleVoids.tenantId, s.tenantId), eq(saleVoids.saleId, saleId)),
      );
    if (!row || row.refundStatus === null) throw new NotFoundException();
    return this.view(s, row.id);
  }

  /**
   * `POST /sales/:id/refund/retry`: asks a refund the gateway refused again (V4). The owner only, approved by
   * the owner's own PIN (UMK-2040): an unknown sale answers 404 before the PIN is checked, so it costs no
   * attempt; the PIN is checked (and committed) before payment-api is called. The void record is not
   * touched: `sale_voids.approved_by` stays who approved the refund; this retry's approver is on
   * payment-api's audit row of the new request.
   */
  async retryRefund(s: PosSession, saleId: string, input: RefundRetryInput) {
    if (s.kind !== 'owner') throw new ForbiddenException();
    await this.refundView(s, saleId);
    // The owner's own PIN (owner decision 2026-11-26): an admin's PIN approves a void, not this.
    const approver = await this.pins.verifyOwner(
      s.tenantId,
      input.approverId,
      input.pin,
    );
    await this.auditSale(s, saleId, 'refund_retry', {
      approvedBy: approver.id,
    });
    await this.payments
      .retryRefund(
        s.tenantId,
        saleId,
        actorRef(s.kind, s.actorId),
        actorRef(approver.kind, approver.id),
      )
      .catch((error: unknown) => {
        throw paymentHttpError(error);
      });
    return this.refundView(s, saleId);
  }

  /** One audit row about a sale (committed on its own, see the callers). */
  private async auditSale(
    s: PosSession,
    saleId: string,
    event: 'refund_manual' | 'refund_retry',
    details: Record<string, unknown> = {},
  ) {
    const [sale] = await this.db
      .select({ number: sales.number })
      .from(sales)
      .where(and(eq(sales.tenantId, s.tenantId), eq(sales.id, saleId)));
    await recordAudit(this.db, s, event, {
      target: {
        type: 'sale',
        id: saleId,
        label: sale?.number ? `#${sale.number}` : undefined,
      },
      details: { saleId, ...details },
    });
  }

  /** `POST /sales/:id/refund/manual`: the store returned the money of a refused refund by hand (V4). */
  async markRefundManual(s: PosSession, saleId: string, note: string) {
    // The owner only (the approved spec): it says the store's money went back outside the gateway.
    if (s.kind !== 'owner') throw new ForbiddenException();
    await this.refundView(s, saleId);
    // What is stored may be old (the gateway refused the refund and nothing has asked since): ask first.
    await this.payments
      .followRefund(s.tenantId, saleId)
      .catch((error: unknown) => {
        throw paymentHttpError(error);
      });
    const refund = await this.refundView(s, saleId);
    // Only a refund the gateway refused; one already marked answers as it stands.
    if (refund.refundStatus === 'succeeded') return refund;
    if (refund.refundStatus !== 'failed') throw refusal('not_refund_failed');
    // Write-ahead: payment-api cannot be called inside a transaction (a rule of this module), so the log row is
    // committed BEFORE the call. A crash or a failed insert then stops the correction instead of leaving it
    // done and unlogged; a call payment-api refuses leaves a row for a request that changed nothing. The
    // note is free text and never stored here.
    await this.auditSale(s, saleId, 'refund_manual');
    await this.payments
      .markRefundManual(s.tenantId, saleId, note, actorRef(s.kind, s.actorId))
      .catch((error: unknown) => {
        throw paymentHttpError(error);
      });
    return this.refundView(s, saleId);
  }

  /** `GET /sales/:id/void`: the void of a sale the actor may see (theirs, one they voided, or `reports.view`). */
  async ofSale(s: PosSession, saleId: string) {
    const [row] = await this.db
      .select({
        id: saleVoids.id,
        actorId: saleVoids.actorId,
        approvedBy: saleVoids.approvedBy,
        seller: sales.actorId,
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
        and(eq(saleVoids.tenantId, s.tenantId), eq(saleVoids.saleId, saleId)),
      );
    if (
      !row ||
      !(
        hasPermission(s, 'reports.view') ||
        [row.actorId, row.approvedBy, row.seller].includes(s.actorId)
      )
    )
      throw new NotFoundException();
    return this.view(s, row.id);
  }

  /** The void as the API shows it. Cost only to `reports.view`. */
  private async view(s: PosSession, id: string) {
    const [v] = await this.db
      .select({
        id: saleVoids.id,
        saleId: saleVoids.saleId,
        saleNumber: sales.number,
        reasonCode: saleVoids.reasonCode,
        note: saleVoids.note,
        actorId: saleVoids.actorId,
        actorKind: saleVoids.actorKind,
        approvedBy: saleVoids.approvedBy,
        approvedByKind: saleVoids.approvedByKind,
        shiftId: saleVoids.shiftId,
        cashReturned: saleVoids.cashReturned,
        transferReturned: saleVoids.transferReturned,
        receivableCancelled: saleVoids.receivableCancelled,
        subtotal: saleVoids.subtotal,
        discount: saleVoids.discount,
        voucherDiscount: saleVoids.voucherDiscount,
        tax: saleVoids.tax,
        total: saleVoids.total,
        rounding: saleVoids.rounding,
        costTotal: saleVoids.costTotal,
        // UMK-1991: null = a void; otherwise where the gateway's refund stands.
        refundStatus: saleVoids.refundStatus,
        createdAt: saleVoids.createdAt,
      })
      .from(saleVoids)
      .innerJoin(
        sales,
        and(
          eq(sales.tenantId, saleVoids.tenantId),
          eq(sales.id, saleVoids.saleId),
        ),
      )
      .where(and(eq(saleVoids.tenantId, s.tenantId), eq(saleVoids.id, id)));
    if (!v) throw new NotFoundException();
    const [returns, names] = await Promise.all([
      this.db
        .select({
          amount: saleVoidReturns.amount,
          paymentMethod: paymentMethods.name,
          fromDrawer: saleVoidReturns.fromDrawer,
          receivablePaymentId: saleVoidReturns.receivablePaymentId,
          // A kasbon instalment that was taken without an open shift (UMK-1963): its cash comes out of
          // this void's drawer although no shift's expected cash ever held it.
          collectedOutsideShift: sql<boolean>`coalesce(${receivablePayments.collectedOutsideShift}, false)`,
        })
        .from(saleVoidReturns)
        .innerJoin(
          paymentMethods,
          and(
            eq(paymentMethods.tenantId, saleVoidReturns.tenantId),
            eq(paymentMethods.id, saleVoidReturns.paymentMethodId),
          ),
        )
        .leftJoin(
          receivablePayments,
          and(
            eq(receivablePayments.tenantId, saleVoidReturns.tenantId),
            eq(receivablePayments.id, saleVoidReturns.receivablePaymentId),
          ),
        )
        .where(
          and(
            eq(saleVoidReturns.tenantId, s.tenantId),
            eq(saleVoidReturns.voidId, id),
          ),
        )
        // Kasbon payments in the order they were received.
        .orderBy(asc(receivablePayments.createdAt), asc(saleVoidReturns.id)),
      this.db
        .select({ id: staff.id, name: staff.name })
        .from(staff)
        .where(
          and(
            eq(staff.tenantId, s.tenantId),
            inArray(staff.id, [v.actorId, v.approvedBy]),
          ),
        ),
    ]);
    const nameOf = (actorId: string, kind: (typeof ACTOR_KINDS)[number]) =>
      kind === 'owner'
        ? 'Pemilik'
        : (names.find((n) => n.id === actorId)?.name ?? 'Staf');
    const {
      actorId,
      actorKind,
      approvedBy,
      approvedByKind,
      costTotal,
      ...rest
    } = v;
    return {
      ...rest,
      status: 'void' as const,
      costTotal: hasPermission(s, 'reports.view') ? costTotal : undefined,
      initiatedBy: {
        id: actorId,
        kind: actorKind,
        name: nameOf(actorId, actorKind),
      },
      approvedBy: {
        id: approvedBy,
        kind: approvedByKind,
        name: nameOf(approvedBy, approvedByKind),
      },
      returns,
    };
  }
}
