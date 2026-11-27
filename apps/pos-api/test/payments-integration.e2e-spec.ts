import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PaymentSync } from '../src/payments-client/payment-sync.service';
import {
  PAYMENT_FETCH,
  PaymentApiError,
  PaymentsClient,
} from '../src/payments-client/payments.client';
import { ADMIN_DATABASE_URL } from './support/env';
import { syncWorkLeft } from './support/sync-work';
import { createStore } from './support/fixtures';
import { PaymentApi, startPaymentApi } from './support/payment-api';

type Store = Awaited<ReturnType<typeof createStore>>;
type PaymentRow = {
  id: string;
  tenant_id: string;
  order_ref: string;
  idempotency_key: string;
  method: string;
  amount: string;
  status: string;
};

const OWNER_PIN = '482913';
const MINUTES = 60_000;
const jakartaDay = (days = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * pos-api against the REAL payment-api app (UMK-1991), each on its own database. The link between them is
 * a switch the test turns: `ok`, `down` (the request never leaves), `lost` (payment-api did the work, the
 * answer never came back).
 */
describe('pos-api with payment-api on (UMK-1991)', () => {
  let pay: PaymentApi;
  let app: INestApplication;
  let sync: PaymentSync;
  let client: PaymentsClient;
  // `late`: a charge leaves pos-api, times out there, and reaches payment-api only when the test lets it.
  let link: 'ok' | 'down' | 'lost' | 'late' = 'ok';
  let calls = 0;
  let held: (() => Promise<Response>)[] = [];
  const tenants: string[] = [];
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());

  const fakeFetch = async (url: string, init: RequestInit) => {
    calls += 1;
    if (link === 'down') throw new TypeError('fetch failed');
    if (
      link === 'late' &&
      init.method === 'POST' &&
      url.endsWith('/payments')
    ) {
      held.push(() => fetch(url, { ...init, signal: undefined }));
      throw new DOMException('The operation timed out', 'TimeoutError');
    }
    const res = await fetch(url, init);
    if (link === 'lost') {
      await res.arrayBuffer();
      throw new DOMException('The operation timed out', 'TimeoutError');
    }
    return res;
  };

  async function posApp(env: Record<string, string>) {
    const saved = Object.fromEntries(
      Object.keys(env).map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, env);
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PAYMENT_FETCH)
        .useValue(fakeFetch)
        .compile();
      const a = moduleRef.createNestApplication();
      try {
        await a.init();
      } catch (error) {
        await moduleRef.close(); // a refused boot must not leave its database pool open
        throw error;
      }
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
      // No timer: each test runs the job itself, with the time it wants.
      POS_PAYMENT_RECONCILE_INTERVAL_SECONDS: '0',
      POS_PAYMENT_SYNC_MAX_ATTEMPTS: '2',
    });
    sync = app.get(PaymentSync);
    client = app.get(PaymentsClient);
  }, 60_000);
  afterAll(async () => {
    // The balance check over every store of this file: pos-api and payment-api agree on every sale.
    link = 'ok';
    await sync.tick(later());
    const all = await admin<
      { id: string; status: string; payment_id: string | null }[]
    >`select id, status, payment_id from pos.sales where tenant_id in ${admin(tenants)}`;
    const payments = await pay.sql<PaymentRow[]>`
      select id, tenant_id, order_ref, idempotency_key, method, amount, status
      from payment.payments where tenant_id in ${pay.sql(tenants)}`;
    const statusOf = new Map(payments.map((p) => [p.id, p.status]));
    const paidOrders = payments
      .filter((p) => p.status === 'paid' && !p.order_ref.includes(':'))
      .map((p) => p.order_ref)
      .sort();
    // No sale is left waiting (a later suite boots with payment-api off, which refuses that).
    expect(all.filter((x) => x.status === 'awaiting_payment')).toEqual([]);
    // Nor anything else for the job, which sweeps every store: see syncWorkLeft.
    expect(await syncWorkLeft(admin, tenants)).toEqual([]);
    // Paid payments of sales = completed sales, one to one; a cancelled sale never has a paid payment.
    expect(paidOrders).toEqual(
      all
        .filter((x) => x.status === 'completed' && x.payment_id)
        .map((x) => x.id)
        .sort(),
    );
    for (const x of all) {
      const st = x.payment_id ? statusOf.get(x.payment_id) : undefined;
      if (x.status === 'completed' && x.payment_id) expect(st).toBe('paid');
      if (x.status === 'void' && x.payment_id) expect(st).toBe('voided');
      if (x.status === 'cancelled') expect(st).not.toBe('paid');
    }
    await app.close();
    await pay.close();
    await admin.end();
  });
  beforeEach(() => {
    link = 'ok';
    held = [];
  });

  const post = (auth: string, url: string, body: object = {}, key?: string) => {
    const req = http().post(url).set('Authorization', auth);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);

  /** A store with one product (Rp5.123, so a cash total is rounded), stock 20, an open shift and the owner's void PIN. */
  async function shop(price = 5123) {
    const s = await createStore();
    tenants.push(s.tenantId);
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Es Teh Manis',
      costPrice: 2000,
      sellingPrice: price,
    }).expect(201);
    const productId = p.body.id as string;
    await post(s.auth, '/stock/opening', { productId, qty: 20 }).expect(201);
    await post(s.auth, '/shifts/open', { openingCash: 100_000 }).expect(201);
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: OWNER_PIN })
      .expect(200);
    return { ...s, productId };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  const sell = (s: Shop, body: object = {}, key: string = randomUUID()) =>
    post(
      s.auth,
      '/sales',
      { lines: [{ productId: s.productId, qty: 1 }], paid: 10_000, ...body },
      key,
    );
  const voidSale = (s: Store, saleId: string, key: string = randomUUID()) =>
    post(
      s.auth,
      `/sales/${saleId}/void`,
      {
        reasonCode: 'customer_cancelled',
        approverId: s.userId,
        pin: OWNER_PIN,
      },
      key,
    );
  const method = async (s: Store, name: string, kind: string) =>
    (await post(s.auth, '/payment-methods', { name, kind }).expect(201)).body
      .id as string;
  const onHand = async (s: Shop) =>
    (await get(s.auth, `/stock/products/${s.productId}`).expect(200)).body
      .onHand as number;
  const shift = async (s: Store) =>
    (await get(s.auth, '/shifts/current').expect(200)).body.shift as {
      cashSales: number;
      salesCount: number;
      expectedCash: number;
    };
  const saleRow = async (id: string) =>
    (
      await admin<
        {
          status: string;
          payment_id: string | null;
          number: number | null;
          hold_number: number | null;
        }[]
      >`select status, payment_id, number, hold_number from pos.sales where id = ${id}`
    )[0];
  const paymentsOf = (tenantId: string) =>
    pay.sql<PaymentRow[]>`
      select id, tenant_id, order_ref, idempotency_key, method, amount, status
      from payment.payments where tenant_id = ${tenantId} order by created_at, id`;
  const eventsOf = (paymentId: string) =>
    pay.sql<
      {
        to_status: string;
        actor_ref: string;
        approved_by: string | null;
        reason_code: string | null;
      }[]
    >`select to_status, actor_ref, approved_by, reason_code from payment.payment_events
      where payment_id = ${paymentId} order by created_at, id`;
  const later = () => new Date(Date.now() + 3 * MINUTES);

  describe('sale in two steps', () => {
    it('D1 D2 a cash sale creates one paid payment for the rounded amount due; a retry creates no second one', async () => {
      const s = await shop();
      const key = randomUUID();
      const res = await sell(s, {}, key).expect(201);
      // Rp5.123 in cash is rounded up to Rp5.200 (UMK-1993).
      expect(res.body).toMatchObject({
        status: 'completed',
        total: 5123,
        rounding: 77,
        amountDue: 5200,
        change: 4800,
      });
      const [payment, ...more] = await paymentsOf(s.tenantId);
      expect(more).toEqual([]);
      expect(payment).toMatchObject({
        order_ref: res.body.id,
        idempotency_key: `${res.body.id}:1`,
        method: 'cash',
        amount: '5200',
        status: 'paid',
      });
      expect(await saleRow(res.body.id)).toMatchObject({
        status: 'completed',
        payment_id: payment.id,
      });
      const [charged] = await eventsOf(payment.id);
      expect(charged.actor_ref).toBe(`owner:${s.userId}`);

      const again = await sell(s, {}, key).expect(201);
      expect(again.body.id).toBe(res.body.id);
      expect(await paymentsOf(s.tenantId)).toHaveLength(1);
      expect(await onHand(s)).toBe(19);
      expect(await shift(s)).toMatchObject({ cashSales: 5200, salesCount: 1 });
    });

    it("UMK-1981: an agent's sale goes through payment-api like the till's, with actor agent:<owner id>", async () => {
      const s = await shop();
      const session = await http()
        .post('/auth/dev/agent-session')
        .send({ userId: s.userId, scopes: ['pos.read', 'pos.write'] })
        .expect(200);
      const res = await sell(
        { ...s, auth: `Bearer ${session.body.sessionToken}` },
        { paid: 5200 },
      ).expect(201);
      expect(res.body).toMatchObject({ status: 'completed', amountDue: 5200 });
      const [payment] = await paymentsOf(s.tenantId);
      expect(payment).toMatchObject({
        method: 'cash',
        amount: '5200',
        status: 'paid',
      });
      const [charged] = await eventsOf(payment.id);
      expect(charged.actor_ref).toBe(`agent:${s.userId}`);
    });

    it('two requests with the same key at once make one sale and one payment (D1)', async () => {
      const s = await shop();
      const key = randomUUID();
      const [a, b] = await Promise.all([sell(s, {}, key), sell(s, {}, key)]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(await paymentsOf(s.tenantId)).toHaveLength(1);
      expect(await onHand(s)).toBe(19);
    });

    it('debit is charged as edc_debit and wallet as static_qris, for the exact total', async () => {
      const s = await shop();
      const debit = await method(s, 'Debit BCA', 'debit');
      const wallet = await method(s, 'QRIS Toko', 'wallet');
      await sell(s, { paymentMethodId: debit, paid: 5123 }).expect(201);
      await sell(s, { paymentMethodId: wallet, paid: 5123 }).expect(201);
      expect(
        (await paymentsOf(s.tenantId)).map((p) => [
          p.method,
          p.amount,
          p.status,
        ]),
      ).toEqual([
        ['edc_debit', '5123', 'paid'],
        ['static_qris', '5123', 'paid'],
      ]);
      // Non-cash money is in no drawer.
      expect(await shift(s)).toMatchObject({ cashSales: 0, salesCount: 2 });
    });
  });

  describe('service to service', () => {
    it('takes the tenant from the session only: a client X-Tenant-Id is ignored and a tenantId in the body is 422', async () => {
      const a = await shop();
      const b = await shop();
      const res = await http()
        .post('/sales')
        .set('Authorization', a.auth)
        .set('Idempotency-Key', randomUUID())
        .set('X-Tenant-Id', b.tenantId)
        .send({ lines: [{ productId: a.productId, qty: 1 }], paid: 10_000 })
        .expect(201);
      const [payment] = await paymentsOf(a.tenantId);
      expect(payment).toMatchObject({
        tenant_id: a.tenantId,
        order_ref: res.body.id,
      });
      expect(await paymentsOf(b.tenantId)).toEqual([]);

      await sell(a, { tenantId: b.tenantId }).expect(422);
      expect(await paymentsOf(a.tenantId)).toHaveLength(1);
      expect(await paymentsOf(b.tenantId)).toEqual([]);
    });

    it('needs the service key: with a wrong key payment-api refuses, the sale awaits payment and no payment exists (M12 retry completes it)', async () => {
      const wrong = await posApp({
        PAYMENT_API_URL: pay.url,
        PAYMENT_SERVICE_KEY: 'not-the-service-key-0000',
        POS_PAYMENT_RECONCILE_INTERVAL_SECONDS: '0',
      });
      try {
        const s = await shop();
        const key = randomUUID();
        const body = {
          lines: [{ productId: s.productId, qty: 1 }],
          paid: 6000,
        };
        const refused = await request(wrong.getHttpServer())
          .post('/sales')
          .set('Authorization', s.auth)
          .set('Idempotency-Key', key)
          .send(body)
          .expect(503);
        expect(refused.body.status).toBe('awaiting_payment');
        expect(await paymentsOf(s.tenantId)).toEqual([]);
        expect(await saleRow(refused.body.saleId)).toMatchObject({
          status: 'awaiting_payment',
          payment_id: null,
        });
        // The same request through the app that holds the right key completes the same sale.
        const done = await post(s.auth, '/sales', body, key).expect(201);
        expect(done.body.id).toBe(refused.body.saleId);
        expect(await paymentsOf(s.tenantId)).toHaveLength(1);
      } finally {
        await wrong.close();
      }
    });

    it('cross-tenant: store B cannot void store A’s sale or read its payment; A’s payment stays paid', async () => {
      const a = await shop();
      const b = await shop();
      const sale = await sell(a).expect(201);
      await sell(b).expect(201);
      await voidSale(b, sale.body.id).expect(404);
      await get(b.auth, `/sales/${sale.body.id}`).expect(404);
      const [payment] = await paymentsOf(a.tenantId);
      expect(payment.status).toBe('paid');
      await expect(client.get(b.tenantId, payment.id)).rejects.toMatchObject({
        kind: 'rejected',
        status: 404,
      });
      await expect(
        client.void(b.tenantId, payment.id, {
          reasonCode: 'customer_cancelled',
          actorRef: 'owner:x',
          approvedBy: 'owner:x',
        }),
      ).rejects.toBeInstanceOf(PaymentApiError);
      expect((await paymentsOf(a.tenantId))[0].status).toBe('paid');
      expect((await paymentsOf(b.tenantId)).map((p) => p.tenant_id)).toEqual([
        b.tenantId,
      ]);
    });
  });

  describe('payment-api down, and the job', () => {
    it('M17 payment-api down: 503, the sale awaits payment with stock and voucher taken, is in no list or shift total, and the shift cannot close', async () => {
      const s = await shop();
      const v = await post(s.auth, '/vouchers', {
        name: 'Hemat',
        code: `V${Math.random().toString(36).slice(2, 8)}`,
        type: 'percentage',
        nominal: 10,
        kuota: 5,
        startDate: jakartaDay(-1),
        expired: jakartaDay(1),
      }).expect(201);
      const quota = async () =>
        (
          await admin<
            { kuota: number }[]
          >`select kuota from pos.vouchers where id = ${v.body.id}`
        )[0].kuota;
      link = 'down';
      const key = randomUUID();
      const res = await sell(s, { voucherCode: v.body.code }, key).expect(503);
      const saleId = res.body.saleId as string;
      const row = await saleRow(saleId);
      expect(row.status).toBe('awaiting_payment');
      expect(await paymentsOf(s.tenantId)).toEqual([]);
      // Held for the waiting sale, so nobody else is sold the same goods.
      expect(await onHand(s)).toBe(19);
      expect(await quota()).toBe(4);
      // Not a receipt yet.
      const list = await get(s.auth, '/sales').expect(200);
      expect(list.body.total).toBe(0);
      expect(list.body.summary.revenue).toBe(0);
      expect(await shift(s)).toMatchObject({
        cashSales: 0,
        salesCount: 0,
        expectedCash: 100_000,
      });
      const waiting = await get(
        s.auth,
        '/sales?status=awaiting_payment',
      ).expect(200);
      expect((waiting.body.data as { id: string }[]).map((x) => x.id)).toEqual([
        saleId,
      ]);
      const range = `from=${jakartaDay(-1)}&to=${jakartaDay(1)}`;
      const report = await get(s.auth, `/reports/sales?${range}`).expect(200);
      expect(report.body.rows).toEqual([]);
      expect(report.body.totals.revenue).toBe(0);
      const shifts = await get(s.auth, `/reports/shifts?${range}`).expect(200);
      expect(shifts.body.rows[0]).toMatchObject({ salesCount: 0, revenue: 0 });
      const close = await post(s.auth, '/shifts/current/close', {
        countedCash: 100_000,
      }).expect(409);
      // UMK-2038: a waiting sale has no receipt number; it is named by its hold number.
      expect(row.number).toBeNull();
      expect(close.body.message).toContain(`#${row.hold_number}`);
      // Not voidable: it was never a receipt.
      await voidSale(s, saleId).expect(409);

      // While payment-api stays down the job concludes nothing, however long the sale has waited.
      const before0 = calls;
      expect(await sync.tick(later())).toMatchObject({
        cancelled: 0,
        completed: 0,
        stopped: true,
      });
      // The tick stops at the first unanswered call instead of waiting on every row.
      expect(calls).toBe(before0 + 1);
      expect((await saleRow(saleId)).status).toBe('awaiting_payment');

      // Back up, and no payment was ever made. A young sale is left alone (the cashier may still retry).
      link = 'ok';
      expect(await sync.tick()).toMatchObject({ cancelled: 0, completed: 0 });
      expect((await saleRow(saleId)).status).toBe('awaiting_payment');
      expect(await paymentsOf(s.tenantId)).toEqual([]);
      // After the waiting time the job closes the charge key at payment-api, and cancels on that answer.
      expect(await sync.tick(later())).toMatchObject({ cancelled: 1 });
      const [closed, ...none] = await paymentsOf(s.tenantId);
      expect(none).toEqual([]);
      expect(closed).toMatchObject({
        order_ref: saleId,
        idempotency_key: `${saleId}:1`,
        status: 'cancelled',
      });
      expect(await saleRow(saleId)).toMatchObject({
        status: 'cancelled',
        payment_id: closed.id,
      });
      expect(await onHand(s)).toBe(20);
      expect(await quota()).toBe(5);

      // M16: a cancelled sale is never completed, and a retry of its request charges nothing.
      const before = calls;
      const retry = await sell(s, { voucherCode: v.body.code }, key).expect(
        409,
      );
      expect(retry.body.status).toBe('cancelled');
      expect(await sync.settleSale(s.tenantId, saleId, 'charge')).toBe(
        'cancelled',
      );
      expect(calls).toBe(before);
      expect((await paymentsOf(s.tenantId)).map((p) => p.status)).toEqual([
        'cancelled',
      ]);
      expect(await onHand(s)).toBe(20);
      await post(s.auth, '/shifts/current/close', {
        countedCash: 100_000,
      }).expect(200);
    });

    it('M4 M15 D8 the charge succeeded but pos-api did not finish: the job completes the sale once, with no void', async () => {
      const s = await shop();
      link = 'lost';
      const res = await sell(s).expect(503);
      const saleId = res.body.saleId as string;
      link = 'ok';
      expect((await saleRow(saleId)).status).toBe('awaiting_payment');
      const [payment] = await paymentsOf(s.tenantId);
      expect(payment).toMatchObject({ order_ref: saleId, status: 'paid' });

      expect(await sync.tick(later())).toMatchObject({ completed: 1 });
      expect(await saleRow(saleId)).toMatchObject({
        status: 'completed',
        payment_id: payment.id,
      });
      // A second run, and a second notice for the same payment, change nothing.
      expect(await sync.tick(later())).toMatchObject({
        completed: 0,
        cancelled: 0,
        failed: 0,
      });
      expect(await sync.settleSale(s.tenantId, saleId, 'reconcile')).toBe(
        'completed',
      );
      const payments = await paymentsOf(s.tenantId);
      expect(payments.map((p) => p.status)).toEqual(['paid']);
      expect(
        (await eventsOf(payment.id)).map((e) => e.to_status),
      ).not.toContain('voided');
      // One receipt, counted once in the drawer.
      expect((await get(s.auth, '/sales').expect(200)).body.total).toBe(1);
      expect(await shift(s)).toMatchObject({
        cashSales: 5200,
        salesCount: 1,
        expectedCash: 105_200,
      });
      expect(await onHand(s)).toBe(19);
    });

    it('M12 the cashier repeats the request after a lost answer: the same sale completes, one payment', async () => {
      const s = await shop();
      const key = randomUUID();
      link = 'lost';
      const lost = await sell(s, {}, key).expect(503);
      link = 'ok';
      const done = await sell(s, {}, key).expect(201);
      expect(done.body).toMatchObject({
        id: lost.body.saleId,
        status: 'completed',
      });
      expect(await paymentsOf(s.tenantId)).toHaveLength(1);
      expect(await onHand(s)).toBe(19);
    });

    it('B1 a charge that times out at pos-api and reaches payment-api AFTER the job gave the sale up is never paid: no paid payment for a cancelled sale', async () => {
      const s = await shop();
      const key = randomUUID();
      link = 'late';
      const res = await sell(s, {}, key).expect(503);
      const saleId = res.body.saleId as string;
      expect(held).toHaveLength(1);
      link = 'ok';
      expect(await paymentsOf(s.tenantId)).toEqual([]);

      // The job runs first: it closes the key, then cancels the sale.
      expect(await sync.tick(later())).toMatchObject({ cancelled: 1 });
      expect((await saleRow(saleId)).status).toBe('cancelled');
      expect(await onHand(s)).toBe(20);

      // Now the charge that was on its way lands at payment-api.
      const landed = await held[0]();
      expect(landed.status).toBe(200);
      expect(((await landed.json()) as { status: string }).status).toBe(
        'cancelled',
      );
      expect(
        (await paymentsOf(s.tenantId)).map((p) => [p.order_ref, p.status]),
      ).toEqual([[saleId, 'cancelled']]);
      // And the cashier's own retry is told the sale is cancelled; still nothing is paid.
      await sell(s, {}, key).expect(409);
      expect((await paymentsOf(s.tenantId)).map((p) => p.status)).toEqual([
        'cancelled',
      ]);
      expect(await shift(s)).toMatchObject({ cashSales: 0, salesCount: 0 });
    });

    it('B1 the same charge landing BEFORE the job is found paid, and the job completes the sale instead', async () => {
      const s = await shop();
      link = 'late';
      const res = await sell(s).expect(503);
      link = 'ok';
      expect((await held[0]()).status).toBe(201);
      expect(await sync.tick(later())).toMatchObject({
        completed: 1,
        cancelled: 0,
      });
      expect((await saleRow(res.body.saleId)).status).toBe('completed');
      expect((await paymentsOf(s.tenantId)).map((p) => p.status)).toEqual([
        'paid',
      ]);
    });

    it('B1 the close itself is lost on the way back: nothing is cancelled on a guess, and the next tick cancels on the closed payment', async () => {
      const s = await shop();
      link = 'down';
      const res = await sell(s).expect(503);
      const saleId = res.body.saleId as string;
      link = 'lost';
      expect(await sync.tick(later())).toMatchObject({
        cancelled: 0,
        stopped: true,
      });
      expect((await saleRow(saleId)).status).toBe('awaiting_payment');
      expect(await onHand(s)).toBe(19);
      link = 'ok';
      expect(await sync.tick(later())).toMatchObject({ cancelled: 1 });
      expect((await saleRow(saleId)).status).toBe('cancelled');
      expect((await paymentsOf(s.tenantId)).map((p) => p.status)).toEqual([
        'cancelled',
      ]);
    });

    it('the cashier’s retry and the job at the same instant agree: one payment, and the sale is completed exactly when it is paid', async () => {
      for (const first of ['down', 'lost'] as const) {
        for (let i = 0; i < 4; i++) {
          const s = await shop();
          const key = randomUUID();
          link = first;
          const res = await sell(s, {}, key).expect(503);
          const saleId = res.body.saleId as string;
          link = 'ok';
          const [retry] = await Promise.all([
            sell(s, {}, key),
            sync.tick(later()),
            sync.settleSale(s.tenantId, saleId, 'reconcile', later()),
          ]);
          const [payment, ...more] = await paymentsOf(s.tenantId);
          expect(more).toEqual([]);
          const sale = await saleRow(saleId);
          expect(sale.payment_id).toBe(payment.id);
          if (payment.status === 'paid') {
            expect(retry.status).toBe(201);
            expect(sale.status).toBe('completed');
            expect(await onHand(s)).toBe(19);
          } else {
            expect(payment.status).toBe('cancelled');
            expect(retry.status).toBe(409);
            expect(sale.status).toBe('cancelled');
            expect(await onHand(s)).toBe(20);
          }
          // A lost answer means the payment was already paid: it can only complete.
          if (first === 'lost') expect(payment.status).toBe('paid');
        }
      }
    });

    it('one tick handles each store’s rows under that store’s own tenant', async () => {
      const a = await shop();
      const b = await shop();
      link = 'lost';
      const sa = await sell(a).expect(503);
      const sb = await sell(b).expect(503);
      link = 'ok';
      expect(await sync.tick(later())).toMatchObject({ completed: 2 });
      for (const [store, saleId] of [
        [a, sa.body.saleId],
        [b, sb.body.saleId],
      ] as const) {
        const [payment, ...more] = await paymentsOf(store.tenantId);
        expect(more).toEqual([]);
        expect(payment).toMatchObject({
          tenant_id: store.tenantId,
          order_ref: saleId,
          status: 'paid',
        });
        expect(await saleRow(saleId)).toMatchObject({
          status: 'completed',
          payment_id: payment.id,
        });
      }
    });

    it('M4 a payment that does not fit its sale is refused, counted with the row id, parked, shown to the owner, and released by a retry', async () => {
      const s = await shop();
      const other = await shop();
      link = 'lost';
      const res = await sell(s).expect(503);
      const saleId = res.body.saleId as string;
      link = 'ok';
      const [payment] = await paymentsOf(s.tenantId);
      // payment-api holds another amount than the sale owes (a restore, a bug): never completed on it.
      await pay.sql`update payment.payments set amount = amount + 100 where id = ${payment.id}`;
      const issues = async (auth = s.auth) =>
        (await get(auth, '/payment-sync/issues').expect(200)).body.data as {
          id: string;
          kind: string;
          refId: string;
          attempts: number;
          lastError: string;
          parkedAt: string | null;
        }[];

      expect(await sync.tick(later())).toMatchObject({
        completed: 0,
        failed: 1,
      });
      expect((await saleRow(saleId)).status).toBe('awaiting_payment');
      expect(await issues()).toMatchObject([
        {
          kind: 'sale',
          refId: saleId,
          attempts: 1,
          lastError: 'payment_mismatch',
          parkedAt: null,
        },
      ]);
      // The cashier's retry is refused too, with its own message, and changes nothing.
      const retry = await post(
        s.auth,
        '/sales',
        { lines: [{ productId: s.productId, qty: 1 }], paid: 10_000 },
        (
          await admin<
            { k: string }[]
          >`select idempotency_key as k from pos.sales where id = ${saleId}`
        )[0].k,
      ).expect(503);
      expect(retry.body.message).toContain('belum bisa dicatat');

      // Second refusal (the limit in this suite): parked, and no longer swept.
      expect(await sync.tick(later())).toMatchObject({ failed: 1 });
      const [parked] = await issues();
      expect(parked).toMatchObject({ attempts: 2 });
      expect(parked.parkedAt).not.toBeNull();
      const before = calls;
      expect(await sync.tick(later())).toMatchObject({
        failed: 0,
        completed: 0,
      });
      expect(calls).toBe(before);

      // Another store sees nothing of it and cannot release it.
      expect(await issues(other.auth)).toEqual([]);
      await post(other.auth, `/payment-sync/issues/${parked.id}/retry`).expect(
        404,
      );
      expect(await issues()).toHaveLength(1);

      // Put right, then released by the owner: the job completes the sale and the issue is gone.
      await pay.sql`update payment.payments set amount = amount - 100 where id = ${payment.id}`;
      await post(s.auth, `/payment-sync/issues/${parked.id}/retry`).expect(200);
      expect(await sync.tick(later())).toMatchObject({
        completed: 1,
        failed: 0,
      });
      expect((await saleRow(saleId)).status).toBe('completed');
      expect(await issues()).toEqual([]);
    });

    it('M3 pos-api refuses to start with payment-api off while a sale still awaits payment', async () => {
      const s = await shop();
      link = 'down';
      const res = await sell(s).expect(503);
      await expect(posApp({ PAYMENT_API_URL: '' })).rejects.toThrow(
        /still await payment/,
      );
      link = 'ok';
      expect(await sync.tick(later())).toMatchObject({ cancelled: 1 });
      expect((await saleRow(res.body.saleId)).status).toBe('cancelled');
    });

    it('M1 the timer runs the job, stops with the app, and a tick never rejects when the database is gone', async () => {
      const timed = await posApp({
        PAYMENT_API_URL: pay.url,
        PAYMENT_SERVICE_KEY: pay.serviceKey,
        PAYMENT_API_TIMEOUT_MS: '500',
        POS_PAYMENT_RECONCILE_AFTER_SECONDS: '1',
        POS_PAYMENT_RECONCILE_INTERVAL_SECONDS: '1',
      });
      const s = await shop();
      link = 'lost';
      const res = await sell(s).expect(503);
      link = 'ok';
      const saleId = res.body.saleId as string;
      for (let i = 0; i < 40; i++) {
        if ((await saleRow(saleId)).status === 'completed') break;
        await new Promise((r) => setTimeout(r, 250));
      }
      expect((await saleRow(saleId)).status).toBe('completed');
      const timedSync = timed.get(PaymentSync);
      await timed.close();
      // Pool closed: every sweep fails, the tick still resolves.
      await expect(timedSync.tick()).resolves.toMatchObject({
        completed: 0,
        failed: 5, // one per sweep: sales, kasbon payments, kasbon corrections, voids, pending refunds
      });
    }, 30_000);

    it('the job fails a sale whose payment closed unpaid: cancelled, stock back, never completed (M16)', async () => {
      const s = await shop();
      link = 'lost';
      const res = await sell(s).expect(503);
      const saleId = res.body.saleId as string;
      link = 'ok';
      const [payment] = await paymentsOf(s.tenantId);
      // The payment is closed in payment-api before pos-api ever completed the sale.
      await client.void(s.tenantId, payment.id, {
        reasonCode: 'customer_cancelled',
        actorRef: `owner:${s.userId}`,
        approvedBy: `owner:${s.userId}`,
      });
      expect(await sync.tick(later())).toMatchObject({
        cancelled: 1,
        completed: 0,
      });
      expect((await saleRow(saleId)).status).toBe('cancelled');
      expect(await onHand(s)).toBe(20);
      expect(await shift(s)).toMatchObject({ cashSales: 0, salesCount: 0 });
      expect(await sync.settleSale(s.tenantId, saleId, 'charge')).toBe(
        'cancelled',
      );
    });
  });

  describe('void', () => {
    it('V1 a void voids the payment with the reason, the actor and the PIN-verified approver; a repeat changes nothing', async () => {
      const s = await shop();
      const sale = await sell(s).expect(201);
      const key = randomUUID();
      await voidSale(s, sale.body.id, key).expect(201);
      const [payment] = await paymentsOf(s.tenantId);
      expect(payment.status).toBe('voided');
      const events = await eventsOf(payment.id);
      expect(events.map((e) => e.to_status)).toEqual([
        'created',
        'paid',
        'voided',
      ]);
      expect(events[2]).toMatchObject({
        actor_ref: `owner:${s.userId}`,
        approved_by: `owner:${s.userId}`,
        reason_code: 'customer_cancelled',
      });
      await voidSale(s, sale.body.id, key).expect(201);
      await voidSale(s, sale.body.id).expect(409);
      expect(await sync.tick()).toMatchObject({ voided: 0, failed: 0 });
      expect(await eventsOf(payment.id)).toHaveLength(3);
      expect(await onHand(s)).toBe(20);
    });

    it('a void while payment-api is down succeeds in pos-api and the job voids the payment later', async () => {
      const s = await shop();
      const sale = await sell(s).expect(201);
      link = 'down';
      await voidSale(s, sale.body.id).expect(201);
      expect((await saleRow(sale.body.id)).status).toBe('void');
      expect((await paymentsOf(s.tenantId))[0].status).toBe('paid');
      expect(await sync.tick()).toMatchObject({ voided: 0, stopped: true });
      link = 'ok';
      expect(await sync.tick()).toMatchObject({ voided: 1, failed: 0 });
      expect((await paymentsOf(s.tenantId))[0].status).toBe('voided');
      expect(await sync.tick()).toMatchObject({ voided: 0 });
    });
  });

  describe('kasbon', () => {
    async function kasbonSale(s: Shop, paid: number) {
      const kasbon = await method(s, 'Kasbon', 'credit');
      const member = await post(s.auth, '/members', {
        name: 'Bu Sari',
        code: `M${Math.random().toString(36).slice(2, 8)}`,
      }).expect(201);
      const sale = await sell(s, {
        paymentMethodId: kasbon,
        memberId: member.body.id,
        paid,
      }).expect(201);
      return {
        saleId: sale.body.id as string,
        receivableId: sale.body.receivableId as string,
      };
    }
    const pairs = async (s: Store) =>
      (await paymentsOf(s.tenantId)).map((p) => [
        p.order_ref,
        p.amount,
        p.method,
        p.status,
      ]);

    it('M22 V7 a kasbon sale makes no payment for the sale; the down payment and each instalment are payments <receivableId>:<n>; the void voids them', async () => {
      const s = await shop(6000);
      const k = await kasbonSale(s, 2500);
      expect((await saleRow(k.saleId)).status).toBe('completed');
      expect(await pairs(s)).toEqual([
        [`${k.receivableId}:1`, '2500', 'cash', 'paid'],
      ]);
      const key = randomUUID();
      await post(
        s.auth,
        `/receivables/${k.receivableId}/payments`,
        { amount: 1000 },
        key,
      ).expect(201);
      // A repeated request takes no second instalment and makes no second payment.
      await post(
        s.auth,
        `/receivables/${k.receivableId}/payments`,
        { amount: 1000 },
        key,
      ).expect(201);
      expect(await pairs(s)).toEqual([
        [`${k.receivableId}:1`, '2500', 'cash', 'paid'],
        [`${k.receivableId}:2`, '1000', 'cash', 'paid'],
      ]);

      await voidSale(s, k.saleId).expect(201);
      expect((await pairs(s)).map((p) => p[3])).toEqual(['voided', 'voided']);
    });

    it('a kasbon with no down payment makes no payment at all', async () => {
      const s = await shop(6000);
      await kasbonSale(s, 0);
      expect(await paymentsOf(s.tenantId)).toEqual([]);
    });

    it('an instalment taken while payment-api is down is kept and recorded by the job; a void before that records and voids it', async () => {
      const s = await shop(6000);
      const k = await kasbonSale(s, 0);
      link = 'down';
      await post(
        s.auth,
        `/receivables/${k.receivableId}/payments`,
        { amount: 1500 },
        randomUUID(),
      ).expect(201);
      expect(await paymentsOf(s.tenantId)).toEqual([]);
      expect(await sync.tick()).toMatchObject({ recorded: 0, stopped: true });
      link = 'ok';
      expect(await sync.tick()).toMatchObject({ recorded: 1, failed: 0 });
      expect(await pairs(s)).toEqual([
        [`${k.receivableId}:1`, '1500', 'cash', 'paid'],
      ]);
      expect(await sync.tick()).toMatchObject({ recorded: 0 });

      link = 'down';
      await post(
        s.auth,
        `/receivables/${k.receivableId}/payments`,
        { amount: 500 },
        randomUUID(),
      ).expect(201);
      await voidSale(s, k.saleId).expect(201);
      link = 'ok';
      expect(await sync.tick()).toMatchObject({ voided: 1, failed: 0 });
      expect(await pairs(s)).toEqual([
        [`${k.receivableId}:1`, '1500', 'cash', 'voided'],
        [`${k.receivableId}:2`, '500', 'cash', 'voided'],
      ]);
      expect(await sync.tick()).toMatchObject({ recorded: 0, voided: 0 });
    });
  });

  describe('kasbon correction (UMK-1971)', () => {
    it('voids the corrected payment with the reason, the actor and the PIN approver, and records the new one as <receivableId>:<n>; a repeat sends nothing new', async () => {
      const s = await shop(6000);
      const kasbon = await method(s, 'Kasbon', 'credit');
      const member = await post(s.auth, '/members', {
        name: 'Siti',
        code: `M${Math.random().toString(36).slice(2, 8)}`,
      }).expect(201);
      const sale = await sell(s, {
        paymentMethodId: kasbon,
        memberId: member.body.id,
        paid: 0,
      }).expect(201);
      const rid = sale.body.receivableId as string;
      const paid = await post(
        s.auth,
        `/receivables/${rid}/payments`,
        { amount: 2500 },
        randomUUID(),
      ).expect(201);
      const old = paid.body.payments[0].id as string;
      const key = randomUUID();
      const correct = () =>
        post(
          s.auth,
          `/receivables/${rid}/payments/${old}/correction`,
          {
            replacement: { amount: 3000 },
            reasonCode: 'wrong_amount',
            approverId: s.userId,
            pin: OWNER_PIN,
          },
          key,
        );
      const done = await correct().expect(201);
      expect(done.body.correction).toMatchObject({
        oldAmount: 2500,
        newAmount: 3000,
        restAfter: 3000,
      });
      const rows = (await paymentsOf(s.tenantId)).map((p) => [
        p.order_ref,
        p.amount,
        p.status,
      ]);
      expect(rows).toEqual([
        [`${rid}:1`, '2500', 'voided'],
        [`${rid}:2`, '3000', 'paid'],
      ]);
      const voidedId = (await paymentsOf(s.tenantId))[0].id;
      expect((await eventsOf(voidedId))[2]).toMatchObject({
        to_status: 'voided',
        actor_ref: `owner:${s.userId}`,
        approved_by: `owner:${s.userId}`,
        reason_code: 'other',
      });
      await correct().expect(201);
      expect(await sync.tick()).toMatchObject({
        recorded: 0,
        reversed: 0,
        failed: 0,
      });
      expect(await paymentsOf(s.tenantId)).toHaveLength(2);
      expect(await eventsOf(voidedId)).toHaveLength(3);
    });

    it('a correction while payment-api is down is kept and the job voids the old payment and records the new one', async () => {
      const s = await shop(6000);
      const kasbon = await method(s, 'Kasbon', 'credit');
      const member = await post(s.auth, '/members', {
        name: 'Siti',
        code: `M${Math.random().toString(36).slice(2, 8)}`,
      }).expect(201);
      const sale = await sell(s, {
        paymentMethodId: kasbon,
        memberId: member.body.id,
        paid: 0,
      }).expect(201);
      const rid = sale.body.receivableId as string;
      link = 'down';
      const paid = await post(
        s.auth,
        `/receivables/${rid}/payments`,
        { amount: 1000 },
        randomUUID(),
      ).expect(201);
      await post(
        s.auth,
        `/receivables/${rid}/payments/${paid.body.payments[0].id}/correction`,
        {
          replacement: null,
          reasonCode: 'duplicate',
          approverId: s.userId,
          pin: OWNER_PIN,
        },
        randomUUID(),
      ).expect(201);
      expect(await paymentsOf(s.tenantId)).toEqual([]);
      link = 'ok';
      expect(await sync.tick()).toMatchObject({
        recorded: 1,
        reversed: 1,
        failed: 0,
      });
      const [p] = await paymentsOf(s.tenantId);
      expect([p.order_ref, p.amount, p.status]).toEqual([
        `${rid}:1`,
        '1000',
        'voided',
      ]);
      expect((await eventsOf(p.id))[2].reason_code).toBe(
        'duplicate_transaction',
      );
      expect(await sync.tick()).toMatchObject({ recorded: 0, reversed: 0 });
    });
  });

  describe('store purge', () => {
    const purge = (userId: string) =>
      http()
        .post('/internal/tenants/purge')
        .set('x-pos-service-key', process.env.POS_SERVICE_KEY!)
        .send({ userId });
    const markForDeletion = (userId: string) =>
      admin`update public.users set delete_status_flag = 'to_delete',
        delete_date = now() - make_interval(days => 31) where id = ${userId}`;
    const paymentRows = async (tenantId: string) => {
      const tables = await pay.sql<{ name: string }[]>`
        select c.relname as name from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'payment' and c.relkind = 'r' and a.attname = 'tenant_id'`;
      let total = 0;
      for (const t of tables) {
        const [{ n }] = await pay.sql.unsafe<{ n: number }[]>(
          `select count(*)::int as n from payment."${t.name}" where tenant_id = $1`,
          [tenantId],
        );
        total += n;
      }
      return total;
    };

    it('also removes the store’s rows in the payment-api database, and leaves another store’s', async () => {
      const a = await shop();
      const b = await shop();
      const sale = await sell(a).expect(201);
      await voidSale(a, sale.body.id).expect(201);
      await sell(a).expect(201);
      await sell(b).expect(201);
      expect(await paymentRows(a.tenantId)).toBeGreaterThan(3);
      const others = await paymentRows(b.tenantId);
      await markForDeletion(a.userId);

      // payment-api down: nothing is purged anywhere, UMKMall is told to retry.
      link = 'down';
      await purge(a.userId).expect(503);
      link = 'ok';
      const [{ n }] = await admin<{ n: number }[]>`
        select count(*)::int as n from pos.sales where tenant_id = ${a.tenantId}`;
      expect(n).toBe(2);
      expect(await paymentRows(a.tenantId)).toBeGreaterThan(3);

      expect((await purge(a.userId).expect(200)).body).toEqual({
        purged: true,
      });
      expect(await paymentRows(a.tenantId)).toBe(0);
      expect(await paymentRows(b.tenantId)).toBe(others);
      const [gone] = await admin<{ n: number }[]>`
        select count(*)::int as n from pos.tenants where id = ${a.tenantId}`;
      expect(gone.n).toBe(0);
    });
  });
});
