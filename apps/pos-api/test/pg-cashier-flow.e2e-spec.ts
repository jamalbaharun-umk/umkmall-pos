import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PaymentSync } from '../src/payments-client/payment-sync.service';
import { PAYMENT_FETCH } from '../src/payments-client/payments.client';
import { seedMerchant } from '../../payment-api/test/support/merchants';
import { ADMIN_DATABASE_URL } from './support/env';
import { createStore } from './support/fixtures';
import { PaymentApi, startPaymentApi } from './support/payment-api';
import { createCashier } from './support/staff';
import { syncWorkLeft } from './support/sync-work';

type Store = Awaited<ReturnType<typeof createStore>>;
type PaymentRow = {
  id: string;
  order_ref: string;
  idempotency_key: string;
  method: string;
  amount: string;
  status: string;
  refund_key: string | null;
};
type Bill = {
  providerRef: string;
  orderRef: string;
  status: string;
  refunds: { id: string; status: string }[];
};

const OWNER_PIN = '482913';
const MINUTES = 60_000;
const PRICE = 5123;
const jakartaDay = (days = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * The cashier's PG flow (UMK-1991): pos-api against the REAL payment-api with its local fake gateway
 * (`fake_qris`, `fake_va`). The test plays the customer and the gateway through payment-api's
 * `/dev/fake-gateway` controls, and moves payment-api's clock instead of waiting.
 * Case codes are those of the spec "Payment-api: alur pembayaran PG dan kasus tepi".
 */
describe('cashier PG flow with the fake gateway (UMK-1991)', () => {
  let pay: PaymentApi;
  let app: INestApplication;
  let sync: PaymentSync;
  // `no_charge`: only a charge (POST /payments) fails; everything else reaches payment-api.
  let link: 'ok' | 'down' | 'no_charge' = 'ok';
  type Call = { url: string; init: RequestInit };
  /**
   * Calls of pos-api to payment-api that a test holds: `before` stops the call before it is sent, `after`
   * lets payment-api do it and holds its answer. Each hold stops the first call that matches, once.
   */
  type Hold = {
    match: (c: Call) => boolean;
    when: 'before' | 'after';
    used: boolean;
    reached: () => void;
    gate: Promise<void>;
  };
  let holds: Hold[] = [];
  /** Rewrites every payment payment-api answers (a field it sends wrong, or not at all). */
  let mangle: ((payment: Record<string, unknown>) => void) | null = null;
  /** The answer of the first matching call is lost: payment-api did it, pos-api never hears. */
  let loseAnswerOf: ((c: Call) => boolean) | null = null;
  /** payment-api's answer to a matching call, made up by the test; the call never reaches payment-api. */
  let answerInstead: ((c: Call) => Response | null) | null = null;
  function hold(match: Hold['match'], when: Hold['when'] = 'before') {
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = new Promise<void>((r) => (reached = r));
    holds.push({ match, when, used: false, reached, gate });
    return { held, release };
  }
  const isFindByKey = (c: Call) =>
    c.init.method === 'GET' && c.url.includes('/payments?idempotencyKey=');
  const isCharge = (c: Call) =>
    c.init.method === 'POST' && c.url.endsWith('/payments');
  const isCancel = (c: Call) =>
    c.init.method === 'POST' && c.url.endsWith('/cancel');
  const tenants: string[] = [];
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());

  /** `undefined` unsets the variable for this app. */
  async function posApp(env: Record<string, string | undefined>) {
    const saved = Object.fromEntries(
      Object.keys(env).map((k) => [k, process.env[k]]),
    );
    for (const [k, v] of Object.entries(env))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PAYMENT_FETCH)
        .useValue(async (url: string, init: RequestInit) => {
          const call = { url, init };
          if (link === 'down' || (link === 'no_charge' && isCharge(call)))
            throw new TypeError('fetch failed');
          const h = holds.find((x) => !x.used && x.match(call));
          if (h) h.used = true;
          if (h?.when === 'before') {
            h.reached();
            await h.gate;
          }
          const made = answerInstead?.(call);
          if (made) return made;
          let res = await fetch(url, init);
          if (mangle && res.ok) {
            const body = (await res.json()) as Record<string, unknown>;
            const items = Array.isArray(body.items)
              ? (body.items as Record<string, unknown>[])
              : [body];
            for (const p of items) if ('orderRef' in p) mangle(p);
            res = new Response(JSON.stringify(body), {
              status: res.status,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (loseAnswerOf?.(call)) {
            loseAnswerOf = null;
            throw new TypeError('fetch failed');
          }
          if (h?.when === 'after') {
            h.reached();
            await h.gate;
          }
          return res;
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
    pay = await startPaymentApi({ fakeGateway: true });
    app = await posApp({
      PAYMENT_API_URL: pay.url,
      PAYMENT_SERVICE_KEY: pay.serviceKey,
      POS_PAYMENT_RECONCILE_INTERVAL_SECONDS: '0',
    });
    sync = app.get(PaymentSync);
  }, 60_000);

  afterAll(async () => {
    link = 'ok';
    // The balance check over every store of this file.
    const all = await admin<
      { id: string; status: string; payment_id: string | null }[]
    >`select id, status, payment_id from pos.sales where tenant_id in ${admin(tenants)}`;
    const payments = await pay.sql<PaymentRow[]>`
      select id, order_ref, status from payment.payments where tenant_id in ${pay.sql(tenants)}`;
    const statusOf = new Map(payments.map((p) => [p.id, p.status]));
    // No sale is left waiting (a later suite boots with payment-api off, which refuses that).
    expect(all.filter((x) => x.status === 'awaiting_payment')).toEqual([]);
    // Paid payments = completed sales, one to one: nothing paid twice, nothing paid for a cancelled sale.
    expect(
      payments
        .filter((p) => p.status === 'paid')
        .map((p) => p.order_ref)
        .sort(),
    ).toEqual(
      all
        // A kasbon sale takes no payment of its own.
        .filter((x) => x.status === 'completed' && x.payment_id)
        .map((x) => x.id)
        .sort(),
    );
    for (const x of all) {
      const st = x.payment_id ? statusOf.get(x.payment_id) : undefined;
      if (x.status === 'completed' && x.payment_id) expect(st).toBe('paid');
      if (x.status === 'cancelled') expect(st).not.toBe('paid');
      if (x.status === 'void') expect(st).toMatch(/^(voided|refund)/);
    }
    // Nothing is left for the job: it sweeps every store, and the next spec file's payment-api starts on an
    // empty database, where a refund this file left pending is a payment that does not exist (its ticks
    // would count it as failed). The refunds some tests leave on their way are returned by the gateway here.
    const open = await pay.sql<{ tenant_id: string; refund_key: string }[]>`
      select tenant_id, refund_key from payment.payments
      where status = 'refund_pending' and tenant_id in ${pay.sql(tenants)}`;
    for (const p of open)
      await gateway(p.tenant_id, 'POST', `/refunds/${p.refund_key}/succeed`);
    await sync.tick(later());
    const left = await syncWorkLeft(admin, tenants);
    await app.close();
    await pay.close();
    await admin.end();
    // After the servers are closed: a failed check must not keep jest from ending.
    expect(left).toEqual([]);
  });
  beforeEach(async () => {
    link = 'ok';
    holds = [];
    loseAnswerOf = null;
    answerInstead = null;
    mangle = null;
    await gatewaySettings('pending');
  });

  const post = (auth: string, url: string, body: object = {}, key?: string) => {
    const req = http().post(url).set('Authorization', auth);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);

  /** The fake gateway's controls: what the customer or the gateway does. Tenant from the store, as pos-api sends it. */
  async function gateway<T = unknown>(
    tenantId: string,
    method: 'GET' | 'POST',
    path: string,
    body?: object,
  ): Promise<T> {
    const res = await fetch(`${pay.url}/dev/fake-gateway${path}`, {
      method,
      headers: {
        'X-Payment-Service-Key': pay.serviceKey,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`fake gateway ${path} answered ${res.status}`);
    return (await res.json()) as T;
  }
  const gatewaySettings = (refundMode: 'pending' | 'succeed' | 'fail') =>
    gateway(randomUUID(), 'POST', '/settings', { refundMode });
  const bills = async (tenantId: string) =>
    (await gateway<{ items: Bill[] }>(tenantId, 'GET', '/payments')).items;
  const billOf = async (s: Store, saleId: string) =>
    (await bills(s.tenantId)).find((b) => b.orderRef === saleId)!;
  /** The customer or the gateway acts on the sale's bill: pay, late-pay, fail, expire. */
  const onBill = async (
    s: Store,
    saleId: string,
    action: 'pay' | 'late-pay' | 'fail' | 'expire',
    body: object = {},
  ) =>
    gateway(
      s.tenantId,
      'POST',
      `/payments/${(await billOf(s, saleId)).providerRef}/${action}`,
      body,
    );

  /** A store with one product (Rp5.123, stock 20), an open shift, the owner's void PIN and a QRIS method. */
  async function shop(price = PRICE) {
    const s = await createStore();
    tenants.push(s.tenantId);
    // A PG charge needs the store's gateway account to be active (UMK-2019).
    await seedMerchant(pay.sql, { tenantId: s.tenantId });
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
    const qris = await method(s, 'QRIS Dinamis', 'fake_qris');
    return { ...s, productId, qris, price };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  const method = async (s: Store, name: string, gatewayMethod: string) =>
    (
      await post(s.auth, '/payment-methods', {
        name,
        kind: 'online',
        gatewayMethod,
      }).expect(201)
    ).body.id as string;
  /** A sale with the store's QRIS method (or `body.paymentMethodId`), by `auth` (default: the owner). */
  const sell = (
    s: Shop,
    body: object = {},
    key: string = randomUUID(),
    auth = s.auth,
  ) =>
    post(
      auth,
      '/sales',
      {
        lines: [{ productId: s.productId, qty: 1 }],
        paymentMethodId: s.qris,
        paid: s.price,
        ...body,
      },
      key,
    );
  /** A PG sale that the customer has paid and the poll has completed. */
  async function paidSale(s: Shop) {
    const saleId = (await sell(s).expect(201)).body.id as string;
    await onBill(s, saleId, 'pay');
    const res = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
    expect(res.body).toMatchObject({ saleStatus: 'completed', status: 'paid' });
    return saleId;
  }
  const approval = (s: Store, pin = OWNER_PIN) => ({
    reasonCode: 'customer_cancelled',
    approverId: s.userId,
    pin,
  });
  const refund = (s: Store, saleId: string, key: string = randomUUID()) =>
    post(s.auth, `/sales/${saleId}/refund`, approval(s), key);
  /** The retry of a refused refund (UMK-2040): by `as`, approved by the owner's PIN unless `body` says otherwise. */
  const retry = (
    as: { auth: string; userId?: string },
    saleId: string,
    body: object = { approverId: as.userId ?? randomUUID(), pin: OWNER_PIN },
  ) => post(as.auth, `/sales/${saleId}/refund/retry`, body);

  const onHand = async (s: Shop) =>
    (await get(s.auth, `/stock/products/${s.productId}`).expect(200)).body
      .onHand as number;
  const shift = async (auth: string) =>
    (await get(auth, '/shifts/current').expect(200)).body.shift as {
      cashSales: number;
      salesCount: number;
    };
  const saleRow = async (id: string) =>
    (
      await admin<
        {
          status: string;
          payment_id: string | null;
          payment_attempt: number;
          payment_method_code: string;
          rounding: string;
          paid: string;
          change: string;
          switch_cash_paid: string | null;
          cancel_reason: string | null;
          payment_refused_code: string | null;
        }[]
      >`select status, payment_id, payment_attempt, payment_method_code, rounding, paid, change,
          switch_cash_paid, cancel_reason, payment_refused_code from pos.sales where id = ${id}`
    )[0];
  const paymentsOf = (saleId: string) =>
    pay.sql<PaymentRow[]>`
      select id, order_ref, idempotency_key, method, amount, status, refund_key
      from payment.payments where order_ref = ${saleId} order by attempt`;
  const voidsOf = (saleId: string) =>
    admin<
      { refund_status: string | null; payment_sync_pending: boolean }[]
    >`select refund_status, payment_sync_pending from pos.sale_voids where sale_id = ${saleId}`;
  const pinFailures = async (s: Store) =>
    (
      await admin<
        { failures: number }[]
      >`select failures from pos.void_pins where actor_id = ${s.userId}`
    )[0].failures;
  const later = () => new Date(Date.now() + 3 * MINUTES);

  describe('online payment methods', () => {
    it('an online method needs payment-api: refused while it is off', async () => {
      // First in the file: pos-api refuses to boot with payment-api off while a sale awaits payment.
      const off = await posApp({ PAYMENT_API_URL: '' });
      try {
        const s = await createStore();
        const res = await request(off.getHttpServer())
          .post('/payment-methods')
          .set('Authorization', s.auth)
          .send({ name: 'QRIS', kind: 'online', gatewayMethod: 'fake_qris' })
          .expect(422);
        expect(res.body.errors).toEqual({
          kind: 'Pembayaran online belum tersedia',
        });
      } finally {
        await off.close();
      }
    });

    it('an online method names its gateway method, no other kind may, and a kasbon instalment cannot use one', async () => {
      const s = await shop();
      const bad = (body: object) =>
        post(s.auth, '/payment-methods', body).expect(422);
      expect((await bad({ name: 'A', kind: 'online' })).body.errors).toEqual({
        gatewayMethod: 'Pilih jenis pembayaran online',
      });
      expect(
        (await bad({ name: 'A', kind: 'online', gatewayMethod: 'xendit_qris' }))
          .body.errors,
      ).toHaveProperty('gatewayMethod');
      expect(
        (await bad({ name: 'A', kind: 'wallet', gatewayMethod: 'fake_qris' }))
          .body.errors,
      ).toEqual({ gatewayMethod: 'Hanya untuk metode pembayaran online' });
      const va = await method(s, 'VA', 'fake_va');
      const list = await get(s.auth, '/payment-methods').expect(200);
      expect(list.body.data).toMatchObject([
        { name: 'Tunai', kind: 'cash', gatewayMethod: null },
        { name: 'QRIS Dinamis', kind: 'online', gatewayMethod: 'fake_qris' },
        { name: 'VA', kind: 'online', gatewayMethod: 'fake_va' },
      ]);
      // Changed to a kind taken at the cashier: the gateway method goes.
      const patched = await http()
        .patch(`/payment-methods/${va}`)
        .set('Authorization', s.auth)
        .send({ kind: 'debit' })
        .expect(200);
      expect(patched.body).toMatchObject({
        kind: 'debit',
        gatewayMethod: null,
      });

      const member = await post(s.auth, '/members', {
        name: 'Bu Sri',
        code: `M${Math.random().toString(36).slice(2, 8)}`,
      }).expect(201);
      const kasbon = (
        await post(s.auth, '/payment-methods', {
          name: 'Kasbon',
          kind: 'credit',
        }).expect(201)
      ).body.id as string;
      const credit = await sell(s, {
        paymentMethodId: kasbon,
        memberId: member.body.id,
        paid: 0,
      }).expect(201);
      const instalment = await post(
        s.auth,
        `/receivables/${credit.body.receivableId}/payments`,
        { amount: 1000, paymentMethodId: s.qris },
        randomUUID(),
      ).expect(422);
      expect(instalment.body.errors).toEqual({
        paymentMethodId:
          'Cicilan kasbon belum bisa dibayar dengan pembayaran online',
      });
    });
  });

  describe('where online payments are off (M1, M3)', () => {
    it.each([
      ['production', 'production'],
      ['unset', undefined],
    ])(
      'NODE_ENV %s: an online method cannot be created, and one that exists does not sell',
      async (_name, nodeEnv) => {
        // The method exists (made where online payments are allowed) before this environment meets it.
        const s = await shop();
        const other = await posApp({
          PAYMENT_API_URL: pay.url,
          PAYMENT_SERVICE_KEY: pay.serviceKey,
          PAYMENT_API_ALLOW_HTTP: 'true',
          POS_PAYMENT_RECONCILE_INTERVAL_SECONDS: '0',
          NODE_ENV: nodeEnv,
        });
        try {
          const there = () => request(other.getHttpServer());
          const made = await there()
            .post('/payment-methods')
            .set('Authorization', s.auth)
            .send({ name: 'VA', kind: 'online', gatewayMethod: 'fake_va' })
            .expect(422);
          expect(made.body.errors).toEqual({
            kind: 'Pembayaran online belum tersedia',
          });
          const sold = await there()
            .post('/sales')
            .set('Authorization', s.auth)
            .set('Idempotency-Key', randomUUID())
            .send({
              lines: [{ productId: s.productId, qty: 1 }],
              paymentMethodId: s.qris,
              paid: s.price,
            })
            .expect(422);
          expect(sold.body.errors).toEqual({
            paymentMethodId: 'Metode pembayaran online belum bisa dipakai',
          });
          // Nothing was taken and nothing waits.
          const [{ n }] = await admin<
            { n: number }[]
          >`select count(*)::int as n from pos.sales where tenant_id = ${s.tenantId}`;
          expect(n).toBe(0);
          expect(await onHand(s)).toBe(20);
          expect(await bills(s.tenantId)).toEqual([]);
          // A cash sale is as before.
          await there()
            .post('/sales')
            .set('Authorization', s.auth)
            .set('Idempotency-Key', randomUUID())
            .send({ lines: [{ productId: s.productId, qty: 1 }], paid: 10_000 })
            .expect(201);
        } finally {
          await other.close();
        }
      },
    );

    it('a gateway method this version does not know is refused by the database, and a method that has one does not sell', async () => {
      const s = await shop();
      const insert = (name: string) =>
        admin`insert into pos.payment_methods (tenant_id, name, is_online, gateway_method)
          values (${s.tenantId}, ${name}, true, 'gopay_dynamic') returning id`;
      await expect(insert('GoPay')).rejects.toThrow(
        /payment_methods_gateway_method_ck/,
      );
      // A row from before the check (or of a newer version): the sale is refused before anything is taken.
      await admin`alter table pos.payment_methods drop constraint payment_methods_gateway_method_ck`;
      try {
        const [row] = await insert('GoPay');
        const res = await sell(s, {
          paymentMethodId: row.id as string,
        }).expect(422);
        expect(res.body.errors).toEqual({
          paymentMethodId: 'Metode pembayaran online belum bisa dipakai',
        });
        expect(await onHand(s)).toBe(20);
        const [{ n }] = await admin<
          { n: number }[]
        >`select count(*)::int as n from pos.sales where tenant_id = ${s.tenantId}`;
        expect(n).toBe(0);
        await admin`delete from pos.payment_methods where id = ${row.id as string}`;
      } finally {
        await admin`alter table pos.payment_methods add constraint payment_methods_gateway_method_ck
          check (gateway_method is null or gateway_method in ('fake_qris', 'fake_va', 'fake_checkout'))`;
      }
    });
  });

  describe('starting a PG sale', () => {
    it('D10 a QRIS sale awaits payment with the QR and its 15-minute expiry, key <saleId>:1, stock and voucher taken; a repeat is the same sale and the same QR', async () => {
      const s = await shop(5000);
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
      const key = randomUUID();
      const total = 4500; // 10% off Rp5.000
      const body = { voucherCode: v.body.code, paid: total };
      const res = await sell(s, body, key).expect(201);
      const saleId = res.body.id as string;
      expect(res.body).toMatchObject({
        status: 'awaiting_payment',
        onlinePayment: true,
        total,
        rounding: 0,
        payment: {
          saleId,
          saleStatus: 'awaiting_payment',
          status: 'awaiting_payment',
          online: true,
          method: 'fake_qris',
          paymentMethodId: s.qris,
          paymentMethodName: 'QRIS Dinamis',
          amount: total,
          attempt: 1,
          checkoutExpired: false,
          canCloseAtGateway: true,
          switchingToCash: false,
          refund: null,
          lateReceipts: [],
        },
      });
      const { checkout, expiresAt } = res.body.payment as {
        checkout: { qrString: string };
        expiresAt: string;
      };
      expect(Object.keys(checkout)).toEqual(['qrString']);
      expect(checkout.qrString).toContain(String(total));
      const ttl = new Date(expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(14 * MINUTES);
      expect(ttl).toBeLessThanOrEqual(15 * MINUTES);

      const [payment, ...more] = await paymentsOf(saleId);
      expect(more).toEqual([]);
      expect(payment).toMatchObject({
        idempotency_key: `${saleId}:1`,
        method: 'fake_qris',
        amount: String(total),
        status: 'pending',
      });
      expect(await onHand(s)).toBe(19);
      expect(await quota()).toBe(4);
      // Not a receipt yet: in no list and no shift total, but listed as waiting.
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 0,
        salesCount: 0,
      });
      const waiting = await get(
        s.auth,
        '/sales?status=awaiting_payment',
      ).expect(200);
      expect(waiting.body.data).toMatchObject([
        { id: saleId, onlinePayment: true },
      ]);

      const again = await sell(s, body, key).expect(201);
      expect(again.body.id).toBe(saleId);
      expect(again.body.payment.checkout).toEqual(checkout);
      expect(await paymentsOf(saleId)).toHaveLength(1);
      expect(await bills(s.tenantId)).toHaveLength(1);
      expect(await onHand(s)).toBe(19);
      expect(await quota()).toBe(4);

      // The shift does not close while the sale awaits its payment.
      const close = await post(s.auth, '/shifts/current/close', {
        countedCash: 100_000,
      }).expect(409);
      expect(close.body.saleNumbers).toEqual([res.body.number]);

      // The cashier cancels: stock and voucher come back, and the shift can close.
      await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(200);
      expect(await onHand(s)).toBe(20);
      expect(await quota()).toBe(5);
      await post(s.auth, '/shifts/current/close', {
        countedCash: 100_000,
      }).expect(200);
    });

    it('UMK-2037 a VA sale is made at the bank the customer chose, and answers that bank and its VA number', async () => {
      const s = await shop();
      const va = await method(s, 'VA', 'fake_va');
      const res = await sell(s, { paymentMethodId: va, bank: 'FAKE2' }).expect(
        201,
      );
      expect(res.body.payment).toMatchObject({
        method: 'fake_va',
        checkout: {
          bank: 'FAKE2',
          vaNumber: expect.stringMatching(/^8809\d{12}$/),
        },
      });
      // UMK-2045: with the name the customer's bank will show for the VA ("a.n."), the gateway's label.
      expect(res.body.payment.checkout.accountName).toBe('FAKE GATEWAY');
      expect(Object.keys(res.body.payment.checkout).sort()).toEqual([
        'accountName',
        'bank',
        'vaNumber',
      ]);
      const poll = await get(s.auth, `/sales/${res.body.id}/payment`).expect(
        200,
      );
      expect(poll.body.checkout).toEqual(res.body.payment.checkout);
      // Only the known keys reach the screen: whatever else a gateway answers about the account stays behind.
      mangle = (p) => {
        p.checkout = {
          ...(p.checkout as object),
          accountNumber: '1234567890',
          holderIdentityNumber: '3171234567890001',
        };
      };
      const strict = await get(s.auth, `/sales/${res.body.id}/payment`).expect(
        200,
      );
      expect(strict.body.checkout).toEqual(res.body.payment.checkout);
      mangle = null;
      // The name is the gateway's text: control characters are dropped and it is cut to 100 characters.
      mangle = (p) => {
        p.checkout = {
          ...(p.checkout as object),
          accountName: `  WARUNG\u0000 BU\n SARI\u202e\u2028 ${'X'.repeat(200)}`,
        };
      };
      const long = await get(s.auth, `/sales/${res.body.id}/payment`).expect(
        200,
      );
      const name = long.body.checkout.accountName as string;
      expect(name).toHaveLength(100);
      expect(name.startsWith('WARUNG BU SARI')).toBe(true);
      // eslint-disable-next-line no-control-regex
      expect(name).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
      mangle = (p) => {
        p.checkout = { ...(p.checkout as object), accountName: '\u0007\n ' };
      };
      const empty = await get(s.auth, `/sales/${res.body.id}/payment`).expect(
        200,
      );
      expect(Object.keys(empty.body.checkout).sort()).toEqual([
        'bank',
        'vaNumber',
      ]);
      mangle = null;
      const [row] = await admin<{ payment_bank: string | null }[]>`
        select payment_bank from pos.sales where id = ${res.body.id}`;
      expect(row.payment_bank).toBe('FAKE2');
      const [payment] = await pay.sql<{ bank: string | null }[]>`
        select bank from payment.payments where order_ref = ${res.body.id}`;
      expect(payment.bank).toBe('FAKE2');
      await onBill(s, res.body.id, 'pay');
      await get(s.auth, `/sales/${res.body.id}/payment`).expect(200);
      expect((await saleRow(res.body.id)).status).toBe('completed');
    });

    it('UMK-2037 a VA sale without a bank, with an unknown one, or a QR or cash sale with one: 422 on `bank`, and nothing is written or taken', async () => {
      const s = await shop();
      const va = await method(s, 'VA', 'fake_va');
      const sales = async () =>
        (
          await admin<{ n: number }[]>`
            select count(*)::int as n from pos.sales where tenant_id = ${s.tenantId}`
        )[0].n;
      const banks = [
        { code: 'FAKE', name: 'Bank Fake' },
        { code: 'FAKE2', name: 'Bank Fake Dua' },
      ];
      const none = await sell(s, { paymentMethodId: va }).expect(422);
      expect(none.body).toMatchObject({
        errors: { bank: 'Pilih bank untuk virtual account' },
        banks,
      });
      const unknown = await sell(s, {
        paymentMethodId: va,
        bank: 'BCA',
      }).expect(422);
      expect(unknown.body).toMatchObject({
        errors: { bank: 'Bank tidak tersedia untuk metode ini' },
        banks,
      });
      for (const bank of ['', 'a b', 7, null]) {
        const bad = await sell(s, { paymentMethodId: va, bank }).expect(422);
        expect(Object.keys(bad.body.errors)).toEqual(['bank']);
      }
      // A QR and a cash sale choose no bank.
      const qr = await sell(s, { bank: 'FAKE' }).expect(422);
      expect(qr.body.errors).toEqual({
        bank: 'Metode pembayaran ini tidak memakai bank',
      });
      const cash = await sell(s, {
        paymentMethodId: undefined,
        paid: 10_000,
        bank: 'FAKE',
      }).expect(422);
      expect(cash.body.errors).toEqual({
        bank: 'Metode pembayaran ini tidak memakai bank',
      });
      expect(await sales()).toBe(0);
      expect(await onHand(s)).toBe(20);
      expect(await bills(s.tenantId)).toEqual([]);
      expect(
        await pay.sql`select 1 from payment.payments where tenant_id = ${s.tenantId}`,
      ).toHaveLength(0);
    });

    it('UMK-2037 the same key answers the same VA; the same key with another bank is another request (422)', async () => {
      const s = await shop();
      const va = await method(s, 'VA', 'fake_va');
      const key = randomUUID();
      const body = { paymentMethodId: va, bank: 'FAKE' };
      const first = await sell(s, body, key).expect(201);
      const again = await sell(s, body, key).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.payment.checkout).toEqual(first.body.payment.checkout);
      await sell(s, { ...body, bank: 'FAKE2' }, key).expect(422);
      expect(await bills(s.tenantId)).toHaveLength(1);
      await post(s.auth, `/sales/${first.body.id}/payment/cancel`).expect(200);
    });

    it('UMK-2037 a VA sale whose charge got no answer is given up by the job with the bank it was asked for; switched to cash it is charged without one', async () => {
      const s = await shop();
      const va = await method(s, 'VA', 'fake_va');
      // The charge never reaches payment-api; the bank check before the sale did.
      link = 'no_charge';
      const lost = await sell(s, { paymentMethodId: va, bank: 'FAKE2' }).expect(
        503,
      );
      link = 'ok';
      const lostId = lost.body.saleId as string;
      expect(await sync.tick(later())).toMatchObject({ cancelled: 1 });
      expect((await saleRow(lostId)).status).toBe('cancelled');
      // The key was closed with the charge's own body: the charge that arrives late answers that payment.
      const [closed] = await pay.sql<{ status: string; bank: string | null }[]>`
        select status, bank from payment.payments where order_ref = ${lostId}`;
      expect(closed).toEqual({ status: 'cancelled', bank: 'FAKE2' });

      const res = await sell(s, { paymentMethodId: va, bank: 'FAKE' }).expect(
        201,
      );
      const cash = await post(s.auth, `/sales/${res.body.id}/payment/cash`, {
        paid: 5200,
      }).expect(200);
      expect(cash.body).toMatchObject({
        saleStatus: 'completed',
        method: 'cash',
      });
      const rows = await pay.sql<
        { method: string; bank: string | null; status: string }[]
      >`select method, bank, status from payment.payments
        where order_ref = ${res.body.id} order by attempt`;
      expect(rows).toEqual([
        { method: 'fake_va', bank: 'FAKE', status: 'cancelled' },
        { method: 'cash', bank: null, status: 'paid' },
      ]);
    });

    it('UMK-2037 payment-api is the authority on the bank: when the check before the sale cannot be made and it refuses the charge, the sale is cancelled at once (422) with its stock back', async () => {
      const s = await shop();
      const va = await method(s, 'VA', 'fake_va');
      // The list of banks cannot be read, so the sale goes on; the charge itself is answered.
      answerInstead = (c) =>
        c.init.method === 'GET' && c.url.endsWith('/merchant-accounts')
          ? new Response('{}', { status: 500 })
          : null;
      const keyOfBca = randomUUID();
      const res = await sell(
        s,
        { paymentMethodId: va, bank: 'BCA' },
        keyOfBca,
      ).expect(422);
      expect(res.body).toMatchObject({
        code: 'bank_unknown',
        status: 'cancelled',
        errors: { bank: expect.any(String) },
      });
      const missing = await sell(s, { paymentMethodId: va }).expect(422);
      expect(missing.body.code).toBe('bank_required');
      answerInstead = null;
      // UMK-2055: the store's banks known now say BCA would do (the list changed since): a repeat still
      // answers what the first request got, never a guess from today's list.
      (
        sync as unknown as {
          banksCache: Map<
            string,
            { at: number; byMethod: Map<string, unknown> }
          >;
        }
      ).banksCache.set(s.tenantId, {
        at: Date.now(),
        byMethod: new Map([['fake_va', [{ code: 'BCA', name: 'BCA' }]]]),
      });
      expect(await saleRow(res.body.saleId)).toMatchObject({
        cancel_reason: 'gateway_refused',
        payment_refused_code: 'bank_unknown',
      });
      // A repeat of the request answers the same 422 with the same code, not a 409.
      const again = await sell(
        s,
        { paymentMethodId: va, bank: 'BCA' },
        keyOfBca,
      ).expect(422);
      expect(again.body).toMatchObject({
        code: 'bank_unknown',
        status: 'cancelled',
        saleId: res.body.saleId,
        errors: { bank: expect.any(String) },
      });
      for (const id of [res.body.saleId, missing.body.saleId] as string[]) {
        expect((await saleRow(id)).status).toBe('cancelled');
        expect((await paymentsOf(id)).map((p) => p.status)).toEqual([
          'cancelled',
        ]);
      }
      expect(await onHand(s)).toBe(20);
      expect(await bills(s.tenantId)).toEqual([]);
    });

    it('M11 the gateway refuses the bill: 409, the sale is cancelled and stock is back at once', async () => {
      // The fake gateway refuses an amount ending in 901.
      const s = await shop(5901);
      const res = await sell(s).expect(409);
      expect(res.body.status).toBe('cancelled');
      expect((await saleRow(res.body.saleId)).status).toBe('cancelled');
      expect((await paymentsOf(res.body.saleId))[0].status).toBe('failed');
      expect(await onHand(s)).toBe(20);
      const view = await get(
        s.auth,
        `/sales/${res.body.saleId}/payment`,
      ).expect(200);
      expect(view.body).toMatchObject({
        saleStatus: 'cancelled',
        status: 'failed',
        checkout: null,
      });
    });

    it('a store whose gateway account is not active gets no bill: 409, the sale is cancelled and stock is back', async () => {
      const s = await shop();
      await seedMerchant(pay.sql, {
        tenantId: s.tenantId,
        status: 'suspended',
      });
      const key = randomUUID();
      const res = await sell(s, {}, key).expect(409);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        code: 'merchant_not_active',
      });
      expect((await saleRow(res.body.saleId)).status).toBe('cancelled');
      expect(await onHand(s)).toBe(20);
      // A retry of the same request answers the same cancelled sale, with the same code (UMK-2055), also when
      // the banks known now would make a bank refusal of it (QRIS "needs" a bank in this made-up list).
      (
        sync as unknown as {
          banksCache: Map<
            string,
            { at: number; byMethod: Map<string, unknown> }
          >;
        }
      ).banksCache.set(s.tenantId, {
        at: Date.now(),
        byMethod: new Map([['fake_qris', [{ code: 'FAKE', name: 'Fake' }]]]),
      });
      const again = await sell(s, {}, key).expect(409);
      expect(again.body).toMatchObject({
        saleId: res.body.saleId,
        status: 'cancelled',
        code: 'merchant_not_active',
      });
      expect(await onHand(s)).toBe(20);
      expect(await bills(s.tenantId)).toEqual([]);
      // The charge key is closed: nothing can be paid under it later.
      expect((await paymentsOf(res.body.saleId)).map((p) => p.status)).toEqual([
        'cancelled',
      ]);
    });

    it('the voucher quota comes back when the store may not charge, and when the bill closes unpaid', async () => {
      const s = await shop(5000);
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
      const body = { voucherCode: v.body.code, paid: 4500 };

      await seedMerchant(pay.sql, {
        tenantId: s.tenantId,
        status: 'suspended',
      });
      await sell(s, body).expect(409);
      expect(await quota()).toBe(5);
      await seedMerchant(pay.sql, { tenantId: s.tenantId });

      const saleId = (await sell(s, body).expect(201)).body.id as string;
      expect(await quota()).toBe(4);
      // The bill closes unpaid (failed here; an expired bill takes the same way out, tested below).
      await onBill(s, saleId, 'fail');
      const closed = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(closed.body).toMatchObject({
        saleStatus: 'cancelled',
        status: 'failed',
      });
      expect(await quota()).toBe(5);
      expect(await onHand(s)).toBe(20);
    });

    it('a PG sale must be paid in the exact total', async () => {
      const s = await shop();
      await sell(s, { paid: 10_000 }).expect(422);
      expect(await onHand(s)).toBe(20);
    });
  });

  describe('paid, expired, failed', () => {
    it('paid through the webhook: the poll completes the sale once, as a non-cash sale', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      const before = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(before.body.status).toBe('awaiting_payment');
      expect((await saleRow(saleId)).status).toBe('awaiting_payment');

      await onBill(s, saleId, 'pay', { webhook: 'duplicate' });
      const [a, b] = await Promise.all([
        get(s.auth, `/sales/${saleId}/payment`).expect(200),
        get(s.auth, `/sales/${saleId}/payment`).expect(200),
      ]);
      for (const res of [a, b])
        expect(res.body).toMatchObject({
          saleStatus: 'completed',
          status: 'paid',
          checkout: null,
          method: 'fake_qris',
        });
      const [payment] = await paymentsOf(saleId);
      expect(await saleRow(saleId)).toMatchObject({
        status: 'completed',
        payment_id: payment.id,
      });
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 0,
        salesCount: 1,
      });
      const sale = await get(s.auth, `/sales/${saleId}`).expect(200);
      expect(sale.body).toMatchObject({
        status: 'completed',
        onlinePayment: true,
        paymentMethod: 'QRIS Dinamis',
      });
      await get(s.auth, `/sales/${saleId}/receipt`).expect(200);
    });

    it('M1 the webhook is lost: the poll still waits, the manual check asks the gateway and completes the sale', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await onBill(s, saleId, 'pay', { webhook: 'drop' });
      const poll = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(poll.body).toMatchObject({
        saleStatus: 'awaiting_payment',
        status: 'awaiting_payment',
      });
      // payment-api asks the gateway at most once per 5 s per payment: the bill was just made.
      pay.clock.advance(6_000);
      const checked = await post(
        s.auth,
        `/sales/${saleId}/payment/check`,
      ).expect(200);
      expect(checked.body).toMatchObject({
        saleStatus: 'completed',
        status: 'paid',
      });
      expect(checked.body.lastCheckedAt).not.toBeNull();
      expect(await onHand(s)).toBe(19);
    });

    it('expired: the QR runs out first (checkoutExpired), and after the grace period the sale is cancelled with stock back', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      // The QR's 15 minutes are over (pos-api reads the expiry against its own clock, so it is moved in
      // payment-api's row), and the gateway reports the bill expired.
      await pay.sql`update payment.payments set expires_at = now() - interval '1 minute' where order_ref = ${saleId}`;
      await onBill(s, saleId, 'expire');
      const open = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      // Still inside the grace period for money on its way: payment-api has not closed it.
      expect(open.body).toMatchObject({
        saleStatus: 'awaiting_payment',
        status: 'awaiting_payment',
        checkoutExpired: true,
      });
      expect(await onHand(s)).toBe(19);

      pay.clock.advance(11 * MINUTES);
      const closed = await post(
        s.auth,
        `/sales/${saleId}/payment/check`,
      ).expect(200);
      expect(closed.body).toMatchObject({
        saleStatus: 'cancelled',
        status: 'expired',
        checkout: null,
        checkoutExpired: false,
      });
      expect(await onHand(s)).toBe(20);
      // M16: a cancelled sale is never completed, and is no receipt.
      await post(s.auth, `/sales/${saleId}/payment/check`).expect(200);
      expect((await saleRow(saleId)).status).toBe('cancelled');
      expect(await shift(s.auth)).toMatchObject({ salesCount: 0 });
    });

    it('failed at the gateway: the poll cancels the sale and gives the stock back', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await onBill(s, saleId, 'fail');
      const res = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(res.body).toMatchObject({
        saleStatus: 'cancelled',
        status: 'failed',
      });
      expect(await onHand(s)).toBe(20);
    });
  });

  describe('switch to cash', () => {
    it('D5 D13 M5 cash while the QR is open: one cash payment <saleId>:2 for the rounded amount; a late QR payment is refunded once and pays nothing', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;

      const short = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 5100,
      }).expect(422);
      expect(short.body.errors).toHaveProperty('paid');
      await post(s.auth, `/sales/${saleId}/payment/cash`, {}).expect(422);
      await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 10_000.5,
      }).expect(422);
      expect(await saleRow(saleId)).toMatchObject({
        status: 'awaiting_payment',
        switch_cash_paid: null,
      });

      const res = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 10_000,
      }).expect(200);
      expect(res.body).toMatchObject({
        saleStatus: 'completed',
        status: 'paid',
        online: false,
        method: 'cash',
        paymentMethodName: 'Tunai',
        amount: 5200,
        attempt: 2,
        checkout: null,
        switchingToCash: false,
        lateReceipts: [],
      });
      const [qr, cash, ...more] = await paymentsOf(saleId);
      expect(more).toEqual([]);
      expect(qr).toMatchObject({
        idempotency_key: `${saleId}:1`,
        method: 'fake_qris',
        status: 'cancelled',
      });
      expect(cash).toMatchObject({
        idempotency_key: `${saleId}:2`,
        method: 'cash',
        amount: '5200',
        status: 'paid',
      });
      expect(await saleRow(saleId)).toMatchObject({
        status: 'completed',
        payment_id: cash.id,
        payment_attempt: 2,
        payment_method_code: 'cash',
        rounding: '77',
        paid: '10000',
        change: '4800',
        switch_cash_paid: null,
      });
      expect((await billOf(s, saleId)).status).toBe('cancelled');
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 5200,
        salesCount: 1,
      });
      expect(await onHand(s)).toBe(19);

      // A repeat (also with another amount) answers the finished sale and charges nothing.
      const again = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 20_000,
      }).expect(200);
      expect(again.body).toMatchObject({ saleStatus: 'completed', attempt: 2 });
      expect(await paymentsOf(saleId)).toHaveLength(2);
      expect((await saleRow(saleId)).paid).toBe('10000');

      // The customer pays the old QR after all: payment-api refunds it; the sale is not paid twice.
      await gatewaySettings('succeed');
      await onBill(s, saleId, 'late-pay');
      const late = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(late.body).toMatchObject({
        saleStatus: 'completed',
        status: 'paid',
        method: 'cash',
        lateReceipts: [
          {
            attempt: 1,
            amount: PRICE,
            kind: 'late_payment',
            refundStatus: 'refunded',
          },
        ],
      });
      expect((await paymentsOf(saleId)).map((p) => p.status)).toEqual([
        'cancelled',
        'paid',
      ]);
      expect((await billOf(s, saleId)).refunds).toHaveLength(1);
      // A second notification of the same money refunds nothing more.
      await gateway(
        s.tenantId,
        'POST',
        `/payments/${(await billOf(s, saleId)).providerRef}/webhook`,
      );
      expect((await billOf(s, saleId)).refunds).toHaveLength(1);
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 5200,
        salesCount: 1,
      });
    });

    it('D5 the customer paid the QR first: 409 already_paid, the sale completes as the QRIS sale and no cash is recorded', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await onBill(s, saleId, 'pay', { webhook: 'drop' });
      const res = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 10_000,
      }).expect(409);
      expect(res.body).toMatchObject({
        code: 'already_paid',
        saleId,
        status: 'completed',
      });
      const [payment, ...more] = await paymentsOf(saleId);
      expect(more).toEqual([]);
      expect(payment).toMatchObject({ method: 'fake_qris', status: 'paid' });
      expect(await saleRow(saleId)).toMatchObject({
        status: 'completed',
        payment_id: payment.id,
        payment_attempt: 1,
        payment_method_code: 'fake_qris',
        rounding: '0',
        switch_cash_paid: null,
      });
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 0,
        salesCount: 1,
      });
      // The same answer on a repeat.
      const again = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 10_000,
      }).expect(409);
      expect(again.body.code).toBe('already_paid');
    });

    it('two cash requests at once make one cash payment and complete the sale once', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      const cash = () =>
        post(s.auth, `/sales/${saleId}/payment/cash`, { paid: 5200 });
      const [a, b] = await Promise.all([cash(), cash()]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(
        (await paymentsOf(saleId)).map((p) => [p.method, p.status]),
      ).toEqual([
        ['fake_qris', 'cancelled'],
        ['cash', 'paid'],
      ]);
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 5200,
        salesCount: 1,
      });
      expect(await onHand(s)).toBe(19);
    });

    it('M17 M2 payment-api down: 503, the switch is taken back and nobody finishes it; the customer can still pay the QR, or the cashier asks again', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      link = 'down';
      const down = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 6000,
      }).expect(503);
      expect(down.body.code).toBe('payment_unavailable');
      // Nothing changed, as the answer says: no switch is left behind.
      expect(await saleRow(saleId)).toMatchObject({
        status: 'awaiting_payment',
        payment_attempt: 1,
        payment_method_code: 'fake_qris',
        switch_cash_paid: null,
      });
      link = 'ok';
      // Neither the poll, the check nor the job turns it into a cash sale.
      const view = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(view.body).toMatchObject({
        saleStatus: 'awaiting_payment',
        method: 'fake_qris',
        attempt: 1,
        switchingToCash: false,
      });
      expect(view.body.checkout.qrString).toEqual(expect.any(String));
      await post(s.auth, `/sales/${saleId}/payment/check`).expect(200);
      expect(await sync.tick(later())).toMatchObject({
        completed: 0,
        cancelled: 0,
      });
      // The cashier, told the switch did not happen, lets the customer scan: a QRIS sale, no cash.
      await onBill(s, saleId, 'pay');
      const paid = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(paid.body).toMatchObject({
        saleStatus: 'completed',
        status: 'paid',
        method: 'fake_qris',
        attempt: 1,
        lateReceipts: [],
      });
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 0,
        salesCount: 1,
      });

      // Or the cashier asks again once payment-api is back.
      const other = (await sell(s).expect(201)).body.id as string;
      link = 'down';
      await post(s.auth, `/sales/${other}/payment/cash`, {
        paid: 6000,
      }).expect(503);
      link = 'ok';
      const again = await post(s.auth, `/sales/${other}/payment/cash`, {
        paid: 6000,
      }).expect(200);
      expect(again.body).toMatchObject({
        saleStatus: 'completed',
        method: 'cash',
        attempt: 2,
      });
      expect(await saleRow(other)).toMatchObject({
        paid: '6000',
        change: '800',
      });
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 5200,
        salesCount: 2,
      });
    });

    it('payment-api answers the close with a 4xx of its own that is no refusal of the bill (400, 401, 403, 429): 409 payment_refused, not "no answer"; a 500 and a proxy’s 408 or 499 stay 503', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      const answer = (status: number, code: string) => {
        answerInstead = (c) =>
          isCancel(c)
            ? new Response(JSON.stringify({ message: 'x', code }), {
                status,
                headers: { 'Content-Type': 'application/json' },
              })
            : null;
      };
      const unchanged = async () => {
        // The switch is taken back, and nothing was closed: the bill is still open at the gateway.
        expect(await saleRow(saleId)).toMatchObject({
          status: 'awaiting_payment',
          payment_attempt: 1,
          payment_method_code: 'fake_qris',
          switch_cash_paid: null,
        });
        expect((await billOf(s, saleId)).status).toBe('pending');
      };
      for (const [status, code] of [
        [400, 'invalid'],
        [401, 'invalid_service_key'],
        [403, 'forbidden'],
        [429, 'too_many_requests'],
      ] as const) {
        answer(status, code);
        const res = await post(s.auth, `/sales/${saleId}/payment/cash`, {
          paid: 6000,
        }).expect(409);
        // payment-api answered: this is its refusal, and the message does not say it gave no answer.
        expect(res.body.code).toBe('payment_refused');
        expect(res.body.message).not.toMatch(/tidak menjawab/);
        await unchanged();
      }
      // A clear refusal of the bill keeps its own code.
      answer(409, 'cancel_not_supported');
      const refusedBill = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 6000,
      }).expect(409);
      expect(refusedBill.body.code).toBe('cancel_refused');
      await unchanged();
      // No usable answer: a 5xx, and a 4xx that is not payment-api's own word (a proxy's 408 or 499). The
      // close may have happened, so the cashier is told to check first.
      for (const status of [500, 408, 499, 418]) {
        answer(status, 'x');
        const none = await post(s.auth, `/sales/${saleId}/payment/cash`, {
          paid: 6000,
        }).expect(503);
        expect(none.body.code).toBe('payment_unavailable');
        expect(none.body.message).toMatch(/tidak menjawab/);
        await unchanged();
      }

      answerInstead = null;
      const done = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 6000,
      }).expect(200);
      expect(done.body).toMatchObject({
        saleStatus: 'completed',
        method: 'cash',
      });
    });

    it('M2 the close reached payment-api but its answer was lost: 503, and the sale is then cancelled, never a cash sale', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      loseAnswerOf = isCancel;
      const res = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 5200,
      }).expect(503);
      expect(res.body.code).toBe('payment_unavailable');
      // It does not say "try again": the bill may be closed, so the cashier is told to look first.
      expect(res.body.message).toMatch(/Cek status pembayaran dulu/);
      expect(res.body.message).toMatch(/dibatalkan dan harus dibuat ulang/);
      expect(await saleRow(saleId)).toMatchObject({
        status: 'awaiting_payment',
        payment_attempt: 1,
        switch_cash_paid: null,
      });
      // The bill is closed, so the QR cannot be paid; the poll says so and the sale is cancelled.
      const view = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(view.body).toMatchObject({
        saleStatus: 'cancelled',
        status: 'cancelled',
      });
      expect(await onHand(s)).toBe(20);
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 0,
        salesCount: 0,
      });
      const gone = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 5200,
      }).expect(409);
      expect(gone.body.code).toBe('not_awaiting');
    });

    it('a switch whose request died: the poll and the check change nothing; the job finishes it only when the bill was closed for it', async () => {
      const s = await shop();
      // The request wrote the switch and closed the bill, then died.
      const closed = (await sell(s).expect(201)).body.id as string;
      const [bill] = await paymentsOf(closed);
      await admin`update pos.sales set switch_cash_paid = 5200 where id = ${closed}`;
      const res = await fetch(`${pay.url}/payments/${bill.id}/cancel`, {
        method: 'POST',
        headers: {
          'X-Payment-Service-Key': pay.serviceKey,
          'X-Tenant-Id': s.tenantId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ actorRef: `owner:${s.userId}` }),
      });
      expect(res.ok).toBe(true);
      // The request wrote the switch and died before it closed the bill.
      const open = (await sell(s).expect(201)).body.id as string;
      await admin`update pos.sales set switch_cash_paid = 5200 where id = ${open}`;

      for (const id of [closed, open]) {
        const view = await get(s.auth, `/sales/${id}/payment`).expect(200);
        expect(view.body).toMatchObject({
          saleStatus: 'awaiting_payment',
          switchingToCash: true,
          attempt: 1,
        });
        await post(s.auth, `/sales/${id}/payment/check`).expect(200);
        expect(await saleRow(id)).toMatchObject({
          status: 'awaiting_payment',
          payment_attempt: 1,
          switch_cash_paid: '5200',
        });
      }
      expect(await sync.tick(later())).toMatchObject({
        completed: 1,
        cancelled: 0,
        failed: 0,
      });
      expect(await saleRow(closed)).toMatchObject({
        status: 'completed',
        payment_method_code: 'cash',
        payment_attempt: 2,
      });
      // The open bill is nobody's to close but the cashier's: it still waits, and the QR still pays it.
      expect(await saleRow(open)).toMatchObject({
        status: 'awaiting_payment',
        payment_attempt: 1,
      });
      expect((await paymentsOf(open)).map((p) => p.status)).toEqual([
        'pending',
      ]);
      // The cashier gives it up: a cancel takes the switch back first.
      await post(s.auth, `/sales/${open}/payment/cancel`).expect(200);
      expect(await saleRow(open)).toMatchObject({
        status: 'cancelled',
        switch_cash_paid: null,
      });
      expect(await onHand(s)).toBe(19);
    });

    it('a stranded switch does not keep a sale waiting for ever: when its bill ends by itself, or never existed, the job takes the switch back and cancels the sale', async () => {
      const s = await shop();
      // The request wrote the switch and died; later the bill fails at the gateway.
      const failed = (await sell(s).expect(201)).body.id as string;
      await admin`update pos.sales set switch_cash_paid = 5200 where id = ${failed}`;
      await onBill(s, failed, 'fail');
      // The sale's charge never reached payment-api (no bill at all), and a switch was written on it.
      link = 'no_charge';
      const none = (await sell(s).expect(503)).body.saleId as string;
      link = 'ok';
      await admin`update pos.sales set switch_cash_paid = 5200 where id = ${none}`;
      expect(await paymentsOf(none)).toEqual([]);

      // A poll and a check are not the ones to end it.
      for (const id of [failed, none]) {
        await get(s.auth, `/sales/${id}/payment`).expect(200);
        await post(s.auth, `/sales/${id}/payment/check`).expect(200);
        expect(await saleRow(id)).toMatchObject({
          status: 'awaiting_payment',
          switch_cash_paid: '5200',
        });
      }
      expect(await sync.tick(later())).toMatchObject({
        completed: 0,
        cancelled: 2,
        failed: 0,
      });
      for (const id of [failed, none])
        expect(await saleRow(id)).toMatchObject({
          status: 'cancelled',
          payment_attempt: 1,
          switch_cash_paid: null,
        });
      // Neither became a cash sale: no cash payment, nothing in the drawer, the stock is back.
      expect((await paymentsOf(failed)).map((p) => p.status)).toEqual([
        'failed',
      ]);
      expect((await paymentsOf(none)).map((p) => p.status)).toEqual([
        'cancelled',
      ]);
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 0,
        salesCount: 0,
      });
      expect(await onHand(s)).toBe(20);
    });

    it('the bill was closed but the cash charge got no answer: the sale is a cash sale that still waits, and the job charges it, never cancels it', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      link = 'no_charge';
      const pending = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 5200,
      }).expect(503);
      // A code of its own: the sale IS a cash sale now, only the record of the cash is missing.
      expect(pending.body.code).toBe('cash_payment_pending');
      expect(await saleRow(saleId)).toMatchObject({
        status: 'awaiting_payment',
        payment_attempt: 2,
        payment_method_code: 'cash',
        switch_cash_paid: null,
      });
      expect((await paymentsOf(saleId)).map((p) => p.status)).toEqual([
        'cancelled',
      ]);
      link = 'ok';
      expect(await sync.tick(later())).toMatchObject({
        completed: 1,
        cancelled: 0,
      });
      expect((await saleRow(saleId)).status).toBe('completed');
      expect(
        (await paymentsOf(saleId)).map((p) => [p.method, p.amount, p.status]),
      ).toEqual([
        ['fake_qris', String(PRICE), 'cancelled'],
        ['cash', '5200', 'paid'],
      ]);
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 5200,
        salesCount: 1,
      });
    });

    it('a sale switched to cash is a cash sale for good: it is voided (not refunded) and its cash leaves the drawer', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 6000,
      }).expect(200);
      const expected = async () =>
        (await get(s.auth, '/shifts/current').expect(200)).body.shift
          .expectedCash as number;
      expect(await expected()).toBe(100_000 + 5200);
      const wrong = await refund(s, saleId).expect(409);
      expect(wrong.body.code).toBe('use_void');
      await post(
        s.auth,
        `/sales/${saleId}/void`,
        approval(s),
        randomUUID(),
      ).expect(201);
      expect(await expected()).toBe(100_000);
      expect(
        (await paymentsOf(saleId)).map((p) => [p.method, p.status]),
      ).toEqual([
        ['fake_qris', 'cancelled'],
        ['cash', 'voided'],
      ]);
      expect(await onHand(s)).toBe(20);
    });

    it('only a sale that waits for a PG payment is switched: a cash sale, a finished sale and a cancelled sale are refused', async () => {
      const s = await shop();
      const cashSale = await sell(s, {
        paymentMethodId: undefined,
        paid: 10_000,
      }).expect(201);
      const notOnline = await post(
        s.auth,
        `/sales/${cashSale.body.id}/payment/cash`,
        { paid: 10_000 },
      ).expect(409);
      expect(notOnline.body.code).toBe('not_online');

      const cancelled = (await sell(s).expect(201)).body.id as string;
      await post(s.auth, `/sales/${cancelled}/payment/cancel`).expect(200);
      const gone = await post(s.auth, `/sales/${cancelled}/payment/cash`, {
        paid: 10_000,
      }).expect(409);
      expect(gone.body).toMatchObject({
        code: 'not_awaiting',
        status: 'cancelled',
      });
      expect(await paymentsOf(cancelled)).toHaveLength(1);
      expect(await onHand(s)).toBe(19);
    });
  });

  describe('a stale answer never cancels a sale switched to cash (B1)', () => {
    /**
     * `stale` reads the sale while it waits for its QR payment and is held before it asks payment-api.
     * Meanwhile the cashier switches to cash; that request is held too, at `cashAt`. Then `stale` goes on
     * with what it read, and at last the cash request finishes.
     */
    async function race(
      stale: (s: Shop, saleId: string) => PromiseLike<unknown>,
      cashAt: 'cash_charge' | 'bill_closed',
    ) {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      const first = hold(isFindByKey);
      const staleRun = Promise.resolve(stale(s, saleId));
      await first.held;
      const second =
        cashAt === 'cash_charge'
          ? // The sale is a cash sale at attempt 2 and its cash is not recorded yet.
            hold(isCharge)
          : // The bill is closed for the switch and the sale is still at attempt 1.
            hold(isCancel, 'after');
      const cash = post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 5200,
      }).then((r) => r);
      await second.held;
      expect(await saleRow(saleId)).toMatchObject(
        cashAt === 'cash_charge'
          ? { status: 'awaiting_payment', payment_attempt: 2 }
          : {
              status: 'awaiting_payment',
              payment_attempt: 1,
              switch_cash_paid: '5200',
            },
      );
      first.release();
      await staleRun;
      // The stale worker found attempt 1 closed unpaid. It must not have cancelled the sale.
      expect((await saleRow(saleId)).status).not.toBe('cancelled');
      expect(await onHand(s)).toBe(19);
      second.release();
      const res = await cash;
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        saleStatus: 'completed',
        method: 'cash',
        attempt: 2,
      });
      expect(await saleRow(saleId)).toMatchObject({
        status: 'completed',
        payment_method_code: 'cash',
        paid: '5200',
      });
      expect(
        (await paymentsOf(saleId)).map((p) => [p.method, p.status]),
      ).toEqual([
        ['fake_qris', 'cancelled'],
        ['cash', 'paid'],
      ]);
      expect(await onHand(s)).toBe(19);
      expect(await shift(s.auth)).toMatchObject({
        cashSales: 5200,
        salesCount: 1,
      });
    }
    const poll = (s: Shop, saleId: string) =>
      get(s.auth, `/sales/${saleId}/payment`).then((r) => r);
    const check = (s: Shop, saleId: string) =>
      post(s.auth, `/sales/${saleId}/payment/check`).then((r) => r);
    const job = () => sync.tick(later());

    it('a poll that read the sale before the switch, applied while the cash is being recorded', () =>
      race(poll, 'cash_charge'));
    it('a poll that read the sale before the switch, applied when the bill has just been closed for it', () =>
      race(poll, 'bill_closed'));
    it('a manual check that read the sale before the switch', () =>
      race(check, 'cash_charge'));
    it('a manual check, applied when the bill has just been closed', () =>
      race(check, 'bill_closed'));
    it('the job that read the sale before the switch', () =>
      race(job, 'cash_charge'));
    it('the job, applied when the bill has just been closed', () =>
      race(job, 'bill_closed'));
  });

  describe('two workers at once', () => {
    /** Whatever won, the sale and payment-api agree and nothing was taken or given twice. */
    async function settled(s: Shop, saleId: string) {
      const sale = await saleRow(saleId);
      const payments = await paymentsOf(saleId);
      const paid = payments.filter((p) => p.status === 'paid');
      expect(['completed', 'cancelled']).toContain(sale.status);
      expect(paid).toHaveLength(sale.status === 'completed' ? 1 : 0);
      if (sale.status === 'completed') expect(sale.payment_id).toBe(paid[0].id);
      expect(await onHand(s)).toBe(sale.status === 'completed' ? 19 : 20);
      expect(sale.switch_cash_paid).toBeNull();
      return sale;
    }

    it('a cancel and a switch to cash at once: one of them wins, the sale is cancelled or a cash sale, never both', async () => {
      for (let i = 0; i < 3; i += 1) {
        const s = await shop();
        const saleId = (await sell(s).expect(201)).body.id as string;
        const [cancel, cash] = await Promise.all([
          post(s.auth, `/sales/${saleId}/payment/cancel`),
          post(s.auth, `/sales/${saleId}/payment/cash`, { paid: 5200 }),
        ]);
        let sale = await saleRow(saleId);
        // Neither got through (each took the other's step back): the cashier asks again.
        if (sale.status === 'awaiting_payment') {
          expect([cancel.status, cash.status]).toEqual([409, 409]);
          await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(200);
        }
        sale = await settled(s, saleId);
        if (cash.status === 200) expect(sale.status).toBe('completed');
        if (cancel.status === 200) expect(sale.status).toBe('cancelled');
        expect(await shift(s.auth)).toMatchObject({
          cashSales: sale.status === 'completed' ? 5200 : 0,
        });
      }
    });

    it('a cancel and the customer’s payment at once: cancelled with nothing paid, or completed with the payment', async () => {
      for (let i = 0; i < 3; i += 1) {
        const s = await shop();
        const saleId = (await sell(s).expect(201)).body.id as string;
        const [cancel] = await Promise.all([
          post(s.auth, `/sales/${saleId}/payment/cancel`),
          onBill(s, saleId, i % 2 ? 'pay' : 'late-pay').catch(() => undefined),
        ]);
        expect([200, 409]).toContain(cancel.status);
        await get(s.auth, `/sales/${saleId}/payment`).expect(200);
        const sale = await settled(s, saleId);
        if (cancel.status === 200) expect(sale.status).toBe('cancelled');
        else expect(cancel.body.code).toBe('already_paid');
      }
    });

    it('two checks, a poll and the job at once on a paid bill complete the sale once', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await onBill(s, saleId, 'pay', { webhook: 'drop' });
      const [a, b, c, tick] = await Promise.all([
        post(s.auth, `/sales/${saleId}/payment/check`),
        post(s.auth, `/sales/${saleId}/payment/check`),
        get(s.auth, `/sales/${saleId}/payment`),
        sync.tick(later()),
      ]);
      expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
      expect(tick.failed).toBe(0);
      expect((await settled(s, saleId)).status).toBe('completed');
      expect(await shift(s.auth)).toMatchObject({ salesCount: 1 });
    });

    it('two refund retries and the job at once ask the gateway for one refund', async () => {
      const s = await shop();
      const saleId = await paidSale(s);
      await gatewaySettings('fail');
      expect((await refund(s, saleId).expect(201)).body.refundStatus).toBe(
        'failed',
      );
      await gatewaySettings('pending');
      const before = (await billOf(s, saleId)).refunds.length;
      const [a, b, tick] = await Promise.all([
        retry(s, saleId),
        retry(s, saleId),
        sync.tick(later()),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(tick.failed).toBe(0);
      expect((await billOf(s, saleId)).refunds).toHaveLength(before + 1);
      const [payment] = await paymentsOf(saleId);
      expect(payment.status).toBe('refund_pending');
      await gateway(
        s.tenantId,
        'POST',
        `/refunds/${payment.refund_key}/succeed`,
      );
      await sync.tick(later());
      expect((await voidsOf(saleId))[0].refund_status).toBe('succeeded');
    });

    it('a refund whose request and the job send it at once is asked once', async () => {
      const s = await shop();
      const saleId = await paidSale(s);
      link = 'down';
      await refund(s, saleId).expect(201);
      link = 'ok';
      const [a, b] = await Promise.all([sync.tick(later()), retry(s, saleId)]);
      expect(a.failed).toBe(0);
      expect(b.status).toBe(200);
      expect((await billOf(s, saleId)).refunds).toHaveLength(1);
      expect((await voidsOf(saleId))[0]).toMatchObject({
        refund_status: 'pending',
        payment_sync_pending: false,
      });
      const [payment] = await paymentsOf(saleId);
      await gateway(
        s.tenantId,
        'POST',
        `/refunds/${payment.refund_key}/succeed`,
      );
      await sync.tick(later());
      expect((await voidsOf(saleId))[0].refund_status).toBe('succeeded');
    });

    it('a refund that succeeded is not overwritten by an older answer', async () => {
      const s = await shop();
      const saleId = await paidSale(s);
      await refund(s, saleId).expect(201);
      const [payment] = await paymentsOf(saleId);
      // A follower (the job's way) read the payment while the refund was on its way and is held with
      // that answer.
      const stale = hold(
        (c) =>
          c.init.method === 'GET' && c.url.endsWith(`/payments/${payment.id}`),
        'after',
      );
      const follower = sync.followRefund(s.tenantId, saleId);
      await stale.held;
      await gateway(
        s.tenantId,
        'POST',
        `/refunds/${payment.refund_key}/succeed`,
      );
      const view = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(view.body.refund.status).toBe('succeeded');
      expect((await voidsOf(saleId))[0].refund_status).toBe('succeeded');
      stale.release();
      // It answers what is stored, not the older answer it holds.
      expect(await follower).toBe('succeeded');
      expect((await voidsOf(saleId))[0].refund_status).toBe('succeeded');
    });
  });

  describe('cancel', () => {
    it('V2 cancelling an awaiting sale needs no PIN and writes no void: the bill is closed, stock is back, a repeat changes nothing', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      const res = await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(
        200,
      );
      expect(res.body).toMatchObject({
        saleStatus: 'cancelled',
        status: 'cancelled',
        checkout: null,
      });
      expect((await billOf(s, saleId)).status).toBe('cancelled');
      expect(await voidsOf(saleId)).toEqual([]);
      expect(await onHand(s)).toBe(20);
      const again = await post(
        s.auth,
        `/sales/${saleId}/payment/cancel`,
      ).expect(200);
      expect(again.body.saleStatus).toBe('cancelled');
      expect(await onHand(s)).toBe(20);
      expect(await paymentsOf(saleId)).toHaveLength(1);
      expect(await pinFailures(s)).toBe(0);
    });

    it('M17 no cancel while payment-api is down: 503, the sale still waits with its stock', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      link = 'down';
      await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(503);
      await get(s.auth, `/sales/${saleId}/payment`).expect(503);
      await post(s.auth, `/sales/${saleId}/payment/check`).expect(503);
      expect((await saleRow(saleId)).status).toBe('awaiting_payment');
      expect(await onHand(s)).toBe(19);
      link = 'ok';
      await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(200);
      expect(await onHand(s)).toBe(20);
    });

    it('D5 a cancel after the customer paid is refused: 409 already_paid and the sale is completed', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await onBill(s, saleId, 'pay', { webhook: 'drop' });
      const res = await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(
        409,
      );
      expect(res.body).toMatchObject({
        code: 'already_paid',
        status: 'completed',
      });
      expect((await saleRow(saleId)).status).toBe('completed');
      expect(await onHand(s)).toBe(19);
      // A receipt is not cancelled here: it is refunded.
      const receipt = await post(
        s.auth,
        `/sales/${saleId}/payment/cancel`,
      ).expect(409);
      expect(receipt.body.code).toBe('not_awaiting');
    });
  });

  describe('refund', () => {
    it('V5 a PG sale is refunded, never voided, and a cash sale is voided, never refunded; neither refusal costs a PIN attempt', async () => {
      const s = await shop();
      const pg = await paidSale(s);
      const cash = (
        await sell(s, { paymentMethodId: undefined, paid: 10_000 }).expect(201)
      ).body.id as string;
      const wrongPin = approval(s, '000000');
      const noVoid = await post(
        s.auth,
        `/sales/${pg}/void`,
        wrongPin,
        randomUUID(),
      ).expect(409);
      expect(noVoid.body.code).toBe('use_refund');
      const noRefund = await post(
        s.auth,
        `/sales/${cash}/refund`,
        wrongPin,
        randomUUID(),
      ).expect(409);
      expect(noRefund.body.code).toBe('use_void');
      expect(await pinFailures(s)).toBe(0);
      expect((await saleRow(pg)).status).toBe('completed');
      expect((await saleRow(cash)).status).toBe('completed');
      expect((await paymentsOf(pg))[0].status).toBe('paid');
      expect(await voidsOf(pg)).toEqual([]);

      // The right PIN is still needed for the refund itself, and a refund needs the void's fields.
      await post(s.auth, `/sales/${pg}/refund`, wrongPin, randomUUID()).expect(
        422,
      );
      expect(await pinFailures(s)).toBe(1);
      await post(s.auth, `/sales/${pg}/refund`, {}, randomUUID()).expect(422);
      await post(s.auth, `/sales/${pg}/refund`, approval(s)).expect(422); // no Idempotency-Key
      expect((await saleRow(pg)).status).toBe('completed');
      await post(
        s.auth,
        `/sales/${cash}/void`,
        approval(s),
        randomUUID(),
      ).expect(201);
      await refund(s, pg).expect(201);
    });

    it('V3 D9 refund: the sale is reversed at once, the gateway is asked once with the reason and the PIN approver, and the job follows it to refunded', async () => {
      const s = await shop();
      const saleId = await paidSale(s);
      const key = randomUUID();
      const res = await refund(s, saleId, key).expect(201);
      expect(res.body).toMatchObject({
        saleId,
        status: 'void',
        refundStatus: 'pending',
        reasonCode: 'customer_cancelled',
        total: PRICE,
        cashReturned: 0,
        transferReturned: PRICE,
        approvedBy: { id: s.userId, kind: 'owner' },
      });
      expect((await saleRow(saleId)).status).toBe('void');
      expect(await onHand(s)).toBe(20);
      const [payment] = await paymentsOf(saleId);
      expect(payment.status).toBe('refund_pending');
      const events = await pay.sql<
        { actor_ref: string; approved_by: string; reason_code: string }[]
      >`select actor_ref, approved_by, reason_code from payment.payment_events
        where payment_id = ${payment.id} and to_status = 'refund_pending'`;
      expect(events).toEqual([
        {
          actor_ref: `owner:${s.userId}`,
          approved_by: `owner:${s.userId}`,
          reason_code: 'customer_cancelled',
        },
      ]);

      // The same request again, and another one: one void record, one refund at the gateway.
      const again = await refund(s, saleId, key).expect(201);
      expect(again.body.id).toBe(res.body.id);
      await refund(s, saleId).expect(409);
      expect(await voidsOf(saleId)).toHaveLength(1);
      expect((await billOf(s, saleId)).refunds).toHaveLength(1);
      expect(await onHand(s)).toBe(20);

      const pending = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(pending.body).toMatchObject({
        saleStatus: 'void',
        status: 'refund_pending',
        refund: {
          status: 'pending',
          sent: true,
          reasonCode: 'customer_cancelled',
        },
      });
      expect(await sync.tick()).toMatchObject({ refunds: 0, failed: 0 });

      // The gateway returns the money: the job reads it.
      await gateway(
        s.tenantId,
        'POST',
        `/refunds/${payment.refund_key}/succeed`,
      );
      expect(await sync.tick()).toMatchObject({ refunds: 1, failed: 0 });
      expect(await voidsOf(saleId)).toEqual([
        { refund_status: 'succeeded', payment_sync_pending: false },
      ]);
      expect(await sync.tick()).toMatchObject({ refunds: 0 });
      const done = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(done.body).toMatchObject({
        status: 'refunded',
        refund: { status: 'succeeded' },
      });
      const record = await get(s.auth, `/sales/${saleId}/void`).expect(200);
      expect(record.body.refundStatus).toBe('succeeded');
      // A void of a cash sale has no refund status.
      const cash = await sell(s, {
        paymentMethodId: undefined,
        paid: 10_000,
      }).expect(201);
      const voided = await post(
        s.auth,
        `/sales/${cash.body.id}/void`,
        approval(s),
        randomUUID(),
      ).expect(201);
      expect(voided.body.refundStatus).toBeNull();
      await retry(s, cash.body.id).expect(404);
    });

    it('V4 the gateway refuses the refund: refund_failed, a retry by the owner with the owner’s own PIN asks again, and it succeeds; an admin’s PIN is refused', async () => {
      const s = await shop();
      const saleId = await paidSale(s);
      // The refund itself is approved by an admin (`sales.void`), as a void may be.
      const supervisor = await createCashier(app, s, [
        'sales.create',
        'sales.void',
      ]);
      const SUPERVISOR_PIN = '271828';
      await http()
        .put('/void-pin')
        .set('Authorization', supervisor.auth)
        .send({ pin: SUPERVISOR_PIN })
        .expect(200);
      const approvedBySupervisor = {
        approverId: supervisor.staffId,
        pin: SUPERVISOR_PIN,
      };
      await gatewaySettings('fail');
      const res = await post(
        s.auth,
        `/sales/${saleId}/refund`,
        { reasonCode: 'customer_cancelled', ...approvedBySupervisor },
        randomUUID(),
      ).expect(201);
      expect(res.body.refundStatus).toBe('failed');
      // The sale stays reversed (V8); the money is still owed to the customer.
      expect((await saleRow(saleId)).status).toBe('void');
      const failed = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(failed.body).toMatchObject({
        status: 'refund_failed',
        refund: { status: 'failed', sent: true },
      });

      const cashier = await createCashier(app, s);
      await retry(cashier, saleId).expect(403);
      await post(cashier.auth, `/sales/${saleId}/refund/manual`, {
        note: 'tunai',
      }).expect(403);
      // Still refused by the gateway: failed again, asked again.
      const still = await retry(s, saleId).expect(200);
      expect(still.body.refundStatus).toBe('failed');

      await gatewaySettings('pending');
      // UMK-2040: `sales.void` is not enough to retry, in the admin's own session…
      const before = (await billOf(s, saleId)).refunds.length;
      await retry(supervisor, saleId, approvedBySupervisor).expect(403);
      // 403 before the body is read: a supervisor learns nothing about it.
      await retry(supervisor, saleId, {}).expect(403);
      // …and (owner decision 2026-11-26) not as the approver of the owner's retry either: the admin's RIGHT
      // PIN gets the generic wrong-PIN answer, nothing is asked, and nothing is counted against the admin.
      const pinRows = () =>
        admin<{ actor_id: string; failures: number }[]>`
          select actor_id, failures from pos.void_pins
          where tenant_id = ${s.tenantId} order by actor_id`;
      const counts = await pinRows();
      for (const pin of [SUPERVISOR_PIN, '000000']) {
        const notOwner = await retry(s, saleId, {
          approverId: supervisor.staffId,
          pin,
        }).expect(422);
        expect(notOwner.body.errors).toEqual({ pin: 'PIN salah' });
      }
      expect(await pinRows()).toEqual(counts);
      expect((await billOf(s, saleId)).refunds).toHaveLength(before);
      // The admin's PIN still approves a void.
      const cash = await sell(s, {
        paymentMethodId: undefined,
        paid: 10_000,
      }).expect(201);
      await post(
        s.auth,
        `/sales/${cash.body.id}/void`,
        { reasonCode: 'customer_cancelled', ...approvedBySupervisor },
        randomUUID(),
      ).expect(201);

      const retried = await retry(s, saleId).expect(200);
      expect(retried.body).toMatchObject({ saleId, refundStatus: 'pending' });
      const [payment] = await paymentsOf(saleId);
      expect(payment.status).toBe('refund_pending');
      const [event] = await pay.sql<
        { actor_ref: string; approved_by: string }[]
      >`select actor_ref, approved_by from payment.payment_events
        where payment_id = ${payment.id} and to_status = 'refund_pending' order by created_at desc limit 1`;
      // Who retried, and whose PIN approved this retry: the owner, both.
      expect(event).toEqual({
        actor_ref: `owner:${s.userId}`,
        approved_by: `owner:${s.userId}`,
      });
      // The void record keeps who approved the refund itself.
      const [record] = await admin<{ approved_by: string }[]>`
        select approved_by from pos.sale_voids where sale_id = ${saleId}`;
      expect(record.approved_by).toBe(supervisor.staffId);
      expect(retried.body.approvedBy.id).toBe(supervisor.staffId);
      // A retry of a refund that is on its way asks nothing new.
      const refunds = (await billOf(s, saleId)).refunds.length;
      await retry(s, saleId).expect(200);
      expect((await billOf(s, saleId)).refunds).toHaveLength(refunds);

      await gateway(
        s.tenantId,
        'POST',
        `/refunds/${payment.refund_key}/succeed`,
      );
      const done = await retry(s, saleId).expect(200);
      expect(done.body.refundStatus).toBe('succeeded');
      expect((await paymentsOf(saleId))[0].status).toBe('refunded');
      expect(await onHand(s)).toBe(20);
    });

    it('UMK-2040 a retry needs the owner’s own PIN: no body 422, a wrong PIN 422 and nothing asked, the 5th wrong PIN locks (429) like a void', async () => {
      const s = await shop();
      const saleId = await paidSale(s);
      await gatewaySettings('fail');
      await refund(s, saleId).expect(201);
      await gatewaySettings('pending');
      const asked = async () => (await billOf(s, saleId)).refunds.length;
      const before = await asked();

      const none = await retry(s, saleId, {}).expect(422);
      expect(Object.keys(none.body.errors).sort()).toEqual([
        'approverId',
        'pin',
      ]);
      // Strict like a void: nothing but the approver and the PIN.
      await retry(s, saleId, {
        approverId: s.userId,
        pin: OWNER_PIN,
        reasonCode: 'other',
      }).expect(422);
      // Someone who may not approve gets the wrong-PIN answer and counts nowhere.
      const cashier = await createCashier(app, s);
      const notApprover = await retry(s, saleId, {
        approverId: cashier.staffId,
        pin: OWNER_PIN,
      }).expect(422);
      expect(notApprover.body.errors).toEqual({ pin: 'PIN salah' });

      const wrong = { approverId: s.userId, pin: '000000' };
      for (let i = 0; i < 4; i++) {
        const res = await retry(s, saleId, wrong).expect(422);
        expect(res.body.errors).toEqual({ pin: 'PIN salah' });
      }
      const fifth = await retry(s, saleId, wrong).expect(429);
      expect(fifth.headers['retry-after']).toBe('300');
      expect(fifth.body.retryAfter).toBe(300);
      // Locked: the right PIN is refused too, and the lock is the void's own (a refund is refused as well).
      const lockedOut = await retry(s, saleId).expect(429);
      expect(lockedOut.body.errors.pin).toMatch(/Terlalu banyak PIN salah/);
      const other = await paidSale(s);
      await refund(s, other).expect(429);
      expect(await asked()).toBe(before);
      expect((await voidsOf(saleId))[0].refund_status).toBe('failed');

      // UMK-2054: the session that is locked out cannot clear its own lock; an owner who just signed in can.
      const unlock = (auth: string) =>
        http().post(`/void-pin/${s.userId}/unlock`).set('Authorization', auth);
      const refused = await unlock(s.auth).expect(403);
      expect(refused.body.code).toBe('fresh_sign_in_required');
      await retry(s, saleId).expect(429);
      await unlock(s.freshAuth).expect(200);
      const ok = await retry(s, saleId).expect(200);
      expect(ok.body.refundStatus).toBe('pending');
      expect(await asked()).toBe(before + 1);
      // Leave nothing in flight for the file's balance check.
      await gateway(
        s.tenantId,
        'POST',
        `/refunds/${(await paymentsOf(saleId))[0].refund_key}/succeed`,
      );
      await sync.tick(later());
    });

    it('UMK-2054 the owner session alone cannot get around the PIN of a retry: no removal, no new PIN, no unlock without a fresh sign-in', async () => {
      const s = await shop();
      const saleId = await paidSale(s);
      await gatewaySettings('fail');
      await refund(s, saleId).expect(201);
      await gatewaySettings('pending');
      const asked = async () => (await billOf(s, saleId)).refunds.length;
      const before = await asked();
      const mine = { approverId: s.userId, pin: '270183' };

      // The reported way in: remove the PIN, make a new one, approve the retry with it.
      const removed = await http()
        .delete(`/void-pin/${s.userId}`)
        .set('Authorization', s.auth)
        .expect(403);
      expect(removed.body.code).toBe('fresh_sign_in_required');
      await http()
        .put('/void-pin')
        .set('Authorization', s.auth)
        .send({ pin: mine.pin })
        .expect(422);
      const refused = await retry(s, saleId, mine).expect(422);
      expect(refused.body.errors).toEqual({ pin: 'PIN salah' });
      expect(await asked()).toBe(before);
      expect((await voidsOf(saleId))[0].refund_status).toBe('failed');

      // The owner's own PIN still approves it.
      await retry(s, saleId).expect(200);
      expect(await asked()).toBe(before + 1);
      await gateway(
        s.tenantId,
        'POST',
        `/refunds/${(await paymentsOf(saleId))[0].refund_key}/succeed`,
      );
      await sync.tick(later());
    });

    it('V4 a refused refund is marked returned by hand by the owner only, with a note; a refund that was not refused is not', async () => {
      const s = await shop();
      const pending = await paidSale(s);
      await refund(s, pending).expect(201);
      // Retrying and saying the money went back by hand are the owner's alone, also for `sales.void`.
      const supervisor = await createCashier(app, s, [
        'sales.create',
        'sales.void',
      ]);
      await retry(supervisor, pending).expect(403);
      await post(supervisor.auth, `/sales/${pending}/refund/manual`, {
        note: 'tunai',
      }).expect(403);
      const not = await post(s.auth, `/sales/${pending}/refund/manual`, {
        note: 'tunai',
      }).expect(409);
      expect(not.body.code).toBe('not_refund_failed');
      expect((await voidsOf(pending))[0].refund_status).toBe('pending');
      const [open] = await paymentsOf(pending);
      await gateway(s.tenantId, 'POST', `/refunds/${open.refund_key}/succeed`);

      const saleId = await paidSale(s);
      await gatewaySettings('fail');
      await refund(s, saleId).expect(201);
      const noNote = await post(
        s.auth,
        `/sales/${saleId}/refund/manual`,
        {},
      ).expect(422);
      expect(noNote.body.errors).toEqual({
        note: 'Tulis cara uang dikembalikan',
      });
      await post(supervisor.auth, `/sales/${saleId}/refund/manual`, {
        note: 'Dikembalikan tunai ke pelanggan',
      }).expect(403);
      expect((await paymentsOf(saleId))[0].status).toBe('refund_failed');
      const res = await post(s.auth, `/sales/${saleId}/refund/manual`, {
        note: 'Dikembalikan tunai ke pelanggan',
      }).expect(200);
      expect(res.body.refundStatus).toBe('succeeded');
      expect((await paymentsOf(saleId))[0].status).toBe('refunded');
      const again = await post(s.auth, `/sales/${saleId}/refund/manual`, {
        note: 'lagi',
      }).expect(200);
      expect(again.body.refundStatus).toBe('succeeded');
      const view = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(view.body).toMatchObject({
        status: 'refunded',
        refund: { status: 'succeeded' },
      });
    });

    it('V4 a refund the gateway refused a moment ago is marked by hand at once: the mark asks where the refund stands first', async () => {
      const s = await shop();
      const saleId = await paidSale(s);
      await refund(s, saleId).expect(201);
      const [payment] = await paymentsOf(saleId);
      await gateway(s.tenantId, 'POST', `/refunds/${payment.refund_key}/fail`);
      // Nothing has asked since: pos-api still has it as pending.
      expect((await voidsOf(saleId))[0].refund_status).toBe('pending');
      const res = await post(s.auth, `/sales/${saleId}/refund/manual`, {
        note: 'Dikembalikan tunai ke pelanggan',
      }).expect(200);
      expect(res.body.refundStatus).toBe('succeeded');
      expect((await paymentsOf(saleId))[0].status).toBe('refunded');
    });

    it('a refund while payment-api is down reverses the sale and is sent by the job, once', async () => {
      const s = await shop();
      const saleId = await paidSale(s);
      link = 'down';
      const res = await refund(s, saleId).expect(201);
      expect(res.body.refundStatus).toBe('pending');
      link = 'ok';
      expect((await paymentsOf(saleId))[0].status).toBe('paid');
      const waiting = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(waiting.body).toMatchObject({
        saleStatus: 'void',
        status: 'paid',
        refund: { status: 'pending', sent: false },
      });
      expect(await sync.tick()).toMatchObject({ voided: 1, failed: 0 });
      expect((await paymentsOf(saleId))[0].status).toBe('refund_pending');
      expect(await voidsOf(saleId)).toEqual([
        { refund_status: 'pending', payment_sync_pending: false },
      ]);
      await sync.tick();
      expect((await billOf(s, saleId)).refunds).toHaveLength(1);
      const [payment] = await paymentsOf(saleId);
      await gateway(
        s.tenantId,
        'POST',
        `/refunds/${payment.refund_key}/succeed`,
      );
    });
  });

  describe('a sale counts from when it was paid (owner ruling 2026-11-25)', () => {
    const revenue = async (s: Shop, day: string) =>
      (
        (await get(s.auth, `/reports/sales?from=${day}&to=${day}`).expect(200))
          .body as { totals: { revenue: number } }
      ).totals.revenue;
    const listed = async (s: Shop, fromDay: string, toDay: string) =>
      (
        (
          await get(
            s.auth,
            `/sales?from=${fromDay}T00:00:00%2B07:00&to=${toDay}T00:00:00%2B07:00`,
          ).expect(200)
        ).body as { data: { id: string }[] }
      ).data.map((x) => x.id);
    /** The sale was rung up yesterday at 23:58 (store time) and still waits. */
    const rungUpYesterday = (saleId: string) =>
      admin`update pos.sales set
          created_at = (${jakartaDay(-1)}::date + time '23:58') at time zone 'Asia/Jakarta',
          paid_at = (${jakartaDay(-1)}::date + time '23:58') at time zone 'Asia/Jakarta'
        where id = ${saleId}`;
    const times = async (saleId: string) =>
      (
        await admin<
          {
            at_creation: boolean;
            today: boolean;
            future: boolean;
            seconds: number;
          }[]
        >`select paid_at = created_at as at_creation, paid_at > now() as future,
            extract(epoch from paid_at - created_at)::float8 as seconds,
            (paid_at at time zone 'Asia/Jakarta')::date = ${jakartaDay()}::date as today
          from pos.sales where id = ${saleId}`
      )[0];

    it('a PG sale rung up before midnight and paid after it is in the new day’s report and list, not the old day’s', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await rungUpYesterday(saleId);
      // Waiting: in no day's figures.
      expect(await revenue(s, jakartaDay(-1))).toBe(0);
      expect(await revenue(s, jakartaDay())).toBe(0);

      await onBill(s, saleId, 'pay');
      await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      // payment-api's clock runs ahead in this file: the paid time is never taken into the future.
      expect(await times(saleId)).toMatchObject({
        at_creation: false,
        today: true,
        future: false,
      });
      expect(await revenue(s, jakartaDay(-1))).toBe(0);
      expect(await revenue(s, jakartaDay())).toBe(PRICE);
      expect(await listed(s, jakartaDay(-1), jakartaDay())).toEqual([]);
      expect(await listed(s, jakartaDay(), jakartaDay(1))).toEqual([saleId]);
      const sale = await get(s.auth, `/sales/${saleId}`).expect(200);
      expect(sale.body.paidAt).not.toBe(sale.body.createdAt);

      // Its refund is a reversal on the day of the refund, as a void is.
      await refund(s, saleId).expect(201);
      expect(await revenue(s, jakartaDay(-1))).toBe(0);
      expect(await revenue(s, jakartaDay())).toBe(0);
      const [payment] = await paymentsOf(saleId);
      await gateway(
        s.tenantId,
        'POST',
        `/refunds/${payment.refund_key}/succeed`,
      );
      await sync.tick(later());
    });

    it('a sale switched to cash counts from when the cashier took the cash; a sale paid at once counts from when it was rung up', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await rungUpYesterday(saleId);
      await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 5200,
      }).expect(200);
      expect(await times(saleId)).toMatchObject({
        at_creation: false,
        today: true,
      });
      expect(await revenue(s, jakartaDay(-1))).toBe(0);
      expect(await revenue(s, jakartaDay())).toBe(PRICE);

      const cash = await sell(s, {
        paymentMethodId: undefined,
        paid: 10_000,
      }).expect(201);
      // Paid in the request that rang it up: the same moment, to the second.
      const at = await times(cash.body.id as string);
      expect(at.seconds).toBeGreaterThanOrEqual(0);
      expect(at.seconds).toBeLessThan(5);
      // A cancelled sale is in no day's figures.
      const gone = (await sell(s).expect(201)).body.id as string;
      await post(s.auth, `/sales/${gone}/payment/cancel`).expect(200);
      expect(await revenue(s, jakartaDay())).toBe(2 * PRICE);
    });

    it.each([
      ['no paid time', null],
      ['a paid time that is no time', 'kemarin sore'],
      ['a paid time that is no ISO time', '25/11/2026 10:03'],
    ])(
      'a paid PG sale is completed and counts from now when payment-api answers %s',
      async (_name, paidAt) => {
        const s = await shop();
        const saleId = (await sell(s).expect(201)).body.id as string;
        await rungUpYesterday(saleId);
        await onBill(s, saleId, 'pay');
        mangle = (p) => {
          p.paidAt = paidAt;
        };
        // Never a 500, never a sale left waiting on a bad value: the poll completes it.
        const view = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
        expect(view.body).toMatchObject({
          saleStatus: 'completed',
          status: 'paid',
        });
        expect(await times(saleId)).toMatchObject({
          at_creation: false,
          today: true,
          future: false,
        });
        expect(await revenue(s, jakartaDay(-1))).toBe(0);
        expect(await revenue(s, jakartaDay())).toBe(PRICE);
      },
    );

    it('a cash sale whose payment the job records the next day counts from that day', async () => {
      const s = await shop();
      // payment-api recorded the cash, but its answer never arrived: the sale waits.
      loseAnswerOf = isCharge;
      const res = await sell(s, {
        paymentMethodId: undefined,
        paid: 10_000,
      }).expect(503);
      const saleId = res.body.saleId as string;
      await rungUpYesterday(saleId);
      expect(await sync.tick(later())).toMatchObject({
        completed: 1,
        cancelled: 0,
        failed: 0,
      });
      expect((await saleRow(saleId)).status).toBe('completed');
      expect(await times(saleId)).toMatchObject({
        at_creation: false,
        today: true,
      });
      expect(await revenue(s, jakartaDay(-1))).toBe(0);
      // Rp5.123 total; the Rp77 rounding is not revenue.
      expect(await revenue(s, jakartaDay())).toBe(PRICE);
    });

    it('the migration dates every earlier sale at the time it was rung up', async () => {
      const s = await shop();
      const cash = await sell(s, {
        paymentMethodId: undefined,
        paid: 10_000,
      }).expect(201);
      const id = cash.body.id as string;
      const statement = readFileSync(
        path.join(__dirname, '..', 'drizzle', '0035_sale_paid_at.sql'),
        'utf8',
      )
        .split('--> statement-breakpoint')
        .map((x) => x.replace(/^\s*--.*$/gm, '').trim())
        .find((x) => x.startsWith('UPDATE'))!;
      // As the migration finds a row: `paid_at` stamped by the new column's default. Rolled back after.
      const rollback = new Error('rollback');
      await admin
        .begin(async (tx) => {
          await tx`update pos.sales set created_at = now() - interval '40 days' where id = ${id}`;
          await tx.unsafe(statement);
          const [row] = await tx<
            { same: boolean }[]
          >`select paid_at = created_at as same from pos.sales where id = ${id}`;
          expect(row.same).toBe(true);
          throw rollback;
        })
        .catch((e: unknown) => {
          if (e !== rollback) throw e;
        });
    });
  });

  describe('UMK-2043 payment-page link (fake_checkout)', () => {
    it('a checkout method sells: awaiting with the https payment page, paid → completed, refunded like any PG sale', async () => {
      const s = await shop();
      const link = await method(s, 'Link Pembayaran', 'fake_checkout');
      const res = await sell(s, { paymentMethodId: link }).expect(201);
      const saleId = res.body.id as string;
      expect(res.body.payment).toMatchObject({
        saleStatus: 'awaiting_payment',
        online: true,
        method: 'fake_checkout',
        paymentMethodName: 'Link Pembayaran',
        attempt: 1,
        canRenew: true,
      });
      const checkout = res.body.payment.checkout as Record<string, string>;
      expect(Object.keys(checkout)).toEqual(['paymentUrl']);
      expect(checkout.paymentUrl).toMatch(/^https:\/\//);
      expect(await onHand(s)).toBe(19);
      await onBill(s, saleId, 'pay');
      const paid = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(paid.body).toMatchObject({
        saleStatus: 'completed',
        status: 'paid',
        method: 'fake_checkout',
      });
      await gatewaySettings('succeed');
      await refund(s, saleId).expect(201);
      expect((await saleRow(saleId)).status).toBe('void');
    });

    it('a payment page that is not https (or carries credentials) never reaches the screen', async () => {
      const s = await shop();
      const link = await method(s, 'Link Pembayaran', 'fake_checkout');
      for (const bad of [
        'javascript:alert(1)',
        'http://fake-gateway.invalid/pay/1',
        'https://user:secret@fake-gateway.invalid/pay/1',
        'not a url',
      ]) {
        mangle = (p) => {
          if (p.checkout)
            (p.checkout as Record<string, string>).paymentUrl = bad;
        };
        const res = await sell(s, { paymentMethodId: link }).expect(201);
        expect(res.body.payment.checkout ?? {}).not.toHaveProperty(
          'paymentUrl',
        );
        mangle = null;
        await post(s.auth, `/sales/${res.body.id}/payment/cancel`).expect(200);
      }
    });

    it('the database takes fake_checkout and still refuses a method it does not know', async () => {
      const s = await shop();
      const insert = (m: string) =>
        admin`insert into pos.payment_methods (tenant_id, name, is_online, gateway_method)
          values (${s.tenantId}, ${m}, true, ${m}) returning id`;
      await insert('fake_checkout');
      await expect(insert('xendit_checkout')).rejects.toThrow(
        /payment_methods_gateway_method_ck/,
      );
    });
  });

  describe('UMK-2041 "Perlu ditinjau"', () => {
    type Review = {
      enabled: boolean;
      receipts: {
        items: Record<string, unknown>[];
        total: number;
        page: number;
        perPage: number;
      };
      failedRefunds: Record<string, unknown>[];
    };
    const review = async (auth: string, query = '') =>
      (await get(auth, `/payment-review${query}`).expect(200)).body as Review;

    /** A sale whose bill closed unpaid (cancelled), then the customer paid it after all. */
    async function lateMoney(s: Shop) {
      const saleId = (await sell(s).expect(201)).body.id as string;
      await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(200);
      await onBill(s, saleId, 'late-pay');
      return saleId;
    }

    it('lists money that paid no sale with its sale, amount, kind and refund status, and the refused refunds; needsReview filters', async () => {
      const s = await shop();
      await gatewaySettings('fail');
      const failedLate = await lateMoney(s);
      await gatewaySettings('succeed');
      const refundedLate = await lateMoney(s);
      // A refund of a paid sale that the gateway refuses.
      const refused = await paidSale(s);
      await gatewaySettings('fail');
      await refund(s, refused).expect(201);

      const all = await review(s.auth);
      expect(all.enabled).toBe(true);
      expect(all.receipts.total).toBe(2);
      const bySale = new Map(all.receipts.items.map((r) => [r.saleId, r]));
      expect(bySale.get(failedLate)).toMatchObject({
        kind: 'late_payment',
        amount: PRICE,
        needsReview: true,
        refundStatus: 'failed',
        saleStatus: 'cancelled',
        receivedAt: expect.any(String),
      });
      expect(bySale.get(refundedLate)).toMatchObject({
        kind: 'late_payment',
        amount: PRICE,
        refundStatus: 'refunded',
        saleStatus: 'cancelled',
      });
      expect(bySale.get(failedLate)!.saleNumber).not.toBeNull();
      // Only the known fields: no payment id, gateway reference, fee or actor.
      for (const r of all.receipts.items)
        expect(Object.keys(r).sort()).toEqual(
          [
            'amount',
            'id',
            'kind',
            'needsReview',
            'receivedAt',
            'refundStatus',
            'saleId',
            'saleNumber',
            'saleStatus',
          ].sort(),
        );
      expect(all.failedRefunds).toMatchObject([
        { saleId: refused, amount: PRICE, reasonCode: 'customer_cancelled' },
      ]);

      const open = await review(s.auth, '?needsReview=true');
      expect(open.receipts.items.map((r) => r.saleId)).toEqual([failedLate]);
      const done = await review(s.auth, '?needsReview=false');
      expect(done.receipts.items.map((r) => r.saleId)).toEqual([refundedLate]);
      const paged = await review(s.auth, '?perPage=1&page=2');
      expect(paged.receipts).toMatchObject({ page: 2, perPage: 1, total: 2 });
      expect(paged.receipts.items).toHaveLength(1);

      for (const q of ['?needsReview=yes', '?perPage=101', '?page=0', '?x=1'])
        await get(s.auth, `/payment-review${q}`).expect(422);
      link = 'down';
      await get(s.auth, '/payment-review').expect(503);
      link = 'ok';
    });

    it('only the owner (payments.manage): a cashier and an admin get 403', async () => {
      const s = await shop();
      const kasir = await createCashier(app, s);
      const adminLike = await createCashier(app, s, [
        'sales.create',
        'sales.void',
        'reports.view',
        'staff.manage',
      ]);
      await get(kasir.auth, '/payment-review').expect(403);
      await get(adminLike.auth, '/payment-review').expect(403);
      await http().get('/payment-review').expect(401);
      await get(s.auth, '/payment-review').expect(200);
    });

    it('cross-tenant: store B sees none of store A’s money, and A’s sale is never named to B', async () => {
      const a = await shop();
      const b = await shop();
      await gatewaySettings('succeed');
      const saleA = await lateMoney(a);
      expect((await review(a.auth)).receipts.items).toMatchObject([
        { saleId: saleA },
      ]);
      expect(await review(b.auth)).toMatchObject({
        receipts: { items: [], total: 0 },
        failedRefunds: [],
      });
      // Even if payment-api named A's sale to B, pos-api looks the sale up in B's store only.
      answerInstead = (c) =>
        c.url.includes('/unmatched-receipts')
          ? Response.json({
              items: [
                {
                  id: randomUUID(),
                  orderRef: saleA,
                  kind: 'late_payment',
                  grossAmount: PRICE,
                  needsReview: true,
                  refundStatus: 'pending',
                  createdAt: new Date().toISOString(),
                  paymentId: randomUUID(),
                  feeAmount: 10,
                },
              ],
              page: 1,
              perPage: 50,
              total: 1,
            })
          : null;
      const leaked = await review(b.auth);
      expect(leaked.receipts.items).toMatchObject([
        { saleId: null, saleNumber: null, saleStatus: null, amount: PRICE },
      ]);
      expect(leaked.receipts.items[0]).not.toHaveProperty('paymentId');
      expect(leaked.receipts.items[0]).not.toHaveProperty('feeAmount');
    });
  });

  describe('UMK-2042 "Buat QR baru"', () => {
    const renew = (auth: string, saleId: string, body: object) =>
      post(auth, `/sales/${saleId}/payment/renew`, body);
    const live = (saleId: string) =>
      pay.sql<{ n: number }[]>`
        select count(*)::int as n from payment.payments
        where order_ref = ${saleId} and status in ('created', 'pending')`;
    const renewAt = async (saleId: string) =>
      (
        await admin<
          { payment_renew_at: Date | null }[]
        >`select payment_renew_at from pos.sales where id = ${saleId}`
      )[0].payment_renew_at;

    it('a new bill for the same sale: the old one is closed first, key <saleId>:2, stock and voucher stay; the new bill pays the sale once and money on the old one is refunded', async () => {
      const s = await shop();
      const first = await sell(s).expect(201);
      const saleId = first.body.id as string;
      const oldQr = first.body.payment.checkout.qrString as string;
      const res = await renew(s.auth, saleId, { attempt: 1 }).expect(200);
      expect(res.body).toMatchObject({
        saleStatus: 'awaiting_payment',
        status: 'awaiting_payment',
        attempt: 2,
        method: 'fake_qris',
        amount: PRICE,
        canRenew: true,
      });
      expect(res.body.checkout.qrString).not.toBe(oldQr);
      const [old, fresh, ...more] = await paymentsOf(saleId);
      expect(more).toEqual([]);
      expect(old).toMatchObject({
        idempotency_key: `${saleId}:1`,
        status: 'cancelled',
      });
      expect(fresh).toMatchObject({
        idempotency_key: `${saleId}:2`,
        method: 'fake_qris',
        amount: String(PRICE),
        status: 'pending',
      });
      expect((await live(saleId))[0].n).toBe(1);
      expect(await saleRow(saleId)).toMatchObject({
        status: 'awaiting_payment',
        payment_attempt: 2,
      });
      expect(await renewAt(saleId)).toBeNull();
      expect(await onHand(s)).toBe(19);

      // The customer pays the new QR: completed once.
      const bill2 = (await bills(s.tenantId)).filter(
        (b) => b.orderRef === saleId,
      );
      const open = bill2.find((b) => b.status !== 'cancelled')!;
      await gateway(s.tenantId, 'POST', `/payments/${open.providerRef}/pay`);
      const done = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(done.body).toMatchObject({
        saleStatus: 'completed',
        status: 'paid',
        attempt: 2,
        canRenew: false,
      });
      expect(await saleRow(saleId)).toMatchObject({ payment_id: fresh.id });

      // The old QR paid after all: payment-api refunds it, the sale is not paid twice.
      await gatewaySettings('succeed');
      const closed = bill2.find((b) => b.status === 'cancelled')!;
      await gateway(
        s.tenantId,
        'POST',
        `/payments/${closed.providerRef}/late-pay`,
      );
      const late = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(late.body).toMatchObject({
        saleStatus: 'completed',
        lateReceipts: [{ attempt: 1, amount: PRICE, kind: 'late_payment' }],
      });
      expect(
        (await paymentsOf(saleId)).filter((p) => p.status === 'paid'),
      ).toHaveLength(1);
      expect(await shift(s.auth)).toMatchObject({ salesCount: 1 });
    });

    it('replay safe: the same attempt twice (also at once) makes one new bill; renewing the new bill makes the third; the limit is 409', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      const [x, y] = await Promise.all([
        renew(s.auth, saleId, { attempt: 1 }),
        renew(s.auth, saleId, { attempt: 1 }),
      ]);
      // One makes the bill; the other answers it, or is told one is being made (never a second intent).
      const ok = [x, y].filter((r) => r.status === 200);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      for (const r of [x, y].filter((r) => r.status !== 200)) {
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('renew_in_progress');
      }
      for (const r of ok) expect(r.body.attempt).toBe(2);
      const again = await renew(s.auth, saleId, { attempt: 1 }).expect(200);
      expect(again.body.checkout).toEqual(ok[0].body.checkout);
      expect(await paymentsOf(saleId)).toHaveLength(2);
      expect((await live(saleId))[0].n).toBe(1);

      await renew(s.auth, saleId, { attempt: 2 }).expect(200);
      await renew(s.auth, saleId, { attempt: 3 }).expect(200);
      const fifth = await renew(s.auth, saleId, { attempt: 4 }).expect(200);
      expect(fifth.body).toMatchObject({ attempt: 5, canRenew: false });
      const limit = await renew(s.auth, saleId, { attempt: 5 }).expect(409);
      expect(limit.body.code).toBe('attempt_limit');
      expect(await paymentsOf(saleId)).toHaveLength(5);
      expect((await live(saleId))[0].n).toBe(1);
      // An attempt the sale never had is a bad request.
      await renew(s.auth, saleId, { attempt: 9 }).expect(422);
      await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(200);
      expect((await live(saleId))[0].n).toBe(0);
      expect(await onHand(s)).toBe(20);
    });

    it('a renew that fails beside a live one never takes the live one’s intent: the sale is not cancelled under it', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await renew(s.auth, saleId, { attempt: 1 }).expect(200);
      // A: the live renewal of attempt 2, held once the old bill is closed (its intent set).
      const closeHold = hold(isCancel, 'after');
      const running = renew(s.auth, saleId, { attempt: 2 }).then((r) => r);
      await closeHold.held;
      const intent = await renewAt(saleId);
      expect(intent).not.toBeNull();
      try {
        // A second tap on the same attempt is refused and changes nothing.
        const twice = await renew(s.auth, saleId, { attempt: 2 }).expect(409);
        expect(twice.body.code).toBe('renew_in_progress');
        // A stale tab (attempt 1) whose request gets no answer: 503, and it takes back only its own intent.
        link = 'down';
        await renew(s.auth, saleId, { attempt: 1 }).expect(503);
        link = 'ok';
        expect(await renewAt(saleId)).toEqual(intent);
        // So the poll that finds the old bill closed leaves the sale waiting.
        const poll = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
        expect(poll.body.saleStatus).toBe('awaiting_payment');
        // Nor does the job take it back before it is stranded.
        await sync.tick(new Date());
        expect(await renewAt(saleId)).toEqual(intent);
      } finally {
        link = 'ok';
        closeHold.release();
      }
      expect((await running).body).toMatchObject({
        saleStatus: 'awaiting_payment',
        attempt: 3,
      });
      expect((await live(saleId))[0].n).toBe(1);
      await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(200);
    });

    it('the customer paid the old bill first: 409 already_paid, completed with it, no new bill', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await onBill(s, saleId, 'pay');
      const res = await renew(s.auth, saleId, { attempt: 1 }).expect(409);
      expect(res.body.code).toBe('already_paid');
      expect(await saleRow(saleId)).toMatchObject({
        status: 'completed',
        payment_attempt: 1,
      });
      expect(await paymentsOf(saleId)).toHaveLength(1);
    });

    it('a poll that read the sale before the renewal and finds the old bill closed never cancels it (stale rule)', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      // The poll reads the sale (no intent yet) and is held before it asks payment-api.
      const pollHold = hold(isFindByKey, 'before');
      const poll = get(s.auth, `/sales/${saleId}/payment`).then((r) => r);
      await pollHold.held;
      // The renewal closes the old bill and is held there, before the sale moves.
      const closeHold = hold(isCancel, 'after');
      const renewing = renew(s.auth, saleId, { attempt: 1 }).then((r) => r);
      await closeHold.held;
      // The poll now finds the old bill closed: it must not cancel the sale.
      try {
        pollHold.release();
        expect((await poll).status).toBe(200);
        expect((await saleRow(saleId)).status).toBe('awaiting_payment');
        // Nor do a check or the job while the renewal runs.
        await post(s.auth, `/sales/${saleId}/payment/check`).expect(200);
        await sync.tick(new Date());
        expect((await saleRow(saleId)).status).toBe('awaiting_payment');
      } finally {
        closeHold.release();
      }
      expect((await renewing).body).toMatchObject({
        saleStatus: 'awaiting_payment',
        attempt: 2,
      });
      expect(await onHand(s)).toBe(19);
      await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(200);
    });

    it('cash and renew exclude each other; a cancel during a renewal wins', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      // A switch to cash asked (its request at work): no new bill.
      await admin`update pos.sales set switch_cash_paid = 10000 where id = ${saleId}`;
      const r = await renew(s.auth, saleId, { attempt: 1 }).expect(409);
      expect(r.body.code).toBe('switching_to_cash');
      await admin`update pos.sales set switch_cash_paid = null where id = ${saleId}`;
      // The cash request drops a renewal intent: cash wins.
      await admin`update pos.sales set payment_renew_at = now() where id = ${saleId}`;
      const cash = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 10_000,
      }).expect(200);
      expect(cash.body).toMatchObject({
        saleStatus: 'completed',
        method: 'cash',
      });
      expect(await renewAt(saleId)).toBeNull();
      // A cash sale gets no new bill.
      const after = await renew(s.auth, saleId, { attempt: 2 }).expect(409);
      expect(after.body.code).toBe('already_paid');

      // A cancel while a renewal is held: one outcome, cancelled, no live bill.
      const other = (await sell(s).expect(201)).body.id as string;
      const h = hold(isCancel, 'before');
      const renewing = renew(s.auth, other, { attempt: 1 }).then((x) => x);
      await h.held;
      const cancel = post(s.auth, `/sales/${other}/payment/cancel`).then(
        (x) => x,
      );
      h.release();
      const [rn, cn] = await Promise.all([renewing, cancel]);
      expect(cn.status).toBe(200);
      expect([200, 409, 503]).toContain(rn.status);
      // Whatever the renewal answered, the sale ends cancelled or waiting on exactly one bill.
      const row = await saleRow(other);
      if (row.status === 'awaiting_payment') {
        expect((await live(other))[0].n).toBe(1);
        await post(s.auth, `/sales/${other}/payment/cancel`).expect(200);
      }
      expect((await saleRow(other)).status).toBe('cancelled');
      expect((await live(other))[0].n).toBe(0);
    });

    it('payment-api down: 503, the intent is taken back and the sale still waits on its old bill', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      link = 'down';
      const res = await renew(s.auth, saleId, { attempt: 1 }).expect(503);
      expect(res.body.code).toBe('payment_unavailable');
      link = 'ok';
      expect(await saleRow(saleId)).toMatchObject({
        status: 'awaiting_payment',
        payment_attempt: 1,
      });
      expect(await renewAt(saleId)).toBeNull();
      expect((await paymentsOf(saleId))[0].status).toBe('pending');
      await onBill(s, saleId, 'pay');
      const paid = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(paid.body).toMatchObject({ saleStatus: 'completed', attempt: 1 });
    });

    it('the new bill’s charge got no answer: 503 renew_pending, a repeat answers the bill; if nobody repeats, the job gives the sale up with its stock back', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      link = 'no_charge';
      const res = await renew(s.auth, saleId, { attempt: 1 }).expect(503);
      expect(res.body.code).toBe('renew_pending');
      link = 'ok';
      expect(await saleRow(saleId)).toMatchObject({
        status: 'awaiting_payment',
        payment_attempt: 2,
      });
      expect((await live(saleId))[0].n).toBe(0);
      const again = await renew(s.auth, saleId, { attempt: 1 }).expect(200);
      expect(again.body).toMatchObject({ attempt: 2 });
      expect(again.body.checkout.qrString).toEqual(expect.any(String));
      expect((await live(saleId))[0].n).toBe(1);
      await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(200);

      const other = (await sell(s).expect(201)).body.id as string;
      link = 'no_charge';
      await renew(s.auth, other, { attempt: 1 }).expect(503);
      link = 'ok';
      // A poll never gives up; the job does after its wait, closing the key first.
      await get(s.auth, `/sales/${other}/payment`).expect(200);
      expect((await saleRow(other)).status).toBe('awaiting_payment');
      await sync.tick(later());
      expect((await saleRow(other)).status).toBe('cancelled');
      expect(
        (await paymentsOf(other)).map((p) => [p.idempotency_key, p.status]),
      ).toEqual([
        [`${other}:1`, 'cancelled'],
        [`${other}:2`, 'cancelled'],
      ]);
      expect(await onHand(s)).toBe(20);
    });

    it('the job takes back a stranded intent; the sale then waits on its open bill', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      await admin`update pos.sales set payment_renew_at = now() - interval '10 minutes' where id = ${saleId}`;
      await sync.tick(later());
      expect(await renewAt(saleId)).toBeNull();
      expect(await saleRow(saleId)).toMatchObject({
        status: 'awaiting_payment',
        payment_attempt: 1,
      });
      await post(s.auth, `/sales/${saleId}/payment/cancel`).expect(200);
    });

    it('who: the sale’s cashier or a sales.void holder; another cashier and store B get 404; a cash sale 409; a bad body 422', async () => {
      const s = await shop();
      const b = await shop();
      const ayu = await createCashier(app, s);
      const budi = await createCashier(app, s);
      const supervisor = await createCashier(app, s, [
        'sales.create',
        'sales.void',
      ]);
      await post(ayu.auth, '/shifts/open', { openingCash: 0 }).expect(201);
      const saleId = (await sell(s, {}, randomUUID(), ayu.auth).expect(201))
        .body.id as string;
      await renew(budi.auth, saleId, { attempt: 1 }).expect(404);
      await renew(b.auth, saleId, { attempt: 1 }).expect(404);
      expect((await paymentsOf(saleId))[0].status).toBe('pending');
      for (const bad of [
        {},
        { attempt: 0 },
        { attempt: 1.5 },
        { attempt: 1, x: 1 },
      ])
        await renew(ayu.auth, saleId, bad).expect(422);
      await renew(ayu.auth, saleId, { attempt: 1 }).expect(200);
      await renew(supervisor.auth, saleId, { attempt: 2 }).expect(200);
      await http()
        .post(`/sales/${saleId}/payment/renew`)
        .send({ attempt: 3 })
        .expect(401);
      await post(ayu.auth, `/sales/${saleId}/payment/cancel`).expect(200);

      const cash = await post(
        s.auth,
        '/sales',
        {
          lines: [{ productId: s.productId, qty: 1 }],
          paid: 10_000,
        },
        randomUUID(),
      ).expect(201);
      const r = await renew(s.auth, cash.body.id, { attempt: 1 }).expect(409);
      expect(r.body.code).toBe('already_paid');
    });
  });

  describe('who may act', () => {
    /** `GET /sales?status=awaiting_payment` as `auth` sees it. */
    const awaitingIds = async (auth: string) => {
      const res = await get(auth, '/sales?status=awaiting_payment').expect(200);
      const data = res.body.data as {
        id: string;
        actorId: string;
        mine: boolean;
      }[];
      return {
        ids: data.map((x) => x.id).sort(),
        total: res.body.total as number,
        data,
      };
    };

    it('UMK-2047 the waiting list holds what the caller may act on: their own, or all with sales.void; reports.view alone is not enough', async () => {
      const s = await shop();
      const ayu = await createCashier(app, s);
      const budi = await createCashier(app, s);
      const reader = await createCashier(app, s, [
        'sales.create',
        'reports.view',
      ]);
      const supervisor = await createCashier(app, s, [
        'sales.create',
        'sales.void',
      ]);
      for (const c of [ayu, reader])
        await post(c.auth, '/shifts/open', { openingCash: 0 }).expect(201);
      const sale = async (auth: string) =>
        (await sell(s, {}, randomUUID(), auth).expect(201)).body.id as string;
      const ofAyu = await sale(ayu.auth);
      const ofReader = await sale(reader.auth);
      const ofOwner = await sale(s.auth);
      const all = [ofAyu, ofReader, ofOwner].sort();

      const mineOnly = await awaitingIds(ayu.auth);
      expect(mineOnly).toMatchObject({ ids: [ofAyu], total: 1 });
      expect(mineOnly.data[0]).toMatchObject({
        actorId: ayu.staffId,
        mine: true,
      });
      expect(await awaitingIds(budi.auth)).toMatchObject({ ids: [], total: 0 });
      // `reports.view` reads every receipt, but a waiting sale of someone else is not theirs to act on:
      // its payment route answers 404, so the list does not offer it.
      expect(await awaitingIds(reader.auth)).toMatchObject({
        ids: [ofReader],
        total: 1,
      });
      await get(reader.auth, `/sales/${ofAyu}/payment`).expect(404);
      // `sales.void` (no `reports.view`) recovers any stuck payment of the store.
      const seen = await awaitingIds(supervisor.auth);
      expect(seen).toMatchObject({ ids: all, total: 3 });
      expect(seen.data.every((x) => !x.mine)).toBe(true);
      await get(supervisor.auth, `/sales/${ofAyu}/payment`).expect(200);
      const owner = await awaitingIds(s.auth);
      expect(owner.ids).toEqual(all);
      expect(owner.data.map((x) => [x.id, x.actorId, x.mine]).sort()).toEqual(
        [
          [ofAyu, ayu.staffId, false],
          [ofReader, reader.staffId, false],
          [ofOwner, s.userId, true],
        ].sort(),
      );
      // Receipts keep their scope: a reader still lists every completed sale of the store.
      await onBill(s, ofAyu, 'pay');
      await get(ayu.auth, `/sales/${ofAyu}/payment`).expect(200);
      const receipts = await get(reader.auth, '/sales').expect(200);
      expect(
        (receipts.body.data as { id: string; mine: boolean }[]).map((x) => [
          x.id,
          x.mine,
        ]),
      ).toEqual([[ofAyu, false]]);
      for (const [auth, id] of [
        [reader.auth, ofReader],
        [s.auth, ofOwner],
      ])
        await post(auth, `/sales/${id}/payment/cancel`).expect(200);
    });

    it('cross-tenant: store B gets 404 on every payment route of store A’s sale, and nothing of A changes', async () => {
      const a = await shop();
      const b = await shop();
      const waiting = (await sell(a).expect(201)).body.id as string;
      const paid = await paidSale(a);
      const refunded = await paidSale(a);
      await gatewaySettings('fail');
      await refund(a, refunded).expect(201);

      await get(b.auth, `/sales/${waiting}/payment`).expect(404);
      await post(b.auth, `/sales/${waiting}/payment/check`).expect(404);
      await post(b.auth, `/sales/${waiting}/payment/cash`, {
        paid: 10_000,
      }).expect(404);
      await post(b.auth, `/sales/${waiting}/payment/cancel`).expect(404);
      await post(
        b.auth,
        `/sales/${paid}/refund`,
        approval(b),
        randomUUID(),
      ).expect(404);
      await retry(b, refunded).expect(404);
      await post(b.auth, `/sales/${refunded}/refund/manual`, {
        note: 'x',
      }).expect(404);
      await get(b.auth, `/sales/${refunded}/void`).expect(404);
      // UMK-2047: the waiting list is the session's store only.
      expect((await awaitingIds(b.auth)).ids).toEqual([]);
      expect((await awaitingIds(a.auth)).ids).toEqual([waiting]);

      expect(await saleRow(waiting)).toMatchObject({
        status: 'awaiting_payment',
        switch_cash_paid: null,
      });
      expect((await paymentsOf(waiting))[0].status).toBe('pending');
      expect((await saleRow(paid)).status).toBe('completed');
      expect((await paymentsOf(paid))[0].status).toBe('paid');
      expect((await voidsOf(refunded))[0].refund_status).toBe('failed');
      expect((await paymentsOf(refunded))[0].status).toBe('refund_failed');
      expect(await bills(b.tenantId)).toEqual([]);
      await post(a.auth, `/sales/${waiting}/payment/cancel`).expect(200);
    });

    it('a cashier acts on their own sale; another cashier gets 404; the owner may check and cancel it but not take its cash', async () => {
      const s = await shop();
      const ayu = await createCashier(app, s);
      const budi = await createCashier(app, s);
      await post(ayu.auth, '/shifts/open', { openingCash: 0 }).expect(201);
      const saleId = (await sell(s, {}, randomUUID(), ayu.auth).expect(201))
        .body.id as string;

      await get(budi.auth, `/sales/${saleId}/payment`).expect(404);
      await post(budi.auth, `/sales/${saleId}/payment/check`).expect(404);
      await post(budi.auth, `/sales/${saleId}/payment/cash`, {
        paid: 10_000,
      }).expect(404);
      await post(budi.auth, `/sales/${saleId}/payment/cancel`).expect(404);

      // What pays the bill (the QR) is not for everyone who may read reports: only the sale's cashier, or
      // someone with `sales.void` who recovers a stuck payment.
      const reader = await createCashier(app, s, [
        'sales.create',
        'reports.view',
      ]);
      await get(reader.auth, `/sales/${saleId}/payment`).expect(404);
      await post(reader.auth, `/sales/${saleId}/payment/cancel`).expect(404);
      const supervisor = await createCashier(app, s, [
        'sales.create',
        'sales.void',
      ]);
      const seen = await get(
        supervisor.auth,
        `/sales/${saleId}/payment`,
      ).expect(200);
      expect(seen.body.checkout.qrString).toEqual(expect.any(String));

      // UMK-2047: the payment says whose sale it is, so the screen offers the cash switch to its cashier only.
      expect(seen.body).toMatchObject({ actorId: ayu.staffId, mine: false });
      const own = await get(ayu.auth, `/sales/${saleId}/payment`).expect(200);
      expect(own.body).toMatchObject({ actorId: ayu.staffId, mine: true });

      const asOwner = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(asOwner.body).toMatchObject({ actorId: ayu.staffId, mine: false });
      const notOwn = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 10_000,
      }).expect(409);
      expect(notOwn.body.code).toBe('not_own_sale');
      expect(await saleRow(saleId)).toMatchObject({
        status: 'awaiting_payment',
        switch_cash_paid: null,
      });

      await get(ayu.auth, `/sales/${saleId}/payment`).expect(200);
      const res = await post(ayu.auth, `/sales/${saleId}/payment/cash`, {
        paid: 5200,
      }).expect(200);
      expect(res.body.saleStatus).toBe('completed');
      // The cash is in the drawer of the cashier who sold, charged in her name.
      expect(await shift(ayu.auth)).toMatchObject({ cashSales: 5200 });
      expect(await shift(s.auth)).toMatchObject({ cashSales: 0 });
      const [, cash] = await paymentsOf(saleId);
      const [charged] = await pay.sql<{ actor_ref: string }[]>`
        select actor_ref from payment.payment_events where payment_id = ${cash.id} order by created_at limit 1`;
      expect(charged.actor_ref).toBe(`cashier:${ayu.staffId}`);

      // The owner may give up a cashier's waiting sale.
      const other = (await sell(s, {}, randomUUID(), ayu.auth).expect(201)).body
        .id as string;
      await post(s.auth, `/sales/${other}/payment/cancel`).expect(200);
      expect((await saleRow(other)).status).toBe('cancelled');
    });

    it('needs a session, and a valid sale id', async () => {
      const s = await shop();
      const id = randomUUID();
      await http().get(`/sales/${id}/payment`).expect(401);
      await http().post(`/sales/${id}/payment/cash`).send({}).expect(401);
      await get(s.auth, `/sales/${id}/payment`).expect(404);
      await post(s.auth, `/sales/${id}/payment/cancel`).expect(404);
      await get(s.auth, '/sales/not-a-uuid/payment').expect(404);
      await retry(s, id).expect(404);
    });
  });

  describe('the job', () => {
    it('leaves an open PG sale waiting, and completes it once the payment is paid', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      expect(await sync.tick(later())).toMatchObject({
        completed: 0,
        cancelled: 0,
        failed: 0,
        stopped: false,
      });
      expect((await saleRow(saleId)).status).toBe('awaiting_payment');
      expect(await onHand(s)).toBe(19);
      await onBill(s, saleId, 'pay');
      expect(await sync.tick(later())).toMatchObject({ completed: 1 });
      expect((await saleRow(saleId)).status).toBe('completed');
    });
  });
});
