import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

// UMK-1972 (design feature 35): the dashboard's widgets. Every figure is the reports' own definition: final sales by
// `paid_at` minus voids by the void's time, tax left out, days by the store's timezone, integer rupiah.
describe('dashboard widgets (UMK-1972)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const http = () => request(app.getHttpServer());
  const OWNER_PIN = '246810';

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const get = (auth: string, path: string) =>
    http().get(path).set('Authorization', auth);
  const post = (auth: string, path: string, body: object) =>
    http()
      .post(path)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  /** A store with a shift open, a cash method (the default) and helpers to add products and sales. */
  async function shop() {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Umum',
    }).expect(201);
    const product = async (
      name: string,
      price: number,
      cost: number,
      qty = 100,
      extra: object = {},
    ) => {
      const p = await post(s.auth, '/catalog/products', {
        categoryId: cat.body.id,
        name,
        costPrice: cost,
        sellingPrice: price,
        ...extra,
      }).expect(201);
      if (qty > 0)
        await post(s.auth, '/stock/opening', {
          productId: p.body.id,
          qty,
        }).expect(201);
      return p.body.id as string;
    };
    await post(s.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: OWNER_PIN })
      .expect(200);
    const method = async (name: string, kind: 'debit' | 'credit' | 'wallet') =>
      (await post(s.auth, '/payment-methods', { name, kind }).expect(201)).body
        .id as string;
    const sell = async (body: object) =>
      (await post(s.auth, '/sales', body).expect(201)).body as {
        id: string;
        total: number;
        receivableId?: string;
      };
    const cashSale = (productId: string, qty: number, paid = 1_000_000) =>
      sell({ lines: [{ productId, qty }], paid });
    const voidSale = (saleId: string) =>
      post(s.auth, `/sales/${saleId}/void`, {
        reasonCode: 'wrong_item_or_qty',
        approverId: s.userId,
        pin: OWNER_PIN,
      }).expect(201);
    /** Moves a sale (and the shift-less clock) back `interval` (a Postgres interval), as the reports' own tests do. */
    const backdate = (saleId: string, interval: string) => admin`
      update pos.sales set created_at = created_at - ${interval}::interval, paid_at = paid_at - ${interval}::interval
       where id = ${saleId}`;
    const setTax = (taxBps: number) =>
      http()
        .put('/sales/settings')
        .set('Authorization', s.auth)
        .send({ taxBps })
        .expect(200);
    return {
      ...s,
      product,
      method,
      sell,
      cashSale,
      voidSale,
      backdate,
      setTax,
    };
  }

  const overview = async (auth: string, period = 'today') =>
    (await get(auth, `/reports/widgets/overview?period=${period}`).expect(200))
      .body;

  describe('overview (hero, tiles, trend)', () => {
    it('sales and gross profit leave tax out; average basket and trend come from the server', async () => {
      const s = await shop();
      const teh = await s.product('Es Teh', 5000, 3000);
      await s.setTax(1000);
      await s.cashSale(teh, 3); // 15.000 + 1.500 tax = 16.500; cost 9.000
      const yesterday = await s.cashSale(teh, 2); // 10.000 + 1.000 tax; cost 6.000
      await s.backdate(yesterday.id, '1 day');

      const o = await overview(s.auth);
      expect(o).toMatchObject({
        period: 'today',
        timezone: 'Asia/Jakarta',
        current: {
          sales: 15_000,
          salesCount: 1,
          averageBasket: 15_000,
          // revenue 16.500 − tax 1.500 − cost 9.000: the same number as the reports' gross profit.
          grossProfit: 6000,
        },
        previous: {
          sales: 10_000,
          salesCount: 1,
          averageBasket: 10_000,
          grossProfit: 4000,
        },
      });
      expect(o.trend).toHaveLength(7);
      // Consecutive store days ending today; the last bucket is the current figures, yesterday's the previous.
      const days = o.trend.map((b: { from: string }) => Date.parse(b.from));
      days.slice(1).forEach((d: number, i: number) => {
        expect(d - days[i]).toBe(86_400_000);
      });
      expect(o.trend[6]).toMatchObject({ ...o.current, from: o.from });
      expect(o.trend[5]).toMatchObject({
        sales: 10_000,
        salesCount: 1,
        grossProfit: 4000,
      });
      expect(o.trend[0]).toMatchObject({
        sales: 0,
        salesCount: 0,
        averageBasket: 0,
        grossProfit: 0,
      });
      // Same totals as the existing report: revenue − tax.
      const dash = (await get(s.auth, '/reports/dashboard?period=today')).body;
      expect(o.current.sales).toBe(dash.current.revenue - dash.current.tax);
      expect(o.current.grossProfit).toBe(dash.current.grossProfit);
    });

    it('a void is taken off on the day it is done, never on the sale’s own day', async () => {
      const s = await shop();
      const teh = await s.product('Es Teh', 5000, 3000);
      const same = await s.cashSale(teh, 3);
      const old = await s.cashSale(teh, 2);
      await s.backdate(old.id, '1 day');
      await s.voidSale(same.id);
      await s.voidSale(old.id);
      const o = await overview(s.auth);
      // Today: the same-day void nets to zero, and the older receipt's void is a reversal today.
      expect(o.current).toMatchObject({
        sales: -10_000,
        salesCount: -1,
        grossProfit: -4000,
        averageBasket: 0,
      });
      expect(o.trend[5]).toMatchObject({ sales: 10_000, salesCount: 1 });
      expect(o.trend[6]).toMatchObject({ sales: -10_000 });
    });

    it('awaiting and cancelled sales are not receipts', async () => {
      const s = await shop();
      const teh = await s.product('Es Teh', 5000, 3000);
      await s.cashSale(teh, 1);
      await admin`update pos.sales set status = 'awaiting_payment', hold_number = 1, hold_day = current_date where tenant_id = ${s.tenantId}`;
      expect((await overview(s.auth)).current).toMatchObject({
        sales: 0,
        salesCount: 0,
      });
      await admin`update pos.sales set status = 'cancelled', cancelled_at = now(), cancel_reason = 'cashier' where tenant_id = ${s.tenantId}`;
      expect((await overview(s.auth)).trend[6].salesCount).toBe(0);
    });

    it('every period: its bucket count, its last bucket equal to the current figures, the dashboard’s comparison', async () => {
      const s = await shop();
      const teh = await s.product('Es Teh', 5000, 3000);
      await s.cashSale(teh, 2);
      const buckets = { today: 7, week: 8, month: 6, year: 3 };
      for (const [period, count] of Object.entries(buckets)) {
        const o = await overview(s.auth, period);
        const dash = (
          await get(s.auth, `/reports/dashboard?period=${period}`).expect(200)
        ).body;
        expect(o.trend).toHaveLength(count);
        expect(o.from).toBe(dash.from);
        expect(o.current.sales).toBe(10_000);
        expect(o.trend[count - 1]).toMatchObject(o.current);
        expect(o.previous.sales).toBe(
          dash.previous.revenue - dash.previous.tax,
        );
      }
    });

    it('a new store answers zeros and an empty trend of zeros, and a bad period is refused', async () => {
      const s = await shop();
      const o = await overview(s.auth);
      expect(o.current).toEqual({
        sales: 0,
        salesCount: 0,
        averageBasket: 0,
        grossProfit: 0,
      });
      expect(o.trend.every((b: { sales: number }) => b.sales === 0)).toBe(true);
      const bad = await get(s.auth, '/reports/widgets/overview?period=decade');
      expect(bad.status).toBe(422);
    });
  });

  describe('hourly', () => {
    /** Sets a sale to `hh:mm` of today in the store's timezone. */
    const at = (saleId: string, time: string) => admin`
      update pos.sales set paid_at = (date_trunc('day', now() at time zone 'Asia/Jakarta') + ${time}::interval)
                                     at time zone 'Asia/Jakarta'
       where id = ${saleId}`;

    it('one value per hour from 08 to 20, the busiest hour named, hours outside it added', async () => {
      const s = await shop();
      const teh = await s.product('Es Teh', 5000, 3000);
      const a = await s.cashSale(teh, 2);
      const b = await s.cashSale(teh, 1);
      const c = await s.cashSale(teh, 2);
      await at(a.id, '15:10');
      await at(b.id, '15:50');
      await at(c.id, '09:00');
      const h = (await get(s.auth, '/reports/widgets/hourly').expect(200)).body;
      expect(h.hours).toHaveLength(13);
      expect(h.hours[0].hour).toBe(8);
      expect(h.hours.find((x: { hour: number }) => x.hour === 15)).toEqual({
        hour: 15,
        sales: 15_000,
        count: 2,
      });
      expect(h.peak).toEqual({ hour: 15, sales: 15_000 });
      expect(h.total).toBe(25_000);
      expect(h.transactions).toBe(3);

      const d = await s.cashSale(teh, 1);
      await at(d.id, '22:30');
      const wider = (await get(s.auth, '/reports/widgets/hourly').expect(200))
        .body;
      expect(wider.hours.at(-1)).toEqual({ hour: 22, sales: 5000, count: 1 });
      expect(wider.hours).toHaveLength(15);
    });

    it('a new store: all hours zero and no peak', async () => {
      const s = await shop();
      const h = (await get(s.auth, '/reports/widgets/hourly').expect(200)).body;
      expect(h.peak).toBeNull();
      expect(h.total).toBe(0);
      expect(h.hours).toHaveLength(13);
    });

    it('a sale paid on another day is not in today’s hours; a void is taken off', async () => {
      const s = await shop();
      const teh = await s.product('Es Teh', 5000, 3000);
      const old = await s.cashSale(teh, 2);
      await s.backdate(old.id, '2 days');
      const v = await s.cashSale(teh, 3);
      await at(v.id, '10:00');
      let h = (await get(s.auth, '/reports/widgets/hourly').expect(200)).body;
      expect(h.total).toBe(15_000);
      await s.voidSale(v.id);
      h = (await get(s.auth, '/reports/widgets/hourly').expect(200)).body;
      // The void is today at the time it was done, so the sale (10:00) stays and its reversal is at now.
      expect(h.hours.find((x: { hour: number }) => x.hour === 10).sales).toBe(
        15_000,
      );
      expect(h.total).toBe(0);
    });
  });

  describe('payment mix', () => {
    it('adds up to the sales figure; kasbon is a part; a voided sale leaves its method', async () => {
      const s = await shop();
      const teh = await s.product('Es Teh', 5000, 3000);
      await s.setTax(1000);
      const debit = await s.method('Kartu Debit', 'debit');
      const kasbon = await s.method('Kasbon', 'credit');
      const member = (
        await post(s.auth, '/members', {
          name: 'Bu Sari',
          code: `M${randomUUID().slice(0, 6)}`,
          phone: '081234567890',
        }).expect(201)
      ).body.id;
      await s.cashSale(teh, 4); // 20.000
      const d = await s.sell({
        lines: [{ productId: teh, qty: 2 }],
        paymentMethodId: debit,
        paid: 11_000,
      }); // 10.000
      await s.sell({
        lines: [{ productId: teh, qty: 1 }],
        paymentMethodId: kasbon,
        memberId: member,
        paid: 0,
      }); // 5.000
      let mix = (await get(s.auth, '/reports/widgets/payment-mix').expect(200))
        .body;
      const by = Object.fromEntries(
        mix.parts.map((p: { name: string; value: number }) => [
          p.name,
          p.value,
        ]),
      );
      expect(by['Kartu Debit']).toBe(10_000);
      expect(by['Kasbon']).toBe(5000);
      expect(mix.parts[0].value).toBe(20_000); // largest first
      expect(mix.total).toBe(35_000);
      expect((await overview(s.auth)).current.sales).toBe(mix.total);

      await s.voidSale(d.id);
      mix = (await get(s.auth, '/reports/widgets/payment-mix').expect(200))
        .body;
      expect(mix.parts.map((p: { name: string }) => p.name)).not.toContain(
        'Kartu Debit',
      );
      expect(mix.total).toBe(25_000);
    });

    it('more than five methods end in Lainnya, and the parts still add up', async () => {
      const s = await shop();
      const teh = await s.product('Es Teh', 1000, 500);
      await s.cashSale(teh, 7);
      for (let i = 1; i <= 5; i++) {
        const id = await s.method(`Dompet ${i}`, 'wallet');
        await s.sell({
          lines: [{ productId: teh, qty: i }],
          paymentMethodId: id,
          paid: i * 1000,
        });
      }
      const mix = (
        await get(s.auth, '/reports/widgets/payment-mix').expect(200)
      ).body;
      expect(mix.parts).toHaveLength(5);
      expect(mix.parts.at(-1)).toMatchObject({ name: 'Lainnya', value: 3000 });
      expect(
        mix.parts.reduce((a: number, p: { value: number }) => a + p.value, 0),
      ).toBe(mix.total);
      expect(mix.total).toBe(22_000);
    });

    it('a new store has no parts', async () => {
      const s = await shop();
      const mix = (
        await get(s.auth, '/reports/widgets/payment-mix').expect(200)
      ).body;
      expect(mix).toMatchObject({ total: 0, parts: [] });
    });
  });

  describe('top products', () => {
    it('by units sold this week, largest first, at most the limit; voided lines and older weeks are out', async () => {
      const s = await shop();
      const a = await s.product('Indomie', 3000, 2000);
      const b = await s.product('Teh Botol', 4000, 2500);
      const c = await s.product('Telur', 2000, 1500);
      const d = await s.product('Beras', 60_000, 50_000);
      await s.sell({
        lines: [
          { productId: a, qty: 12 },
          { productId: b, qty: 9 },
          { productId: c, qty: 9 },
        ],
        paid: 1_000_000,
      });
      const gone = await s.cashSale(d, 30, 5_000_000);
      await s.voidSale(gone.id);
      const old = await s.cashSale(d, 40, 5_000_000);
      await s.backdate(old.id, '8 days');
      const top = (
        await get(s.auth, '/reports/widgets/top-products').expect(200)
      ).body;
      expect(top.period).toBe('week');
      expect(
        top.rows.map((r: { name: string; qty: number }) => [r.name, r.qty]),
      ).toEqual([
        ['Indomie', 12],
        ['Teh Botol', 9], // ties by sales, then name
        ['Telur', 9],
      ]);
      expect(top.rows[0]).toMatchObject({ sales: 36_000, unit: 'PCS' });
      const two = (
        await get(s.auth, '/reports/widgets/top-products?limit=2').expect(200)
      ).body;
      expect(two.rows).toHaveLength(2);
      const stat = (
        await get(s.auth, '/reports/widgets/top-products?period=year').expect(
          200,
        )
      ).body;
      expect(stat.period).toBe('year');
    });

    it('refuses a limit or period it does not know', async () => {
      const s = await shop();
      for (const q of ['limit=0', 'limit=11', 'limit=abc', 'period=decade']) {
        const res = await get(s.auth, `/reports/widgets/top-products?${q}`);
        expect(res.status).toBe(422);
      }
    });

    it('a new store has none', async () => {
      const s = await shop();
      expect(
        (await get(s.auth, '/reports/widgets/top-products').expect(200)).body
          .rows,
      ).toEqual([]);
    });
  });

  describe('low stock', () => {
    it('out and low products only, emptiest first, with the counts and the level to measure against', async () => {
      const s = await shop();
      const out = await s.product('Gula 1 kg', 15_000, 12_000, 15, {
        lowStockThreshold: 5,
      });
      await s.cashSale(out, 15);
      const low = await s.product('Telur 1 kg', 28_000, 24_000, 20, {
        lowStockThreshold: 5,
      });
      await s.cashSale(low, 16); // 4 left of the 20 received
      const lower = await s.product('Minyak 1 L', 18_000, 15_000, 20, {
        lowStockThreshold: 10,
      });
      await s.cashSale(lower, 11); // 9 left, threshold 10
      await s.product('Beras 5 kg', 70_000, 60_000, 50); // plenty
      await s.product('Jasa potong', 5000, 0, 0, { type: 'service' }); // never tracked
      await s.product('Baru', 1000, 500, 0); // tracked, never stocked: the products list calls it out too
      const gone = await s.product('Dihapus', 1000, 500, 0);
      await http()
        .delete(`/catalog/products/${gone}`)
        .set('Authorization', s.auth)
        .expect(204);
      const r = (await get(s.auth, '/reports/widgets/low-stock').expect(200))
        .body;
      expect(r).toMatchObject({ total: 4, out: 2, low: 2 });
      expect(
        r.rows.map((x: { name: string; onHand: number; status: string }) => [
          x.name,
          x.onHand,
          x.status,
        ]),
      ).toEqual([
        ['Baru', 0, 'out'],
        ['Gula 1 kg', 0, 'out'],
        ['Telur 1 kg', 4, 'low'],
        ['Minyak 1 L', 9, 'low'],
      ]);
    });
  });

  describe('receivables by age', () => {
    it('buckets by days late on the store’s date; the late ones add up to the summary’s due amount', async () => {
      const s = await shop();
      const gula = await s.product('Gula', 500, 300, 500);
      const kasbon = await s.method('Kasbon', 'credit');
      const sale = async (name: string, total: number, days: number) => {
        const member = (
          await post(s.auth, '/members', {
            name,
            code: `M${randomUUID().slice(0, 6)}`,
            phone: '081234567890',
          }).expect(201)
        ).body.id;
        const k = await s.sell({
          lines: [{ productId: gula, qty: total / 500 }],
          paymentMethodId: kasbon,
          memberId: member,
          paid: 0,
        });
        await admin`
          update pos.receivables set due_date = (now() at time zone 'Asia/Jakarta')::date + ${days}::int
           where id = ${k.receivableId!}`;
      };
      await sale('A', 1000, 5); // not due
      await sale('B', 1500, 0); // due today
      await sale('C', 2000, -7); // 7 days late
      await sale('D', 2500, -8); // 8 days late
      await sale('E', 3000, -30); // 30 days late
      await sale('F', 3500, -31); // more than 30
      const r = (await get(s.auth, '/reports/receivables/aging').expect(200))
        .body;
      expect(r.buckets.map((b: { key: string }) => b.key)).toEqual([
        'not_due',
        'late_1_7',
        'late_8_30',
        'late_over_30',
      ]);
      expect(
        r.buckets.map((b: { amount: number; customers: number }) => [
          b.amount,
          b.customers,
        ]),
      ).toEqual([
        [1000, 1],
        [3500, 2],
        [5500, 2],
        [3500, 1],
      ]);
      expect(r.total).toBe(13_500);
      expect(r.customers).toBe(6);
      const summary = (
        await get(s.auth, '/reports/receivables/summary').expect(200)
      ).body;
      expect(r.total).toBe(summary.totalRest);
      expect(
        r.buckets
          .slice(1)
          .reduce((a: number, b: { amount: number }) => a + b.amount, 0),
      ).toBe(summary.dueRest);
    });

    it('a settled or voided kasbon is in no bucket, and a new store has zeros', async () => {
      const s = await shop();
      const r = (await get(s.auth, '/reports/receivables/aging').expect(200))
        .body;
      expect(r.total).toBe(0);
      expect(r.buckets.every((b: { amount: number }) => b.amount === 0)).toBe(
        true,
      );
    });
  });

  describe('access and tenants', () => {
    const PATHS = [
      '/reports/widgets/overview',
      '/reports/widgets/hourly',
      '/reports/widgets/payment-mix',
      '/reports/widgets/top-products',
      '/reports/widgets/low-stock',
      '/reports/receivables/aging',
    ];

    it('needs reports.view on every widget', async () => {
      const s = await createStore();
      const plain = await createCashier(app, s, ['sales.create']);
      const viewer = await createCashier(app, s, ['reports.view']);
      for (const path of PATHS) {
        await get(plain.auth, path).expect(403);
        await get(viewer.auth, path).expect(200);
      }
    });

    it('cross-tenant: store B sees nothing of store A on any widget', async () => {
      const a = await shop();
      const teh = await a.product('Es Teh', 5000, 3000, 2);
      await a.cashSale(teh, 2); // sold out: low stock, too
      const kasbon = await a.method('Kasbon', 'credit');
      const member = (
        await post(a.auth, '/members', {
          name: 'Bu Sari',
          code: `M${randomUUID().slice(0, 6)}`,
          phone: '081234567890',
        }).expect(201)
      ).body.id;
      const gula = await a.product('Gula', 500, 300, 500);
      await a.sell({
        lines: [{ productId: gula, qty: 4 }],
        paymentMethodId: kasbon,
        memberId: member,
        paid: 0,
      });

      const b = await createStore();
      const o = (
        await get(b.auth, '/reports/widgets/overview?period=year').expect(200)
      ).body;
      expect(o.current.sales).toBe(0);
      expect(o.trend.every((x: { sales: number }) => x.sales === 0)).toBe(true);
      expect(
        (await get(b.auth, '/reports/widgets/hourly').expect(200)).body.total,
      ).toBe(0);
      expect(
        (
          await get(b.auth, '/reports/widgets/payment-mix?period=year').expect(
            200,
          )
        ).body.parts,
      ).toEqual([]);
      expect(
        (
          await get(b.auth, '/reports/widgets/top-products?period=year').expect(
            200,
          )
        ).body.rows,
      ).toEqual([]);
      expect(
        (await get(b.auth, '/reports/widgets/low-stock').expect(200)).body
          .total,
      ).toBe(0);
      expect(
        (await get(b.auth, '/reports/receivables/aging').expect(200)).body
          .total,
      ).toBe(0);
      // A still has its own.
      expect((await overview(a.auth, 'year')).current.sales).toBe(12_000);
      expect(
        (await get(a.auth, '/reports/receivables/aging').expect(200)).body
          .total,
      ).toBe(2000);
      expect(
        (await get(a.auth, '/reports/widgets/low-stock').expect(200)).body
          .total,
      ).toBe(1);
    });
  });
});
