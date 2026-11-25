import { loadEnv } from '../config';
import {
  PaymentApiError,
  type PaymentFetch,
  paymentMethodCode,
  PaymentsClient,
} from './payments.client';

const TENANT = '11111111-1111-4111-8111-111111111111';
const BASE = {
  DATABASE_URL: 'postgres://u:p@localhost:5544/pos',
  POS_SESSION_SECRET: 'x'.repeat(32),
  UMKMALL_WEB_URL: 'http://127.0.0.1:9',
  POS_SERVICE_KEY: 'k'.repeat(16),
};
const PAYMENT = {
  id: 'p1',
  orderRef: 'order-1',
  status: 'paid',
  amount: 5200,
  method: 'cash',
};

function clientWith(http: PaymentFetch, env: Record<string, string> = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, BASE, env);
  try {
    return new PaymentsClient(http);
  } finally {
    process.env = saved;
  }
}
const ON = {
  PAYMENT_API_URL: 'http://payment.internal:3001/',
  PAYMENT_SERVICE_KEY: 'service-key-0123456789',
};
const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

describe('payment-api client (UMK-1991)', () => {
  it('env: off without PAYMENT_API_URL; a URL without PAYMENT_SERVICE_KEY (or a short one) is refused', () => {
    expect(loadEnv(BASE).PAYMENT_API_URL).toBeUndefined();
    expect(() =>
      loadEnv({ ...BASE, PAYMENT_API_URL: ON.PAYMENT_API_URL }),
    ).toThrow('PAYMENT_SERVICE_KEY');
    expect(() =>
      loadEnv({ ...BASE, ...ON, PAYMENT_SERVICE_KEY: 'short' }),
    ).toThrow('PAYMENT_SERVICE_KEY');
    expect(loadEnv({ ...BASE, ...ON }).PAYMENT_API_TIMEOUT_MS).toBe(5000);
    // An empty value means off, not a broken deploy.
    expect(
      loadEnv({ ...BASE, PAYMENT_API_URL: '', PAYMENT_SERVICE_KEY: '' })
        .PAYMENT_API_URL,
    ).toBeUndefined();
  });

  it('env: production needs an https URL (or the explicit private-network switch); the waiting time is at least twice the timeout', () => {
    const prod = { ...BASE, ...ON, NODE_ENV: 'production' };
    expect(() => loadEnv(prod)).toThrow('PAYMENT_API_URL');
    expect(
      loadEnv({ ...prod, PAYMENT_API_URL: 'https://payment.umkmall.id' })
        .PAYMENT_API_URL,
    ).toBe('https://payment.umkmall.id');
    expect(
      loadEnv({ ...prod, PAYMENT_API_ALLOW_HTTP: 'true' }).PAYMENT_API_URL,
    ).toBe(ON.PAYMENT_API_URL);
    expect(() =>
      loadEnv({ ...BASE, ...ON, POS_PAYMENT_RECONCILE_AFTER_SECONDS: '9' }),
    ).toThrow('POS_PAYMENT_RECONCILE_AFTER_SECONDS');
    expect(() =>
      loadEnv({ ...BASE, ...ON, POS_PAYMENT_RECONCILE_AFTER_SECONDS: '0' }),
    ).toThrow('POS_PAYMENT_RECONCILE_AFTER_SECONDS');
    expect(
      loadEnv({ ...BASE, ...ON, POS_PAYMENT_RECONCILE_AFTER_SECONDS: '10' })
        .POS_PAYMENT_RECONCILE_AFTER_SECONDS,
    ).toBe(10);
  });

  it('is off without a URL and then never calls out', async () => {
    const http = jest.fn<ReturnType<PaymentFetch>, Parameters<PaymentFetch>>();
    const client = clientWith(http);
    expect(client.enabled).toBe(false);
    await expect(client.get(TENANT, 'p1')).rejects.toMatchObject({
      kind: 'unavailable',
    });
    expect(http).not.toHaveBeenCalled();
  });

  it('sends the service key, the given tenant and the key `<orderRef>:<attempt>`', async () => {
    const http = jest.fn<ReturnType<PaymentFetch>, Parameters<PaymentFetch>>(
      () => json(201, PAYMENT),
    );
    const client = clientWith(http, ON);
    const payment = await client.charge(TENANT, {
      orderRef: 'order-1',
      attempt: 1,
      method: 'cash',
      amount: 5200,
      actorRef: 'cashier:c1',
    });
    expect(payment).toMatchObject(PAYMENT);
    const [url, init] = http.mock.calls[0];
    expect(url).toBe('http://payment.internal:3001/payments');
    expect(init.headers).toMatchObject({
      'X-Payment-Service-Key': ON.PAYMENT_SERVICE_KEY,
      'X-Tenant-Id': TENANT,
      'Idempotency-Key': 'order-1:1',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // A redirect would carry the service key elsewhere.
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string)).toEqual({
      orderRef: 'order-1',
      attempt: 1,
      method: 'cash',
      amount: 5200,
      actorRef: 'cashier:c1',
    });
  });

  it.each([
    [404, 'rejected'],
    [409, 'rejected'],
    [422, 'rejected'],
    [400, 'unavailable'],
    [401, 'unavailable'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('a %i answer is %s', async (status, kind) => {
    const client = clientWith(() => json(status, { code: 'some_code' }), ON);
    const error = await client.get(TENANT, 'p1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentApiError);
    expect(error).toMatchObject({ kind, status, code: 'some_code' });
  });

  it('a network error, a timeout and an answer that is not a payment are unavailable; the error carries no key', async () => {
    const down = clientWith(() => Promise.reject(new TypeError('boom')), ON);
    const error = (await down
      .get(TENANT, 'p1')
      .catch((e: unknown) => e)) as PaymentApiError;
    expect(error.kind).toBe('unavailable');
    expect(JSON.stringify({ ...error, m: error.message })).not.toContain(
      ON.PAYMENT_SERVICE_KEY,
    );
    const odd = clientWith(() => json(200, { id: 'p1', amount: '5200' }), ON);
    await expect(odd.get(TENANT, 'p1')).rejects.toMatchObject({
      kind: 'unavailable',
    });
    const slow = clientWith(
      (_url, init) =>
        new Promise((_, reject) =>
          init.signal!.addEventListener('abort', () =>
            reject(init.signal!.reason as Error),
          ),
        ),
      { ...ON, PAYMENT_API_TIMEOUT_MS: '20' },
    );
    await expect(slow.get(TENANT, 'p1')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('close sends the charge’s own key and body to /payments/close', async () => {
    const http = jest.fn<ReturnType<PaymentFetch>, Parameters<PaymentFetch>>(
      () => json(201, { ...PAYMENT, status: 'cancelled' }),
    );
    const client = clientWith(http, ON);
    const closed = await client.close(TENANT, {
      orderRef: 'order-1',
      attempt: 1,
      method: 'cash',
      amount: 5200,
      actorRef: 'cashier:c1',
    });
    expect(closed.status).toBe('cancelled');
    const [url, init] = http.mock.calls[0];
    expect(url).toBe('http://payment.internal:3001/payments/close');
    expect(init.headers).toMatchObject({
      'X-Tenant-Id': TENANT,
      'Idempotency-Key': 'order-1:1',
    });
  });

  it('findByKey answers the payment of a key, or null', async () => {
    const found = clientWith(() => json(200, { items: [PAYMENT] }), ON);
    expect(await found.findByKey(TENANT, 'order-1:1')).toMatchObject(PAYMENT);
    const none = clientWith(() => json(200, { items: [] }), ON);
    expect(await none.findByKey(TENANT, 'order-1:1')).toBeNull();
  });

  it('maps the POS method kinds; kasbon is not a payment method', () => {
    const kind = (k: 'isCash' | 'isDebit' | 'isWallet' | null) =>
      paymentMethodCode({
        isCash: k === 'isCash',
        isDebit: k === 'isDebit',
        isWallet: k === 'isWallet',
      });
    expect(kind('isCash')).toBe('cash');
    expect(kind('isDebit')).toBe('edc_debit');
    expect(kind('isWallet')).toBe('static_qris');
    expect(kind(null)).toBeNull();
    // An online method is charged as its gateway method, and only as one this build knows.
    const online = (gatewayMethod: string | null) =>
      paymentMethodCode({
        isCash: false,
        isDebit: false,
        isWallet: false,
        isOnline: true,
        gatewayMethod,
      });
    expect(online('fake_qris')).toBe('fake_qris');
    expect(online('fake_va')).toBe('fake_va');
    expect(online('some_gateway')).toBeNull();
    expect(online(null)).toBeNull();
  });

  it('reads what a PG payment adds: checkout, expiry, last check, whether the bill can be closed, late money', async () => {
    const pg = {
      ...PAYMENT,
      method: 'fake_qris',
      status: 'pending',
      attempt: 2,
      checkout: { qrString: 'QR', n: 5 },
      expiresAt: '2026-11-25T10:15:00.000Z',
      lastSyncedAt: null,
      capabilities: { canCancel: false },
      unmatchedReceipts: [
        {
          id: 'r1',
          kind: 'late_payment',
          grossAmount: 5200,
          needsReview: true,
          refundStatus: 'pending',
          refundActor: 'system',
        },
        { id: 'r2', grossAmount: 1.5 },
      ],
    };
    const client = clientWith(() => json(200, pg), ON);
    expect(await client.sync(TENANT, 'p1')).toEqual({
      ...PAYMENT,
      method: 'fake_qris',
      status: 'pending',
      attempt: 2,
      checkout: { qrString: 'QR' },
      expiresAt: '2026-11-25T10:15:00.000Z',
      lastSyncedAt: null,
      canCancel: false,
      unmatchedReceipts: [
        {
          id: 'r1',
          kind: 'late_payment',
          grossAmount: 5200,
          needsReview: true,
          refundStatus: 'pending',
        },
      ],
    });
    // A payment taken at the cashier has none of it.
    const plain = clientWith(() => json(200, PAYMENT), ON);
    expect(await plain.get(TENANT, 'p1')).toEqual({
      ...PAYMENT,
      attempt: 1,
      checkout: null,
      expiresAt: null,
      lastSyncedAt: null,
      canCancel: true,
      unmatchedReceipts: [],
    });
  });

  it('closes an unpaid bill with the actor only, and sends a refund with its reason and approver', async () => {
    const seen: { url: string; body: unknown }[] = [];
    const client = clientWith((url, init) => {
      seen.push({ url, body: JSON.parse(init.body as string) as unknown });
      return json(200, PAYMENT);
    }, ON);
    await client.cancelPending(TENANT, 'p1', 'cashier:c1');
    await client.refund(TENANT, 'p1', {
      reasonCode: 'customer_cancelled',
      actorRef: 'cashier:c1',
      approvedBy: 'owner:o1',
    });
    await client.markRefundedManually(TENANT, 'p1', {
      note: 'tunai',
      actorRef: 'owner:o1',
      approvedBy: 'owner:o1',
    });
    expect(seen.map((x) => [new URL(x.url).pathname, x.body])).toEqual([
      ['/payments/p1/cancel', { actorRef: 'cashier:c1' }],
      [
        '/payments/p1/refund',
        {
          reasonCode: 'customer_cancelled',
          actorRef: 'cashier:c1',
          approvedBy: 'owner:o1',
        },
      ],
      [
        '/payments/p1/refund/manual',
        { note: 'tunai', actorRef: 'owner:o1', approvedBy: 'owner:o1' },
      ],
    ]);
  });
});
