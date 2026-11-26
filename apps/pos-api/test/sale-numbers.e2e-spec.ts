import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DB, type Db } from '../src/db/db.module';
import { PaymentSync } from '../src/payments-client/payment-sync.service';
import { PAYMENT_FETCH } from '../src/payments-client/payments.client';
import { PAID_SINCE_LIMIT } from '../src/sales/sales.service';
import { takeNumber } from '../src/sales/numbers';
import { seedMerchant } from '../../payment-api/test/support/merchants';
import { ADMIN_DATABASE_URL } from './support/env';
import { createStore } from './support/fixtures';
import { createCashier } from './support/staff';
import { syncWorkLeft } from './support/sync-work';
import { PaymentApi, startPaymentApi } from './support/payment-api';

type Store = Awaited<ReturnType<typeof createStore>>;
type Bill = { providerRef: string; orderRef: string; status: string };

const PRICE = 5123;
const MINUTES = 60_000;

/**
 * UMK-2038: the receipt number is given when a sale is completed, and a waiting sale is called by a hold
 * number. pos-api against the real payment-api with its fake gateway, as in pg-cashier-flow.e2e-spec.ts.
 * Every test ends with `gapFree`: the store's receipts are numbered 1..n and nothing else has a number.
 */
describe('hold number and receipt number (UMK-2038)', () => {
  let pay: PaymentApi;
  let app: INestApplication;
  let sync: PaymentSync;
  let link: 'ok' | 'down' = 'ok';
  /** The answer of the next charge is lost: payment-api recorded the payment, pos-api never hears. */
  let loseCharge = false;
  const tenants: string[] = [];
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());

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
          if (link === 'down') throw new TypeError('fetch failed');
          const res = await fetch(url, init);
          if (
            loseCharge &&
            init.method === 'POST' &&
            url.endsWith('/payments')
          ) {
            loseCharge = false;
            throw new TypeError('fetch failed');
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
    try {
      // No sale is left waiting (a later suite boots with payment-api off, which refuses that), and nothing
      // else for the job, which sweeps every store: see syncWorkLeft.
      expect(await syncWorkLeft(admin, tenants)).toEqual([]);
      for (const tenantId of tenants) await gapFree(tenantId);
    } finally {
      // Closed whatever the checks say: an open server would keep jest from ending.
      await app.close();
      await pay.close();
      await admin.end();
    }
  });
  beforeEach(() => {
    link = 'ok';
    loseCharge = false;
  });

  const post = (auth: string, url: string, body: object = {}, key?: string) => {
    const req = http().post(url).set('Authorization', auth);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);

  async function gateway<T = unknown>(
    tenantId: string,
    method: 'GET' | 'POST',
    route: string,
    body?: object,
  ): Promise<T> {
    const res = await fetch(`${pay.url}/dev/fake-gateway${route}`, {
      method,
      headers: {
        'X-Payment-Service-Key': pay.serviceKey,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok)
      throw new Error(`fake gateway ${route} answered ${res.status}`);
    return (await res.json()) as T;
  }
  /** The customer or the gateway acts on the sale's bill. */
  const onBill = async (
    s: Store,
    saleId: string,
    action: 'pay' | 'fail' | 'expire',
    body: object = {},
  ) => {
    const { items } = await gateway<{ items: Bill[] }>(
      s.tenantId,
      'GET',
      '/payments',
    );
    const bill = items.find((b) => b.orderRef === saleId)!;
    return gateway(
      s.tenantId,
      'POST',
      `/payments/${bill.providerRef}/${action}`,
      body,
    );
  };

  /** A store with one product (Rp5.123, stock 50), an open shift and a QRIS method. */
  async function shop(merchant = true, stock = 50) {
    const s = await createStore();
    tenants.push(s.tenantId);
    if (merchant) await seedMerchant(pay.sql, { tenantId: s.tenantId });
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Es Teh Manis',
      costPrice: 2000,
      sellingPrice: PRICE,
    }).expect(201);
    const productId = p.body.id as string;
    await post(s.auth, '/stock/opening', { productId, qty: stock }).expect(201);
    await post(s.auth, '/shifts/open', { openingCash: 100_000 }).expect(201);
    const qris = (
      await post(s.auth, '/payment-methods', {
        name: 'QRIS Dinamis',
        kind: 'online',
        gatewayMethod: 'fake_qris',
      }).expect(201)
    ).body.id as string;
    return { ...s, productId, qris };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  /** A sale with the store's QRIS method (or `body.paymentMethodId`). */
  const sell = (s: Shop, body: object = {}, key: string = randomUUID()) =>
    post(
      s.auth,
      '/sales',
      {
        lines: [{ productId: s.productId, qty: 1 }],
        paymentMethodId: s.qris,
        paid: PRICE,
        ...body,
      },
      key,
    );
  /** A cash sale: with payment-api on it is created waiting and completed in the same request. */
  const sellCash = (s: Shop, key?: string) =>
    sell(s, { paymentMethodId: undefined, paid: 10_000 }, key);
  const poll = (s: Store, saleId: string) =>
    get(s.auth, `/sales/${saleId}/payment`);
  const later = () => new Date(Date.now() + 3 * MINUTES);

  type Row = {
    id: string;
    status: string;
    number: number | null;
    hold_number: number | null;
    completed_at: Date | null;
  };
  const rows = (tenantId: string) =>
    admin<Row[]>`
      select id, status, number, hold_number, completed_at from pos.sales
      where tenant_id = ${tenantId} order by created_at, hold_number`;
  const row = async (id: string) =>
    (
      await admin<Row[]>`
        select id, status, number, hold_number, completed_at from pos.sales where id = ${id}`
    )[0];

  /**
   * The property UMK-2038 is about: the store's receipts (completed and void sales) are numbered 1..n with
   * no gap and no number twice, the counter stands at n, and a sale that is not a receipt has no number.
   */
  async function gapFree(tenantId: string) {
    const all = await rows(tenantId);
    const receipts = all
      .filter((x) => x.status === 'completed' || x.status === 'void')
      .map((x) => x.number)
      .sort((a, b) => a! - b!);
    expect(receipts).toEqual(receipts.map((_, i) => i + 1));
    expect(
      all.filter((x) => x.status !== 'completed' && x.status !== 'void'),
    ).toEqual(
      all
        .filter((x) => x.status !== 'completed' && x.status !== 'void')
        .map((x) => ({ ...x, number: null, completed_at: null })),
    );
    const [counter] = await admin<{ n: number }[]>`
      select last_sale_number as n from pos.sales_settings where tenant_id = ${tenantId}`;
    expect(counter?.n ?? 0).toBe(receipts.length);
    return receipts.length;
  }

  it('with payment-api off a sale takes its receipt number when it is rung up, and has no hold number', async () => {
    // First in the file: pos-api refuses to boot with payment-api off while a sale awaits payment.
    const off = await posApp({ PAYMENT_API_URL: '' });
    try {
      const s = await createStore();
      tenants.push(s.tenantId);
      const send = (url: string, body: object, key?: string) => {
        const req = request(off.getHttpServer())
          .post(url)
          .set('Authorization', s.auth);
        if (key) req.set('Idempotency-Key', key);
        return req.send(body);
      };
      const cat = await send('/catalog/categories', { name: 'A' }).expect(201);
      const p = await send('/catalog/products', {
        categoryId: cat.body.id,
        name: 'Kopi',
        costPrice: 1000,
        sellingPrice: 5000,
      }).expect(201);
      await send('/stock/opening', { productId: p.body.id, qty: 5 }).expect(
        201,
      );
      await send('/shifts/open', { openingCash: 0 }).expect(201);
      for (const n of [1, 2]) {
        const sale = await send(
          '/sales',
          { lines: [{ productId: p.body.id, qty: 1 }], paid: 5000 },
          randomUUID(),
        ).expect(201);
        expect(sale.body).toMatchObject({
          status: 'completed',
          number: n,
          receiptNumber: n,
          holdNumber: null,
        });
        const receipt = await request(off.getHttpServer())
          .get(`/sales/${sale.body.id}/receipt`)
          .set('Authorization', s.auth)
          .expect(200);
        expect(receipt.body).toMatchObject({
          number: n,
          receiptNumber: n,
          holdNumber: null,
        });
        expect((await row(sale.body.id as string)).completed_at).not.toBeNull();
      }
      expect(await gapFree(s.tenantId)).toBe(2);
      const [counter] = await admin<{ n: number }[]>`
        select last_hold_number as n from pos.sales_settings where tenant_id = ${s.tenantId}`;
      expect(counter.n).toBe(0);
    } finally {
      await off.close();
    }
  });

  it('a PG sale waits with a hold number and no receipt number; paid, it takes the next receipt number', async () => {
    const s = await shop();
    // Two receipts first, so a hold number and a receipt number are told apart below.
    const first = await sellCash(s).expect(201);
    expect(first.body).toMatchObject({
      status: 'completed',
      number: 1,
      receiptNumber: 1,
      holdNumber: 1,
    });
    expect((await sellCash(s).expect(201)).body.receiptNumber).toBe(2);

    const res = await sell(s).expect(201);
    const saleId = res.body.id as string;
    // `number` is the one to show now: the hold number while the sale waits.
    expect(res.body).toMatchObject({
      status: 'awaiting_payment',
      number: 3,
      receiptNumber: null,
      holdNumber: 3,
    });
    expect(res.body.payment).toMatchObject({
      saleNumber: 3,
      receiptNumber: null,
      holdNumber: 3,
    });
    expect(await row(saleId)).toMatchObject({
      number: null,
      hold_number: 3,
      completed_at: null,
    });
    const waiting = await get(s.auth, '/sales?status=awaiting_payment').expect(
      200,
    );
    expect(waiting.body.data).toMatchObject([
      { id: saleId, number: 3, receiptNumber: null, holdNumber: 3 },
    ]);
    // A sale rung up while that one waits takes the next RECEIPT number: the waiting sale holds none.
    expect((await sellCash(s).expect(201)).body).toMatchObject({
      receiptNumber: 3,
      holdNumber: 4,
    });

    await onBill(s, saleId, 'pay');
    const paid = await poll(s, saleId).expect(200);
    expect(paid.body).toMatchObject({
      saleStatus: 'completed',
      saleNumber: 4,
      receiptNumber: 4,
      holdNumber: 3,
    });
    // A second poll, and the sale itself, say the same.
    expect((await poll(s, saleId).expect(200)).body.receiptNumber).toBe(4);
    const sale = await get(s.auth, `/sales/${saleId}`).expect(200);
    expect(sale.body).toMatchObject({
      number: 4,
      receiptNumber: 4,
      holdNumber: 3,
    });
    const receipt = await get(s.auth, `/sales/${saleId}/receipt`).expect(200);
    expect(receipt.body).toMatchObject({
      number: 4,
      receiptNumber: 4,
      holdNumber: 3,
    });
    const list = await get(s.auth, '/sales').expect(200);
    expect(
      (list.body.data as { receiptNumber: number }[]).map(
        (x) => x.receiptNumber,
      ),
    ).toEqual([4, 3, 2, 1]);
    expect((await row(saleId)).completed_at).not.toBeNull();
    expect(await gapFree(s.tenantId)).toBe(4);
  });

  it('a sale that is cancelled, fails at the gateway or is refused a bill takes no receipt number: the next receipt continues the sequence', async () => {
    const s = await shop();
    expect((await sellCash(s).expect(201)).body.receiptNumber).toBe(1);

    const cancelled = (await sell(s).expect(201)).body.id as string;
    const gone = await post(
      s.auth,
      `/sales/${cancelled}/payment/cancel`,
    ).expect(200);
    expect(gone.body).toMatchObject({
      saleStatus: 'cancelled',
      saleNumber: 2,
      receiptNumber: null,
      holdNumber: 2,
    });

    const failed = (await sell(s).expect(201)).body.id as string;
    // Neither a waiting nor a cancelled sale has a receipt: its hold number is never printed as "No.".
    for (const [id, status] of [
      [failed, 'awaiting_payment'],
      [cancelled, 'cancelled'],
    ]) {
      const none = await get(s.auth, `/sales/${id}/receipt`).expect(409);
      expect(none.body).toMatchObject({ code: 'not_a_receipt', status });
      expect(none.body).not.toHaveProperty('number');
    }
    await onBill(s, failed, 'fail');
    expect((await poll(s, failed).expect(200)).body).toMatchObject({
      saleStatus: 'cancelled',
      receiptNumber: null,
      holdNumber: 3,
    });
    for (const id of [cancelled, failed])
      expect(await row(id)).toMatchObject({
        status: 'cancelled',
        number: null,
        completed_at: null,
      });
    const list = await get(s.auth, '/sales?status=cancelled').expect(200);
    expect(
      (list.body.data as { receiptNumber: null; holdNumber: number }[]).map(
        (x) => [x.receiptNumber, x.holdNumber],
      ),
    ).toEqual([
      [null, 3],
      [null, 2],
    ]);

    expect((await sellCash(s).expect(201)).body).toMatchObject({
      receiptNumber: 2,
      holdNumber: 4,
    });
    expect(await gapFree(s.tenantId)).toBe(2);

    // A store whose gateway account is not active: the sale is cancelled in the request that rang it up.
    const closed = await shop(false);
    expect((await sellCash(closed).expect(201)).body.receiptNumber).toBe(1);
    const refused = await sell(closed).expect(409);
    expect(await row(refused.body.saleId as string)).toMatchObject({
      status: 'cancelled',
      number: null,
      hold_number: 2,
    });
    expect((await sellCash(closed).expect(201)).body.receiptNumber).toBe(2);
    expect(await gapFree(closed.tenantId)).toBe(2);
  });

  it('two PG sales paid in the reverse order are numbered in the order they were paid', async () => {
    const s = await shop();
    const a = (await sell(s).expect(201)).body;
    const b = (await sell(s).expect(201)).body;
    expect([a.holdNumber, b.holdNumber]).toEqual([1, 2]);

    await onBill(s, b.id as string, 'pay');
    expect((await poll(s, b.id as string).expect(200)).body).toMatchObject({
      saleStatus: 'completed',
      receiptNumber: 1,
      holdNumber: 2,
    });
    await onBill(s, a.id as string, 'pay');
    expect((await poll(s, a.id as string).expect(200)).body).toMatchObject({
      saleStatus: 'completed',
      receiptNumber: 2,
      holdNumber: 1,
    });
    expect(await gapFree(s.tenantId)).toBe(2);
  });

  it('a cash sale that could not be recorded waits with a hold number; a repeat or the job gives it the next receipt number', async () => {
    const s = await shop();
    link = 'down';
    const key = randomUUID();
    const held = await sellCash(s, key).expect(503);
    link = 'ok';
    // This one's cash was recorded by payment-api, but the answer never came back: the job finishes it.
    loseCharge = true;
    const byJob = (await sellCash(s).expect(503)).body.saleId as string;
    expect(await row(held.body.saleId as string)).toMatchObject({
      status: 'awaiting_payment',
      number: null,
      hold_number: 1,
    });
    // A sale rung up meanwhile is the first receipt.
    expect((await sellCash(s).expect(201)).body).toMatchObject({
      receiptNumber: 1,
      holdNumber: 3,
    });
    const again = await sellCash(s, key).expect(201);
    expect(again.body).toMatchObject({
      id: held.body.saleId,
      status: 'completed',
      number: 2,
      receiptNumber: 2,
      holdNumber: 1,
    });
    expect(await sync.tick(later())).toMatchObject({ completed: 1, failed: 0 });
    expect(await row(byJob)).toMatchObject({
      status: 'completed',
      number: 3,
      hold_number: 2,
    });
    // A second run gives nothing a second number.
    expect(await sync.tick(later())).toMatchObject({ completed: 0, failed: 0 });
    expect(await gapFree(s.tenantId)).toBe(3);
  });

  it('a kasbon completes when it is rung up: its receipt number is taken then, with no hold number', async () => {
    const s = await shop();
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
    const waiting = (await sell(s).expect(201)).body.id as string;
    const credit = await sell(s, {
      paymentMethodId: kasbon,
      memberId: member.body.id,
      paid: 0,
    }).expect(201);
    expect(credit.body).toMatchObject({
      status: 'completed',
      number: 1,
      receiptNumber: 1,
      holdNumber: null,
    });
    await post(s.auth, `/sales/${waiting}/payment/cancel`).expect(200);
    expect(await gapFree(s.tenantId)).toBe(1);
  });

  it('one store’s numbers do not move with another store’s sales', async () => {
    const a = await shop();
    const b = await shop();
    await sellCash(a).expect(201);
    const waiting = (await sell(a).expect(201)).body.id as string;
    await sellCash(a).expect(201);
    expect((await sellCash(b).expect(201)).body).toMatchObject({
      receiptNumber: 1,
      holdNumber: 1,
    });
    expect((await sell(b).expect(201)).body).toMatchObject({
      receiptNumber: null,
      holdNumber: 2,
    });
    // Store B cannot read store A's waiting sale, by either number.
    await get(b.auth, `/sales/${waiting}`).expect(404);
    await get(b.auth, `/sales/${waiting}/payment`).expect(404);
    for (const x of [a, b]) {
      for (const r of await rows(x.tenantId))
        if (r.status === 'awaiting_payment')
          await post(x.auth, `/sales/${r.id}/payment/cancel`).expect(200);
    }
    expect(await gapFree(a.tenantId)).toBe(2);
    expect(await gapFree(b.tenantId)).toBe(1);
  });

  describe('workers at once', () => {
    it('a cancel, a switch to cash, the customer’s payment and a poll at once: the sale is one receipt with one number, or cancelled with none', async () => {
      for (let i = 0; i < 6; i += 1) {
        const s = await shop();
        await sellCash(s).expect(201);
        const saleId = (await sell(s).expect(201)).body.id as string;
        // Each round leaves one of the three out, so every pair meets as well as all three.
        const acts = [
          () => post(s.auth, `/sales/${saleId}/payment/cancel`),
          () => post(s.auth, `/sales/${saleId}/payment/cash`, { paid: 5200 }),
          () => onBill(s, saleId, 'pay').catch(() => undefined),
        ].filter((_, k) => i < 3 || k !== i - 3);
        await Promise.all([...acts.map((act) => act()), poll(s, saleId)]);
        // Whatever each request answered, the next ones settle the sale.
        await poll(s, saleId);
        if ((await row(saleId)).status === 'awaiting_payment')
          await post(s.auth, `/sales/${saleId}/payment/cancel`);
        await sync.tick(later());
        const sale = await row(saleId);
        expect(['completed', 'cancelled']).toContain(sale.status);
        expect(sale.number).toBe(sale.status === 'completed' ? 2 : null);
        expect(sale.hold_number).toBe(2);
        // The next receipt follows whatever happened.
        const next = await sellCash(s).expect(201);
        expect(next.body.receiptNumber).toBe(
          sale.status === 'completed' ? 3 : 2,
        );
        await gapFree(s.tenantId);
      }
    }, 30_000);

    it('polls, checks and the job at once on several paid sales, while new sales are rung up: every sale gets one number', async () => {
      const s = await shop();
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1)
        ids.push((await sell(s).expect(201)).body.id as string);
      // Paid in the reverse order, and the gateway's notice is lost: only the workers below learn of it.
      for (const id of [...ids].reverse())
        await onBill(s, id, 'pay', { webhook: 'drop' });
      const answers = await Promise.all([
        ...ids.map((id) => post(s.auth, `/sales/${id}/payment/check`)),
        ...ids.map((id) => post(s.auth, `/sales/${id}/payment/check`)),
        ...ids.map((id) => poll(s, id)),
        sellCash(s),
        sellCash(s),
        sync.tick(later()),
      ]);
      for (const a of answers.slice(0, 15))
        expect((a as { status: number }).status).toBe(200);
      for (const id of ids) await poll(s, id).expect(200);
      const done = await Promise.all(ids.map((id) => row(id)));
      expect(done.map((x) => x.status)).toEqual(ids.map(() => 'completed'));
      // The same number however often and by whomever the sale is read.
      for (const x of done) {
        const view = await poll(s, x.id).expect(200);
        expect(view.body.receiptNumber).toBe(x.number);
      }
      expect(await gapFree(s.tenantId)).toBe(7);
    });

    it('a cancel and the customer’s payment at once, many times over', async () => {
      const s = await shop();
      let receipts = 0;
      for (let i = 0; i < 6; i += 1) {
        const saleId = (await sell(s).expect(201)).body.id as string;
        await Promise.all([
          post(s.auth, `/sales/${saleId}/payment/cancel`),
          onBill(s, saleId, 'pay', i % 2 ? { webhook: 'drop' } : {}).catch(
            () => undefined,
          ),
        ]);
        await post(s.auth, `/sales/${saleId}/payment/check`);
        if ((await row(saleId)).status === 'awaiting_payment')
          await post(s.auth, `/sales/${saleId}/payment/cancel`);
        const sale = await row(saleId);
        if (sale.status === 'completed') receipts += 1;
        expect(sale.number).toBe(sale.status === 'completed' ? receipts : null);
      }
      expect(await gapFree(s.tenantId)).toBe(receipts);
    });
  });

  describe('the database and the migration', () => {
    it('refuses a receipt without a number or a completion time, and a waiting sale without a hold number', async () => {
      const s = await shop();
      const done = (await sellCash(s).expect(201)).body.id as string;
      const waiting = (await sell(s).expect(201)).body.id as string;
      const refused = (q: Promise<unknown>) =>
        expect(q).rejects.toMatchObject({ constraint_name: 'sales_number_ck' });
      await refused(
        admin`update pos.sales set number = null where id = ${done}`,
      );
      await refused(
        admin`update pos.sales set completed_at = null where id = ${done}`,
      );
      await refused(
        admin`update pos.sales set hold_number = null, hold_day = null where id = ${waiting}`,
      );
      // A hold number has its day, and only a cancelled sale has a reason.
      for (const q of [
        admin`update pos.sales set hold_day = null where id = ${waiting}`,
        admin`update pos.sales set hold_number = null where id = ${done}`,
        admin`update pos.sales set cancel_reason = 'expired' where id = ${waiting}`,
      ])
        await expect(q).rejects.toMatchObject({
          constraint_name: 'sales_hold_day_ck',
        });
      await refused(
        admin`update pos.sales set status = 'completed' where id = ${waiting}`,
      );
      // Two sales of one store never share a hold number on one day, or a receipt number.
      const other = (await sell(s).expect(201)).body.id as string;
      await expect(
        admin`update pos.sales set hold_number = 2 where id = ${other}`,
      ).rejects.toMatchObject({
        constraint_name: 'sales_tenant_hold_day_number_uq',
      });
      for (const id of [waiting, other])
        await post(s.auth, `/sales/${id}/payment/cancel`).expect(200);
      await gapFree(s.tenantId);
    });

    it('the migration gives earlier receipts their completion time and waiting sales a hold number in the order they were rung up, then dates the hold numbers by store day and takes the receipt number off a waiting sale', async () => {
      const s = await shop();
      const other = await shop();
      const receipt = (await sellCash(s).expect(201)).body.id as string;
      const first = (await sell(s).expect(201)).body.id as string;
      const second = (await sell(s).expect(201)).body.id as string;
      const theirs = (await sell(other).expect(201)).body.id as string;
      // Found by its name, not its number: migrations of parallel work are renumbered.
      const dir = path.join(__dirname, '..', 'drizzle');
      const updatesOf = (suffix: string) =>
        readFileSync(
          path.join(
            dir,
            readdirSync(dir).find((f) => f.endsWith(suffix))!,
          ),
          'utf8',
        )
          .split('--> statement-breakpoint')
          .map((x) => x.replace(/^\s*--.*$/gm, '').trim())
          .filter((x) => x.startsWith('UPDATE'));
      const statements = updatesOf('_sale_hold_number.sql');
      expect(statements).toHaveLength(3);
      const daily = updatesOf('_hold_number_daily.sql');
      expect(daily).toHaveLength(3);
      // As the migration finds the rows: numbered when rung up, no hold number, no completion time. Rolled
      // back after.
      const rollback = new Error('rollback');
      await admin
        .begin(async (tx) => {
          await tx`alter table pos.sales drop constraint sales_number_ck`;
          await tx`alter table pos.sales drop constraint sales_hold_day_ck`;
          await tx`update pos.sales set hold_number = null, hold_day = null, completed_at = null,
              paid_at = created_at - interval '1 hour'
            where tenant_id in ${tx([s.tenantId, other.tenantId])}`;
          // Rung up second, first: the order is by `created_at`, not by id.
          await tx`update pos.sales set number = 7, created_at = now() - interval '2 hours' where id = ${second}`;
          await tx`update pos.sales set number = 8, created_at = now() - interval '1 hour' where id = ${first}`;
          await tx`update pos.sales_settings set last_hold_number = 0, hold_number_day = null
            where tenant_id in ${tx([s.tenantId, other.tenantId])}`;
          for (const statement of statements) await tx.unsafe(statement);
          const after = await tx<
            (Row & { same: boolean })[]
          >`select id, status, number, hold_number, completed_at, completed_at = paid_at as same
            from pos.sales where id in ${tx([receipt, first, second, theirs])}`;
          const by = new Map(after.map((x) => [x.id, x]));
          expect(by.get(receipt)).toMatchObject({
            hold_number: null,
            same: true,
          });
          expect(by.get(second)).toMatchObject({
            number: 7,
            hold_number: 1,
            completed_at: null,
          });
          expect(by.get(first)).toMatchObject({ number: 8, hold_number: 2 });
          // Each store counts for itself.
          expect(by.get(theirs)).toMatchObject({ hold_number: 1 });
          const counters = await tx<{ tenant_id: string; n: number }[]>`
            select tenant_id, last_hold_number as n from pos.sales_settings
            where tenant_id in ${tx([s.tenantId, other.tenantId])}`;
          expect(
            Object.fromEntries(counters.map((c) => [c.tenant_id, c.n])),
          ).toEqual({ [s.tenantId]: 2, [other.tenantId]: 1 });

          // The next migration (daily hold numbers): each hold number is dated at the store day its sale
          // was rung up, and a counter in use goes on counting today.
          await tx`update pos.sales set created_at = (current_date - 3 + time '23:30') at time zone 'UTC'
            where id = ${second}`;
          for (const statement of daily) await tx.unsafe(statement);
          const dated = await tx<{ id: string; ok: boolean }[]>`
            select id, hold_day = (created_at at time zone 'Asia/Jakarta')::date as ok
            from pos.sales where id in ${tx([first, second, theirs])}`;
          expect(dated.map((x) => x.ok)).toEqual([true, true, true]);
          // 23:30 UTC is 06:30 the next day in Jakarta.
          const [late] = await tx<{ day: string }[]>`
            select (hold_day - current_date)::text as day from pos.sales where id = ${second}`;
          expect(late.day).toBe('-2');
          // And a waiting sale no longer holds the receipt number it was created with.
          const kept = await tx<{ number: number | null }[]>`
            select number from pos.sales where id in ${tx([first, second])}`;
          expect(kept.map((x) => x.number)).toEqual([null, null]);
          const [receiptKept] = await tx<{ number: number | null }[]>`
            select number from pos.sales where id = ${receipt}`;
          expect(receiptKept.number).toBe(1);
          const [undated] = await tx<{ n: number }[]>`
            select count(*)::int as n from pos.sales where id = ${receipt} and hold_day is null`;
          expect(undated.n).toBe(1);
          const days = await tx<{ today: boolean }[]>`
            select hold_number_day = (now() at time zone 'Asia/Jakarta')::date as today
            from pos.sales_settings where tenant_id in ${tx([s.tenantId, other.tenantId])}`;
          expect(days.map((d) => d.today)).toEqual([true, true]);
          throw rollback;
        })
        .catch((e: unknown) => {
          if (e !== rollback) throw e;
        });

      await onBill(s, first, 'pay');
      expect((await poll(s, first).expect(200)).body).toMatchObject({
        saleStatus: 'completed',
        receiptNumber: 2,
      });
      await onBill(s, second, 'pay');
      expect((await poll(s, second).expect(200)).body.receiptNumber).toBe(3);
      await post(other.auth, `/sales/${theirs}/payment/cancel`).expect(200);
      expect(await gapFree(s.tenantId)).toBe(3);
    }, 30_000);
  });

  describe('the hold number starts at 1 every store day (Asia/Jakarta)', () => {
    const take = (tenantId: string, at?: Date) =>
      app.get<Db>(DB).transaction((tx) => takeNumber(tx, tenantId, 'hold', at));
    const counter = async (tenantId: string) =>
      (
        await admin<{ n: number; day: string }[]>`
          select last_hold_number as n, hold_number_day::text as day
          from pos.sales_settings where tenant_id = ${tenantId}`
      )[0];

    it('the clock passes midnight in Jakarta: the next number is 1 on the new day; before it, the count goes on', async () => {
      // Not in `tenants`: numbers are taken here without a sale, which the 1..n check would not accept.
      const s = await createStore();
      // 23:59:58 and 23:59:59 on 30 November in Jakarta (UTC+7), then midnight.
      expect(await take(s.tenantId, new Date('2026-11-30T16:59:58Z'))).toEqual({
        number: 1,
        day: '2026-11-30',
        taxBps: 0,
      });
      expect(
        await take(s.tenantId, new Date('2026-11-30T16:59:59.999Z')),
      ).toMatchObject({ number: 2, day: '2026-11-30' });
      expect(
        await take(s.tenantId, new Date('2026-11-30T17:00:00Z')),
      ).toMatchObject({ number: 1, day: '2026-12-01' });
      expect(
        await take(s.tenantId, new Date('2026-12-01T16:59:59Z')),
      ).toMatchObject({ number: 2, day: '2026-12-01' });
      // Days later, and a new year.
      expect(
        await take(s.tenantId, new Date('2027-01-01T03:00:00Z')),
      ).toMatchObject({ number: 1, day: '2027-01-01' });
      // A clock that went back gives no number twice: it stays in the day the counter is in.
      expect(
        await take(s.tenantId, new Date('2026-12-31T10:00:00Z')),
      ).toMatchObject({ number: 2, day: '2027-01-01' });
      expect(await counter(s.tenantId)).toEqual({ n: 2, day: '2027-01-01' });
      // A transaction that rolls back gives its number back.
      await app
        .get<Db>(DB)
        .transaction(async (tx) => {
          await takeNumber(
            tx,
            s.tenantId,
            'hold',
            new Date('2027-01-01T04:00:00Z'),
          );
          throw new Error('rollback');
        })
        .catch(() => undefined);
      expect(
        await take(s.tenantId, new Date('2027-01-01T04:00:00Z')),
      ).toMatchObject({ number: 3 });
      // The receipt counter knows no day.
      const receipt = (at?: Date) =>
        app
          .get<Db>(DB)
          .transaction((tx) => takeNumber(tx, s.tenantId, 'receipt', at));
      expect(await receipt()).toMatchObject({ number: 1, day: null });
      expect(await receipt(new Date('2030-01-01T00:00:00Z'))).toMatchObject({
        number: 2,
      });
    });

    it('many takes at once, on one day and across midnight: no number twice on a day, each day counted from 1', async () => {
      const s = await createStore();
      const other = await createStore();
      tenants.push(s.tenantId, other.tenantId);
      // No row yet: the first takes race to create it.
      const first = await Promise.all(
        Array.from({ length: 12 }, () =>
          take(s.tenantId, new Date('2026-11-30T10:00:00Z')),
        ),
      );
      expect(first.map((x) => x.number).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 12 }, (_, i) => i + 1),
      );
      // Half a second around midnight, all at once, and another store at the same time.
      const around = await Promise.all([
        ...Array.from({ length: 16 }, (_, i) =>
          take(
            s.tenantId,
            new Date(Date.parse('2026-11-30T16:59:59.750Z') + (i % 2) * 500),
          ),
        ),
        ...Array.from({ length: 4 }, () =>
          take(other.tenantId, new Date('2026-11-30T17:00:00Z')),
        ),
      ]);
      const mine = around.slice(0, 16);
      const pairs = [...first, ...mine].map((x) => `${x.day}#${x.number}`);
      expect(new Set(pairs).size).toBe(pairs.length);
      // Once a take of the new day got in, every later one is in the new day, counted from 1.
      const newDay = mine
        .filter((x) => x.day === '2026-12-01')
        .map((x) => x.number)
        .sort((a, b) => a - b);
      expect(newDay.length).toBeGreaterThanOrEqual(8);
      expect(newDay).toEqual(newDay.map((_, i) => i + 1));
      const oldDay = mine.filter((x) => x.day === '2026-11-30');
      expect(oldDay.map((x) => x.number).sort((a, b) => a - b)).toEqual(
        oldDay.map((_, i) => 13 + i),
      );
      expect(await counter(s.tenantId)).toEqual({
        n: newDay.length,
        day: '2026-12-01',
      });
      expect(
        around
          .slice(16)
          .map((x) => x.number)
          .sort(),
      ).toEqual([1, 2, 3, 4]);
    });

    it('a sale that still waits from yesterday keeps its number while today’s first waiting sale is #1 again; receipt numbers go on', async () => {
      const s = await shop();
      expect((await sellCash(s).expect(201)).body.holdNumber).toBe(1);
      const old = (await sell(s).expect(201)).body;
      expect(old.holdNumber).toBe(2);
      // A day passes: what was taken today was taken yesterday.
      await admin`update pos.sales set hold_day = hold_day - 1 where tenant_id = ${s.tenantId}`;
      await admin`update pos.sales_settings set hold_number_day = hold_number_day - 1
        where tenant_id = ${s.tenantId}`;

      const fresh = await sellCash(s).expect(201);
      expect(fresh.body).toMatchObject({ holdNumber: 1, receiptNumber: 2 });
      const today = (await sell(s).expect(201)).body;
      expect(today.holdNumber).toBe(2);
      // Two waiting sales called #2, of two days: both are found, each by its id.
      const days = await admin<{ id: string; day: number }[]>`
        select id, (hold_day - (now() at time zone 'Asia/Jakarta')::date)::int as day
        from pos.sales where id in ${admin([old.id as string, today.id as string])}`;
      expect(Object.fromEntries(days.map((d) => [d.id, d.day]))).toEqual({
        [old.id as string]: -1,
        [today.id as string]: 0,
      });
      const close = await post(s.auth, '/shifts/current/close', {
        countedCash: 0,
      }).expect(409);
      expect(
        (close.body.sales as { id: string; holdNumber: number }[]).map((x) => [
          x.id,
          x.holdNumber,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [old.id, 2],
          [today.id, 2],
        ]),
      );
      // Yesterday's sale is paid today: the next receipt number, its own hold number.
      await onBill(s, old.id as string, 'pay');
      expect((await poll(s, old.id as string).expect(200)).body).toMatchObject({
        receiptNumber: 3,
        holdNumber: 2,
      });
      await post(s.auth, `/sales/${today.id}/payment/cancel`).expect(200);
      expect(await gapFree(s.tenantId)).toBe(3);
    });
  });

  describe('closing a shift while sales await payment (UMK-2044)', () => {
    it('409 sales_awaiting_payment lists the shift’s waiting sales by hold number with what is owed; the shift closes once they are settled', async () => {
      const s = await shop();
      await sellCash(s).expect(201);
      const qr = (await sell(s).expect(201)).body.id as string;
      // A cash sale between its two steps blocks the close too.
      link = 'down';
      const held = (await sellCash(s).expect(503)).body.saleId as string;
      link = 'ok';
      const close = () =>
        post(s.auth, '/shifts/current/close', { countedCash: 100_000 });
      const refused = await close().expect(409);
      expect(refused.body).toMatchObject({
        code: 'sales_awaiting_payment',
        message: 'Masih ada penjualan yang menunggu pembayaran: #2, #3',
        saleNumbers: [2, 3],
      });
      expect(refused.body.sales).toEqual([
        {
          id: qr,
          holdNumber: 2,
          amountDue: PRICE,
          paymentMethod: 'QRIS Dinamis',
          onlinePayment: true,
          createdAt: expect.any(String),
        },
        {
          id: held,
          holdNumber: 3,
          // Cash: Rp5.123 rounded up to Rp5.200.
          amountDue: 5200,
          paymentMethod: 'Tunai',
          onlinePayment: false,
          createdAt: expect.any(String),
        },
      ]);
      // Nothing was closed.
      expect(
        (await get(s.auth, '/shifts/current').expect(200)).body.shift,
      ).toMatchObject({ closedAt: null });

      await post(s.auth, `/sales/${qr}/payment/cancel`).expect(200);
      const one = await close().expect(409);
      expect((one.body.sales as { id: string }[]).map((x) => x.id)).toEqual([
        held,
      ]);
      await post(s.auth, `/sales/${held}/payment/cancel`).expect(200);
      await close().expect(200);
      await gapFree(s.tenantId);
    });

    it('a close and a new PG sale at once: the shift closes without the sale, or the sale is rung up and blocks the close; never a closed shift with a waiting sale', async () => {
      for (let i = 0; i < 6; i += 1) {
        const s = await shop();
        const [close, sale] = await Promise.all([
          post(s.auth, '/shifts/current/close', { countedCash: 100_000 }),
          sell(s),
        ]);
        if (close.status === 200) {
          // The sale found no open shift: nothing was rung up, no number was taken.
          expect(sale.status).toBe(422);
          expect(await rows(s.tenantId)).toEqual([]);
        } else {
          expect(sale.status).toBe(201);
          expect(close.status).toBe(409);
          expect(close.body).toMatchObject({
            code: 'sales_awaiting_payment',
            sales: [{ id: sale.body.id, holdNumber: 1 }],
          });
          await post(s.auth, `/sales/${sale.body.id}/payment/cancel`).expect(
            200,
          );
        }
        const [stuck] = await admin<{ n: number }[]>`
          select count(*)::int as n from pos.sales x join pos.shifts h on h.id = x.shift_id
          where x.tenant_id = ${s.tenantId} and x.status = 'awaiting_payment' and h.closed_at is not null`;
        expect(stuck.n).toBe(0);
      }
    });

    it('a sale that is being rung up holds the close back: the close waits for it and is then refused with that sale', async () => {
      const s = await shop();
      await sellCash(s).expect(201);
      // The sale is stopped where it takes its hold number (the store's counters row is locked here), after
      // it took the shift's row lock.
      const locker = postgres(ADMIN_DATABASE_URL, { max: 1 });
      const waitingForLocks = async (n: number) => {
        for (let i = 0; i < 200; i += 1) {
          const [r] = await admin<{ n: number }[]>`
            select count(*)::int as n from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'`;
          if (r.n === n) return;
          await new Promise((r2) => setTimeout(r2, 25));
        }
        throw new Error(`never saw ${n} waiting`);
      };
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const holding = locker.begin(async (tx) => {
        await tx`select 1 from pos.sales_settings where tenant_id = ${s.tenantId} for update`;
        locked();
        await gate;
      });
      try {
        await isLocked;
        let saleDone = false;
        let closeDone = false;
        const sale = sell(s).then((r) => {
          saleDone = true;
          return r;
        });
        await waitingForLocks(1);
        const close = post(s.auth, '/shifts/current/close', {
          countedCash: 100_000,
        }).then((r) => {
          closeDone = true;
          return r;
        });
        // The close waits for the shift's row, which the sale holds.
        await waitingForLocks(2);
        expect([saleDone, closeDone]).toEqual([false, false]);
        release();
        await holding;
        const [sold, closed] = await Promise.all([sale, close]);
        expect(sold.status).toBe(201);
        expect(closed.status).toBe(409);
        expect(closed.body).toMatchObject({
          code: 'sales_awaiting_payment',
          sales: [{ id: sold.body.id, holdNumber: 2 }],
        });
        await post(s.auth, `/sales/${sold.body.id}/payment/cancel`).expect(200);
        await post(s.auth, '/shifts/current/close', {
          countedCash: 100_000,
        }).expect(200);
      } finally {
        release();
        await locker.end();
      }
    }, 30_000);

    it('only the closing actor’s own shift in their own store: another cashier’s and another store’s waiting sales neither block nor show', async () => {
      const a = await shop();
      const b = await shop();
      const cashier = await createCashier(app, a, ['sales.create']);
      await post(cashier.auth, '/shifts/open', { openingCash: 0 }).expect(201);
      const owners = (await sell(a).expect(201)).body.id as string;
      const cashiers = (
        await post(
          cashier.auth,
          '/sales',
          {
            lines: [{ productId: a.productId, qty: 1 }],
            paymentMethodId: a.qris,
            paid: PRICE,
          },
          randomUUID(),
        ).expect(201)
      ).body.id as string;
      const theirs = (await sell(b).expect(201)).body.id as string;

      const close = (auth: string) =>
        post(auth, '/shifts/current/close', { countedCash: 0 });
      const ids = (res: { body: { sales: { id: string }[] } }) =>
        res.body.sales.map((x) => x.id);
      expect(ids(await close(a.auth).expect(409))).toEqual([owners]);
      expect(ids(await close(cashier.auth).expect(409))).toEqual([cashiers]);
      expect(ids(await close(b.auth).expect(409))).toEqual([theirs]);

      // Store B settles its own: its shift closes while store A's sales still wait.
      await post(b.auth, `/sales/${theirs}/payment/cancel`).expect(200);
      await close(b.auth).expect(200);
      // The cashier settles theirs: their shift closes while the owner's sale still waits.
      await post(cashier.auth, `/sales/${cashiers}/payment/cancel`).expect(200);
      await close(cashier.auth).expect(200);
      expect(ids(await close(a.auth).expect(409))).toEqual([owners]);
      await post(a.auth, `/sales/${owners}/payment/cancel`).expect(200);
      await close(a.auth).expect(200);
    });
  });

  describe('sales paid while the till was away (UMK-2046)', () => {
    const paidSince = (auth: string, since: string) =>
      get(auth, `/sales/paid-since?since=${encodeURIComponent(since)}`);
    const idsOf = (res: { body: { data: { id: string }[] } }) =>
      res.body.data.map((x) => x.id);
    const pause = (ms = 25) => new Promise((r) => setTimeout(r, ms));
    const sellAs = (s: Shop, auth: string) =>
      post(
        auth,
        '/sales',
        {
          lines: [{ productId: s.productId, qty: 1 }],
          paymentMethodId: s.qris,
          paid: PRICE,
        },
        randomUUID(),
      );

    it('lists a PG sale completed after `since`, with both numbers, and not one completed before; cash sales and sales switched to cash are not listed', async () => {
      const s = await shop();
      const before = (await sell(s).expect(201)).body.id as string;
      await onBill(s, before, 'pay');
      await poll(s, before).expect(200);
      await sellCash(s).expect(201);
      await pause();
      const since = new Date().toISOString();
      await pause();
      expect((await paidSince(s.auth, since).expect(200)).body.data).toEqual(
        [],
      );

      // The till goes away with two sales waiting. One is paid, and the job (not the till) learns of it.
      const paid = (await sell(s).expect(201)).body.id as string;
      const open = (await sell(s).expect(201)).body.id as string;
      const switched = (await sell(s).expect(201)).body.id as string;
      await onBill(s, paid, 'pay');
      expect(await sync.tick(later())).toMatchObject({ completed: 1 });
      await post(s.auth, `/sales/${switched}/payment/cash`, {
        paid: 5200,
      }).expect(200);
      await sellCash(s).expect(201);

      const res = await paidSince(s.auth, since).expect(200);
      expect(res.body.data).toEqual([
        {
          id: paid,
          number: 3,
          receiptNumber: 3,
          holdNumber: 3,
          status: 'completed',
          reason: null,
          // The job learned of the payment, not the till.
          completedByJob: true,
          onlinePayment: true,
          total: PRICE,
          amountDue: PRICE,
          paymentMethod: 'QRIS Dinamis',
          paidAt: expect.any(String),
          completedAt: expect.any(String),
          cancelledAt: null,
          endedAt: expect.any(String),
          createdAt: expect.any(String),
        },
      ]);
      expect(res.body.data[0].endedAt).toBe(res.body.data[0].completedAt);
      // `asOf` is behind the clock, so the next request overlaps this one: the till drops what it has shown.
      const asOf = new Date(res.body.asOf as string).getTime();
      expect(Date.now() - asOf).toBeGreaterThanOrEqual(9_000);
      expect(Date.now() - asOf).toBeLessThan(60_000);
      expect(res.body).toMatchObject({ hasMore: false, afterId: null });
      // Oldest first.
      expect(idsOf(await paidSince(s.auth, res.body.asOf).expect(200))).toEqual(
        [before, paid],
      );
      // Nothing after the completion.
      await pause();
      expect(
        idsOf(await paidSince(s.auth, new Date().toISOString()).expect(200)),
      ).toEqual([]);

      await post(s.auth, `/sales/${open}/payment/cancel`).expect(200);
      await gapFree(s.tenantId);
    });

    it('lists a cash sale the job completed (not one the till completed itself), and every cancelled sale with why: cashier, failed, expired, unpaid, gateway_refused', async () => {
      const s = await shop();
      const since = new Date(Date.now() - 1000).toISOString();
      const row2 = async (id: string) =>
        (
          (await paidSince(s.auth, since).expect(200)).body.data as {
            id: string;
            status: string;
            reason: string | null;
            completedByJob: boolean;
            onlinePayment: boolean;
            receiptNumber: number | null;
            holdNumber: number;
            cancelledAt: string | null;
            endedAt: string;
          }[]
        ).find((x) => x.id === id);

      // Cash rung up and recorded at once, and cash completed by a repeat of the request: the till saw both.
      const atOnce = (await sellCash(s).expect(201)).body.id as string;
      link = 'down';
      const key = randomUUID();
      const repeated = (await sellCash(s, key).expect(503)).body
        .saleId as string;
      // Never recorded at all: the job gives it up.
      const givenUp = (await sellCash(s).expect(503)).body.saleId as string;
      link = 'ok';
      await sellCash(s, key).expect(201);
      // Recorded by payment-api, the answer lost: the job completes it.
      loseCharge = true;
      const byJob = (await sellCash(s).expect(503)).body.saleId as string;

      const byCashier = (await sell(s).expect(201)).body.id as string;
      await post(s.auth, `/sales/${byCashier}/payment/cancel`).expect(200);
      const failed = (await sell(s).expect(201)).body.id as string;
      await onBill(s, failed, 'fail');
      await poll(s, failed).expect(200);
      const expired = (await sell(s).expect(201)).body.id as string;
      await pay.sql`update payment.payments set expires_at = now() - interval '1 minute' where order_ref = ${expired}`;
      await onBill(s, expired, 'expire');

      expect(await sync.tick(later())).toMatchObject({
        completed: 1,
        cancelled: 1,
        failed: 0,
      });
      // The grace period for money on its way is over: payment-api closes the expired bill.
      pay.clock.advance(11 * MINUTES);
      try {
        await post(s.auth, `/sales/${expired}/payment/check`).expect(200);
      } finally {
        pay.clock.advance(-11 * MINUTES);
      }

      expect(await row2(atOnce)).toBeUndefined();
      expect(await row2(repeated)).toBeUndefined();
      expect(await row2(byJob)).toMatchObject({
        status: 'completed',
        reason: null,
        completedByJob: true,
        onlinePayment: false,
        receiptNumber: 3,
        cancelledAt: null,
      });
      expect(await row2(givenUp)).toMatchObject({
        status: 'cancelled',
        reason: 'unpaid',
        onlinePayment: false,
        receiptNumber: null,
      });
      expect(await row2(byCashier)).toMatchObject({
        status: 'cancelled',
        reason: 'cashier',
        onlinePayment: true,
        receiptNumber: null,
      });
      expect(await row2(failed)).toMatchObject({
        status: 'cancelled',
        reason: 'failed',
      });
      const gone = await row2(expired);
      expect(gone).toMatchObject({
        status: 'expired',
        reason: 'expired',
        completedByJob: false,
        receiptNumber: null,
      });
      expect(gone!.endedAt).toBe(gone!.cancelledAt);
      // Still `cancelled` as a sale: `expired` is this answer's word for why.
      expect((await row(expired)).status).toBe('cancelled');

      // Nothing of it after it has all ended.
      await pause();
      expect(
        idsOf(await paidSince(s.auth, new Date().toISOString()).expect(200)),
      ).toEqual([]);
      await gapFree(s.tenantId);

      // A store that may not charge at the gateway: cancelled in the request that rang the sale up.
      const closed = await shop(false);
      const refused = (await sell(closed).expect(409)).body.saleId as string;
      expect(
        (await paidSince(closed.auth, since).expect(200)).body.data,
      ).toMatchObject([
        { id: refused, status: 'cancelled', reason: 'gateway_refused' },
      ]);
    });

    it('a payment learned late is listed although the customer paid before `since`', async () => {
      const s = await shop();
      const saleId = (await sell(s).expect(201)).body.id as string;
      // Paid: payment-api knows, pos-api does not yet (payment-api pushes nothing; the till is off).
      await onBill(s, saleId, 'pay');
      await pause(1100);
      const since = new Date().toISOString();
      await pause();
      await poll(s, saleId).expect(200);
      const res = await paidSince(s.auth, since).expect(200);
      expect(idsOf(res)).toEqual([saleId]);
      // Dated when the customer paid, which is before the till last looked.
      const [sale] = res.body.data as { paidAt: string; completedAt: string }[];
      expect(new Date(sale.paidAt).getTime()).toBeLessThan(
        new Date(since).getTime(),
      );
      expect(new Date(sale.completedAt).getTime()).toBeGreaterThan(
        new Date(since).getTime(),
      );
    });

    it('a cashier sees their own, also with `sales.void`; a `reports.view` holder and the owner see the store’s, as on GET /sales; store B sees nothing of store A', async () => {
      const a = await shop();
      const b = await shop();
      const mine = await createCashier(app, a, ['sales.create']);
      const other = await createCashier(app, a, ['sales.create']);
      // May open every sale's payment, but the totals of other people's sales are for `reports.view`.
      const supervisor = await createCashier(app, a, [
        'sales.create',
        'sales.void',
      ]);
      const reader = await createCashier(app, a, ['reports.view']);
      await post(mine.auth, '/shifts/open', { openingCash: 0 }).expect(201);
      await post(supervisor.auth, '/shifts/open', { openingCash: 0 }).expect(
        201,
      );
      const since = new Date(Date.now() - MINUTES).toISOString();
      const owners = (await sell(a).expect(201)).body.id as string;
      const cashiers = (await sellAs(a, mine.auth).expect(201)).body
        .id as string;
      // A cancelled sale is the same people's as a paid one.
      const dropped = (await sell(a).expect(201)).body.id as string;
      await post(a.auth, `/sales/${dropped}/payment/cancel`).expect(200);
      const supervisors = (await sellAs(a, supervisor.auth).expect(201)).body
        .id as string;
      for (const id of [owners, cashiers, supervisors]) {
        await onBill(a, id, 'pay');
        await poll(a, id).expect(200);
      }

      expect(idsOf(await paidSince(mine.auth, since).expect(200))).toEqual([
        cashiers,
      ]);
      expect(idsOf(await paidSince(other.auth, since).expect(200))).toEqual([]);
      expect(
        idsOf(await paidSince(supervisor.auth, since).expect(200)),
      ).toEqual([supervisors]);
      const all = [dropped, owners, cashiers, supervisors];
      expect(idsOf(await paidSince(reader.auth, since).expect(200))).toEqual(
        all,
      );
      expect(idsOf(await paidSince(a.auth, since).expect(200))).toEqual(all);
      // The same sales as the list shows each of them.
      for (const who of [mine, other, supervisor, reader]) {
        const list = await get(who.auth, '/sales').expect(200);
        // (The list shows receipts; this also tells of the cancelled sale.)
        expect(idsOf(list).sort()).toEqual(
          idsOf(await paidSince(who.auth, since).expect(200))
            .filter((id) => id !== dropped)
            .sort(),
        );
      }
      expect(idsOf(await paidSince(b.auth, since).expect(200))).toEqual([]);
    });

    it('more sales than one answer holds: oldest first, `hasMore` with a cursor, and paging sees every sale exactly once, also sales completed at the same instant', async () => {
      const s = await shop(true, 200);
      const since = new Date(Date.now() - 10 * MINUTES).toISOString();
      const ids: string[] = [];
      for (let i = 0; i < 2 * PAID_SINCE_LIMIT + 20; i += 1) {
        const id = (await sell(s).expect(201)).body.id as string;
        await onBill(s, id, 'pay');
        ids.push(id);
      }
      // The job completes them (100 a run).
      for (let i = 0; i < 2; i += 1) await sync.tick(later());
      expect(await gapFree(s.tenantId)).toBe(ids.length);
      // Cancelled sales are paged through with them.
      for (let i = 0; i < 7; i += 1) {
        const id = (await sell(s).expect(201)).body.id as string;
        await post(s.auth, `/sales/${id}/payment/cancel`).expect(200);
        ids.push(id);
      }
      // A minute ago, at seven instants one MICROSECOND apart: every page ends in the middle of sales that
      // ended at the same instant, and inside a millisecond that the next page continues in. A cursor cut
      // to milliseconds would repeat or pass by sales.
      const longAgo = admin`date_trunc('second', now()) - interval '1 minute'`;
      await admin`
        update pos.sales set completed_at = ${longAgo} + (number % 7) * interval '1 microsecond'
        where tenant_id = ${s.tenantId} and status = 'completed'`;
      await admin`
        update pos.sales set cancelled_at = ${longAgo} + (hold_number % 7) * interval '1 microsecond'
        where tenant_id = ${s.tenantId} and status = 'cancelled'`;

      type Page = {
        data: { id: string; endedAt: string }[];
        hasMore: boolean;
        asOf: string;
        afterId: string | null;
      };
      /** Pages from `since` to the end: the size of each page, every id in order, and the last answer. */
      async function pageThrough() {
        const seen: string[] = [];
        const pages: number[] = [];
        let query = `since=${encodeURIComponent(since)}`;
        for (;;) {
          const res = await get(s.auth, `/sales/paid-since?${query}`).expect(
            200,
          );
          const body = res.body as Page;
          pages.push(body.data.length);
          seen.push(...body.data.map((x) => x.id));
          // Oldest first within the page.
          const times = body.data.map((x) => x.endedAt);
          expect(times).toEqual([...times].sort());
          if (!body.hasMore || pages.length > 10) {
            expect(body.afterId).toBeNull();
            return { seen, pages, last: body, query };
          }
          expect(body.afterId).toBe(body.data[body.data.length - 1].id);
          // The cursor carries the microseconds.
          expect(body.asOf).toMatch(/\.\d{6}Z$/);
          query = `since=${encodeURIComponent(body.asOf)}&afterId=${body.afterId}`;
        }
      }
      const { seen, pages, query } = await pageThrough();
      expect(pages).toEqual([PAID_SINCE_LIMIT, PAID_SINCE_LIMIT, 27]);
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort()).toEqual([...ids].sort());

      // The newest 30 ended just now, where a completion still being written could commit with an earlier
      // time. No cursor is put there: the page that would end among them stops at the last settled sale,
      // and they come with the last page, whose `asOf` is behind the clock, so the next request reads them
      // again (and anything that committed meanwhile).
      await admin`
        update pos.sales set completed_at = clock_timestamp()
        where tenant_id = ${s.tenantId} and status = 'completed' and number > ${ids.length - 7 - 30}`;
      const fresh = await pageThrough();
      expect(fresh.pages).toEqual([PAID_SINCE_LIMIT, 47, 30]);
      expect(new Set(fresh.seen).size).toBe(fresh.seen.length);
      expect([...fresh.seen].sort()).toEqual([...ids].sort());
      const again = await get(
        s.auth,
        `/sales/paid-since?since=${encodeURIComponent(fresh.last.asOf)}`,
      ).expect(200);
      expect(idsOf(again).sort()).toEqual(fresh.seen.slice(-30).sort());

      // Store B pages through nothing of it, with store A's cursor.
      const b = await shop();
      expect(
        idsOf(await get(b.auth, `/sales/paid-since?${query}`).expect(200)),
      ).toEqual([]);
    }, 120_000);

    it('needs a session and a time with an offset that a sale can have: 401, 422', async () => {
      const s = await shop();
      await http()
        .get('/sales/paid-since?since=2026-11-26T00:00:00Z')
        .expect(401);
      const missing = await get(s.auth, '/sales/paid-since').expect(422);
      expect(missing.body.errors).toHaveProperty('since');
      for (const bad of [
        'kemarin',
        '2026-11-26',
        '2026-11-26T10:00:00',
        // Times the database cannot hold or no sale has: a 422, not a failed query.
        '0000-01-01T00:00:00Z',
        '1999-12-31T23:59:59Z',
        '9999-12-31T23:59:59Z',
        new Date(Date.now() + 3 * 86_400_000).toISOString(),
        // An offset no place has: zod and JavaScript take it, the database does not.
        '2026-11-26T10:00:00+23:59',
        '2026-11-25T10:00:00-23:59',
        '2026-11-26T10:00:00+16:00',
        '2026-11-26T10:00:00+14:01',
        '2026-11-26T10:00:00+1500',
      ])
        await paidSince(s.auth, bad).expect(422);
      for (const edge of [
        '2026-11-26T10:00:00+14:00',
        '2026-11-25T10:00:00-12:00',
      ])
        await paidSince(s.auth, edge).expect(200);
      const ok = '2026-11-26T10:00:00%2B07:00';
      await get(s.auth, `/sales/paid-since?since=${ok}`).expect(200);
      const badId = await get(
        s.auth,
        `/sales/paid-since?since=${ok}&afterId=1`,
      ).expect(422);
      expect(badId.body.errors).toHaveProperty('afterId');
      await get(
        s.auth,
        `/sales/paid-since?since=${ok}&afterId=${randomUUID()}`,
      ).expect(200);
    });
  });
});
