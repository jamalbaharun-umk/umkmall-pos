import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
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
  /** The answer of the first matching call is lost: payment-api did it, pos-api never hears. */
  let loseAnswerOf: ((c: Call) => boolean) | null = null;
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
          const res = await fetch(url, init);
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
    await app.close();
    await pay.close();
    await admin.end();
  });
  beforeEach(async () => {
    link = 'ok';
    holds = [];
    loseAnswerOf = null;
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
      .set('Authorization', s.auth)
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
        }[]
      >`select status, payment_id, payment_attempt, payment_method_code, rounding, paid, change,
          switch_cash_paid from pos.sales where id = ${id}`
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
          check (gateway_method is null or gateway_method in ('fake_qris', 'fake_va'))`;
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

    it('a VA sale answers the bank and the VA number', async () => {
      const s = await shop();
      const va = await method(s, 'VA', 'fake_va');
      const res = await sell(s, { paymentMethodId: va }).expect(201);
      expect(res.body.payment).toMatchObject({ method: 'fake_va' });
      expect(Object.keys(res.body.payment.checkout).sort()).toEqual([
        'bank',
        'vaNumber',
      ]);
      await onBill(s, res.body.id, 'pay');
      await get(s.auth, `/sales/${res.body.id}/payment`).expect(200);
      expect((await saleRow(res.body.id)).status).toBe('completed');
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
      // A retry of the same request answers the same cancelled sale.
      const again = await sell(s, {}, key).expect(409);
      expect(again.body.saleId).toBe(res.body.saleId);
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

    it('M2 the close reached payment-api but its answer was lost: 503, and the sale is then cancelled, never a cash sale', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      loseAnswerOf = isCancel;
      const res = await post(s.auth, `/sales/${saleId}/payment/cash`, {
        paid: 5200,
      }).expect(503);
      expect(res.body.code).toBe('payment_unavailable');
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
        post(s.auth, `/sales/${saleId}/refund/retry`),
        post(s.auth, `/sales/${saleId}/refund/retry`),
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
      const [a, b] = await Promise.all([
        sync.tick(later()),
        post(s.auth, `/sales/${saleId}/refund/retry`),
      ]);
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
      await post(s.auth, `/sales/${cash.body.id}/refund/retry`).expect(404);
    });

    it('V4 the gateway refuses the refund: refund_failed, a retry by someone with sales.void asks again, and it succeeds', async () => {
      const s = await shop();
      const saleId = await paidSale(s);
      await gatewaySettings('fail');
      const res = await refund(s, saleId).expect(201);
      expect(res.body.refundStatus).toBe('failed');
      // The sale stays reversed (V8); the money is still owed to the customer.
      expect((await saleRow(saleId)).status).toBe('void');
      const failed = await get(s.auth, `/sales/${saleId}/payment`).expect(200);
      expect(failed.body).toMatchObject({
        status: 'refund_failed',
        refund: { status: 'failed', sent: true },
      });

      const cashier = await createCashier(app, s);
      await post(cashier.auth, `/sales/${saleId}/refund/retry`).expect(403);
      await post(cashier.auth, `/sales/${saleId}/refund/manual`, {
        note: 'tunai',
      }).expect(403);
      // Still refused by the gateway: failed again, asked again.
      const still = await post(s.auth, `/sales/${saleId}/refund/retry`).expect(
        200,
      );
      expect(still.body.refundStatus).toBe('failed');

      await gatewaySettings('pending');
      const supervisor = await createCashier(app, s, [
        'sales.create',
        'sales.void',
      ]);
      const retried = await post(
        supervisor.auth,
        `/sales/${saleId}/refund/retry`,
      ).expect(200);
      expect(retried.body).toMatchObject({ saleId, refundStatus: 'pending' });
      const [payment] = await paymentsOf(saleId);
      expect(payment.status).toBe('refund_pending');
      const [event] = await pay.sql<
        { actor_ref: string; approved_by: string }[]
      >`select actor_ref, approved_by from payment.payment_events
        where payment_id = ${payment.id} and to_status = 'refund_pending' order by created_at desc limit 1`;
      // Who retried, and the approver whose PIN approved the refund.
      expect(event).toEqual({
        actor_ref: `cashier:${supervisor.staffId}`,
        approved_by: `owner:${s.userId}`,
      });
      // A retry of a refund that is on its way asks nothing new.
      const refunds = (await billOf(s, saleId)).refunds.length;
      await post(s.auth, `/sales/${saleId}/refund/retry`).expect(200);
      expect((await billOf(s, saleId)).refunds).toHaveLength(refunds);

      await gateway(
        s.tenantId,
        'POST',
        `/refunds/${payment.refund_key}/succeed`,
      );
      const done = await post(s.auth, `/sales/${saleId}/refund/retry`).expect(
        200,
      );
      expect(done.body.refundStatus).toBe('succeeded');
      expect((await paymentsOf(saleId))[0].status).toBe('refunded');
      expect(await onHand(s)).toBe(20);
    });

    it('V4 a refused refund is marked returned by hand, with a note; a refund that was not refused is not', async () => {
      const s = await shop();
      const pending = await paidSale(s);
      await refund(s, pending).expect(201);
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

  describe('who may act', () => {
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
      await post(b.auth, `/sales/${refunded}/refund/retry`).expect(404);
      await post(b.auth, `/sales/${refunded}/refund/manual`, {
        note: 'x',
      }).expect(404);
      await get(b.auth, `/sales/${refunded}/void`).expect(404);

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

      await get(s.auth, `/sales/${saleId}/payment`).expect(200);
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
      await post(s.auth, `/sales/${id}/refund/retry`).expect(404);
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
