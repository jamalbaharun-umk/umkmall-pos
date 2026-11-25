import './support/fake-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { LocalFakeGateway } from '../src/adapters/fake/local-fake-gateway';
import { AppModule } from '../src/app.module';
import { Clock, PaymentSettings } from '../src/config';
import { ReconciliationService } from '../src/payments/reconciliation.service';
import { ADMIN_DATABASE_URL } from './support/env';
import {
  auditOf,
  CANCEL,
  createStore,
  FakeClock,
  MINUTE,
  outboxOf,
  Payment,
  SERVICE_KEY,
  Store,
  unmatchedOf,
} from './support/fixtures';

const GW = '/dev/fake-gateway';

/**
 * The local fake gateway (PAYMENT_ADAPTERS=fake) through the real app: no adapter is overridden here. Only the
 * clock is a test's, so expiry and reconciliation need no waiting.
 */
describe('local fake gateway', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let settings: PaymentSettings;
  let defaults: object;
  let reconcile: ReconciliationService;
  let sql: postgres.Sql;
  const http = () => request(app.getHttpServer());

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
    await createStore(app)
      .post(`${GW}/settings`, { refundMode: 'pending' })
      .expect(200);
  });
  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  const bill = async (s: Store, over: Record<string, unknown> = {}) => {
    const res = await s.chargeRaw({ method: 'fake_qris', ...over }).expect(201);
    expect(res.body.status).toBe('pending');
    return res.body as Payment;
  };
  const act = (s: Store, p: Payment, action: string, body: object = {}) =>
    s.post(`${GW}/payments/${p.providerRef}/${action}`, body);
  const bills = async (s: Store) =>
    (await s.get(`${GW}/payments`).expect(200)).body.items as any[];
  const billOf = async (s: Store, p: Payment) =>
    (await bills(s)).find((b) => b.paymentId === p.id);
  const moves = async (id: string) =>
    (await auditOf(sql, id))
      .filter((e) => e.from_status !== e.to_status)
      .map((e) => `${e.to_status}/${e.source}`);
  const deliverOverHttp = (hook: { body: string; signature: string }) =>
    http()
      .post('/webhooks/fake')
      .set('Content-Type', 'application/json')
      .set('X-Fake-Signature', hook.signature)
      .send(hook.body);
  const events = (paymentId: string) =>
    sql<{ state: string; tenant_id: string | null; event_id: string }[]>`
      select state, tenant_id, event_id from payment.webhook_events
      where reference = ${paymentId} order by created_at, id`;

  describe('bills', () => {
    it('a dynamic QRIS bill is pending, valid for 15 minutes, and listed for its store', async () => {
      const s = createStore(app);
      const before = clock.now().getTime();
      const p = await bill(s, { amount: 30_000 });
      expect(p).toMatchObject({
        method: 'fake_qris',
        kind: 'online',
        providerRef: expect.stringMatching(/^FAKE-QR-[0-9A-F]{12}$/),
        checkout: { qrString: expect.stringContaining('FAKEQRIS.') },
        capabilities: {
          supportsVoid: false,
          supportsRefund: true,
          canCancel: true,
          singleUseQr: true,
        },
      });
      const ttl = new Date(p.expiresAt).getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(15 * MINUTE);
      expect(ttl).toBeLessThan(15 * MINUTE + 5000);
      expect(await bills(s)).toEqual([
        {
          providerRef: p.providerRef,
          paymentId: p.id,
          orderRef: p.orderRef,
          method: 'fake_qris',
          amount: 30_000,
          status: 'pending',
          expiresAt: p.expiresAt,
          checkout: p.checkout,
          receipts: [],
          refunds: [],
          createdAt: expect.any(String),
        },
      ]);
    });

    it('a virtual account bill carries a VA number and takes more than one transfer', async () => {
      const s = createStore(app);
      const p = await bill(s, { method: 'fake_va' });
      expect(p).toMatchObject({
        providerRef: expect.stringMatching(/^FAKE-VA-/),
        checkout: {
          bank: 'FAKE',
          vaNumber: expect.stringMatching(/^8808\d{12}$/),
        },
        capabilities: { singleUseQr: false },
      });
    });

    it('the same charge again answers the same bill', async () => {
      const s = createStore(app);
      const orderRef = `order-${randomUUID()}`;
      const first = await bill(s, { orderRef });
      const again = await s
        .chargeRaw({ method: 'fake_qris', orderRef })
        .expect(200);
      expect(again.body.providerRef).toBe(first.providerRef);
      expect(await bills(s)).toHaveLength(1);
    });
  });

  describe('paid, failed, expired', () => {
    it('pay: the signed webhook goes through the inbox and settle, and the payment is paid', async () => {
      const s = createStore(app);
      const p = await bill(s);
      const res = await act(s, p, 'pay').expect(200);
      expect(res.body.bill).toMatchObject({
        status: 'paid',
        receipts: [{ amount: 25_000 }],
      });
      expect(res.body.webhook).toMatchObject({
        signatureHeader: 'X-Fake-Signature',
        delivered: true,
        answers: [{ received: true, duplicate: false }],
      });
      // The notification is a PG's: our reference, no tenant, no status.
      expect(JSON.parse(res.body.webhook.body)).toEqual({
        eventId: res.body.webhook.eventId,
        reference: p.id,
      });
      const paid = await s.read(p.id);
      expect(paid).toMatchObject({ status: 'paid', feeAmount: 0 });
      expect(paid.paidAt).not.toBeNull();
      expect(await moves(p.id)).toEqual([
        'created/charge',
        'pending/charge',
        'paid/webhook',
      ]);
      expect(await events(p.id)).toEqual([
        {
          state: 'processed',
          tenant_id: s.tenantId,
          event_id: res.body.webhook.eventId,
        },
      ]);
    });

    it("the same notification over HTTP: no service key, the signature is checked, and the tenant is our payment row's", async () => {
      const a = createStore(app);
      const p = await bill(a);
      const { body } = await act(a, p, 'pay', { webhook: 'drop' }).expect(200);
      expect(body.webhook).toMatchObject({ delivered: false, answers: [] });
      expect((await a.read(p.id)).status).toBe('pending');

      const bad = body.webhook.signature.replace(/.$/, (c: string) =>
        c === '0' ? '1' : '0',
      );
      const refused = await deliverOverHttp({
        ...body.webhook,
        signature: bad,
      }).expect(401);
      expect(refused.body.code).toBe('invalid_signature');
      // A body that was changed after signing does not verify either.
      await deliverOverHttp({
        signature: body.webhook.signature,
        body: body.webhook.body.replace(p.id, randomUUID()),
      }).expect(401);
      expect((await a.read(p.id)).status).toBe('pending');

      // A tenant header on the webhook is not read: the payment is found by reference, the tenant is its row's.
      const ok = await deliverOverHttp(body.webhook)
        .set('X-Tenant-Id', randomUUID())
        .expect(200);
      expect(ok.body).toEqual({ received: true, duplicate: false });
      expect((await a.read(p.id)).status).toBe('paid');
      expect(await events(p.id)).toMatchObject([
        { state: 'processed', tenant_id: a.tenantId },
      ]);
      const [row] =
        await sql`select tenant_id from payment.payments where id = ${p.id}`;
      expect(row.tenant_id).toBe(a.tenantId);
    });

    it('fail: the payment is failed and the order can be charged again', async () => {
      const s = createStore(app);
      const p = await bill(s);
      const res = await act(s, p, 'fail').expect(200);
      expect(res.body.bill.status).toBe('failed');
      expect((await s.read(p.id)).status).toBe('failed');
      expect(await moves(p.id)).toContain('failed/webhook');
      const next = await s
        .chargeRaw({ method: 'fake_qris', orderRef: p.orderRef, attempt: 2 })
        .expect(201);
      expect(next.body.status).toBe('pending');
    });

    it('expire: the payment waits out the grace period, then is expired', async () => {
      const s = createStore(app);
      const p = await bill(s);
      const res = await act(s, p, 'expire').expect(200);
      expect(res.body.bill.status).toBe('expired');
      // The gateway says expired, but a payment on its way is still waited for.
      expect((await s.read(p.id)).status).toBe('pending');
      clock.advance(settings.qrTtlMs + settings.expiryGraceMs + 1000);
      await act(s, p, 'webhook').expect(200);
      expect((await s.read(p.id)).status).toBe('expired');
      expect(await moves(p.id)).toContain('expired/webhook');
    });

    it('a bill nobody touches expires at the gateway by itself and the reconciliation closes the payment', async () => {
      const s = createStore(app);
      const p = await bill(s);
      clock.advance(settings.qrTtlMs + settings.expiryGraceMs + 1000);
      expect((await billOf(s, p)).status).toBe('expired');
      await reconcile.tick();
      expect((await s.read(p.id)).status).toBe('expired');
      expect(await moves(p.id)).toContain('expired/reconciliation');
      // Closed at the gateway: pay, fail and expire are refused; late-pay is the way.
      for (const action of ['pay', 'fail', 'expire']) {
        const refused = await act(s, p, action).expect(409);
        expect(refused.body.code).toBe('bill_closed');
      }
    });
  });

  describe('late payment', () => {
    const cancelled = async (s: Store) => {
      const p = await bill(s);
      const res = await s
        .post(`/payments/${p.id}/cancel`, { actorRef: 'cashier-1' })
        .expect(200);
      expect(res.body.status).toBe('cancelled');
      expect((await billOf(s, p)).status).toBe('cancelled');
      return p;
    };

    it('late-pay is refused while the bill is open', async () => {
      const s = createStore(app);
      const p = await bill(s);
      const res = await act(s, p, 'late-pay').expect(409);
      expect(res.body.code).toBe('bill_open');
      expect((await billOf(s, p)).receipts).toEqual([]);
    });

    it('money on a closed bill is an unmatched receipt, refunded by system, and the payment never becomes paid', async () => {
      const s = createStore(app);
      const p = await cancelled(s);
      await act(s, p, 'late-pay').expect(200);
      expect((await s.read(p.id)).status).toBe('cancelled');
      const [receipt] = await unmatchedOf(sql, p.id);
      expect(receipt).toMatchObject({
        kind: 'late_payment',
        gross_amount: '25000',
        refund_status: 'pending',
        refund_actor: 'system',
      });
      // The automatic refund was asked at the gateway under the receipt row's id.
      const held = await billOf(s, p);
      expect(held.refunds).toEqual([
        {
          id: receipt.id,
          receiptId: held.receipts[0].id,
          amount: 25_000,
          status: 'pending',
        },
      ]);
      expect(await outboxOf(sql, p.id)).toContain('payment.unmatched_receipt');

      await s.post(`${GW}/refunds/${receipt.id}/succeed`).expect(200);
      expect((await unmatchedOf(sql, p.id))[0]).toMatchObject({
        refund_status: 'refunded',
        needs_review: false,
      });
      expect((await s.read(p.id)).status).toBe('cancelled');
      const listed = await s.get('/unmatched-receipts').expect(200);
      expect(listed.body.items).toMatchObject([
        { paymentId: p.id, kind: 'late_payment', refundStatus: 'refunded' },
      ]);
    });

    it('a refused automatic refund leaves the receipt for the owner', async () => {
      const s = createStore(app);
      const p = await cancelled(s);
      await act(s, p, 'late-pay').expect(200);
      const [receipt] = await unmatchedOf(sql, p.id);
      await s.post(`${GW}/refunds/${receipt.id}/fail`).expect(200);
      expect((await unmatchedOf(sql, p.id))[0]).toMatchObject({
        refund_status: 'failed',
        needs_review: true,
      });
    });

    it('PAYMENT_LATE_AUTO_REFUND off: the money waits for review and no refund is asked', async () => {
      const s = createStore(app);
      settings.lateAutoRefund = false;
      const p = await cancelled(s);
      await act(s, p, 'late-pay').expect(200);
      expect(await unmatchedOf(sql, p.id)).toMatchObject([
        { kind: 'late_payment', refund_status: 'none', needs_review: true },
      ]);
      expect((await billOf(s, p)).refunds).toEqual([]);
    });

    it('a late payment whose webhook is lost is found by the reconciliation', async () => {
      const s = createStore(app);
      const p = await cancelled(s);
      await act(s, p, 'late-pay', { webhook: 'drop' }).expect(200);
      expect(await unmatchedOf(sql, p.id)).toEqual([]);
      clock.advance(settings.reconcileAfterMs + 1000);
      await reconcile.tick();
      expect(await unmatchedOf(sql, p.id)).toMatchObject([
        { kind: 'late_payment', refund_status: 'pending' },
      ]);
    });
  });

  describe('other money', () => {
    it('another amount on a QR never pays it: the payment fails and the money is unmatched', async () => {
      const s = createStore(app);
      const p = await bill(s);
      await act(s, p, 'pay', { amount: 20_000 }).expect(200);
      expect(await s.read(p.id)).toMatchObject({
        status: 'failed',
        needsReview: true,
        reviewReason: 'amount_mismatch',
      });
      expect(await unmatchedOf(sql, p.id)).toMatchObject([
        { kind: 'amount_mismatch', gross_amount: '20000' },
      ]);
      // A dynamic QR takes one payment only.
      const again = await act(s, p, 'pay').expect(409);
      expect(again.body.code).toBe('already_paid');
    });

    it('a second transfer to a VA is a duplicate receipt; the payment stays paid once', async () => {
      const s = createStore(app);
      const p = await bill(s, { method: 'fake_va' });
      await act(s, p, 'pay').expect(200);
      await act(s, p, 'pay').expect(200);
      expect((await s.read(p.id)).status).toBe('paid');
      expect((await moves(p.id)).filter((m) => m.startsWith('paid'))).toEqual([
        'paid/webhook',
      ]);
      expect(await unmatchedOf(sql, p.id)).toMatchObject([
        { kind: 'duplicate', gross_amount: '25000', refund_status: 'pending' },
      ]);
    });
  });

  describe('refunds', () => {
    const paid = async (s: Store) => {
      const p = await bill(s);
      await act(s, p, 'pay').expect(200);
      return p;
    };
    const refund = (s: Store, p: Payment) =>
      s.post(`/payments/${p.id}/refund`, CANCEL).expect(200);

    it('a refund waits at the gateway until it is settled; succeed → refunded', async () => {
      const s = createStore(app);
      const p = await paid(s);
      expect((await refund(s, p)).body.status).toBe('refund_pending');
      const [held] = (await billOf(s, p)).refunds;
      expect(held).toMatchObject({ amount: 25_000, status: 'pending' });
      const res = await s.post(`${GW}/refunds/${held.id}/succeed`).expect(200);
      expect(res.body.bill.refunds[0].status).toBe('succeeded');
      expect((await s.read(p.id)).status).toBe('refunded');
      expect(await moves(p.id)).toEqual([
        'created/charge',
        'pending/charge',
        'paid/webhook',
        'refund_pending/refund',
        'refunded/webhook',
      ]);
      // Settled once.
      const again = await s.post(`${GW}/refunds/${held.id}/fail`).expect(409);
      expect(again.body.code).toBe('refund_not_pending');
    });

    it('fail → refund_failed for review; asked again it is a new refund at the gateway, which succeeds', async () => {
      const s = createStore(app);
      const p = await paid(s);
      await refund(s, p);
      const [first] = (await billOf(s, p)).refunds;
      await s.post(`${GW}/refunds/${first.id}/fail`).expect(200);
      expect(await s.read(p.id)).toMatchObject({
        status: 'refund_failed',
        needsReview: true,
        reviewReason: 'refund_failed',
      });

      expect((await refund(s, p)).body.status).toBe('refund_pending');
      const held = (await billOf(s, p)).refunds;
      expect(held.map((r: any) => r.status)).toEqual(['failed', 'pending']);
      expect(held[1].id).not.toBe(first.id);
      await s.post(`${GW}/refunds/${held[1].id}/succeed`).expect(200);
      expect(await s.read(p.id)).toMatchObject({
        status: 'refunded',
        needsReview: false,
      });
    });

    it('a refund whose webhook is lost is settled by the reconciliation', async () => {
      const s = createStore(app);
      const p = await paid(s);
      await refund(s, p);
      const [held] = (await billOf(s, p)).refunds;
      await s
        .post(`${GW}/refunds/${held.id}/succeed`, { webhook: 'drop' })
        .expect(200);
      expect((await s.read(p.id)).status).toBe('refund_pending');
      clock.advance(settings.reconcileAfterMs + 1000);
      await reconcile.tick();
      expect((await s.read(p.id)).status).toBe('refunded');
    });

    it('settings: refundMode answers every new refund at once', async () => {
      const s = createStore(app);
      expect((await s.get(`${GW}/settings`).expect(200)).body).toEqual({
        refundMode: 'pending',
      });
      await s.post(`${GW}/settings`, { refundMode: 'succeed' }).expect(200);
      const a = await paid(s);
      expect((await refund(s, a)).body.status).toBe('refunded');
      await s.post(`${GW}/settings`, { refundMode: 'fail' }).expect(200);
      const b = await paid(s);
      expect((await refund(s, b)).body.status).toBe('refund_failed');
    });
  });

  describe('lost, duplicate and out-of-order webhooks', () => {
    it('lost webhook: the manual status check finds the payment', async () => {
      const s = createStore(app);
      const p = await bill(s);
      await act(s, p, 'pay', { webhook: 'drop' }).expect(200);
      expect((await s.read(p.id)).status).toBe('pending');
      expect(await events(p.id)).toEqual([]);
      const synced = await s.post(`/payments/${p.id}/sync`).expect(200);
      expect(synced.body.status).toBe('paid');
      expect(await moves(p.id)).toContain('paid/sync');
    });

    it('lost webhook: the reconciliation finds the payment with nobody asking', async () => {
      const s = createStore(app);
      const p = await bill(s);
      await act(s, p, 'pay', { webhook: 'drop' }).expect(200);
      await reconcile.tick();
      // Not yet: the reconciliation leaves a payment alone for PAYMENT_RECONCILE_AFTER_SECONDS.
      expect((await s.read(p.id)).status).toBe('pending');
      clock.advance(settings.reconcileAfterMs + 1000);
      await reconcile.tick();
      expect((await s.read(p.id)).status).toBe('paid');
      expect(await moves(p.id)).toContain('paid/reconciliation');
    });

    it('duplicate webhook: stored and processed once, one paid move, one notice', async () => {
      const s = createStore(app);
      const p = await bill(s);
      const res = await act(s, p, 'pay', { webhook: 'duplicate' }).expect(200);
      expect(res.body.webhook.answers).toEqual([
        { received: true, duplicate: false },
        { received: true, duplicate: true },
      ]);
      // The same event a third and a fourth time, by the control route and over HTTP.
      const third = await act(s, p, 'webhook', {
        eventId: res.body.webhook.eventId,
      }).expect(200);
      expect(third.body.webhook.answers).toEqual([
        { received: true, duplicate: true },
      ]);
      const fourth = await deliverOverHttp(res.body.webhook).expect(200);
      expect(fourth.body).toEqual({ received: true, duplicate: true });
      expect(await events(p.id)).toHaveLength(1);
      expect((await moves(p.id)).filter((m) => m.startsWith('paid'))).toEqual([
        'paid/webhook',
      ]);
      expect(
        (await outboxOf(sql, p.id)).filter((t) => t === 'payment.paid'),
      ).toHaveLength(1);
    });

    it('out of order: the "paid" notification that arrives after the refund changes nothing', async () => {
      const s = createStore(app);
      const p = await bill(s);
      const { body: lost } = await act(s, p, 'pay', {
        webhook: 'drop',
      }).expect(200);
      await s.post(`/payments/${p.id}/sync`).expect(200);
      await s.post(`/payments/${p.id}/refund`, CANCEL).expect(200);
      const [held] = (await billOf(s, p)).refunds;
      await s.post(`${GW}/refunds/${held.id}/succeed`).expect(200);
      const before = await moves(p.id);
      expect(before[before.length - 1]).toBe('refunded/webhook');

      const late = await deliverOverHttp(lost.webhook).expect(200);
      expect(late.body).toEqual({ received: true, duplicate: false });
      await act(s, p, 'webhook').expect(200);
      expect((await s.read(p.id)).status).toBe('refunded');
      expect(await moves(p.id)).toEqual(before);
      expect((await events(p.id)).map((e) => e.state)).toEqual([
        'processed',
        'processed',
        'processed',
      ]);
    });
  });

  describe('scripted amounts', () => {
    it('…901: the gateway refuses the charge', async () => {
      const s = createStore(app);
      const res = await s
        .chargeRaw({ method: 'fake_qris', amount: 25_901 })
        .expect(201);
      expect(res.body.status).toBe('failed');
      expect(await bills(s)).toEqual([]);
    });

    it('…902: the gateway is unreachable, the payment fails at once', async () => {
      const s = createStore(app);
      const res = await s
        .chargeRaw({ method: 'fake_va', amount: 25_902 })
        .expect(201);
      expect(res.body.status).toBe('failed');
      expect(await bills(s)).toEqual([]);
    });

    it('…903: the bill exists but the answer was lost; it is found by our reference', async () => {
      const s = createStore(app);
      const res = await s
        .chargeRaw({ method: 'fake_qris', amount: 25_903 })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'pending',
        providerRef: expect.stringMatching(/^FAKE-QR-/),
      });
      expect(await bills(s)).toHaveLength(1);
      await act(s, res.body, 'pay').expect(200);
      expect((await s.read(res.body.id)).status).toBe('paid');
    });

    it('…911: the answer takes a second', async () => {
      const s = createStore(app);
      const started = Date.now();
      const res = await s
        .chargeRaw({ method: 'fake_qris', amount: 25_911 })
        .expect(201);
      expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
      expect(res.body.status).toBe('pending');
    });
  });

  describe('control routes', () => {
    const ROUTES: ['get' | 'post', string][] = [
      ['get', `${GW}/payments`],
      ['post', `${GW}/payments/FAKE-QR-000000000000/pay`],
      ['post', `${GW}/payments/FAKE-QR-000000000000/fail`],
      ['post', `${GW}/payments/FAKE-QR-000000000000/expire`],
      ['post', `${GW}/payments/FAKE-QR-000000000000/late-pay`],
      ['post', `${GW}/payments/FAKE-QR-000000000000/webhook`],
      ['post', `${GW}/refunds/${randomUUID()}/succeed`],
      ['post', `${GW}/refunds/${randomUUID()}/fail`],
      ['get', `${GW}/settings`],
      ['post', `${GW}/settings`],
    ];

    it.each(ROUTES)(
      '%s %s needs the service key (401) and then a tenant (400)',
      async (method, url) => {
        for (const key of [null, '', 'x'.repeat(32), `${SERVICE_KEY()}x`]) {
          const req = http()[method](url).set('X-Tenant-Id', randomUUID());
          if (key !== null) req.set('X-Payment-Service-Key', key);
          const res = await req.expect(401);
          expect(res.body.code).toBe('invalid_service_key');
        }
        const res = await http()
          [method](url)
          .set('X-Payment-Service-Key', SERVICE_KEY())
          .expect(400);
        expect(res.body.code).toBe('tenant_required');
      },
    );

    it('an unknown bill or refund answers 404', async () => {
      const s = createStore(app);
      for (const [, url] of ROUTES.slice(1, 8)) {
        const res = await s.post(url).expect(404);
        expect(res.body).toEqual({ message: 'Not found', code: 'not_found' });
      }
    });

    it('a bad body answers 422 and changes nothing', async () => {
      const s = createStore(app);
      const p = await bill(s);
      for (const body of [
        { amount: 10.5 },
        { amount: '25000' },
        { amount: -1 },
        { webhook: 'later' },
      ]) {
        const res = await act(s, p, 'pay', body).expect(422);
        expect(Object.keys(res.body.errors)).toHaveLength(1);
      }
      await s.post(`${GW}/settings`, { refundMode: 'maybe' }).expect(422);
      await s.post(`${GW}/settings`, {}).expect(422);
      expect(await billOf(s, p)).toMatchObject({
        status: 'pending',
        receipts: [],
      });
    });

    it("cross-tenant: store B cannot see or touch store A's bills and refunds", async () => {
      const a = createStore(app);
      const b = createStore(app);
      const open = await bill(a);
      const refunded = await bill(a);
      await act(a, refunded, 'pay').expect(200);
      await a.post(`/payments/${refunded.id}/refund`, CANCEL).expect(200);
      const [held] = (await billOf(a, refunded)).refunds;

      expect(await bills(b)).toEqual([]);
      for (const action of ['pay', 'fail', 'expire', 'late-pay', 'webhook']) {
        const res = await act(b, open, action).expect(404);
        expect(res.body.code).toBe('not_found');
      }
      for (const result of ['succeed', 'fail'])
        await b.post(`${GW}/refunds/${held.id}/${result}`).expect(404);

      // Nothing moved for store A.
      expect(await billOf(a, open)).toMatchObject({
        status: 'pending',
        receipts: [],
      });
      expect((await a.read(open.id)).status).toBe('pending');
      expect((await billOf(a, refunded)).refunds[0].status).toBe('pending');
      expect((await a.read(refunded.id)).status).toBe('refund_pending');
      expect(await events(open.id)).toEqual([]);
    });
  });

  describe('production', () => {
    const nodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = nodeEnv;
    });

    it('the app does not boot with the fake gateway listed', async () => {
      process.env.NODE_ENV = 'production';
      await expect(
        Test.createTestingModule({ imports: [AppModule] }).compile(),
      ).rejects.toThrow(/PAYMENT_ADAPTERS|never loads in production/);
    });

    it('outside production the app registered the gateway, because it is listed', () => {
      expect(app.get(LocalFakeGateway)).toBeInstanceOf(LocalFakeGateway);
    });
  });
});
