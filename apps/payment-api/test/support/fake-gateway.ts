import { createHmac, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ChargeResult,
  GatewayUnreachableError,
  PaymentAdapter,
  PaymentRef,
  RefundRequest,
  RefundResult,
  StatusResult,
  UnsupportedOperationError,
  WebhookInput,
  WebhookNotice,
  WebhookSignatureError,
} from '../../src/adapters/adapter';

type ChargeMode =
  | 'ok'
  /** The bill is created, then the response is lost. */
  | 'timeout_after_success'
  /** The request is lost on the way: no bill, but the adapter cannot know. */
  | 'timeout_before'
  /** Connection refused: certainly no bill. */
  | 'unreachable'
  /** The PG answers "no". */
  | 'refuse';

type RefundMode =
  | 'succeed'
  /** Accepted; the money is on its way (settle later with `finishRefund`). */
  | 'pending'
  | 'refuse'
  | 'timeout_after_success'
  | 'down';

interface Bill {
  reference: string;
  amount: number;
  status: 'pending' | 'paid' | 'expired' | 'cancelled';
  expiresAt: Date | null;
  /** As the PG stores them: NET of its fee. */
  receipts: { id: string; net: number; fee: number }[];
  refunds: Record<string, 'pending' | 'succeeded' | 'failed'>;
}

const SECRET = 'fake-gateway-webhook-secret';
const sign = (body: string) =>
  createHmac('sha256', SECRET).update(body).digest('hex');

/**
 * TEST ONLY. A scriptable payment gateway behind the real adapter contract (no real PG adapter ships before the
 * legal gate, UMK-1977). It keeps its own bills, like a PG does, and a test tells it how to misbehave:
 * delay, time out after the bill was really created, lose the request, be unreachable, answer "not found" for a
 * bill that exists (then find it), report money after expiry, report another amount, report a second payment,
 * refuse or delay a refund, refuse to close a QR. It reports amounts net of its fee internally and the adapter
 * side normalises them to gross, as a real adapter must.
 */
export class FakeGateway implements PaymentAdapter {
  readonly method = 'fake_qris';
  readonly kind = 'online' as const;
  readonly provider = 'fake';
  readonly supportsVoid = false;
  readonly supportsRefund = true;
  canCancel = true;
  singleUseQr = true;

  readonly bills = new Map<string, Bill>();
  readonly calls: { op: string; reference: string; key?: string }[] = [];

  // ---- knobs -------------------------------------------------------------------------------------------
  delayMs = 0;
  /** Consumed one per charge call; `ok` when empty. */
  chargeScript: ChargeMode[] = [];
  /** The next N lookups answer `not_found` although the bill exists (a lagging PG). */
  lookupsNotFound = 0;
  /** The next N lookups fail like a PG that is down. */
  lookupsDown = 0;
  /** The next N cancel calls fail like a PG that is down. */
  cancelsDown = 0;
  /** The PG accepts a cancel call and leaves the bill open. */
  cancelIgnored = false;
  refundMode: RefundMode = 'succeed';
  /** The PG's fee on each receipt. It stores receipts net of it. */
  fee = 0;
  /** Runs inside `charge`, after the bill exists and before the answer returns (a webhook that wins the race). */
  onCharge?: (reference: string) => Promise<void>;
  private receiptSeq = 0;
  private eventSeq = 0;
  /** Event ids are unique per gateway instance: test files share one database. */
  private readonly run = Math.random().toString(36).slice(2, 10);
  /** Lookups of these bills fail like a PG that is down, until removed. */
  readonly brokenLookups = new Set<string>();

  reset() {
    this.delayMs = 0;
    this.chargeScript = [];
    this.lookupsNotFound = 0;
    this.lookupsDown = 0;
    this.cancelsDown = 0;
    this.cancelIgnored = false;
    this.refundMode = 'succeed';
    this.fee = 0;
    this.onCharge = undefined;
    this.brokenLookups.clear();
    this.canCancel = true;
    this.singleUseQr = true;
  }

  count(op: string, reference: string): number {
    return this.calls.filter((c) => c.op === op && c.reference === reference)
      .length;
  }

  // ---- what happens at the PG, driven by the test ------------------------------------------------------
  /**
   * The payer pays. `gross` defaults to the bill's amount. A second payment on a single-use QR is rejected by
   * the PG unless `force` (a PG that reports it anyway).
   */
  pay(reference: string, gross?: number, opts: { force?: boolean } = {}) {
    const bill = this.bill(reference);
    if (bill.receipts.length > 0 && this.singleUseQr && !opts.force)
      throw new Error('fake gateway: QR already used');
    const amount = gross ?? bill.amount;
    bill.receipts.push({
      id: `rcpt-${++this.receiptSeq}`,
      net: amount - this.fee,
      fee: this.fee,
    });
    if (bill.status === 'pending') bill.status = 'paid';
  }

  expire(reference: string) {
    const bill = this.bill(reference);
    if (bill.status === 'pending') bill.status = 'expired';
  }

  finishRefund(key: string, result: 'succeeded' | 'failed') {
    for (const bill of this.bills.values())
      if (key in bill.refunds) bill.refunds[key] = result;
  }

  /** A signed notification for a bill, as the PG would POST it. Pass an eventId to send the same event again. */
  webhook(reference: string, eventId = `evt-${this.run}-${++this.eventSeq}`) {
    const body = JSON.stringify({ eventId, reference });
    return { eventId, body, signature: sign(body) };
  }

  private bill(reference: string): Bill {
    const bill = this.bills.get(reference);
    if (!bill) throw new Error('fake gateway: no such bill');
    return bill;
  }

  // ---- the adapter contract ---------------------------------------------------------------------------
  async charge(payment: PaymentRef): Promise<ChargeResult> {
    this.calls.push({ op: 'charge', reference: payment.id });
    if (this.delayMs) await sleep(this.delayMs);
    const mode = this.chargeScript.shift() ?? 'ok';
    if (mode === 'unreachable') throw new GatewayUnreachableError();
    if (mode === 'timeout_before') throw new Error('fake gateway: timeout');
    if (mode === 'refuse') return { status: 'failed' };
    // Idempotent on our reference: the same charge twice is one bill.
    let bill = this.bills.get(payment.id);
    if (!bill) {
      bill = {
        reference: payment.id,
        amount: payment.amount,
        status: 'pending',
        expiresAt: payment.expiresAt,
        receipts: [],
        refunds: {},
      };
      this.bills.set(payment.id, bill);
    }
    if (this.onCharge) await this.onCharge(payment.id);
    if (mode === 'timeout_after_success')
      throw new Error('fake gateway: timeout secret-internal-detail');
    return {
      status: 'pending',
      providerRef: `fake-${payment.id}`,
      expiresAt: bill.expiresAt ?? undefined,
      checkout: { qrString: `QR:${payment.id}` },
    };
  }

  async getStatus(payment: PaymentRef): Promise<StatusResult> {
    this.calls.push({ op: 'getStatus', reference: payment.id });
    if (this.delayMs) await sleep(this.delayMs);
    if (this.brokenLookups.has(payment.id))
      throw new Error('fake gateway: down secret-internal-detail');
    if (this.lookupsDown > 0) {
      this.lookupsDown--;
      throw new Error('fake gateway: down secret-internal-detail');
    }
    const bill = this.bills.get(payment.id);
    if (!bill) return { status: 'not_found' };
    if (this.lookupsNotFound > 0) {
      this.lookupsNotFound--;
      return { status: 'not_found' };
    }
    return {
      status: bill.status,
      providerRef: `fake-${bill.reference}`,
      expiresAt: bill.expiresAt ?? undefined,
      checkout: { qrString: `QR:${bill.reference}` },
      // Normalised to gross: what the payer was charged = what the PG kept (fee) + what it passes on (net).
      receipts: bill.receipts.map((r) => ({
        id: r.id,
        grossAmount: r.net + r.fee,
        feeAmount: r.fee,
      })),
      refunds: { ...bill.refunds },
    };
  }

  void(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError(this.method, 'void'));
  }

  refund(payment: PaymentRef, request: RefundRequest): Promise<RefundResult> {
    this.calls.push({ op: 'refund', reference: payment.id, key: request.key });
    const bill = this.bill(payment.id);
    if (this.refundMode === 'down')
      return Promise.reject(new Error('fake gateway: down'));
    // Idempotent on the key: the same refund twice is one refund.
    const known = bill.refunds[request.key];
    if (known) return Promise.resolve({ status: known });
    const status =
      this.refundMode === 'refuse'
        ? 'failed'
        : this.refundMode === 'pending'
          ? 'pending'
          : 'succeeded';
    bill.refunds[request.key] = status;
    if (this.refundMode === 'timeout_after_success')
      return Promise.reject(new Error('fake gateway: timeout'));
    return Promise.resolve({ status });
  }

  cancelPending(payment: PaymentRef): Promise<void> {
    this.calls.push({ op: 'cancel', reference: payment.id });
    if (!this.canCancel)
      return Promise.reject(
        new UnsupportedOperationError(this.method, 'cancel'),
      );
    if (this.cancelsDown > 0) {
      this.cancelsDown--;
      return Promise.reject(new Error('fake gateway: down'));
    }
    const bill = this.bills.get(payment.id);
    if (bill?.status === 'pending' && !this.cancelIgnored)
      bill.status = 'cancelled';
    return Promise.resolve();
  }

  handleWebhook(input: WebhookInput): Promise<WebhookNotice> {
    const given = input.headers['x-fake-signature'];
    const expected = Buffer.from(sign(input.rawBody.toString('utf8')));
    const actual = Buffer.from(typeof given === 'string' ? given : '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return Promise.reject(new WebhookSignatureError());
    const parsed = JSON.parse(input.rawBody.toString('utf8')) as {
      eventId: string;
      reference?: string;
    };
    return Promise.resolve({
      eventId: parsed.eventId,
      reference: parsed.reference ?? null,
    });
  }
}
