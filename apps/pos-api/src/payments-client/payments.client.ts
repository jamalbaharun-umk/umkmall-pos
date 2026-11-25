import { Inject, Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../config';

/** The HTTP call the client makes; a provider so a test can drop or delay an answer. */
export const PAYMENT_FETCH = Symbol('PAYMENT_FETCH');
export type PaymentFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

/** payment-api's methods for the POS's method kinds. Kasbon (`isCredit`) is not a payment method. */
export type PaymentMethodCode = 'cash' | 'edc_debit' | 'static_qris';
export const paymentMethodCode = (m: {
  isCash: boolean;
  isDebit: boolean;
  isWallet: boolean;
}): PaymentMethodCode | null =>
  m.isCash
    ? 'cash'
    : m.isDebit
      ? 'edc_debit'
      : m.isWallet
        ? 'static_qris'
        : null;

/** A payment as payment-api answers it (the fields pos-api uses). */
export type Payment = {
  id: string;
  orderRef: string;
  status: string;
  amount: number;
  method: string;
};

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
    },
  ): Promise<Payment> {
    return this.payment(
      await this.call(tenantId, 'POST', '/payments', 'POST /payments', {
        body: input,
        idempotencyKey: `${input.orderRef}:${input.attempt}`,
      }),
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

  private payment(body: unknown): Payment {
    if (!isPayment(body))
      throw new PaymentApiError('unavailable', null, 'bad_answer');
    return {
      id: body.id,
      orderRef: body.orderRef,
      status: body.status,
      amount: body.amount,
      method: body.method,
    };
  }

  private async call(
    tenantId: string,
    method: 'GET' | 'POST',
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
    this.logger.warn(`${route} → ${res.status}${code ? ` ${code}` : ''}`);
    throw new PaymentApiError(
      rejected ? 'rejected' : 'unavailable',
      res.status,
      code,
    );
  }
}
