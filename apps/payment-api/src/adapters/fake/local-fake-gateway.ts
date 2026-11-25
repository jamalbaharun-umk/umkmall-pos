import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Clock } from '../../config';
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
} from '../adapter';

export const FAKE_PROVIDER = 'fake';
export const FAKE_METHODS = ['fake_qris', 'fake_va'] as const;
export type FakeMethod = (typeof FAKE_METHODS)[number];
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

export type FakeBillStatus =
  'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
export type FakeRefundStatus = 'pending' | 'succeeded' | 'failed';
/** How the gateway answers a new refund. `pending`: a person settles it through the control routes. */
export type FakeRefundMode = 'pending' | 'succeed' | 'fail';

export interface FakeBill {
  providerRef: string;
  /** Our payment id: the reference the gateway was given, and what its notifications name. */
  paymentId: string;
  tenantId: string;
  orderRef: string;
  method: FakeMethod;
  amount: number;
  status: FakeBillStatus;
  expiresAt: Date | null;
  checkout: Record<string, string>;
  receipts: { id: string; amount: number; paidAt: Date }[];
  refunds: {
    id: string;
    receiptId: string | null;
    amount: number;
    status: FakeRefundStatus;
  }[];
  createdAt: Date;
}

/** A notification as the gateway would POST it to `/webhooks/fake`, with its signature. */
export interface FakeNotification {
  eventId: string;
  body: string;
  signature: string;
}

/** A control asked for something the bill's state does not allow. `code` is the refusal the route answers. */
export class FakeGatewayRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FakeGatewayRefusal';
  }
}

const CLOSED: readonly FakeBillStatus[] = ['failed', 'expired', 'cancelled'];

/**
 * LOCAL USE ONLY. A payment gateway that lives inside the payment-api process, so every PG flow can be run on
 * a developer's machine with no PG and no outbound call. It is not a PG adapter in the sense of the legal gate
 * (UMK-1977): it moves no money and talks to nobody.
 *
 * It exists only when PAYMENT_ADAPTERS lists `fake`, and never in production: `loadEnv` refuses that
 * combination at boot, and this constructor refuses it again on its own.
 *
 * Like a PG it keeps its own bills (in memory: a restart forgets them) and knows nothing of payment-api's
 * database. The control routes (`fake-gateway.controller.ts`) change what it knows; payment-api learns that the
 * usual way, through `getStatus` inside `SettlementService.settle`. Nothing here writes a payment.
 */
export class LocalFakeGateway {
  /** By payment id. */
  private readonly bills = new Map<string, FakeBill>();
  /** Drawn at boot: only this process can sign a notification. */
  private readonly secret = randomBytes(32);
  private readonly run = randomBytes(4).toString('hex');
  private eventSeq = 0;
  refundMode: FakeRefundMode = 'pending';

  constructor(private readonly clock: Clock) {
    if (process.env.NODE_ENV === 'production')
      throw new Error('The fake payment gateway never loads in production');
  }

  adapters(): PaymentAdapter[] {
    return [
      new FakeAdapter(this, 'fake_qris', true),
      // A virtual account takes a second transfer; a dynamic QR is used up by the first payment.
      new FakeAdapter(this, 'fake_va', false),
    ];
  }

  // ---- what payment-api asks (the adapter contract) ----------------------------------------------------

  /**
   * Creates the bill, once per payment id. The last three digits of the amount script the answer:
   * 901 refused, 902 unreachable, 903 bill created and the answer lost, 911–919 answered after 1–9 seconds.
   */
  async charge(payment: PaymentRef, method: FakeMethod): Promise<ChargeResult> {
    const script = payment.amount % 1000;
    if (script >= 911 && script <= 919) await sleep((script - 910) * 1000);
    if (script === 901) return { status: 'failed' };
    if (script === 902) throw new GatewayUnreachableError();

    let bill = this.bills.get(payment.id);
    const isNew = !bill;
    if (!bill) {
      const serial = randomBytes(6).toString('hex').toUpperCase();
      bill = {
        providerRef: `FAKE-${method === 'fake_qris' ? 'QR' : 'VA'}-${serial}`,
        paymentId: payment.id,
        tenantId: payment.tenantId,
        orderRef: payment.orderRef,
        method,
        amount: payment.amount,
        status: 'pending',
        expiresAt: payment.expiresAt,
        checkout:
          method === 'fake_qris'
            ? { qrString: `FAKEQRIS.${serial}.${payment.amount}` }
            : {
                bank: 'FAKE',
                vaNumber: `8808${BigInt(`0x${serial}`).toString().padStart(15, '0').slice(-12)}`,
              },
        receipts: [],
        refunds: [],
        createdAt: this.clock.now(),
      };
      this.bills.set(payment.id, bill);
    }
    if (script === 903 && isNew) throw new Error('fake gateway: answer lost');
    return {
      status: 'pending',
      providerRef: bill.providerRef,
      expiresAt: bill.expiresAt ?? undefined,
      checkout: bill.checkout,
    };
  }

  getStatus(payment: PaymentRef): StatusResult {
    const bill = this.bills.get(payment.id);
    if (!bill) return { status: 'not_found' };
    this.refresh(bill);
    return {
      status: bill.status,
      providerRef: bill.providerRef,
      expiresAt: bill.expiresAt ?? undefined,
      checkout: bill.checkout,
      // The fake takes no fee: gross is what the payer paid.
      receipts: bill.receipts.map((r) => ({
        id: r.id,
        grossAmount: r.amount,
        feeAmount: 0,
      })),
      refunds: Object.fromEntries(bill.refunds.map((r) => [r.id, r.status])),
    };
  }

  /** Idempotent on the request's key: the same refund asked twice is one refund. */
  refund(payment: PaymentRef, request: RefundRequest): RefundResult {
    const bill = this.bills.get(payment.id);
    // A bill the gateway does not know (a restart): the outcome is unknown, payment-api asks again later.
    if (!bill) throw new Error('fake gateway: no such bill');
    const known = bill.refunds.find((r) => r.id === request.key);
    if (known) return { status: known.status };
    const status: FakeRefundStatus =
      this.refundMode === 'succeed'
        ? 'succeeded'
        : this.refundMode === 'fail'
          ? 'failed'
          : 'pending';
    bill.refunds.push({
      id: request.key,
      receiptId: request.receiptId,
      amount: request.amount,
      status,
    });
    return { status };
  }

  cancelPending(payment: PaymentRef): void {
    const bill = this.bills.get(payment.id);
    if (!bill) return;
    this.refresh(bill);
    if (bill.status === 'pending') bill.status = 'cancelled';
  }

  /** Constant-time signature check over the exact bytes, then the notification. */
  readWebhook(input: WebhookInput): WebhookNotice {
    const given = input.headers[FAKE_SIGNATURE_HEADER];
    const expected = Buffer.from(this.sign(input.rawBody));
    const actual = Buffer.from(typeof given === 'string' ? given : '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new WebhookSignatureError();
    const parsed = JSON.parse(input.rawBody.toString('utf8')) as {
      eventId: string;
      reference?: string;
    };
    return { eventId: parsed.eventId, reference: parsed.reference ?? null };
  }

  // ---- what a person does at the gateway (the control routes) ------------------------------------------

  /** The tenant's bills, newest first. */
  list(tenantId: string): FakeBill[] {
    return [...this.bills.values()]
      .filter((b) => b.tenantId === tenantId)
      .map((b) => this.refresh(b))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** A bill of this tenant by the gateway's reference; undefined for another tenant's, as for none. */
  find(tenantId: string, providerRef: string): FakeBill | undefined {
    const bill = [...this.bills.values()].find(
      (b) => b.tenantId === tenantId && b.providerRef === providerRef,
    );
    return bill && this.refresh(bill);
  }

  /** The bill of this tenant that holds the refund. */
  findRefund(tenantId: string, refundId: string): FakeBill | undefined {
    const bill = [...this.bills.values()].find(
      (b) =>
        b.tenantId === tenantId && b.refunds.some((r) => r.id === refundId),
    );
    return bill && this.refresh(bill);
  }

  /** The payer pays an open bill. Another amount than the bill's is the PG reporting mismatched money. */
  pay(bill: FakeBill, amount?: number): void {
    if (CLOSED.includes(bill.status))
      throw new FakeGatewayRefusal('bill_closed');
    if (bill.status === 'paid' && bill.method === 'fake_qris')
      throw new FakeGatewayRefusal('already_paid');
    this.receive(bill, amount);
    bill.status = 'paid';
  }

  /** Money that arrives on a bill the gateway had already closed. */
  latePay(bill: FakeBill, amount?: number): void {
    if (!CLOSED.includes(bill.status))
      throw new FakeGatewayRefusal('bill_open');
    this.receive(bill, amount);
  }

  close(bill: FakeBill, to: 'failed' | 'expired'): void {
    if (bill.status !== 'pending') throw new FakeGatewayRefusal('bill_closed');
    bill.status = to;
  }

  finishRefund(bill: FakeBill, refundId: string, to: 'succeeded' | 'failed') {
    const refund = bill.refunds.find((r) => r.id === refundId);
    if (!refund || refund.status !== 'pending')
      throw new FakeGatewayRefusal('refund_not_pending');
    refund.status = to;
  }

  /** A signed notification for a bill. Pass an earlier event id to build the same event again. */
  notification(bill: FakeBill, eventId?: string): FakeNotification {
    const id = eventId ?? `fake-evt-${this.run}-${++this.eventSeq}`;
    // As a PG's: our reference and nothing about the tenant or the status.
    const body = JSON.stringify({ eventId: id, reference: bill.paymentId });
    return { eventId: id, body, signature: this.sign(Buffer.from(body)) };
  }

  private receive(bill: FakeBill, amount?: number) {
    bill.receipts.push({
      id: `fake-rcpt-${randomBytes(6).toString('hex')}`,
      amount: amount ?? bill.amount,
      paidAt: this.clock.now(),
    });
  }

  /** A PG closes an unpaid bill by itself when its validity ends. */
  private refresh(bill: FakeBill): FakeBill {
    if (
      bill.status === 'pending' &&
      bill.expiresAt &&
      this.clock.now().getTime() >= bill.expiresAt.getTime()
    )
      bill.status = 'expired';
    return bill;
  }

  private sign(body: Buffer): string {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }
}

/** One method of the fake gateway behind the adapter contract. Refund only, like every PG method. */
class FakeAdapter implements PaymentAdapter {
  readonly kind = 'online' as const;
  readonly provider = FAKE_PROVIDER;
  readonly supportsVoid = false;
  readonly supportsRefund = true;
  readonly canCancel = true;

  constructor(
    private readonly gateway: LocalFakeGateway,
    readonly method: FakeMethod,
    readonly singleUseQr: boolean,
  ) {}

  charge(payment: PaymentRef): Promise<ChargeResult> {
    return this.gateway.charge(payment, this.method);
  }

  // The gateway's answers are wrapped so that a throw is a rejected promise, as from a real PG client.
  async getStatus(payment: PaymentRef): Promise<StatusResult> {
    return Promise.resolve(this.gateway.getStatus(payment));
  }

  void(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError(this.method, 'void'));
  }

  async refund(
    payment: PaymentRef,
    request: RefundRequest,
  ): Promise<RefundResult> {
    return Promise.resolve(this.gateway.refund(payment, request));
  }

  async handleWebhook(input: WebhookInput): Promise<WebhookNotice> {
    return Promise.resolve(this.gateway.readWebhook(input));
  }

  async cancelPending(payment: PaymentRef): Promise<void> {
    return Promise.resolve(this.gateway.cancelPending(payment));
  }
}
