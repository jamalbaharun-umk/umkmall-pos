import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { fieldError } from '../common/validation';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { paymentMethods, sales, saleVoids } from '../db/schema';
import { saleNumbers } from '../sales/numbers';
import { hasPermission } from '../staff/require-permission';
import type { PosSession } from '../tenancy/session';
import {
  PaymentSync,
  type SaleSettlement,
  type SettleMode,
} from './payment-sync.service';
import {
  isInFlight,
  isOnlineMethod,
  type Payment,
  PaymentApiError,
  PaymentsClient,
} from './payments.client';

/** What the cashier's screen shows for a payment: payment-api's status, with both waiting states as one. */
export type SalePaymentStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded'
  | 'refund_failed'
  | 'voided';

const STATUSES: readonly SalePaymentStatus[] = [
  'paid',
  'expired',
  'failed',
  'cancelled',
  'refund_pending',
  'refunded',
  'refund_failed',
  'voided',
];

const MESSAGES: Record<string, string> = {
  already_paid:
    'Pelanggan sudah membayar tagihan ini. Penjualan selesai dengan pembayaran itu.',
  not_awaiting: 'Penjualan ini tidak sedang menunggu pembayaran',
  not_online: 'Penjualan ini tidak menunggu pembayaran online',
  not_own_sale: 'Hanya kasir penjualan ini yang bisa menerima tunainya',
  cancel_refused:
    'Tagihan belum bisa ditutup. Penjualan masih menunggu pembayaran.',
  not_refund_failed: 'Hanya refund yang ditolak yang bisa ditandai manual',
  payment_refused:
    'Layanan pembayaran menolak permintaan ini. Coba lagi atau hubungi pemilik.',
  cash_switch_unanswered:
    'Layanan pembayaran tidak menjawab, jadi penjualan belum menjadi tunai. Cek status pembayaran dulu sebelum menerima uang atau meminta pelanggan membayar: bila tagihan sudah tertutup, penjualan ini dibatalkan dan harus dibuat ulang.',
  cash_payment_pending:
    'Penjualan ini sudah menjadi penjualan tunai, tetapi pembayarannya belum tercatat. Coba lagi.',
};

/** A 409 with a stable `code` the screen can act on. */
export const refusal = (code: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({
    message: MESSAGES[code] ?? MESSAGES.payment_refused,
    code,
    ...extra,
  });

/**
 * payment-api's failure as this API answers it: no clear answer → 503 `payment_unavailable` (nothing
 * changed, try again); a refusal → 409 with one of our own codes. payment-api's message is never passed on.
 */
export function paymentHttpError(error: unknown): unknown {
  if (!(error instanceof PaymentApiError)) return error;
  if (error.kind === 'unavailable')
    return new ServiceUnavailableException({
      message: 'Layanan pembayaran tidak bisa dihubungi. Coba lagi.',
      code: 'payment_unavailable',
    });
  return refusal(
    error.code === 'not_refund_failed' ? error.code : 'payment_refused',
  );
}

/** payment-api's own refusals of a request that are not about the bill; it did nothing on these. */
const REFUSED_STATUSES = new Set([400, 401, 403, 429]);

/**
 * The holder name of a VA as the screen may show it (UMK-2045): the gateway's text, so control characters
 * (and the invisible direction marks) are dropped and it is cut to 100 characters. Null when nothing is left.
 */
const UNPRINTABLE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;
export const accountNameOf = (v: string): string | null =>
  v.replace(UNPRINTABLE, '').trim().slice(0, 100).trim() || null;

/** 503: the sale is a cash sale already and only the record of its cash is missing. */
const cashPending = () =>
  new ServiceUnavailableException({
    message: MESSAGES.cash_payment_pending,
    code: 'cash_payment_pending',
  });

/**
 * The cashier's side of a sale's payment (UMK-1991): where it stands, the manual check, the switch to cash
 * and the cancel. Every route answers the same `SalePayment`.
 *
 * It decides nothing itself: `PaymentSync.settle` asks payment-api and moves the sale. Nothing here runs in
 * a database transaction, so no call to payment-api is made under a lock.
 */
@Injectable()
export class SalePayments {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly sync: PaymentSync,
    private readonly client: PaymentsClient,
  ) {}

  /**
   * The sale as the actor may see it here: their own, or any of the store's with `sales.void` (the
   * supervisor who recovers a stuck payment or approves a refund). Else 404: the answer carries what pays
   * the bill (the QR, the VA number), which is not for everyone who may read reports.
   */
  private async sale(s: PosSession, saleId: string) {
    const [sale] = await this.db
      .select({
        id: sales.id,
        number: sales.number,
        holdNumber: sales.holdNumber,
        status: sales.status,
        actorId: sales.actorId,
        total: sales.total,
        rounding: sales.rounding,
        method: sales.paymentMethodCode,
        attempt: sales.paymentAttempt,
        paymentId: sales.paymentId,
        switchCashPaid: sales.switchCashPaid,
        paymentMethodId: sales.paymentMethodId,
        paymentMethodName: paymentMethods.name,
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
    if (
      !sale ||
      !(hasPermission(s, 'sales.void') || sale.actorId === s.actorId)
    )
      throw new NotFoundException();
    return sale;
  }

  private async settle(
    s: PosSession,
    saleId: string,
    mode: SettleMode,
  ): Promise<SaleSettlement> {
    try {
      return await this.sync.settle(s.tenantId, saleId, mode);
    } catch (error) {
      throw paymentHttpError(error);
    }
  }

  /** `GET /sales/:id/payment` (the poll) and `POST /sales/:id/payment/check` (the PG is asked). */
  async status(s: PosSession, saleId: string, mode: 'read' | 'sync') {
    await this.sale(s, saleId);
    const { payment } = await this.settle(s, saleId, mode);
    return this.view(s, saleId, payment);
  }

  /**
   * The cashier takes cash for a sale that waits for a PG payment. Only the sale's own cashier: the cash
   * goes into the drawer of the sale's shift, which is theirs.
   *
   * No usable answer from payment-api before the sale became a cash sale: the switch is taken back and the
   * answer says so (503 `payment_unavailable`, 409 `cancel_refused`): the sale waits for its PG payment as
   * before, and nothing turns it into a cash sale later. Once it IS a cash sale (the bill is closed) only
   * the record of the cash is missing: 503 `cash_payment_pending`, and a repeat or the job finishes it.
   */
  async payCash(s: PosSession, saleId: string, paid: number) {
    const sale = await this.sale(s, saleId);
    if (sale.status !== 'awaiting_payment')
      return this.cashOutcome(await this.view(s, saleId, null));
    if (sale.actorId !== s.actorId) throw refusal('not_own_sale');
    // A sale that never was a PG sale has nothing to switch from: it is paid by repeating the sale.
    if (!isOnlineMethod(sale.method) && sale.attempt === 1)
      throw refusal('not_online');
    // Already a cash sale: an earlier request switched it and only its charge is left.
    if (sale.method !== 'cash') {
      const asked = await this.sync.requestCashSwitch(s.tenantId, saleId, paid);
      if (asked === 'underpaid')
        throw fieldError(
          'paid',
          'Uang dibayar kurang dari jumlah yang harus dibayar',
        );
      if (asked === 'not_online') throw refusal('not_online');
    }
    let payment: Payment | null;
    try {
      ({ payment } = await this.sync.settle(
        s.tenantId,
        saleId,
        'cash',
        new Date(),
        paid,
      ));
    } catch (error) {
      // Whatever went wrong, the request ends here: the intent goes with it.
      await this.sync.abandonCashSwitch(s.tenantId, saleId);
      if (!(error instanceof PaymentApiError)) throw error;
      if (await this.isCashNow(s, saleId))
        throw error.kind === 'unavailable'
          ? cashPending()
          : refusal('payment_refused');
      // payment-api would not close the bill: the sale still waits for the PG payment.
      if (error.kind === 'rejected') throw refusal('cancel_refused');
      // payment-api did answer, and refused the request itself (400, 401, 403, 429): it closed nothing, so
      // this is a refusal, not a call that went unanswered. Only these four: any other 4xx (a proxy's 408
      // or 499) says nothing about what payment-api did, and stays "no answer".
      if (error.status !== null && REFUSED_STATUSES.has(error.status))
        throw refusal('payment_refused');
      // No answer: the close may or may not have reached payment-api. The cashier must look before acting.
      throw new ServiceUnavailableException({
        message: MESSAGES.cash_switch_unanswered,
        code: 'payment_unavailable',
      });
    }
    const view = await this.view(s, saleId, payment, true);
    if (view.saleStatus === 'awaiting_payment') {
      await this.sync.abandonCashSwitch(s.tenantId, saleId);
      throw (await this.isCashNow(s, saleId))
        ? cashPending()
        : refusal('cancel_refused');
    }
    return this.cashOutcome(view);
  }

  /** The sale was switched and is a cash sale that still waits for the record of its cash. */
  private async isCashNow(s: PosSession, saleId: string) {
    const sale = await this.sale(s, saleId);
    return (
      sale.status === 'awaiting_payment' &&
      sale.method === 'cash' &&
      sale.attempt > 1
    );
  }

  private cashOutcome(view: Awaited<ReturnType<SalePayments['view']>>) {
    if (view.saleStatus === 'completed' && view.method === 'cash') {
      // A cash sale that was never a PG sale has nothing to switch from.
      if (view.attempt === 1) throw refusal('not_online');
      return view;
    }
    const extra = { saleId: view.saleId, status: view.saleStatus };
    if (view.saleStatus === 'completed') throw refusal('already_paid', extra);
    throw refusal('not_awaiting', extra);
  }

  /** The cashier gives an awaiting sale up. No PIN and no void record: it never was a receipt (V2). */
  async cancel(s: PosSession, saleId: string) {
    const sale = await this.sale(s, saleId);
    const extra = { saleId, status: sale.status };
    if (sale.status === 'completed' || sale.status === 'void')
      throw refusal('not_awaiting', extra);
    const { outcome, payment } =
      sale.status === 'awaiting_payment'
        ? await this.settle(s, saleId, 'cancel')
        : { outcome: sale.status, payment: null };
    if (outcome === 'completed')
      throw refusal('already_paid', { saleId, status: outcome });
    if (outcome === 'awaiting_payment') throw refusal('cancel_refused');
    return this.view(s, saleId, payment, true);
  }

  /**
   * The `SalePayment` every route answers. `known` is the payment of the sale's current attempt when the
   * caller already has it; it is asked again for its details when it is a PG payment.
   *
   * `afterAction`: the caller has just moved the sale. payment-api failing to answer the details then must
   * not turn a done action into a 503 that says nothing changed: the view is built from what is known.
   */
  async view(
    s: PosSession,
    saleId: string,
    known: Payment | null,
    afterAction = false,
  ) {
    const sale = await this.sale(s, saleId);
    const online = isOnlineMethod(sale.method);
    let payment = known;
    let others: Payment[] = [];
    if (this.sync.enabled) {
      try {
        // The sale's own payment once it has one, else the open PG payment of the current attempt. The whole
        // payment (checkout, capabilities, late money) comes only from the one-payment route.
        const id = sale.paymentId ?? (known && online ? known.id : null);
        if (id) payment = await this.client.get(s.tenantId, id);
        // Earlier attempts (a QR closed for cash) can still receive money: show what arrived on them.
        if (sale.attempt > 1 && sale.status !== 'awaiting_payment') {
          const all = await this.client.listByOrder(s.tenantId, saleId);
          others = await Promise.all(
            all
              .filter((p) => p.id !== payment?.id && isOnlineMethod(p.method))
              .slice(0, 5)
              .map((p) => this.client.get(s.tenantId, p.id)),
          );
        }
      } catch (error) {
        if (!afterAction) throw paymentHttpError(error);
        others = [];
      }
    }
    const refund = await this.refund(s.tenantId, saleId, payment);

    const waiting = payment ? isInFlight(payment) : false;
    const status: SalePaymentStatus = payment
      ? (STATUSES.find((x) => x === payment.status) ?? 'awaiting_payment')
      : sale.status === 'completed'
        ? 'paid'
        : sale.status === 'void'
          ? 'voided'
          : sale.status;
    const checkout =
      payment && waiting && payment.checkout
        ? Object.fromEntries(
            // `accountName` (UMK-2045): the holder name the customer's bank shows for the VA, as the gateway
            // labels it. Only these keys reach the screen, whatever else a gateway may answer.
            ['qrString', 'bank', 'vaNumber', 'accountName']
              .filter((k) => k in payment.checkout!)
              .map((k): [string, string | null] => [
                k,
                k === 'accountName'
                  ? accountNameOf(payment.checkout![k])
                  : payment.checkout![k],
              ])
              .filter((e): e is [string, string] => e[1] !== null),
          )
        : null;
    const numbers = saleNumbers(sale);
    return {
      saleId: sale.id,
      // UMK-2038: `saleNumber` is the number to show now (the receipt number once the sale is completed,
      // else the hold number); the two below say which is which.
      saleNumber: numbers.number,
      receiptNumber: numbers.receiptNumber,
      holdNumber: numbers.holdNumber,
      saleStatus: sale.status,
      // UMK-2047: who rang the sale up. Only they switch it to cash (`not_own_sale`); a `sales.void` holder
      // may still check, cancel and refund it.
      actorId: sale.actorId,
      mine: sale.actorId === s.actorId,
      status,
      online,
      method: sale.method,
      paymentMethodId: sale.paymentMethodId,
      paymentMethodName: sale.paymentMethodName,
      // What the customer owes: the total, plus the cash rounding of a cash sale.
      amount: sale.total + sale.rounding,
      attempt: sale.attempt,
      checkout: checkout && Object.keys(checkout).length ? checkout : null,
      expiresAt: online ? (payment?.expiresAt ?? null) : null,
      checkoutExpired:
        waiting &&
        !!payment?.expiresAt &&
        new Date(payment.expiresAt) <= new Date(),
      lastCheckedAt: payment?.lastSyncedAt ?? null,
      canCloseAtGateway: payment?.canCancel ?? true,
      switchingToCash: sale.switchCashPaid !== null,
      refund,
      lateReceipts: [...(payment ? [payment] : []), ...others].flatMap((p) =>
        p.unmatchedReceipts.map((r) => ({
          id: r.id,
          attempt: p.attempt,
          amount: r.grossAmount,
          kind: r.kind,
          refundStatus: r.refundStatus,
          needsReview: r.needsReview,
        })),
      ),
    };
  }

  /** The sale's PG refund, brought up to date from the payment the view already has. */
  private async refund(
    tenantId: string,
    saleId: string,
    payment: Payment | null,
  ) {
    const status = await this.sync
      .followRefund(tenantId, saleId, payment ?? undefined)
      .catch((error: unknown) => {
        throw paymentHttpError(error);
      });
    if (!status) return null;
    const [row] = await this.db
      .select({
        reasonCode: saleVoids.reasonCode,
        note: saleVoids.note,
        requestedAt: saleVoids.createdAt,
        pending: saleVoids.paymentSyncPending,
      })
      .from(saleVoids)
      .where(
        and(eq(saleVoids.tenantId, tenantId), eq(saleVoids.saleId, saleId)),
      );
    return {
      status,
      // False: payment-api has not been asked yet (it was unreachable); the job sends it.
      sent: !row.pending,
      reasonCode: row.reasonCode,
      note: row.note,
      requestedAt: row.requestedAt,
    };
  }
}
