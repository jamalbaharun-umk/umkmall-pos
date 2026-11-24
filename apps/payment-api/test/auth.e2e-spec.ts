import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { FakeOnlineAdapter } from './support/fake-online.adapter';
import {
  CANCEL,
  createApp,
  createStore,
  SERVICE_KEY,
} from './support/fixtures';

describe('service auth and tenant isolation', () => {
  let app: INestApplication;
  let fakeOnline: FakeOnlineAdapter;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, fakeOnline } = await createApp());
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const id = randomUUID();
  const ROUTES: ['get' | 'post', string][] = [
    ['post', '/payments'],
    ['get', '/payments'],
    ['get', `/payments/${id}`],
    ['post', `/payments/${id}/sync`],
    ['post', `/payments/${id}/cancel`],
    ['post', `/payments/${id}/void`],
    ['post', `/payments/${id}/refund`],
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
    const a = createStore(app);
    const b = createStore(app);
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
    const [row] = await admin<{ tenant_id: string }[]>`
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

  it('cross-tenant: store B gets 404 on store A’s payment for read, sync, cancel, void and refund', async () => {
    const a = createStore(app);
    const b = createStore(app);
    const cash = await a.charge({ orderRef: 'INV-X' });
    const online = await a.charge({ method: 'fake_online' });
    fakeOnline.settle(online.id, 'paid');
    await a.post(`/payments/${online.id}/sync`).expect(200);
    const gatewayCalls = fakeOnline.calls.length;

    const NOT_FOUND = { message: 'Payment not found', code: 'not_found' };
    for (const p of [cash, online]) {
      await b.get(`/payments/${p.id}`).expect(404, NOT_FOUND);
      await b.post(`/payments/${p.id}/sync`).expect(404, NOT_FOUND);
      await b.post(`/payments/${p.id}/cancel`, CANCEL).expect(404, NOT_FOUND);
      await b.post(`/payments/${p.id}/void`, CANCEL).expect(404, NOT_FOUND);
      await b.post(`/payments/${p.id}/refund`, CANCEL).expect(404, NOT_FOUND);
    }
    // Not in B's lists, by any lookup.
    expect((await b.get('/payments')).body.total).toBe(0);
    expect((await b.get('/payments?orderRef=INV-X')).body.total).toBe(0);
    expect((await b.get('/payments?status=paid')).body.total).toBe(0);

    // A's payments are untouched, and nothing reached the gateway.
    for (const p of [cash, online]) {
      const res = await a.get(`/payments/${p.id}`).expect(200);
      expect(res.body.status).toBe('paid');
      expect(res.body.events).toHaveLength(1);
    }
    expect(fakeOnline.calls).toHaveLength(gatewayCalls);

    // The same requests as A do work (the 404s above were about the tenant, not the request).
    await a.post(`/payments/${cash.id}/void`, CANCEL).expect(200);
    await a.post(`/payments/${online.id}/refund`, CANCEL).expect(200);
  });
});
