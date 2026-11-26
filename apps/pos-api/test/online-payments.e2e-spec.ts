import './support/payment-fake-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PAYMENT_FETCH } from '../src/payments-client/payments.client';
import { ADMIN_PERMISSIONS } from '../src/staff/permissions';
import { createStore } from './support/fixtures';
import { PaymentApi, startPaymentApi } from './support/payment-api';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

const DRAFT = {
  businessType: 'individual',
  businessName: 'Warung Bu Sari',
  email: 'sari@example.test',
  phone: '+6281234567890',
};

/**
 * The "Pembayaran Online" routes (UMK-2019) against the REAL payment-api with its local fake gateway. The
 * fake's reviewer is driven as a calling service would: payment-api's /dev/fake-gateway routes, with the
 * service key and the store's tenant header.
 */
describe('online payments: onboarding through pos-api (UMK-2019)', () => {
  let pay: PaymentApi;
  let app: INestApplication;
  let offApp: INestApplication;
  let link: 'ok' | 'down' = 'ok';
  /** Every pos-api response body of the suite, to prove afterwards that none carries a secret. */
  const answers: string[] = [];
  const http = () => request(app.getHttpServer());

  async function posApp(env: Record<string, string>) {
    const saved = Object.fromEntries(
      Object.keys(env).map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, env);
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PAYMENT_FETCH)
        .useValue((url: string, init: RequestInit) => {
          if (link === 'down') throw new TypeError('fetch failed');
          return fetch(url, init);
        })
        .compile();
      const a = moduleRef.createNestApplication();
      await a.init();
      return a;
    } finally {
      for (const [k, v] of Object.entries(saved))
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
  }

  beforeAll(async () => {
    pay = await startPaymentApi();
    app = await posApp({
      PAYMENT_API_URL: pay.url,
      PAYMENT_SERVICE_KEY: pay.serviceKey,
      POS_PAYMENT_RECONCILE_INTERVAL_SECONDS: '0',
    });
    // payment-api off: how local dev and every other test run.
    offApp = await posApp({ PAYMENT_API_URL: '' });
  }, 60_000);
  afterEach(() => {
    link = 'ok';
  });
  afterAll(async () => {
    await app.close();
    await offApp.close();
    await pay.close();
  });

  const call = (
    method: 'get' | 'post' | 'put',
    url: string,
    auth: string,
    body?: object,
  ) =>
    http()
      [method](`/online-payments${url}`)
      .set('Authorization', auth)
      .send(body)
      .on('response', (res: { text?: string }) => answers.push(res.text ?? ''));
  const account = async (s: Store) =>
    (
      (await call('get', '', s.auth).expect(200)).body as {
        accounts: Record<string, unknown>[];
      }
    ).accounts[0];
  /** The fake gateway's reviewer, for this store. */
  const gateway = (s: Store, action: string, body: object = {}) =>
    fetch(`${pay.url}/dev/fake-gateway/account/${action}`, {
      method: 'POST',
      headers: {
        'X-Payment-Service-Key': pay.serviceKey,
        'X-Tenant-Id': s.tenantId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  const submitted = async (s: Store) => {
    await call('put', '/fake/draft', s.auth, DRAFT).expect(200);
    await call('post', '/fake/submit', s.auth, { termsAccepted: true }).expect(
      200,
    );
  };
  const active = async (s: Store) => {
    await submitted(s);
    expect((await gateway(s, 'approve')).status).toBe(200);
    await call('put', '/fake/methods/fake_qris', s.auth, {
      enabled: true,
    }).expect(200);
  };

  it('the flow: not submitted → draft → submitted → verified at the gateway → a method on → active', async () => {
    const s = await createStore();
    const start = await call('get', '', s.auth).expect(200);
    expect(start.body).toMatchObject({
      enabled: true,
      mode: 'fake',
      accounts: [
        {
          provider: 'fake',
          status: 'not_submitted',
          verification: 'hosted',
          profile: { businessName: null },
        },
      ],
    });
    expect(
      (start.body.accounts[0].methods as { method: string }[]).map(
        (m) => m.method,
      ),
    ).toEqual(['fake_qris', 'fake_va', 'fake_checkout']);

    // A partial draft is kept; submitting it is refused.
    await call('put', '/fake/draft', s.auth, {
      businessName: 'Warung Bu Sari',
    }).expect(200);
    const early = await call('post', '/fake/submit', s.auth, {
      termsAccepted: true,
    }).expect(409);
    expect(early.body).toEqual({
      message: 'Lengkapi data usaha sebelum mengajukan',
      code: 'draft_incomplete',
    });

    const draft = await call('put', '/fake/draft', s.auth, DRAFT).expect(200);
    expect(draft.body).toMatchObject({
      status: 'not_submitted',
      profile: DRAFT,
    });
    // A save of one field keeps the others.
    const part = await call('put', '/fake/draft', s.auth, {
      phone: '+628111111111',
    }).expect(200);
    expect(part.body.profile).toEqual({ ...DRAFT, phone: '+628111111111' });
    await call('put', '/fake/draft', s.auth, DRAFT).expect(200);
    const sub = await call('post', '/fake/submit', s.auth, {
      termsAccepted: true,
    }).expect(200);
    expect(sub.body.status).toBe('submitted');
    // The actor payment-api recorded is the session's.
    const [event] = await pay.sql`
      select actor_ref, source from payment.merchant_account_events where tenant_id = ${s.tenantId}`;
    expect(event).toEqual({ actor_ref: s.userId, source: 'submit' });

    const verify = await call('post', '/fake/verification-link', s.auth).expect(
      200,
    );
    expect(verify.body).toEqual({
      url: expect.stringMatching(/^https:\/\/fake-gateway\.invalid\/verify\//),
      expiresAt: expect.any(String),
    });
    // Not verified yet: no toggle, and the cashier is offered nothing.
    const tooEarly = await call('put', '/fake/methods/fake_qris', s.auth, {
      enabled: true,
    }).expect(409);
    expect(tooEarly.body.code).toBe('merchant_not_verified');

    expect((await gateway(s, 'approve')).status).toBe(200);
    expect((await account(s)).status).toBe('verified');
    expect((await call('get', '/methods', s.auth).expect(200)).body).toEqual({
      methods: [],
      banks: {},
    });

    const on = await call('put', '/fake/methods/fake_qris', s.auth, {
      enabled: true,
    }).expect(200);
    expect(on.body.status).toBe('active');
    expect((await call('get', '/methods', s.auth).expect(200)).body).toEqual({
      methods: ['fake_qris'],
      banks: {},
    });
    // UMK-2037: a method that needs a bank answers the banks the customer chooses from; a QR answers none.
    await call('put', '/fake/methods/fake_va', s.auth, {
      enabled: true,
    }).expect(200);
    const withVa = await call('get', '/methods', s.auth).expect(200);
    expect(withVa.body).toEqual({
      methods: ['fake_qris', 'fake_va'],
      banks: {
        fake_va: [
          { code: 'FAKE', name: 'Bank Fake' },
          { code: 'FAKE2', name: 'Bank Fake Dua' },
        ],
      },
    });
    // The owner's page carries them per method too, and nothing else of the gateway's.
    const va = ((await account(s)).methods as { method: string }[]).find(
      (m) => m.method === 'fake_va',
    );
    expect(va).toEqual({
      method: 'fake_va',
      enabled: true,
      chargeable: true,
      banks: withVa.body.banks.fake_va,
    });
    await call('put', '/fake/methods/fake_va', s.auth, {
      enabled: false,
    }).expect(200);
    const off = await call('put', '/fake/methods/fake_qris', s.auth, {
      enabled: false,
    }).expect(200);
    expect(off.body.status).toBe('verified');
  });

  it('shows the gateway’s reason for a fix, a rejection and a suspension', async () => {
    const s = await createStore();
    await submitted(s);
    await gateway(s, 'needs-fix', { reason: 'Foto KTP buram' });
    expect(await account(s)).toMatchObject({
      status: 'needs_fix',
      statusReason: 'Foto KTP buram',
    });
    await call('put', '/fake/draft', s.auth, DRAFT).expect(200);
    await call('post', '/fake/submit', s.auth, { termsAccepted: true }).expect(
      200,
    );
    await gateway(s, 'approve');
    await call('put', '/fake/methods/fake_va', s.auth, {
      enabled: true,
    }).expect(200);
    await gateway(s, 'suspend', { reason: 'Dibekukan' });
    expect(await account(s)).toMatchObject({
      status: 'suspended',
      statusReason: 'Dibekukan',
    });
    // Suspended: the cashier is offered nothing, though the toggle is still on.
    expect((await call('get', '/methods', s.auth).expect(200)).body).toEqual({
      methods: [],
      banks: {},
    });

    const r = await createStore();
    await submitted(r);
    await gateway(r, 'reject', { reason: 'Usaha tidak sesuai' });
    expect(await account(r)).toMatchObject({
      status: 'rejected',
      statusReason: 'Usaha tidak sesuai',
    });
    const locked = await call('put', '/fake/draft', r.auth, DRAFT).expect(409);
    expect(locked.body).toEqual({
      message: 'Data tidak bisa diubah pada status ini',
      code: 'merchant_locked',
    });
  });

  it('gates every route with payments.manage: the default Admin role and a cashier get 403', async () => {
    const s = await createStore();
    const admin = await createCashier(app, s, [...ADMIN_PERMISSIONS]);
    const manager = await createCashier(app, s, ['payments.manage']);
    const routes: ['get' | 'post' | 'put', string, object?][] = [
      ['get', ''],
      ['put', '/fake/draft', DRAFT],
      ['post', '/fake/submit', { termsAccepted: true }],
      ['post', '/fake/verification-link'],
      ['post', '/fake/sync'],
      ['put', '/fake/methods/fake_qris', { enabled: true }],
    ];
    for (const [method, url, body] of routes) {
      await call(method, url, admin.auth, body).expect(403);
      await http()[method](`/online-payments${url}`).send(body).expect(401);
    }
    expect(await account(s)).toMatchObject({
      status: 'not_submitted',
      profile: { businessName: null },
    });
    // A staff member the owner gave the permission to passes, as themselves.
    await call('put', '/fake/draft', manager.auth, DRAFT).expect(200);
    await call('post', '/fake/submit', manager.auth, {
      termsAccepted: true,
    }).expect(200);
    const [event] = await pay.sql`
      select actor_ref from payment.merchant_account_events where tenant_id = ${s.tenantId}`;
    expect(event.actor_ref).toBe(manager.staffId);
    // The cashier's list of methods needs sales.create, not payments.manage.
    await call('get', '/methods', admin.auth).expect(200);
    const noSales = await createCashier(app, s, ['reports.view']);
    await call('get', '/methods', noSales.auth).expect(403);
  });

  it('answers 422 on a bad body, in Indonesian, and sends nothing on', async () => {
    const s = await createStore();
    for (const body of [
      { businessType: 'cv' },
      { email: 'bukan-email' },
      { phone: '0812-abc' },
      { businessName: 'x'.repeat(121) },
      { ...DRAFT, nik: '3201010101010001' },
      { ...DRAFT, tenantId: '00000000-0000-4000-8000-000000000000' },
    ])
      await call('put', '/fake/draft', s.auth, body).expect(422);
    const email = await call('put', '/fake/draft', s.auth, {
      email: 'bukan-email',
    }).expect(422);
    expect(email.body.errors).toEqual({ email: 'Format email tidak valid' });
    for (const body of [{}, { termsAccepted: false }, { termsAccepted: 'ya' }])
      await call('post', '/fake/submit', s.auth, body).expect(422);
    for (const body of [{}, { enabled: 'ya' }])
      await call('put', '/fake/methods/fake_qris', s.auth, body).expect(422);
    const [{ n }] = await pay.sql<{ n: number }[]>`
      select count(*)::int as n from payment.merchant_accounts where tenant_id = ${s.tenantId}`;
    expect(n).toBe(0);
    // An unknown provider or method is 404 / 422, never a 500.
    await call('put', '/xendit/draft', s.auth, DRAFT).expect(404);
    await call('put', '/..%2Fpayments/draft', s.auth, DRAFT).expect(404);
    await call('post', '/FAKE/sync', s.auth).expect(404);
    await submitted(s);
    await gateway(s, 'approve');
    await call('put', '/fake/methods/cash', s.auth, { enabled: true }).expect(
      422,
    );
  });

  it('cross-tenant: store B never reads or changes store A’s account', async () => {
    const a = await createStore();
    const b = await createStore();
    await active(a);
    expect(await account(b)).toMatchObject({
      status: 'not_submitted',
      profile: { businessName: null, email: null, phone: null },
    });
    expect((await call('get', '/methods', b.auth).expect(200)).body).toEqual({
      methods: [],
      banks: {},
    });
    // B's own actions land on B's account: A's stays as it was.
    await call('put', '/fake/methods/fake_qris', b.auth, {
      enabled: false,
    }).expect(409);
    await call('post', '/fake/verification-link', b.auth).expect(409);
    await call('put', '/fake/draft', b.auth, {
      ...DRAFT,
      businessName: 'Toko B',
    }).expect(200);
    // A tenant id in the query is not read.
    const peek = await http()
      .get(`/online-payments?tenantId=${a.tenantId}`)
      .set('Authorization', b.auth)
      .expect(200);
    expect(peek.body.accounts[0].profile.businessName).toBe('Toko B');
    expect(await account(a)).toMatchObject({
      status: 'active',
      profile: { businessName: DRAFT.businessName },
    });
    const rows = await pay.sql<{ tenant_id: string; status: string }[]>`
      select tenant_id, status from payment.merchant_accounts
      where tenant_id in (${a.tenantId}, ${b.tenantId}) order by status`;
    expect([...rows]).toEqual([
      { tenant_id: a.tenantId, status: 'active' },
      { tenant_id: b.tenantId, status: 'not_submitted' },
    ]);
  });

  it('answers 503 when payment-api gives no answer, and changes nothing', async () => {
    const s = await createStore();
    link = 'down';
    const res = await call('get', '', s.auth).expect(503);
    expect(res.body).toEqual({
      message: 'Layanan pembayaran sedang tidak bisa dihubungi, coba lagi',
    });
    await call('put', '/fake/draft', s.auth, DRAFT).expect(503);
    await call('get', '/methods', s.auth).expect(503);
  });

  it('with payment-api off: the page says so and the cashier is offered nothing', async () => {
    const s = await createStore();
    const off = () => request(offApp.getHttpServer());
    const page = await off()
      .get('/online-payments')
      .set('Authorization', s.auth)
      .expect(200);
    expect(page.body).toEqual({ enabled: false, mode: null, accounts: [] });
    const methods = await off()
      .get('/online-payments/methods')
      .set('Authorization', s.auth)
      .expect(200);
    expect(methods.body).toEqual({ methods: [], banks: {} });
    await off()
      .put('/online-payments/fake/draft')
      .set('Authorization', s.auth)
      .send(DRAFT)
      .expect(503);
  });

  it('payment-api’s tenant purge (the one the store purge calls) erases the gateway account too', async () => {
    const s = await createStore();
    await active(s);
    const count = async () =>
      (
        await pay.sql<{ n: number }[]>`
          select (select count(*) from payment.merchant_accounts where tenant_id = ${s.tenantId})::int
               + (select count(*) from payment.merchant_account_events where tenant_id = ${s.tenantId})::int
               + (select count(*) from payment.merchant_webhook_events where tenant_id = ${s.tenantId})::int as n`
      )[0].n;
    expect(await count()).toBeGreaterThanOrEqual(5);
    const res = await fetch(`${pay.url}/internal/tenants/purge`, {
      method: 'POST',
      headers: {
        'X-Payment-Service-Key': pay.serviceKey,
        'X-Tenant-Id': s.tenantId,
      },
    });
    expect(await res.json()).toEqual({ purged: true });
    expect(await count()).toBe(0);
    expect((await account(s)).status).toBe('not_submitted');
  });

  it('no answer of pos-api carries the gateway’s account id, the service key or a credential', async () => {
    const ids = (
      await pay.sql<{ provider_account_id: string }[]>`
        select provider_account_id from payment.merchant_accounts where provider_account_id is not null`
    ).map((r) => r.provider_account_id);
    expect(ids.length).toBeGreaterThan(2);
    expect(answers.length).toBeGreaterThan(60);
    for (const text of answers)
      for (const word of [
        ...ids,
        'FAKE-ACCT-',
        'providerAccountId',
        'credentials',
        pay.serviceKey,
      ])
        expect(text).not.toContain(word);
  });
});
