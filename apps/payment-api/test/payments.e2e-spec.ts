import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  auditOf,
  CANCEL,
  createApp,
  createStore,
  Harness,
  outboxOf,
  SERVICE_KEY,
} from './support/fixtures';

describe('payments: charge, idempotency, lookup', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createApp();
  });
  afterAll(() => h.close());

  const rows = (tenantId: string) =>
    h.sql<{ id: string; status: string; amount: string }[]>`
      select id, status, amount from payment.payments where tenant_id = ${tenantId}`;

  it.each(['cash', 'edc_debit', 'static_qris'])(
    'charges a %s payment as paid at once, with its audit rows and one paid notice',
    async (method) => {
      const s = createStore(h.app);
      const res = await s
        .post(
          '/payments',
          { orderRef: 'INV-1', method, amount: 12_500, actorRef: 'cashier-7' },
          'INV-1:1',
        )
        .expect(201);
      expect(res.body).toMatchObject({
        orderRef: 'INV-1',
        attempt: 1,
        method,
        kind: 'cashac',
        amount: 12_500,
        status: 'paid',
        needsReview: false,
        idempotencyKey: 'INV-1:1',
        providerRef: null,
        expiresAt: null,
        capabilities: {
          supportsVoid: true,
          supportsRefund: false,
          canCancel: false,
        },
        unmatchedReceipts: [],
      });
      expect(res.body.paidAt).toEqual(expect.any(String));
      expect(res.body.events).toMatchObject([
        { fromStatus: null, toStatus: 'created', actorRef: 'cashier-7' },
        { fromStatus: 'created', toStatus: 'paid', actorRef: 'cashier-7' },
      ]);
      // Internals stay inside.
      expect(res.body).not.toHaveProperty('tenantId');
      expect(res.body).not.toHaveProperty('requestHash');
      expect(await rows(s.tenantId)).toEqual([
        { id: res.body.id, status: 'paid', amount: '12500' },
      ]);
      expect(await outboxOf(h.sql, res.body.id)).toEqual(['payment.paid']);
    },
  );

  it('D1 Bayar pressed twice, five times at once with one key: one payment, one PG bill', async () => {
    const s = createStore(h.app);
    const body = {
      orderRef: 'INV-D1',
      attempt: 1,
      method: 'fake_qris',
      amount: 9_000,
      actorRef: 'cashier-7',
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => s.post('/payments', body, 'INV-D1:1')),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      200, 200, 200, 200, 201,
    ]);
    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1);
    const [id] = [...ids];
    expect(await rows(s.tenantId)).toHaveLength(1);
    expect(h.pg.count('charge', id)).toBe(1);
    expect(h.pg.bills.size).toBeGreaterThanOrEqual(1);
    expect((await s.read(id)).status).toBe('pending');
    // And the same for CASHAC: one payment, one paid notice.
    const cash = { ...body, orderRef: 'INV-D1-cash', method: 'cash' };
    const again = await Promise.all(
      Array.from({ length: 5 }, () =>
        s.post('/payments', cash, 'INV-D1-cash:1'),
      ),
    );
    expect(new Set(again.map((r) => r.body.id)).size).toBe(1);
    expect(await outboxOf(h.sql, again[0].body.id)).toEqual(['payment.paid']);
  });

  it('D2 a retried charge returns the same payment; the same key with another request is refused', async () => {
    const s = createStore(h.app);
    const body = {
      orderRef: 'INV-D2',
      attempt: 1,
      method: 'cash',
      amount: 40_000,
      actorRef: 'cashier-7',
    };
    const first = await s.post('/payments', body, 'INV-D2:1').expect(201);
    const retry = await s.post('/payments', body, 'INV-D2:1').expect(200);
    expect(retry.body).toEqual(first.body);
    for (const other of [
      { ...body, amount: 40_001 },
      { ...body, orderRef: 'INV-D2b' },
      { ...body, method: 'edc_debit' },
      { ...body, attempt: 2 },
    ]) {
      const res = await s.post('/payments', other, 'INV-D2:1').expect(409);
      expect(res.body.code).toBe('idempotency_key_reused');
    }
    expect(await rows(s.tenantId)).toHaveLength(1);
    expect(await auditOf(h.sql, first.body.id)).toHaveLength(2);
    expect((await s.read(first.body.id)).amount).toBe(40_000);
  });

  it('keeps idempotency keys per tenant: the same key under two tenants is two payments', async () => {
    const a = createStore(h.app);
    const b = createStore(h.app);
    const body = {
      orderRef: 'INV-5',
      method: 'cash',
      amount: 1_000,
      actorRef: 'cashier-7',
    };
    const pa = await a.post('/payments', body, 'INV-5:1').expect(201);
    const pb = await b.post('/payments', body, 'INV-5:1').expect(201);
    expect(pa.body.id).not.toBe(pb.body.id);
    expect(await rows(a.tenantId)).toHaveLength(1);
    expect(await rows(b.tenantId)).toHaveLength(1);
  });

  it('allows one live payment per order (no split payment); a new attempt needs the old one closed', async () => {
    const s = createStore(h.app);
    const first = await s.charge({ orderRef: 'INV-6' });
    const second = await s
      .chargeRaw({ orderRef: 'INV-6', attempt: 2, method: 'edc_debit' })
      .expect(409);
    expect(second.body.code).toBe('order_has_live_payment');
    expect(await rows(s.tenantId)).toHaveLength(1);

    await s.post(`/payments/${first.id}/void`, CANCEL).expect(200);
    // An attempt number is used once per order, whatever the key.
    const reused = await s
      .post(
        '/payments',
        {
          orderRef: 'INV-6',
          attempt: 1,
          method: 'cash',
          amount: 5,
          actorRef: 'c',
        },
        'another-key-1',
      )
      .expect(409);
    expect(reused.body.code).toBe('attempt_already_used');
    await s
      .chargeRaw({ orderRef: 'INV-6', attempt: 2, method: 'edc_debit' })
      .expect(201);
  });

  it('accepts only integer rupiah and a whole attempt number', async () => {
    const s = createStore(h.app);
    const base = { orderRef: 'INV-7', method: 'cash', actorRef: 'c' };
    for (const amount of [10.5, '1000', -1, null, 1e13, Number.NaN]) {
      const res = await s
        .post('/payments', { ...base, amount }, randomUUID())
        .expect(422);
      expect(res.body.errors).toHaveProperty('amount');
    }
    await s.post('/payments', base, randomUUID()).expect(422);
    for (const attempt of [0, 1.5, '2', -1]) {
      const res = await s
        .post('/payments', { ...base, amount: 1, attempt }, randomUUID())
        .expect(422);
      expect(res.body.errors).toHaveProperty('attempt');
    }
    expect(await rows(s.tenantId)).toHaveLength(0);
    // Zero is a payment record for an order nothing is due on.
    await s.post('/payments', { ...base, amount: 0 }, randomUUID()).expect(201);
  });

  it('answers 422 per field for a bad charge, and never echoes what was sent', async () => {
    const s = createStore(h.app);
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

  it('M22 kasbon is a receivable at the caller, not a payment; an instalment is its own payment on the receivable', async () => {
    const s = createStore(h.app);
    const kasbon = await s
      .chargeRaw({ orderRef: 'sale-1', method: 'kasbon' })
      .expect(422);
    expect(kasbon.body.errors.method).toMatch(/receivable/);
    expect(await rows(s.tenantId)).toHaveLength(0);
    // The instalment: a normal CASHAC payment whose order reference names the receivable.
    const receivableId = randomUUID();
    const instalment = await s.charge({
      orderRef: receivableId,
      method: 'static_qris',
      amount: 2_500,
    });
    expect(instalment).toMatchObject({
      orderRef: receivableId,
      status: 'paid',
      amount: 2_500,
    });
  });

  it('requires a well-formed Idempotency-Key', async () => {
    const s = createStore(h.app);
    const body = { orderRef: 'o', method: 'cash', amount: 1, actorRef: 'c' };
    const missing = await s.post('/payments', body).expect(422);
    expect(missing.body.errors).toHaveProperty('Idempotency-Key');
    await s.post('/payments', body, 'k'.repeat(201)).expect(422);
    await s.post('/payments', body, 'has spaces in it').expect(422);
    expect(await rows(s.tenantId)).toHaveLength(0);
  });

  it('finds payments by order reference, by idempotency key and by status (reconciliation)', async () => {
    const s = createStore(h.app);
    const a = await s.charge({ orderRef: 'INV-A', amount: 100 });
    const b = await s.charge({ orderRef: 'INV-B' });
    await s.post(`/payments/${b.id}/void`, CANCEL).expect(200);
    h.clock.advance(1000);
    const b2 = await s.charge({ orderRef: 'INV-B', attempt: 2 });
    const ids = (res: request.Response) =>
      res.body.items.map((p: { id: string }) => p.id);

    const byOrder = await s.get('/payments?orderRef=INV-B').expect(200);
    expect(byOrder.body.total).toBe(2);
    expect(ids(byOrder)).toEqual([b2.id, b.id]); // newest first
    expect(byOrder.body.items[0]).not.toHaveProperty('events');

    const byKey = await s
      .get(`/payments?idempotencyKey=${encodeURIComponent('INV-A:1')}`)
      .expect(200);
    expect(ids(byKey)).toEqual([a.id]);

    const paid = await s.get('/payments?status=paid').expect(200);
    expect(ids(paid).sort()).toEqual([a.id, b2.id].sort());
    const voided = await s.get('/payments?status=voided').expect(200);
    expect(ids(voided)).toEqual([b.id]);
    const liveForB = await s
      .get('/payments?orderRef=INV-B&status=paid')
      .expect(200);
    expect(liveForB.body.items).toHaveLength(1);
    expect(
      (await s.get('/payments?needsReview=true').expect(200)).body.total,
    ).toBe(0);

    const none = await s.get('/payments?orderRef=NOPE').expect(200);
    expect(none.body).toEqual({ items: [], page: 1, perPage: 20, total: 0 });

    const page = await s.get('/payments?perPage=2&page=2').expect(200);
    expect(page.body).toMatchObject({ page: 2, perPage: 2, total: 3 });
    expect(page.body.items).toHaveLength(1);

    await s.get('/payments?status=bogus').expect(422);
    await s.get('/payments?perPage=1000').expect(422);
    await s.get('/payments?needsReview=maybe').expect(422);
  });

  it('reads one payment; an unknown or malformed id is 404', async () => {
    const s = createStore(h.app);
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
    await s.post('/payments/not-a-uuid/refund', CANCEL).expect(404);
    await s.post('/payments/not-a-uuid/cancel', CANCEL).expect(404);
    await s.post('/payments/not-a-uuid/sync').expect(404);
  });

  it('answers malformed JSON and unknown routes with a fixed, safe body', async () => {
    const s = createStore(h.app);
    const bad = await request(h.app.getHttpServer())
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
