import { Inject, Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../config';
import { GATEWAY_METHODS } from '../db/schema';

/** The HTTP call the client makes; a provider so a test can drop or delay an answer. */
export const PAYMENT_FETCH = Symbol('PAYMENT_FETCH');
export type PaymentFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

/**
 * payment-api's methods a store may configure as an online (payment gateway) method. Only the local fake
 * gateway until the legal gate (UMK-1977): a real provider adds its methods here.
 */
export const ONLINE_METHODS = GATEWAY_METHODS;
export type OnlineMethod = (typeof ONLINE_METHODS)[number];
export const isOnlineMethod = (code: string | null): code is OnlineMethod =>
  ONLINE_METHODS.includes(code as OnlineMethod);

/** payment-api's methods for the POS's method kinds. Kasbon (`isCredit`) is not a payment method. */
export type PaymentMethodCode =
  'cash' | 'edc_debit' | 'static_qris' | OnlineMethod;
export const paymentMethodCode = (m: {
  isCash: boolean;
  isDebit: boolean;
  isWallet: boolean;
  isOnline?: boolean;
  gatewayMethod?: string | null;
}): PaymentMethodCode | null =>
  m.isCash
    ? 'cash'
    : m.isDebit
      ? 'edc_debit'
      : m.isWallet
        ? 'static_qris'
        : m.isOnline && isOnlineMethod(m.gatewayMethod ?? null)
          ? (m.gatewayMethod as OnlineMethod)
          : null;

/** Money the PG received that paid no payment (late, duplicate, another amount); payment-api refunds it. */
export type UnmatchedReceipt = {
  id: string;
  kind: string;
  grossAmount: number;
  needsReview: boolean;
  refundStatus: string | null;
};

/** A payment as payment-api answers it (the fields pos-api uses). */
export type Payment = {
  id: string;
  orderRef: string;
  status: string;
  amount: number;
  method: string;
  attempt: number;
  /** What the payer needs for a PG payment: `qrString`, or `bank` and `vaNumber`. */
  checkout: Record<string, string> | null;
  /** ISO time the QR or VA stops accepting payment; null for a payment taken at the cashier. */
  expiresAt: string | null;
  /** ISO time payment-api last asked the PG. */
  lastSyncedAt: string | null;
  /** ISO time the payment became `paid`, by payment-api's clock; null when it gave none or one that is no time. */
  paidAt: string | null;
  /** False: the PG cannot close an unpaid bill, which stays payable until it expires (D13). */
  canCancel: boolean;
  unmatchedReceipts: UnmatchedReceipt[];
};

/** A bank a PG method can make a bill at (a virtual account): payment-api's code and the name to show. */
export type Bank = { code: string; name: string };

/** A store's account at a payment gateway, as payment-api answers it (UMK-2019). No secret is in it. */
export type MerchantAccount = {
  provider: string;
  mode: string;
  status: string;
  statusReason: string | null;
  verification: string;
  profile: {
    businessType: string | null;
    businessName: string | null;
    email: string | null;
    phone: string | null;
  };
  termsAcceptedAt: string | null;
  submittedAt: string | null;
  methods: {
    method: string;
    enabled: boolean;
    chargeable: boolean;
    /** UMK-2037: what the customer chooses from before a bill of this method is made; empty when none. */
    banks: Bank[];
  }[];
  lastSyncedAt: string | null;
  updatedAt: string | null;
};

export type MerchantDraft = {
  businessType: string | null;
  businessName: string | null;
  email: string | null;
  phone: string | null;
};

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Copies the known fields of an account and nothing else: whatever payment-api may answer one day, only
 * these reach a browser.
 */
const toMerchantAccount = (v: unknown): MerchantAccount | null => {
  const a = v as Record<string, unknown> | null;
  if (
    !a ||
    typeof a.provider !== 'string' ||
    typeof a.status !== 'string' ||
    !Array.isArray(a.methods)
  )
    return null;
  const profile = (a.profile ?? {}) as Record<string, unknown>;
  return {
    provider: a.provider,
    mode: text(a.mode) ?? '',
    status: a.status,
    statusReason: text(a.statusReason),
    verification: text(a.verification) ?? '',
    profile: {
      businessType: text(profile.businessType),
      businessName: text(profile.businessName),
      email: text(profile.email),
      phone: text(profile.phone),
    },
    termsAcceptedAt: text(a.termsAcceptedAt),
    submittedAt: text(a.submittedAt),
    methods: (a.methods as Record<string, unknown>[])
      .filter((m) => m && typeof m.method === 'string')
      .map((m) => ({
        method: m.method as string,
        enabled: m.enabled === true,
        chargeable: m.chargeable === true,
        banks: (Array.isArray(m.banks) ? (m.banks as unknown[]) : [])
          .map((b) => b as Record<string, unknown> | null)
          .filter(
            (b): b is { code: string; name: string } =>
              !!b && typeof b.code === 'string' && typeof b.name === 'string',
          )
          .map((b) => ({ code: b.code, name: b.name })),
      })),
    lastSyncedAt: text(a.lastSyncedAt),
    updatedAt: text(a.updatedAt),
  };
};

/** Still waiting for the payer: neither paid nor closed. */
export const isInFlight = (p: { status: string }) =>
  p.status === 'created' || p.status === 'pending';

/**
 * payment-api gave no usable answer.
 * - `unavailable`: no clear yes or no (network, timeout, 5xx, and 401/400, which are our own configuration).
 *   Nothing may be concluded: the caller changes nothing and tries again later.
 * - `rejected`: a clear refusal (404, 409, 422) with payment-api's stable `code`.
 */
export class PaymentApiError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'rejected',
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(`payment-api ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'PaymentApiError';
  }
}

/**
 * A time payment-api answered, as an ISO string, or null when it is missing or not a time. What comes back
 * is safe to hand to the database: a value that is no time must never make a write throw.
 */
export const isoTime = (v: unknown): string | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  const at = new Date(v);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

const isPayment = (v: unknown): v is Payment => {
  const p = v as Partial<Payment> | null;
  return (
    !!p &&
    typeof p.id === 'string' &&
    typeof p.status === 'string' &&
    typeof p.orderRef === 'string' &&
    Number.isSafeInteger(p.amount)
  );
};

/**
 * pos-api → payment-api, server to server (UMK-1991). The ONLY file that reads the service key and writes the
 * `X-Payment-Service-Key` and `X-Tenant-Id` headers (guard test). Every method takes the tenant id first: the
 * caller passes `session.tenantId`, or the tenant of the pos row it is working on (job, purge). Never a value
 * from a request body, query or path.
 *
 * Off when PAYMENT_API_URL is unset (`enabled` false): callers skip payment-api and behave as before UMK-1991.
 */
@Injectable()
export class PaymentsClient {
  private readonly logger = new Logger(PaymentsClient.name);
  private readonly baseUrl: string | null;
  private readonly serviceKey: string;
  private readonly timeoutMs: number;

  constructor(@Inject(PAYMENT_FETCH) private readonly http: PaymentFetch) {
    const env = loadEnv();
    this.baseUrl = env.PAYMENT_API_URL?.replace(/\/+$/, '') ?? null;
    this.serviceKey = env.PAYMENT_SERVICE_KEY ?? '';
    this.timeoutMs = env.PAYMENT_API_TIMEOUT_MS;
  }

  get enabled(): boolean {
    return this.baseUrl !== null;
  }

  /**
   * Creates and charges. The key is the order reference plus the attempt number, so a repeated call answers
   * the first payment and never makes a second one.
   */
  async charge(
    tenantId: string,
    input: {
      orderRef: string;
      attempt: number;
      method: PaymentMethodCode;
      /** Integer rupiah. */
      amount: number;
      actorRef: string;
      /** UMK-2037: the bank of a PG method that needs one; left out for every other charge. */
      bank?: string;
    },
  ): Promise<Payment> {
    return this.payment(
      await this.call(tenantId, 'POST', '/payments', 'POST /payments', {
        body: input,
        idempotencyKey: `${input.orderRef}:${input.attempt}`,
      }),
    );
  }

  /**
   * Closes a charge key for good, with the charge's own input. payment-api answers the payment that has
   * the key, unchanged (a `paid` one stays paid), or writes a `cancelled` one under it, so a charge of
   * ours that is still on its way can never be paid. The only answer on which a sale may be cancelled
   * for want of a payment.
   */
  async close(
    tenantId: string,
    input: {
      orderRef: string;
      attempt: number;
      method: PaymentMethodCode;
      amount: number;
      actorRef: string;
      bank?: string;
    },
  ): Promise<Payment> {
    return this.payment(
      await this.call(
        tenantId,
        'POST',
        '/payments/close',
        'POST /payments/close',
        {
          body: input,
          idempotencyKey: `${input.orderRef}:${input.attempt}`,
        },
      ),
    );
  }

  /** The payment a charge key made, or null when payment-api has none. */
  async findByKey(tenantId: string, key: string): Promise<Payment | null> {
    const page = (await this.call(
      tenantId,
      'GET',
      `/payments?idempotencyKey=${encodeURIComponent(key)}&perPage=1`,
      'GET /payments',
    )) as { items?: unknown[] } | null;
    if (!page || !Array.isArray(page.items))
      throw new PaymentApiError('unavailable', null, 'bad_answer');
    return page.items.length ? this.payment(page.items[0]) : null;
  }

  async get(tenantId: string, id: string): Promise<Payment> {
    return this.payment(
      await this.call(
        tenantId,
        'GET',
        `/payments/${encodeURIComponent(id)}`,
        'GET /payments/:id',
      ),
    );
  }

  /** Every payment of an order (all attempts), newest first; without their unmatched receipts. */
  async listByOrder(tenantId: string, orderRef: string): Promise<Payment[]> {
    const page = (await this.call(
      tenantId,
      'GET',
      `/payments?orderRef=${encodeURIComponent(orderRef)}&perPage=20`,
      'GET /payments',
    )) as { items?: unknown[] } | null;
    if (!page || !Array.isArray(page.items))
      throw new PaymentApiError('unavailable', null, 'bad_answer');
    return page.items.map((item) => this.payment(item));
  }

  /** Manual status check: payment-api asks the PG (at most once per its interval) and answers the payment. */
  async sync(tenantId: string, id: string): Promise<Payment> {
    return this.payment(
      await this.call(
        tenantId,
        'POST',
        `/payments/${encodeURIComponent(id)}/sync`,
        'POST /payments/:id/sync',
      ),
    );
  }

  /**
   * Closes a bill that is still unpaid: no reason and no approver, it is neither a void nor a refund. Only
   * for a payment that is still waiting. Rejected with `already_paid` when the payer paid first (the
   * payment is then `paid`).
   */
  async cancelPending(
    tenantId: string,
    id: string,
    actorRef: string,
  ): Promise<Payment> {
    return this.payment(
      await this.call(
        tenantId,
        'POST',
        `/payments/${encodeURIComponent(id)}/cancel`,
        'POST /payments/:id/cancel',
        { body: { actorRef } },
      ),
    );
  }

  /**
   * PG payments only, the full amount. `approvedBy` is the approver whose PIN pos-api verified. A repeat
   * answers the refund under way; on a refused refund it asks the PG again.
   */
  async refund(
    tenantId: string,
    id: string,
    input: {
      reasonCode: string;
      note?: string;
      actorRef: string;
      approvedBy: string;
    },
  ): Promise<Payment> {
    return this.payment(
      await this.call(
        tenantId,
        'POST',
        `/payments/${encodeURIComponent(id)}/refund`,
        'POST /payments/:id/refund',
        { body: input },
      ),
    );
  }

  /** The store returned the money of a refused refund by hand. */
  async markRefundedManually(
    tenantId: string,
    id: string,
    input: { note: string; actorRef: string; approvedBy: string },
  ): Promise<Payment> {
    return this.payment(
      await this.call(
        tenantId,
        'POST',
        `/payments/${encodeURIComponent(id)}/refund/manual`,
        'POST /payments/:id/refund/manual',
        { body: input },
      ),
    );
  }

  /** CASHAC only. `approvedBy` is the approver whose PIN pos-api verified. A repeat answers the voided payment. */
  async void(
    tenantId: string,
    id: string,
    input: {
      reasonCode: string;
      note?: string;
      actorRef: string;
      approvedBy: string;
    },
  ): Promise<Payment> {
    return this.payment(
      await this.call(
        tenantId,
        'POST',
        `/payments/${encodeURIComponent(id)}/void`,
        'POST /payments/:id/void',
        { body: input },
      ),
    );
  }

  /** Deletes every row of the store in payment-api. Only the store purge calls this. */
  async purge(tenantId: string): Promise<void> {
    await this.call(
      tenantId,
      'POST',
      '/internal/tenants/purge',
      'POST /internal/tenants/purge',
    );
  }

  // ---- the store's account at a payment gateway (UMK-2019) -------------------------------------------------

  async merchantAccounts(
    tenantId: string,
  ): Promise<{ mode: string; accounts: MerchantAccount[] }> {
    const body = (await this.call(
      tenantId,
      'GET',
      '/merchant-accounts',
      'GET /merchant-accounts',
    )) as { mode?: unknown; items?: unknown[] } | null;
    if (!body || !Array.isArray(body.items))
      throw new PaymentApiError('unavailable', null, 'bad_answer');
    return {
      mode: text(body.mode) ?? '',
      accounts: body.items.map((item) => this.merchant(item)),
    };
  }

  async saveMerchantDraft(
    tenantId: string,
    provider: string,
    // Only the fields the owner sent: payment-api keeps the others.
    draft: Partial<MerchantDraft>,
  ): Promise<MerchantAccount> {
    return this.merchant(
      await this.call(
        tenantId,
        'PUT',
        `/merchant-accounts/${encodeURIComponent(provider)}`,
        'PUT /merchant-accounts/:provider',
        { body: draft },
      ),
    );
  }

  /** `actorRef` is who agreed to the terms and submitted. A repeat answers the submitted account. */
  async submitMerchant(
    tenantId: string,
    provider: string,
    input: { actorRef: string },
  ): Promise<MerchantAccount> {
    return this.merchant(
      await this.call(
        tenantId,
        'POST',
        `/merchant-accounts/${encodeURIComponent(provider)}/submit`,
        'POST /merchant-accounts/:provider/submit',
        { body: { termsAccepted: true, actorRef: input.actorRef } },
      ),
    );
  }

  /** The gateway's page where the owner verifies. Handed to the owner's browser; never stored or logged. */
  async merchantVerificationLink(
    tenantId: string,
    provider: string,
  ): Promise<{ url: string; expiresAt: string | null }> {
    const body = (await this.call(
      tenantId,
      'POST',
      `/merchant-accounts/${encodeURIComponent(provider)}/verification-link`,
      'POST /merchant-accounts/:provider/verification-link',
    )) as { url?: unknown; expiresAt?: unknown } | null;
    if (!body || typeof body.url !== 'string')
      throw new PaymentApiError('unavailable', null, 'bad_answer');
    return { url: body.url, expiresAt: text(body.expiresAt) };
  }

  async syncMerchant(
    tenantId: string,
    provider: string,
  ): Promise<MerchantAccount> {
    return this.merchant(
      await this.call(
        tenantId,
        'POST',
        `/merchant-accounts/${encodeURIComponent(provider)}/sync`,
        'POST /merchant-accounts/:provider/sync',
      ),
    );
  }

  async setMerchantMethod(
    tenantId: string,
    provider: string,
    method: string,
    input: { enabled: boolean; actorRef: string },
  ): Promise<MerchantAccount> {
    return this.merchant(
      await this.call(
        tenantId,
        'PUT',
        `/merchant-accounts/${encodeURIComponent(provider)}/methods/${encodeURIComponent(method)}`,
        'PUT /merchant-accounts/:provider/methods/:method',
        { body: input },
      ),
    );
  }

  private merchant(body: unknown): MerchantAccount {
    const account = toMerchantAccount(body);
    if (!account) throw new PaymentApiError('unavailable', null, 'bad_answer');
    return account;
  }

  private payment(body: unknown): Payment {
    if (!isPayment(body))
      throw new PaymentApiError('unavailable', null, 'bad_answer');
    const raw = body as unknown as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === 'string' ? v : null);
    const checkout =
      raw.checkout && typeof raw.checkout === 'object'
        ? Object.fromEntries(
            Object.entries(raw.checkout as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === 'string',
            ),
          )
        : null;
    const capabilities = raw.capabilities as { canCancel?: unknown } | null;
    const unmatched = Array.isArray(raw.unmatchedReceipts)
      ? (raw.unmatchedReceipts as Record<string, unknown>[])
      : [];
    return {
      id: body.id,
      orderRef: body.orderRef,
      status: body.status,
      amount: body.amount,
      method: body.method,
      attempt: Number.isSafeInteger(raw.attempt) ? (raw.attempt as number) : 1,
      checkout,
      expiresAt: text(raw.expiresAt),
      lastSyncedAt: text(raw.lastSyncedAt),
      paidAt: isoTime(raw.paidAt),
      canCancel: capabilities?.canCancel !== false,
      unmatchedReceipts: unmatched
        .filter(
          (r) =>
            typeof r.id === 'string' && Number.isSafeInteger(r.grossAmount),
        )
        .map((r) => ({
          id: r.id as string,
          kind: text(r.kind) ?? 'unknown',
          grossAmount: r.grossAmount as number,
          needsReview: r.needsReview === true,
          refundStatus: text(r.refundStatus),
        })),
    };
  }

  private async call(
    tenantId: string,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    route: string,
    opts: { body?: object; idempotencyKey?: string } = {},
  ): Promise<unknown> {
    if (this.baseUrl === null)
      throw new PaymentApiError('unavailable', null, 'disabled');
    const headers: Record<string, string> = {
      'X-Payment-Service-Key': this.serviceKey,
      'X-Tenant-Id': tenantId,
      Accept: 'application/json',
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    let res: Response;
    let body: unknown;
    try {
      res = await this.http(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
        // A redirect would carry the service key to wherever it points.
        redirect: 'error',
      });
      body = await res.json().catch(() => null);
    } catch (error) {
      // The route pattern and the error class only: never the URL's ids, the headers or the body.
      this.logger.warn(`${route} → ${(error as Error).name}`);
      throw new PaymentApiError('unavailable', null, null);
    }
    if (res.ok) return body;
    const code =
      typeof (body as { code?: unknown } | null)?.code === 'string'
        ? (body as { code: string }).code
        : null;
    const rejected = [404, 409, 422].includes(res.status);
    if (!rejected)
      this.logger.warn(`${route} → ${res.status}${code ? ` ${code}` : ''}`);
    throw new PaymentApiError(
      rejected ? 'rejected' : 'unavailable',
      res.status,
      code,
    );
  }
}
