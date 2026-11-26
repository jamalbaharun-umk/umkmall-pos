import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
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
      // No sale is left waiting (a later suite boots with payment-api off, which refuses that).
      const waiting = await admin`
        select id from pos.sales where status = 'awaiting_payment' and tenant_id in ${admin(tenants)}`;
      expect(waiting).toEqual([]);
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
    action: 'pay' | 'fail',
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
  async function shop(merchant = true) {
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
    await post(s.auth, '/stock/opening', { productId, qty: 50 }).expect(201);
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
      const outcomes = new Set<string>();
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
        outcomes.add(sale.status);
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
      expect(outcomes.size).toBeGreaterThan(0);
    });

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
        admin`update pos.sales set hold_number = null where id = ${waiting}`,
      );
      await refused(
        admin`update pos.sales set status = 'completed' where id = ${waiting}`,
      );
      // Two sales of one store never share a hold number or a receipt number.
      const other = (await sell(s).expect(201)).body.id as string;
      await expect(
        admin`update pos.sales set hold_number = 2 where id = ${other}`,
      ).rejects.toMatchObject({
        constraint_name: 'sales_tenant_hold_number_uq',
      });
      for (const id of [waiting, other])
        await post(s.auth, `/sales/${id}/payment/cancel`).expect(200);
      await gapFree(s.tenantId);
    });

    it('the migration gives earlier receipts their completion time and waiting sales a hold number in the order they were rung up, and a waiting sale that had a number keeps it when it is completed', async () => {
      const s = await shop();
      const other = await shop();
      const receipt = (await sellCash(s).expect(201)).body.id as string;
      const first = (await sell(s).expect(201)).body.id as string;
      const second = (await sell(s).expect(201)).body.id as string;
      const theirs = (await sell(other).expect(201)).body.id as string;
      // Found by its name, not its number: migrations of parallel work are renumbered.
      const dir = path.join(__dirname, '..', 'drizzle');
      const file = readdirSync(dir).find((f) =>
        f.endsWith('_sale_hold_number.sql'),
      )!;
      const statements = readFileSync(path.join(dir, file), 'utf8')
        .split('--> statement-breakpoint')
        .map((x) => x.replace(/^\s*--.*$/gm, '').trim())
        .filter((x) => x.startsWith('UPDATE'));
      expect(statements).toHaveLength(3);
      // As the migration finds the rows: numbered when rung up, no hold number, no completion time. Rolled
      // back after.
      const rollback = new Error('rollback');
      await admin
        .begin(async (tx) => {
          await tx`alter table pos.sales drop constraint sales_number_ck`;
          await tx`update pos.sales set hold_number = null, completed_at = null,
              paid_at = created_at - interval '1 hour'
            where tenant_id in ${tx([s.tenantId, other.tenantId])}`;
          // Rung up second, first: the order is by `created_at`, not by id.
          await tx`update pos.sales set number = 7, created_at = now() - interval '2 hours' where id = ${second}`;
          await tx`update pos.sales set number = 8, created_at = now() - interval '1 hour' where id = ${first}`;
          await tx`update pos.sales_settings set last_hold_number = 0
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
          throw rollback;
        })
        .catch((e: unknown) => {
          if (e !== rollback) throw e;
        });

      // A sale that was waiting with a number when the migration ran (here: given one by hand) keeps it.
      await admin`update pos.sales set number = 2 where id = ${first}`;
      await admin`update pos.sales_settings set last_sale_number = 2 where tenant_id = ${s.tenantId}`;
      await onBill(s, first, 'pay');
      expect((await poll(s, first).expect(200)).body).toMatchObject({
        saleStatus: 'completed',
        receiptNumber: 2,
      });
      await onBill(s, second, 'pay');
      expect((await poll(s, second).expect(200)).body.receiptNumber).toBe(3);
      await post(other.auth, `/sales/${theirs}/payment/cancel`).expect(200);
      expect(await gapFree(s.tenantId)).toBe(3);
    });
  });
});
