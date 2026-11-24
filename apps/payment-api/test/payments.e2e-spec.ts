import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import {
  CANCEL,
  createApp,
  createStore,
  SERVICE_KEY,
} from './support/fixtures';

describe('payments: charge, idempotency, lookup', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });

  beforeAll(async () => {
    ({ app } = await createApp());
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const rows = (tenantId: string) =>
    admin<{ id: string; status: string; amount: string }[]>`
      select id, status, amount from payment.payments where tenant_id = ${tenantId}`;
  const eventCount = async (paymentId: string) => {
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from payment.payment_events where payment_id = ${paymentId}`;
    return n;
  };

  it.each(['cash', 'edc_debit', 'static_qris', 'kasbon'])(
    'charges a %s payment as paid at once, with a charged audit row',
    async (method) => {
      const s = createStore(app);
      const key = randomUUID();
      const res = await s
        .post(
          '/payments',
          { orderRef: 'INV-1', method, amount: 12_500, actorRef: 'cashier-7' },
          key,
        )
        .expect(201);
      expect(res.body).toMatchObject({
        orderRef: 'INV-1',
        method,
        kind: 'cashac',
        amount: 12_500,
        status: 'paid',
        idempotencyKey: key,
        providerRef: null,
        cancelledAt: null,
      });
      expect(res.body.paidAt).toEqual(expect.any(String));
      expect(res.body.events).toEqual([
        {
          type: 'charged',
          actorRef: 'cashier-7',
          approvedBy: null,
          reason: null,
          createdAt: expect.any(String),
        },
      ]);
      // Internals stay inside.
      expect(res.body).not.toHaveProperty('tenantId');
      expect(res.body).not.toHaveProperty('requestHash');
      const stored = await rows(s.tenantId);
      expect(stored).toEqual([
        { id: res.body.id, status: 'paid', amount: '12500' },
      ]);
    },
  );

  it('a retry with the same idempotency key returns the first payment and creates no second one', async () => {
    const s = createStore(app);
    const key = randomUUID();
    const body = {
      orderRef: 'INV-2',
      method: 'cash',
      amount: 40_000,
      actorRef: 'cashier-7',
    };
    const first = await s.post('/payments', body, key).expect(201);
    const retry = await s.post('/payments', body, key).expect(200);
    expect(retry.body).toEqual(first.body);
    expect(await rows(s.tenantId)).toHaveLength(1);
    expect(await eventCount(first.body.id)).toBe(1);
  });

  it('five concurrent requests with one key create one payment', async () => {
    const s = createStore(app);
    const key = randomUUID();
    const body = {
      orderRef: 'INV-3',
      method: 'cash',
      amount: 9_000,
      actorRef: 'cashier-7',
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => s.post('/payments', body, key)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      200, 200, 200, 200, 201,
    ]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await rows(s.tenantId)).toHaveLength(1);
  });

  it('refuses the same key with another request (409), and charges nothing', async () => {
    const s = createStore(app);
    const key = randomUUID();
    const body = {
      orderRef: 'INV-4',
      method: 'cash',
      amount: 40_000,
      actorRef: 'cashier-7',
    };
    await s.post('/payments', body, key).expect(201);
    for (const other of [
      { ...body, amount: 40_001 },
      { ...body, orderRef: 'INV-4b' },
      { ...body, method: 'kasbon' },
    ]) {
      const res = await s.post('/payments', other, key).expect(409);
      expect(res.body.code).toBe('idempotency_key_reused');
    }
    expect(await rows(s.tenantId)).toHaveLength(1);
  });

  it('keeps idempotency keys per tenant: the same key under two tenants is two payments', async () => {
    const a = createStore(app);
    const b = createStore(app);
    const key = randomUUID();
    const body = {
      orderRef: 'INV-5',
      method: 'cash',
      amount: 1_000,
      actorRef: 'cashier-7',
    };
    const pa = await a.post('/payments', body, key).expect(201);
    const pb = await b.post('/payments', body, key).expect(201);
    expect(pa.body.id).not.toBe(pb.body.id);
    expect(await rows(a.tenantId)).toHaveLength(1);
    expect(await rows(b.tenantId)).toHaveLength(1);
  });

  it('allows one live payment per order (no split payment); a voided order can be charged again', async () => {
    const s = createStore(app);
    const first = await s.charge({ orderRef: 'INV-6' });
    const second = await s
      .post(
        '/payments',
        { orderRef: 'INV-6', method: 'edc_debit', amount: 5, actorRef: 'c' },
        randomUUID(),
      )
      .expect(409);
    expect(second.body.code).toBe('order_already_paid');
    expect(await rows(s.tenantId)).toHaveLength(1);

    await s.post(`/payments/${first.id}/void`, CANCEL).expect(200);
    await s
      .post(
        '/payments',
        { orderRef: 'INV-6', method: 'edc_debit', amount: 5, actorRef: 'c' },
        randomUUID(),
      )
      .expect(201);
  });

  it('accepts only integer rupiah', async () => {
    const s = createStore(app);
    const base = { orderRef: 'INV-7', method: 'cash', actorRef: 'c' };
    for (const amount of [10.5, '1000', -1, null, 1e13, Number.NaN]) {
      const res = await s
        .post('/payments', { ...base, amount }, randomUUID())
        .expect(422);
      expect(res.body.errors).toHaveProperty('amount');
    }
    await s.post('/payments', base, randomUUID()).expect(422);
    expect(await rows(s.tenantId)).toHaveLength(0);
    // Zero is a payment record for an order nothing is due on.
    await s.post('/payments', { ...base, amount: 0 }, randomUUID()).expect(201);
  });

  it('answers 422 per field for a bad charge, and never echoes what was sent', async () => {
    const s = createStore(app);
    const empty = await s.post('/payments', {}, randomUUID()).expect(422);
    expect(Object.keys(empty.body.errors).sort()).toEqual([
      'actorRef',
      'amount',
      'method',
      'orderRef',
    ]);
    const unknown = await s
      .post(
        '/payments',
        { orderRef: 'o', method: 'bitcoin-xyz', amount: 1, actorRef: 'c' },
        randomUUID(),
      )
      .expect(422);
    expect(unknown.body.errors).toEqual({ method: 'Unknown payment method' });
    expect(JSON.stringify(unknown.body)).not.toContain('bitcoin-xyz');
    const blank = await s
      .post(
        '/payments',
        { orderRef: '  ', method: 'cash', amount: 1, actorRef: 'c' },
        randomUUID(),
      )
      .expect(422);
    expect(Object.keys(blank.body.errors)).toEqual(['orderRef']);
  });

  it('requires a well-formed Idempotency-Key', async () => {
    const s = createStore(app);
    const body = { orderRef: 'o', method: 'cash', amount: 1, actorRef: 'c' };
    const missing = await s.post('/payments', body).expect(422);
    expect(missing.body.errors).toHaveProperty('Idempotency-Key');
    await s.post('/payments', body, 'short').expect(422);
    await s.post('/payments', body, 'has spaces in it').expect(422);
    expect(await rows(s.tenantId)).toHaveLength(0);
  });

  it('finds payments by order reference, by idempotency key and by status (reconciliation)', async () => {
    const s = createStore(app);
    const key = `sale:${randomUUID()}`;
    const a = await s
      .post(
        '/payments',
        { orderRef: 'INV-A', method: 'cash', amount: 100, actorRef: 'c' },
        key,
      )
      .expect(201);
    const b = await s.charge({ orderRef: 'INV-B' });
    await s.post(`/payments/${b.id}/void`, CANCEL).expect(200);
    const b2 = await s.charge({ orderRef: 'INV-B' });

    const byOrder = await s.get('/payments?orderRef=INV-B').expect(200);
    expect(byOrder.body.total).toBe(2);
    expect(byOrder.body.items.map((p: { id: string }) => p.id)).toEqual([
      b2.id,
      b.id,
    ]); // newest first
    expect(byOrder.body.items[0]).not.toHaveProperty('events');

    const byKey = await s
      .get(`/payments?idempotencyKey=${encodeURIComponent(key)}`)
      .expect(200);
    expect(byKey.body.items.map((p: { id: string }) => p.id)).toEqual([
      a.body.id,
    ]);

    const paid = await s.get('/payments?status=paid').expect(200);
    expect(paid.body.items.map((p: { id: string }) => p.id).sort()).toEqual(
      [a.body.id, b2.id].sort(),
    );
    const voided = await s.get('/payments?status=voided').expect(200);
    expect(voided.body.items.map((p: { id: string }) => p.id)).toEqual([b.id]);
    const liveForB = await s
      .get('/payments?orderRef=INV-B&status=paid')
      .expect(200);
    expect(liveForB.body.items).toHaveLength(1);

    const none = await s.get('/payments?orderRef=NOPE').expect(200);
    expect(none.body).toEqual({ items: [], page: 1, perPage: 20, total: 0 });

    const page = await s.get('/payments?perPage=2&page=2').expect(200);
    expect(page.body).toMatchObject({ page: 2, perPage: 2, total: 3 });
    expect(page.body.items).toHaveLength(1);

    await s.get('/payments?status=bogus').expect(422);
    await s.get('/payments?perPage=1000').expect(422);
  });

  it('reads one payment; an unknown or malformed id is 404', async () => {
    const s = createStore(app);
    const p = await s.charge();
    const res = await s.get(`/payments/${p.id}`).expect(200);
    expect(res.body).toMatchObject({ id: p.id, status: 'paid' });
    const missing = await s.get(`/payments/${randomUUID()}`).expect(404);
    expect(missing.body).toEqual({
      message: 'Payment not found',
      code: 'not_found',
    });
    await s.get('/payments/not-a-uuid').expect(404);
    await s.post('/payments/not-a-uuid/void', CANCEL).expect(404);
    await s.post('/payments/not-a-uuid/sync').expect(404);
  });

  it('answers malformed JSON and unknown routes with a fixed, safe body', async () => {
    const s = createStore(app);
    const bad = await request(app.getHttpServer())
      .post('/payments')
      .set('X-Payment-Service-Key', SERVICE_KEY())
      .set('X-Tenant-Id', s.tenantId)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send('{"orderRef": ')
      .expect(400);
    expect(bad.body).toEqual({ message: 'Bad request' });
    const unknown = await s.get('/nope').expect(404);
    expect(unknown.body).toEqual({ message: 'Not found' });
  });
});
