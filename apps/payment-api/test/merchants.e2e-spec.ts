import './support/fake-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import request from 'supertest';
import { LocalFakeGateway } from '../src/adapters/fake/local-fake-gateway';
import { AppModule } from '../src/app.module';
import { Clock, PaymentSettings } from '../src/config';
import { ReconciliationService } from '../src/payments/reconciliation.service';
import { ADMIN_DATABASE_URL } from './support/env';
import { createStore, FakeClock, MINUTE, Store } from './support/fixtures';
import { seedMerchant } from './support/merchants';

const GW = '/dev/fake-gateway';
const ACCOUNTS = '/merchant-accounts';
const FAKE = `${ACCOUNTS}/fake`;
const DRAFT = {
  businessType: 'individual',
  businessName: 'Warung Bu Sari',
  email: 'sari@example.test',
  phone: '+6281234567890',
};
const SUBMIT = { termsAccepted: true, actorRef: 'owner-1' };
const ON = { enabled: true, actorRef: 'owner-1' };
const OFF = { enabled: false, actorRef: 'owner-1' };

/**
 * Onboarding a store at a payment gateway (UMK-2019), through the real app with the local fake gateway
 * (PAYMENT_ADAPTERS=fake): no adapter is overridden. Stores here start WITHOUT a gateway account.
 */
describe('merchant onboarding', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let settings: PaymentSettings;
  let defaults: object;
  let reconcile: ReconciliationService;
  let sql: postgres.Sql;
  const http = () => request(app.getHttpServer());
  /** Every response body of the suite, to prove afterwards that none carries a secret. */
  const answers: string[] = [];

  beforeAll(async () => {
    clock = new FakeClock();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    settings = app.get(PaymentSettings);
    defaults = { ...settings };
    reconcile = app.get(ReconciliationService);
    sql = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  });
  afterEach(async () => {
    Object.assign(settings, defaults);
    await newStore().post(`${GW}/accounts/outage`, { down: false }).expect(200);
  });
  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  /** A store that never onboarded, whose every answer is recorded. */
  const newStore = () => {
    const s = createStore(app, { merchant: false });
    const record = (req: request.Test) =>
      req.on('response', (res: { text?: string }) =>
        answers.push(res.text ?? ''),
      );
    return {
      ...s,
      get: (url: string) => record(s.get(url)),
      post: (url: string, body: object = {}, key?: string) =>
        record(s.post(url, body, key)),
      put: (url: string, body: object = {}) =>
        record(
          request(app.getHttpServer())
            .put(url)
            .set('X-Payment-Service-Key', process.env.PAYMENT_SERVICE_KEY!)
            .set('X-Tenant-Id', s.tenantId)
            .send(body),
        ),
    };
  };
  type S = ReturnType<typeof newStore>;

  const account = async (s: S) =>
    (await s.get(ACCOUNTS).expect(200)).body.items[0];
  const submitted = async (s: S = newStore()) => {
    await s.put(FAKE, DRAFT).expect(200);
    const res = await s.post(`${FAKE}/submit`, SUBMIT).expect(200);
    expect(res.body.status).toBe('submitted');
    return s;
  };
  const review = (s: S, action: string, body: object = {}) =>
    s.post(`${GW}/account/${action}`, body);
  const verified = async (s: S = newStore()) => {
    await submitted(s);
    await review(s, 'approve').expect(200);
    return s;
  };
  const active = async (s: S = newStore()) => {
    await verified(s);
    await s.put(`${FAKE}/methods/fake_qris`, ON).expect(200);
    return s;
  };
  const row = async (s: { tenantId: string }) =>
    (
      await sql<
        {
          id: string;
          status: string;
          provider_account_id: string | null;
          enabled_methods: string[];
          status_reason: string | null;
          credentials_encrypted: string | null;
        }[]
      >`select id, status, provider_account_id, enabled_methods, status_reason, credentials_encrypted
        from payment.merchant_accounts where tenant_id = ${s.tenantId}`
    )[0];
  const moves = async (s: { tenantId: string }) =>
    (
      await sql<{ from_status: string; to_status: string; source: string }[]>`
        select from_status, to_status, source from payment.merchant_account_events
        where tenant_id = ${s.tenantId} order by created_at, id`
    )
      .filter((e) => e.from_status !== e.to_status)
      .map((e) => `${e.to_status}/${e.source}`);
  const deliver = (hook: { body: string; signature: string }) =>
    http()
      .post('/webhooks/fake/accounts')
      .set('Content-Type', 'application/json')
      .set('X-Fake-Signature', hook.signature)
      .send(hook.body);
  const qris = (s: Store | S, over: Record<string, unknown> = {}) =>
    s.chargeRaw({ method: 'fake_qris', ...over });

  describe('the flow', () => {
    it('answers a store that never onboarded as not_submitted, with the methods it could switch on', async () => {
      const s = newStore();
      const res = await s.get(ACCOUNTS).expect(200);
      expect(res.body).toEqual({
        mode: 'fake',
        items: [
          {
            provider: 'fake',
            mode: 'fake',
            status: 'not_submitted',
            statusReason: null,
            verification: 'hosted',
            profile: {
              businessType: null,
              businessName: null,
              email: null,
              phone: null,
            },
            termsAcceptedAt: null,
            submittedAt: null,
            methods: ['fake_qris', 'fake_va', 'fake_checkout'].map(
              (method) => ({ method, enabled: false, chargeable: false }),
            ),
            lastSyncedAt: null,
            updatedAt: null,
          },
        ],
      });
      expect(await row(s)).toBeUndefined();
    });

    it('draft → submitted → verified on the gateway’s page → a method on → active', async () => {
      const s = newStore();
      // A partial draft is kept as it is.
      const draft = await s
        .put(FAKE, { businessName: 'Warung Bu Sari' })
        .expect(200);
      expect(draft.body).toMatchObject({
        status: 'not_submitted',
        profile: { businessName: 'Warung Bu Sari', email: null },
      });
      const incomplete = await s.post(`${FAKE}/submit`, SUBMIT).expect(409);
      expect(incomplete.body).toMatchObject({
        code: 'draft_incomplete',
        meta: { missing: ['businessType', 'email', 'phone'] },
      });

      await s.put(FAKE, DRAFT).expect(200);
      const sub = await s.post(`${FAKE}/submit`, SUBMIT).expect(200);
      expect(sub.body).toMatchObject({ status: 'submitted', profile: DRAFT });
      expect(sub.body.termsAcceptedAt).toEqual(expect.any(String));
      expect((await row(s)).provider_account_id).toMatch(/^FAKE-ACCT-/);
      // Submitted: the draft is closed, and no method can be switched yet.
      expect((await s.put(FAKE, DRAFT).expect(409)).body.code).toBe(
        'merchant_locked',
      );
      expect(
        (await s.put(`${FAKE}/methods/fake_qris`, ON).expect(409)).body,
      ).toMatchObject({
        code: 'merchant_not_verified',
        meta: { status: 'submitted' },
      });

      // The owner verifies on the gateway's page: the contract gives a link and nothing else.
      const link = await s.post(`${FAKE}/verification-link`).expect(200);
      expect(link.body).toEqual({
        url: expect.stringMatching(
          /^https:\/\/fake-gateway\.invalid\/verify\/[0-9a-f]{32}$/,
        ),
        expiresAt: expect.any(String),
      });

      await review(s, 'approve').expect(200);
      expect(await account(s)).toMatchObject({ status: 'verified' });
      expect(
        (await s.post(`${FAKE}/verification-link`).expect(409)).body.code,
      ).toBe('verification_not_open');

      const on = await s.put(`${FAKE}/methods/fake_qris`, ON).expect(200);
      expect(on.body.status).toBe('active');
      expect(on.body.methods).toEqual([
        { method: 'fake_qris', enabled: true, chargeable: true },
        { method: 'fake_va', enabled: false, chargeable: false },
        { method: 'fake_checkout', enabled: false, chargeable: false },
      ]);
      // The same toggle again changes nothing.
      await s.put(`${FAKE}/methods/fake_qris`, ON).expect(200);
      await s.put(`${FAKE}/methods/fake_va`, ON).expect(200);
      await s.put(`${FAKE}/methods/fake_va`, OFF).expect(200);
      expect((await row(s)).enabled_methods).toEqual(['fake_qris']);
      // The last method off: verified again.
      const off = await s.put(`${FAKE}/methods/fake_qris`, OFF).expect(200);
      expect(off.body.status).toBe('verified');
      expect(await moves(s)).toEqual([
        'submitted/submit',
        'verified/webhook',
        'active/toggle',
        'verified/toggle',
      ]);
    });

    it('submit is idempotent: a repeat answers the submitted account and creates no second sub-account', async () => {
      const s = await submitted();
      const before = await row(s);
      const again = await s.post(`${FAKE}/submit`, SUBMIT).expect(200);
      expect(again.body.status).toBe('submitted');
      expect(await row(s)).toEqual(before);
      expect(await moves(s)).toEqual(['submitted/submit']);
    });

    it('the gateway down at submit answers 503, the account stays submitted, and the repeat creates the sub-account', async () => {
      const s = newStore();
      await s.put(FAKE, DRAFT).expect(200);
      await s.post(`${GW}/accounts/outage`, { down: true }).expect(200);
      const down = await s.post(`${FAKE}/submit`, SUBMIT).expect(503);
      expect(down.body.code).toBe('gateway_unavailable');
      expect(await row(s)).toMatchObject({
        status: 'submitted',
        provider_account_id: null,
      });
      await s.post(`${GW}/accounts/outage`, { down: false }).expect(200);
      await s.post(`${FAKE}/submit`, SUBMIT).expect(200);
      expect((await row(s)).provider_account_id).toMatch(/^FAKE-ACCT-/);
    });

    it('a submit whose answer was lost is finished by the reconciliation', async () => {
      const s = newStore();
      await s.put(FAKE, DRAFT).expect(200);
      await s.post(`${GW}/accounts/outage`, { down: true }).expect(200);
      await s.post(`${FAKE}/submit`, SUBMIT).expect(503);
      await s.post(`${GW}/accounts/outage`, { down: false }).expect(200);
      clock.advance(3 * MINUTE);
      await reconcile.tick();
      expect((await row(s)).provider_account_id).toMatch(/^FAKE-ACCT-/);
      await s.get(`${GW}/account`).expect(200);
    });

    it('needs_fix carries the reason, reopens the draft, and a new submit is reviewed again', async () => {
      const s = await submitted();
      await review(s, 'needs-fix', { reason: 'Foto KTP buram' }).expect(200);
      expect(await account(s)).toMatchObject({
        status: 'needs_fix',
        statusReason: 'Foto KTP buram',
      });
      // The link is open again, and the draft may be corrected.
      await s.post(`${FAKE}/verification-link`).expect(200);
      await s.put(FAKE, { ...DRAFT, businessName: 'Warung Sari' }).expect(200);
      const again = await s.post(`${FAKE}/submit`, SUBMIT).expect(200);
      expect(again.body).toMatchObject({
        status: 'submitted',
        statusReason: null,
      });
      expect((await s.get(`${GW}/account`).expect(200)).body).toMatchObject({
        status: 'pending',
        profile: { businessName: 'Warung Sari' },
      });
      await review(s, 'approve').expect(200);
      expect(await moves(s)).toEqual([
        'submitted/submit',
        'needs_fix/webhook',
        'submitted/submit',
        'verified/webhook',
      ]);
    });

    it('rejected is final for the owner: no draft, no submit, no link, no toggle', async () => {
      const s = await submitted();
      await review(s, 'reject', { reason: 'Usaha tidak sesuai' }).expect(200);
      expect(await account(s)).toMatchObject({
        status: 'rejected',
        statusReason: 'Usaha tidak sesuai',
      });
      expect((await s.put(FAKE, DRAFT).expect(409)).body.code).toBe(
        'merchant_locked',
      );
      expect(
        (await s.post(`${FAKE}/submit`, SUBMIT).expect(409)).body.code,
      ).toBe('merchant_locked');
      await s.post(`${FAKE}/verification-link`).expect(409);
      await s.put(`${FAKE}/methods/fake_qris`, ON).expect(409);
      expect((await review(s, 'approve').expect(409)).body.code).toBe(
        'account_not_reviewable',
      );
    });

    it('suspended keeps the toggles, refuses new ones, and a reinstated account is active again', async () => {
      const s = await active();
      await review(s, 'suspend', { reason: 'Dibekukan sementara' }).expect(200);
      const frozen = await account(s);
      expect(frozen).toMatchObject({
        status: 'suspended',
        statusReason: 'Dibekukan sementara',
      });
      expect(frozen.methods[0]).toEqual({
        method: 'fake_qris',
        enabled: true,
        chargeable: false,
      });
      await s.put(`${FAKE}/methods/fake_va`, ON).expect(409);
      await review(s, 'approve').expect(200);
      expect(await account(s)).toMatchObject({
        status: 'active',
        statusReason: null,
      });
      expect(await moves(s)).toEqual([
        'submitted/submit',
        'verified/webhook',
        'active/toggle',
        'suspended/webhook',
        'active/webhook',
      ]);
    });
  });

  describe('validation', () => {
    it('answers 422 on a bad draft, and refuses anything that is not the short draft', async () => {
      const s = newStore();
      for (const body of [
        { businessType: 'cv' },
        { email: 'not-an-email' },
        { phone: '0812-abc' },
        { businessName: 'x'.repeat(121) },
        // An identity number or a document is not part of the draft: refused, never stored.
        { ...DRAFT, nik: '3201010101010001' },
        { ...DRAFT, ktpPhoto: 'data:image/png;base64,AAAA' },
        { ...DRAFT, tenantId: '00000000-0000-4000-8000-000000000000' },
      ])
        await s.put(FAKE, body).expect(422);
      expect(await row(s)).toBeUndefined();
    });

    it('answers 422 on a submit without the terms or the actor, and on a bad toggle', async () => {
      const s = newStore();
      await s.put(FAKE, DRAFT).expect(200);
      for (const body of [
        {},
        { termsAccepted: false, actorRef: 'o' },
        { termsAccepted: true },
        { termsAccepted: 'true', actorRef: 'o' },
      ])
        await s.post(`${FAKE}/submit`, body).expect(422);
      expect((await row(s)).status).toBe('not_submitted');
      const v = await verified();
      await v.put(`${FAKE}/methods/fake_qris`, { enabled: 'yes' }).expect(422);
      await v.put(`${FAKE}/methods/fake_qris`, { enabled: true }).expect(422);
      // Only the provider's own methods have a toggle.
      for (const method of ['cash', 'static_qris', 'nope'])
        await v.put(`${FAKE}/methods/${method}`, ON).expect(422);
    });

    it('answers 404 for a provider that does not exist, and for the fake in another mode', async () => {
      const s = newStore();
      await s.put(`${ACCOUNTS}/xendit`, DRAFT).expect(404);
      await s.post(`${ACCOUNTS}/xendit/submit`, SUBMIT).expect(404);
      await s.post(`${ACCOUNTS}/xendit/sync`).expect(404);
      settings.gatewayMode = 'sandbox';
      expect((await s.get(ACCOUNTS).expect(200)).body).toEqual({
        mode: 'sandbox',
        items: [],
      });
      await s.put(FAKE, DRAFT).expect(404);
    });
  });

  describe('the gateway’s webhook', () => {
    it('refuses a notification whose signature does not verify, and stores nothing', async () => {
      const s = await submitted();
      const hook = (await review(s, 'approve', { webhook: 'drop' }).expect(200))
        .body.webhook;
      const count = async () =>
        (
          await sql<
            { n: number }[]
          >`select count(*)::int as n from payment.merchant_webhook_events where event_id = ${hook.eventId}`
        )[0].n;
      const forged = await deliver({
        body: hook.body,
        signature: 'f'.repeat(64),
      }).expect(401);
      expect(forged.body.code).toBe('invalid_signature');
      // A valid signature over other bytes does not verify either.
      await deliver({
        body: hook.body.replace('account', 'accounT'),
        signature: hook.signature,
      }).expect(401);
      expect(await count()).toBe(0);
      expect((await row(s)).status).toBe('submitted');
      await deliver(hook).expect(200);
      expect(await count()).toBe(1);
      expect((await row(s)).status).toBe('verified');
    });

    it('is idempotent: the same event twice is stored once and moves the account once', async () => {
      const s = await submitted();
      const res = await review(s, 'approve', { webhook: 'duplicate' }).expect(
        200,
      );
      expect(res.body.webhook.answers).toEqual([
        { received: true, duplicate: false },
        { received: true, duplicate: true },
      ]);
      // And once more over HTTP, as a PG that retries.
      expect((await deliver(res.body.webhook).expect(200)).body).toEqual({
        received: true,
        duplicate: true,
      });
      expect(await moves(s)).toEqual(['submitted/submit', 'verified/webhook']);
      const events = await sql`
        select state, tenant_id, merchant_account_id from payment.merchant_webhook_events
        where event_id = ${res.body.webhook.eventId}`;
      const account = await row(s);
      expect([...events]).toEqual([
        {
          state: 'processed',
          tenant_id: s.tenantId,
          merchant_account_id: account.id,
        },
      ]);
    });

    it('out of order: an old event delivered late lands on the gateway’s current status', async () => {
      const s = await submitted();
      // The gateway asked for a fix, but that notification is held back…
      const old = (
        await review(s, 'needs-fix', {
          reason: 'Alamat kurang lengkap',
          webhook: 'drop',
        }).expect(200)
      ).body.webhook;
      expect((await row(s)).status).toBe('submitted');
      // …a manual check finds it, the owner submits again and the gateway approves.
      clock.advance(MINUTE);
      expect((await s.post(`${FAKE}/sync`).expect(200)).body.status).toBe(
        'needs_fix',
      );
      await s.post(`${FAKE}/submit`, SUBMIT).expect(200);
      await review(s, 'approve').expect(200);
      expect((await row(s)).status).toBe('verified');
      // The old "needs fix" arrives now: the account is not thrown back.
      expect((await deliver(old).expect(200)).body).toEqual({
        received: true,
        duplicate: false,
      });
      expect(await row(s)).toMatchObject({
        status: 'verified',
        status_reason: null,
      });
    });

    it('carries no status: the body names the account only, and a forged status in a signed body is not possible', async () => {
      const s = await submitted();
      const hook = (await review(s, 'approve', { webhook: 'drop' }).expect(200))
        .body.webhook;
      expect(Object.keys(JSON.parse(hook.body)).sort()).toEqual([
        'account',
        'eventId',
        'type',
      ]);
      await deliver(hook).expect(200);
      // Sent to the payment webhook instead, it names no payment: kept there as unmatched, nothing moves.
      const before = await moves(s);
      const asPayment = await http()
        .post('/webhooks/fake')
        .set('Content-Type', 'application/json')
        .set('X-Fake-Signature', hook.signature)
        .send(hook.body)
        .expect(200);
      expect(asPayment.body).toEqual({ received: true, duplicate: false });
      const [stored] = await sql`
        select state from payment.webhook_events where event_id = ${hook.eventId}`;
      expect(stored.state).toBe('unmatched');
      expect(await moves(s)).toEqual(before);
      // And a payment notification is refused by the account webhook.
      const payer = createStore(app);
      const p = (await payer.chargeRaw({ method: 'fake_qris' }).expect(201))
        .body;
      const bill = (
        await payer.post(`${GW}/payments/${p.providerRef}/webhook`).expect(200)
      ).body.webhook;
      await deliver(bill).expect(400);
    });

    it('a notification that names no account of ours is kept as unmatched, without a tenant', async () => {
      const gateway = app.get(LocalFakeGateway);
      const hook = gateway.accountNotification({
        accountId: 'FAKE-ACCT-NONE',
        merchantId: '00000000-0000-4000-8000-000000000001',
        tenantId: '00000000-0000-4000-8000-000000000002',
        status: 'verified',
        reason: null,
        profile: DRAFT as never,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await deliver(hook).expect(200);
      const [stored] = await sql`
        select state, tenant_id from payment.merchant_webhook_events where event_id = ${hook.eventId}`;
      expect(stored).toEqual({ state: 'unmatched', tenant_id: null });
    });

    it('a lost webhook is found by the reconciliation, and a manual sync finds it at once', async () => {
      const s = await submitted();
      await review(s, 'approve', { webhook: 'drop' }).expect(200);
      expect((await row(s)).status).toBe('submitted');
      // Too early for the job.
      await reconcile.tick();
      expect((await row(s)).status).toBe('submitted');
      clock.advance(3 * MINUTE);
      await reconcile.tick();
      expect((await row(s)).status).toBe('verified');
      expect(await moves(s)).toEqual([
        'submitted/submit',
        'verified/reconciliation',
      ]);

      const t = await submitted();
      await review(t, 'approve', { webhook: 'drop' }).expect(200);
      clock.advance(MINUTE);
      const synced = await t.post(`${FAKE}/sync`).expect(200);
      expect(synced.body.status).toBe('verified');
    });

    it('a webhook that cannot be processed stays in the inbox and is retried', async () => {
      const s = await submitted();
      await s.post(`${GW}/accounts/outage`, { down: true }).expect(200);
      const res = await review(s, 'approve').expect(200);
      expect(res.body.webhook.answers).toEqual([
        { received: true, duplicate: false },
      ]);
      const state = async () =>
        (
          await sql`select state, attempts from payment.merchant_webhook_events
                    where event_id = ${res.body.webhook.eventId}`
        )[0];
      expect(await state()).toEqual({ state: 'failed', attempts: 1 });
      expect((await row(s)).status).toBe('submitted');
      await s.post(`${GW}/accounts/outage`, { down: false }).expect(200);
      await reconcile.tick();
      expect(await state()).toEqual({ state: 'processed', attempts: 1 });
      expect((await row(s)).status).toBe('verified');
    });
  });

  describe('the charge gate', () => {
    it('refuses a PG charge for a store with no account, and never gates a CASHAC method', async () => {
      const s = newStore();
      const res = await qris(s).expect(409);
      expect(res.body).toMatchObject({
        code: 'merchant_not_active',
        meta: { status: 'not_submitted' },
      });
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from payment.payments where tenant_id = ${s.tenantId}`;
      expect(n).toBe(0);
      for (const method of ['cash', 'edc_debit', 'static_qris'])
        expect((await s.chargeRaw({ method }).expect(201)).body.status).toBe(
          'paid',
        );
    });

    it.each([
      'not_submitted',
      'submitted',
      'needs_fix',
      'rejected',
      'verified',
      'suspended',
    ])('refuses a PG charge while the account is %s', async (status) => {
      const s = newStore();
      // Every method on, so that only the status can be the reason.
      await seedMerchant(sql, { tenantId: s.tenantId, status });
      expect((await qris(s).expect(409)).body).toMatchObject({
        code: 'merchant_not_active',
        meta: { status },
      });
    });

    it('through the flow: refused at every step until a method is on, then charged', async () => {
      const s = newStore();
      await s.put(FAKE, DRAFT).expect(200);
      await qris(s).expect(409);
      await s.post(`${FAKE}/submit`, SUBMIT).expect(200);
      await qris(s).expect(409);
      await review(s, 'approve').expect(200);
      expect((await qris(s).expect(409)).body.meta).toEqual({
        status: 'verified',
      });
      await s.put(`${FAKE}/methods/fake_qris`, ON).expect(200);
      expect((await qris(s).expect(201)).body).toMatchObject({
        status: 'pending',
        checkout: { qrString: expect.any(String) },
      });
    });

    it('refuses a method that is switched off while another is on', async () => {
      const s = await active();
      await qris(s).expect(201);
      expect(
        (await s.chargeRaw({ method: 'fake_va' }).expect(409)).body.code,
      ).toBe('method_disabled');
      await s.put(`${FAKE}/methods/fake_va`, ON).expect(200);
      await s.chargeRaw({ method: 'fake_va' }).expect(201);
      await s.put(`${FAKE}/methods/fake_qris`, OFF).expect(200);
      expect((await qris(s).expect(409)).body.code).toBe('method_disabled');
    });

    it('a charge answers a QR string or a hosted payment URL, by the method', async () => {
      const s = await active();
      await s.put(`${FAKE}/methods/fake_checkout`, ON).expect(200);
      const res = await s.chargeRaw({ method: 'fake_checkout' }).expect(201);
      expect(res.body.checkout).toEqual({
        paymentUrl: expect.stringMatching(
          /^https:\/\/fake-gateway\.invalid\/pay\//,
        ),
      });
      expect(res.body.providerRef).toMatch(/^FAKE-CO-/);
    });

    it('switching a method off does not touch a bill that is waiting: it is still paid', async () => {
      const s = await active();
      const p = (await qris(s).expect(201)).body;
      await s.put(`${FAKE}/methods/fake_qris`, OFF).expect(200);
      await s.post(`${GW}/payments/${p.providerRef}/pay`).expect(200);
      expect((await s.read(p.id)).status).toBe('paid');
    });

    it('a replay of a charge key answers the first payment also after a suspension; a new charge is refused', async () => {
      const s = await active();
      const body = { orderRef: 'order-replay', method: 'fake_qris' };
      const first = (await s.chargeRaw(body).expect(201)).body;
      await review(s, 'suspend', { reason: 'x' }).expect(200);
      const again = await s.chargeRaw(body).expect(200);
      expect(again.body.id).toBe(first.id);
      expect((await qris(s).expect(409)).body).toMatchObject({
        code: 'merchant_not_active',
        meta: { status: 'suspended' },
      });
      // The key of another request is still refused as such, not replayed.
      await s
        .chargeRaw({ ...body, amount: 1 })
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('idempotency_key_reused'));
    });
  });

  describe('modes', () => {
    it('refuses to submit and to charge in live mode while the live switch is off', async () => {
      const s = await active();
      settings.gatewayMode = 'live';
      settings.liveEnabled = false;
      expect((await qris(s).expect(409)).body.code).toBe('live_disabled');
      // An account that was created live is not charged either, whatever the environment says now.
      const live = newStore();
      await seedMerchant(sql, { tenantId: live.tenantId, mode: 'live' });
      settings.gatewayMode = 'fake';
      expect((await qris(live).expect(409)).body.code).toBe('live_disabled');
      // The fake serves no live mode: there is nothing to submit to.
      settings.gatewayMode = 'live';
      await newStore().put(FAKE, DRAFT).expect(404);
    });

    it('refuses a charge on an account of another mode than the environment’s', async () => {
      const s = newStore();
      await seedMerchant(sql, { tenantId: s.tenantId, mode: 'sandbox' });
      expect((await qris(s).expect(409)).body.code).toBe(
        'merchant_mode_mismatch',
      );
      const account = (await s.get(ACCOUNTS).expect(200)).body.items[0];
      expect(account.methods[0]).toMatchObject({
        enabled: true,
        chargeable: false,
      });
    });
  });

  describe('cross-tenant', () => {
    it('store B reads, changes and drives only its own account, never store A’s', async () => {
      const a = await active();
      const b = newStore();
      // B sees no account of its own, and nothing of A's.
      expect(await account(b)).toMatchObject({
        status: 'not_submitted',
        profile: { businessName: null },
      });
      // B's draft, submit and toggle act on B's account only.
      await b.put(FAKE, { ...DRAFT, businessName: 'Toko B' }).expect(200);
      await b.put(`${FAKE}/methods/fake_qris`, OFF).expect(409);
      await b.post(`${FAKE}/verification-link`).expect(409);
      // The fake's reviewer, called for B, cannot reach A's sub-account.
      await b.get(`${GW}/account`).expect(404);
      for (const action of ['approve', 'needs-fix', 'reject', 'suspend'])
        await review(b, action, { reason: 'x' }).expect(404);
      await b.post(`${GW}/account/webhook`).expect(404);
      await qris(b).expect(409);
      expect(await account(a)).toMatchObject({
        status: 'active',
        profile: { businessName: DRAFT.businessName },
      });
      expect((await row(a)).enabled_methods).toEqual(['fake_qris']);
      // A tenant id in a body or a query is not read.
      await b
        .get(`${ACCOUNTS}?tenantId=${a.tenantId}`)
        .expect(200)
        .expect((r) => expect(r.body.items[0].status).toBe('not_submitted'));
    });

    it('needs the service key, and the tenant header', async () => {
      await http().get(ACCOUNTS).expect(401);
      await http().put(FAKE).send(DRAFT).expect(401);
      await http()
        .get(ACCOUNTS)
        .set('X-Payment-Service-Key', process.env.PAYMENT_SERVICE_KEY!)
        .expect(400);
      await http().post(`${GW}/account/approve`).expect(401);
    });
  });

  describe('secrets', () => {
    it('no answer of any route carries the gateway’s account id, a credential or the signing secret', async () => {
      // A store through every route, on top of everything the suite recorded so far.
      const s = await active();
      await s.post(`${FAKE}/sync`).expect(200);
      await s.get(`${GW}/account`).expect(200);
      await s.post(`${GW}/account/webhook`).expect(200);
      await sql`update payment.merchant_accounts set credentials_encrypted = 'enc:never-answered'
                where tenant_id = ${s.tenantId}`;
      await s.get(ACCOUNTS).expect(200);
      await s.put(`${FAKE}/methods/fake_va`, ON).expect(200);

      const ids = (
        await sql<{ provider_account_id: string }[]>`
          select provider_account_id from payment.merchant_accounts
          where provider_account_id like 'FAKE-ACCT-%'`
      ).map((r) => r.provider_account_id);
      expect(ids.length).toBeGreaterThan(5);
      const gateway: unknown = app.get(LocalFakeGateway);
      const secret = (gateway as { secret: Buffer }).secret;
      const forbidden = [
        ...ids,
        'FAKE-ACCT-',
        'enc:never-answered',
        'credentials',
        'providerAccountId',
        'provider_account_id',
        secret.toString('hex'),
        secret.toString('base64'),
        process.env.PAYMENT_SERVICE_KEY!,
      ];
      expect(answers.length).toBeGreaterThan(50);
      for (const text of answers)
        for (const word of forbidden) expect(text).not.toContain(word);
    });
  });
});
