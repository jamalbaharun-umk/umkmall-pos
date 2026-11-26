import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Clock } from '../../config';
import {
  Bank,
  BillValidity,
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
import type {
  AccountNotice,
  AccountStatusResult,
  MerchantProfile,
  MerchantRef,
  OnboardingAdapter,
  ProviderAccountStatus,
} from '../onboarding';

export const FAKE_PROVIDER = 'fake';
export const FAKE_METHODS = ['fake_qris', 'fake_va', 'fake_checkout'] as const;
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

/** A store's sub-account at the fake gateway. The gateway reviews it when a person uses the controls. */
export interface FakeAccount {
  /** The gateway's own id of the sub-account. */
  accountId: string;
  /** Our merchant account id: the reference the gateway was given, and what its notifications name. */
  merchantId: string;
  tenantId: string;
  status: ProviderAccountStatus;
  reason: string | null;
  profile: MerchantProfile;
  createdAt: Date;
  updatedAt: Date;
}

export type FakeReview = 'approve' | 'needs_fix' | 'reject' | 'suspend';

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

/**
 * The banks a `fake_va` bill can be made at (UMK-2037). Made-up names: the fake gateway stands for no bank.
 * `vaPrefix` is the start of the VA numbers of that bank, so a bill shows which one was chosen.
 */
export const FAKE_BANKS = [
  { code: 'FAKE', name: 'Bank Fake', vaPrefix: '8808' },
  { code: 'FAKE2', name: 'Bank Fake Dua', vaPrefix: '8809' },
] as const;

/** What a payer's bank would show as the holder of a fake VA. */
export const FAKE_VA_ACCOUNT_NAME = 'FAKE GATEWAY';

const CLOSED: readonly FakeBillStatus[] = ['failed', 'expired', 'cancelled'];
const PREFIX: Record<FakeMethod, string> = {
  fake_qris: 'QR',
  fake_va: 'VA',
  fake_checkout: 'CO',
};

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
  /** By merchant account id. */
  private readonly accounts = new Map<string, FakeAccount>();
  /** While true the gateway cannot be reached for onboarding calls (a control sets it). */
  accountsDown = false;

  constructor(private readonly clock: Clock) {
    // Fails closed: only an explicit development or test environment may hold it.
    const env = process.env.NODE_ENV;
    if (env !== 'development' && env !== 'test')
      throw new Error(
        'The fake payment gateway loads only when NODE_ENV is development or test',
      );
  }

  adapters(): PaymentAdapter[] {
    return [
      new FakeAdapter(this, 'fake_qris', true),
      // A virtual account takes a second transfer; a dynamic QR is used up by the first payment.
      new FakeAdapter(this, 'fake_va', false),
      // A PG that takes the payment on its own page: the charge answers a payment URL, not a QR.
      new FakeAdapter(this, 'fake_checkout', true),
    ];
  }

  onboarding(): OnboardingAdapter {
    return new FakeOnboarding(this);
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
        providerRef: `FAKE-${PREFIX[method]}-${serial}`,
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
            : method === 'fake_checkout'
              ? { paymentUrl: `https://fake-gateway.invalid/pay/${serial}` }
              : this.virtualAccount(payment.bank, serial),
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

  /** The VA at the bank the payer chose. payment-api sends only a declared bank; anything else is a bug. */
  private virtualAccount(bank: string | null, serial: string) {
    const chosen = FAKE_BANKS.find((b) => b.code === bank);
    if (!chosen) throw new Error('fake gateway: a VA needs one of its banks');
    return {
      bank: chosen.code,
      // UMK-2045: the holder name a bank shows for the VA. A fixed label: the fake gateway knows no store.
      accountName: FAKE_VA_ACCOUNT_NAME,
      vaNumber: `${chosen.vaPrefix}${BigInt(`0x${serial}`).toString().padStart(15, '0').slice(-12)}`,
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
    this.verify(input);
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
    if (bill.status === 'paid' && bill.method !== 'fake_va')
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

  // ---- onboarding: what payment-api asks (the onboarding contract) ---------------------------------------

  private reachable() {
    if (this.accountsDown) throw new GatewayUnreachableError();
  }

  /** Creates the sub-account once per merchant id; a repeat answers the same sub-account, unchanged. */
  createAccount(merchant: MerchantRef, profile: MerchantProfile) {
    this.reachable();
    const now = this.clock.now();
    let account = this.accounts.get(merchant.id);
    if (!account) {
      account = {
        accountId: `FAKE-ACCT-${randomBytes(6).toString('hex').toUpperCase()}`,
        merchantId: merchant.id,
        tenantId: merchant.tenantId,
        status: 'pending',
        reason: null,
        profile,
        createdAt: now,
        updatedAt: now,
      };
      this.accounts.set(merchant.id, account);
    }
    return { providerAccountId: account.accountId };
  }

  /** Takes the corrected draft of a sub-account that exists; after `needs_fix` it is reviewed again. */
  updateAccount(merchant: MerchantRef, profile: MerchantProfile) {
    this.reachable();
    const account = this.accounts.get(merchant.id);
    if (!account) throw new Error('fake gateway: no such account');
    account.profile = profile;
    if (account.status === 'needs_fix') {
      account.status = 'pending';
      account.reason = null;
    }
    account.updatedAt = this.clock.now();
  }

  /** The page where the owner would verify. Nothing answers at this address: the controls stand in for it. */
  verificationLink(merchant: MerchantRef) {
    this.reachable();
    if (!this.accounts.has(merchant.id))
      throw new Error('fake gateway: no such account');
    return {
      url: `https://fake-gateway.invalid/verify/${randomBytes(16).toString('hex')}`,
      expiresAt: new Date(this.clock.now().getTime() + 3_600_000),
    };
  }

  getAccountStatus(merchant: MerchantRef): AccountStatusResult {
    this.reachable();
    const account = this.accounts.get(merchant.id);
    if (!account) return { status: 'not_found' };
    return {
      status: account.status,
      reason: account.reason ?? undefined,
      updatedAt: account.updatedAt,
    };
  }

  /** The same signature as a payment notification; the signed body says it is about an account. */
  readAccountWebhook(input: WebhookInput): AccountNotice {
    this.verify(input);
    const parsed = JSON.parse(input.rawBody.toString('utf8')) as {
      eventId: string;
      type?: string;
      account?: string;
    };
    if (parsed.type !== 'account' || typeof parsed.eventId !== 'string')
      throw new Error('fake gateway: not an account notification');
    return { eventId: parsed.eventId, reference: parsed.account ?? null };
  }

  // ---- onboarding: what the gateway's reviewer does (the control routes) ---------------------------------

  /** The tenant's sub-account; undefined when it has none. */
  accountOf(tenantId: string): FakeAccount | undefined {
    return [...this.accounts.values()].find((a) => a.tenantId === tenantId);
  }

  review(account: FakeAccount, action: FakeReview, reason?: string): void {
    const from: Record<FakeReview, readonly ProviderAccountStatus[]> = {
      // Approving a suspended account reinstates it.
      approve: ['pending', 'needs_fix', 'suspended'],
      needs_fix: ['pending'],
      reject: ['pending', 'needs_fix'],
      suspend: ['pending', 'needs_fix', 'verified'],
    };
    if (!from[action].includes(account.status))
      throw new FakeGatewayRefusal('account_not_reviewable');
    const to: Record<FakeReview, ProviderAccountStatus> = {
      approve: 'verified',
      needs_fix: 'needs_fix',
      reject: 'rejected',
      suspend: 'suspended',
    };
    account.status = to[action];
    account.reason = action === 'approve' ? null : (reason ?? null);
    account.updatedAt = this.clock.now();
  }

  /** A signed account notification. Pass an earlier event id to build the same event again. */
  accountNotification(
    account: FakeAccount,
    eventId?: string,
  ): FakeNotification {
    const id = eventId ?? `fake-acct-evt-${this.run}-${++this.eventSeq}`;
    // As a PG's: our reference and nothing about the tenant or the status.
    const body = JSON.stringify({
      eventId: id,
      type: 'account',
      account: account.merchantId,
    });
    return { eventId: id, body, signature: this.sign(Buffer.from(body)) };
  }

  private verify(input: WebhookInput) {
    const given = input.headers[FAKE_SIGNATURE_HEADER];
    const expected = Buffer.from(this.sign(input.rawBody));
    const actual = Buffer.from(typeof given === 'string' ? given : '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new WebhookSignatureError();
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
  readonly validity: BillValidity;
  readonly banks?: readonly Bank[];

  constructor(
    private readonly gateway: LocalFakeGateway,
    readonly method: FakeMethod,
    readonly singleUseQr: boolean,
  ) {
    // A virtual account is paid from a bank app, not at the till: it lives longer than a QR (UMK-2039).
    this.validity = method === 'fake_va' ? 'va' : 'qr';
    this.banks =
      method === 'fake_va'
        ? FAKE_BANKS.map(({ code, name }) => ({ code, name }))
        : undefined;
  }

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

/**
 * The fake gateway behind the onboarding contract: `hosted`, as the first real provider will be. The owner's
 * step on the gateway's page is played by the control routes.
 */
class FakeOnboarding implements OnboardingAdapter {
  readonly provider = FAKE_PROVIDER;
  readonly modes = ['fake'] as const;
  readonly verification = 'hosted' as const;
  readonly methods = FAKE_METHODS;

  constructor(private readonly gateway: LocalFakeGateway) {}

  // Wrapped so that a throw is a rejected promise, as from a real PG client.
  async createAccount(merchant: MerchantRef, profile: MerchantProfile) {
    return Promise.resolve(this.gateway.createAccount(merchant, profile));
  }

  async updateAccount(merchant: MerchantRef, profile: MerchantProfile) {
    return Promise.resolve(this.gateway.updateAccount(merchant, profile));
  }

  async verificationLink(merchant: MerchantRef) {
    return Promise.resolve(this.gateway.verificationLink(merchant));
  }

  async getAccountStatus(merchant: MerchantRef) {
    return Promise.resolve(this.gateway.getAccountStatus(merchant));
  }

  async handleAccountWebhook(input: WebhookInput) {
    return Promise.resolve(this.gateway.readAccountWebhook(input));
  }
}
