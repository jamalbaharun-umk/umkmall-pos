import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CANCEL,
  createApp,
  createStore,
  Harness,
  SERVICE_KEY,
} from './support/fixtures';

describe('service auth and tenant isolation', () => {
  let h: Harness;
  const http = () => request(h.app.getHttpServer());

  beforeAll(async () => {
    h = await createApp();
  });
  afterAll(() => h.close());

  const id = randomUUID();
  const ROUTES: ['get' | 'post', string][] = [
    ['post', '/payments'],
    ['post', '/payments/close'],
    ['get', '/payments'],
    ['get', `/payments/${id}`],
    ['post', `/payments/${id}/sync`],
    ['post', `/payments/${id}/cancel`],
    ['post', `/payments/${id}/void`],
    ['post', `/payments/${id}/refund`],
    ['post', `/payments/${id}/refund/manual`],
    ['get', '/unmatched-receipts'],
    ['post', '/internal/tenants/purge'],
  ];

  it.each(ROUTES)(
    '%s %s needs the service key (401 when wrong, missing or empty)',
    async (method, url) => {
      const tenantId = randomUUID();
      const attempts: (string | null)[] = [
        null,
        '',
        'x'.repeat(32),
        SERVICE_KEY().slice(0, -1),
        `${SERVICE_KEY()}x`,
      ];
      for (const key of attempts) {
        const req = http()[method](url).set('X-Tenant-Id', tenantId);
        if (key !== null) req.set('X-Payment-Service-Key', key);
        const res = await req.expect(401);
        expect(res.body).toEqual({
          message: 'Invalid service key',
          code: 'invalid_service_key',
        });
      }
    },
  );

  it.each(ROUTES)(
    '%s %s needs a uuid X-Tenant-Id once the key is right (400)',
    async (method, url) => {
      for (const tenant of [null, '', 'store-1', `${randomUUID()}x`]) {
        const req = http()
          [method](url)
          .set('X-Payment-Service-Key', SERVICE_KEY());
        if (tenant !== null) req.set('X-Tenant-Id', tenant);
        const res = await req.expect(400);
        expect(res.body.code).toBe('tenant_required');
      }
    },
  );

  it('does not say whether the tenant header was good when the key is wrong', async () => {
    await http()
      .get('/payments')
      .set('X-Payment-Service-Key', 'wrong-key-wrong-key')
      .set('X-Tenant-Id', 'not-a-uuid')
      .expect(401);
  });

  it('keeps /health public', async () => {
    await http().get('/health').expect(200, { status: 'ok' });
  });

  it('takes the tenant from the header only: a tenantId in body or query is ignored', async () => {
    const a = createStore(h.app);
    const b = createStore(h.app);
    const res = await a
      .post(
        '/payments',
        {
          orderRef: 'INV-T',
          method: 'cash',
          amount: 100,
          actorRef: 'c',
          tenantId: b.tenantId,
          tenant_id: b.tenantId,
        },
        randomUUID(),
      )
      .expect(201);
    const [row] = await h.sql<{ tenant_id: string }[]>`
      select tenant_id from payment.payments where id = ${res.body.id}`;
    expect(row.tenant_id).toBe(a.tenantId);

    const asB = await a
      .get(`/payments?tenantId=${b.tenantId}&tenant_id=${b.tenantId}`)
      .expect(200);
    expect(asB.body.items.map((p: { id: string }) => p.id)).toEqual([
      res.body.id,
    ]);
    expect((await b.get('/payments').expect(200)).body.total).toBe(0);
  });

  it('a webhook cannot choose its tenant: a tenant header on it is ignored, the payment row’s tenant is used', async () => {
    const a = createStore(h.app);
    const b = createStore(h.app);
    const p = await a.qr();
    h.pg.pay(p.id);
    const signed = h.pg.webhook(p.id, 'evt-tenant');
    await http()
      .post('/webhooks/fake')
      .set('Content-Type', 'application/json')
      .set('X-Fake-Signature', signed.signature)
      .set('X-Tenant-Id', b.tenantId)
      .send(signed.body)
      .expect(200);
    const [event] = await h.sql<{ tenant_id: string }[]>`
      select tenant_id from payment.webhook_events where reference = ${p.id}`;
    expect(event.tenant_id).toBe(a.tenantId);
    expect((await a.read(p.id)).status).toBe('paid');
    expect((await b.get('/payments').expect(200)).body.total).toBe(0);
  });

  it('cross-tenant: store B gets 404 on store A’s payment for read, sync, cancel, void, refund and manual refund', async () => {
    const a = createStore(h.app);
    const b = createStore(h.app);
    const cash = await a.charge({ orderRef: 'INV-X' });
    const waiting = await a.qr();
    const online = await a.qr();
    h.pg.pay(online.id);
    await a.post(`/payments/${online.id}/sync`).expect(200);
    // Unmatched money on A's bill, for the receipts list.
    h.pg.pay(online.id, undefined, { force: true });
    await h.deliver(online.id).expect(200);
    const gatewayCalls = h.pg.calls.length;

    const NOT_FOUND = { message: 'Payment not found', code: 'not_found' };
    const manual = { note: 'n', actorRef: 'o', approvedBy: 'o' };
    for (const p of [cash, waiting, online]) {
      await b.get(`/payments/${p.id}`).expect(404, NOT_FOUND);
      await b.post(`/payments/${p.id}/sync`).expect(404, NOT_FOUND);
      await b.post(`/payments/${p.id}/cancel`, CANCEL).expect(404, NOT_FOUND);
      await b.post(`/payments/${p.id}/void`, CANCEL).expect(404, NOT_FOUND);
      await b.post(`/payments/${p.id}/refund`, CANCEL).expect(404, NOT_FOUND);
      await b
        .post(`/payments/${p.id}/refund/manual`, manual)
        .expect(404, NOT_FOUND);
    }
    // Not in B's lists, by any lookup.
    expect((await b.get('/payments')).body.total).toBe(0);
    expect((await b.get('/payments?orderRef=INV-X')).body.total).toBe(0);
    expect((await b.get('/payments?status=paid')).body.total).toBe(0);
    expect((await b.get('/unmatched-receipts')).body.total).toBe(0);
    expect((await a.get('/unmatched-receipts')).body.total).toBe(1);

    // A's payments are untouched, and nothing reached the gateway.
    expect((await a.read(cash.id)).status).toBe('paid');
    expect((await a.read(waiting.id)).status).toBe('pending');
    expect((await a.read(online.id)).status).toBe('paid');
    expect(h.pg.calls).toHaveLength(gatewayCalls);

    // The same requests as A do work (the 404s above were about the tenant, not the request).
    await a.post(`/payments/${cash.id}/void`, CANCEL).expect(200);
    await a.post(`/payments/${online.id}/refund`, CANCEL).expect(200);
    await a
      .post(`/payments/${waiting.id}/cancel`, { actorRef: 'c' })
      .expect(200);
  });
});
