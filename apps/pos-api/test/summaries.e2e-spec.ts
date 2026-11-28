import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import {
  ADMIN_PERMISSIONS,
  PERMISSIONS,
  type Permission,
} from '../src/staff/permissions';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
// The store's timezone is Asia/Jakarta (UTC+7) by default.
const jakarta = (offsetDays = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * Design feature 39, the summaries above each menu. One scenario store (every figure below is worked out in the
 * `scenario` comment), one empty store for the cross-tenant check, and one cashier per permission case.
 */
describe('summaries across menus (feature 39)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const http = () => request(app.getHttpServer());
  /** A JSON array of a supertest body (untyped by design). */
  const nums = (x: unknown) => x as number[];
  const arr = (x: unknown) => x as Array<Record<string, any>>;
  const get = (auth: string, path: string) =>
    http().get(path).set('Authorization', auth);
  const post = (auth: string, path: string, body: object) =>
    http()
      .post(path)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  let a: Store; // the scenario store
  let b: Store; // another store, empty
  let gula: string;
  let kopi: string;
  let kasbonMethod: string;
  let sari: Awaited<ReturnType<typeof createCashier>>;
  // Yesterday is in this month unless today is the 1st (the month-based figures then leave it out).
  const yesterdayInMonth = jakarta() > `${jakarta().slice(0, 8)}01`;

  /**
   * Scenario (store A, all dated today unless said). Gula Rp1.000 (cost 600, stock 500), Kopi Rp2.000 (cost 1.500,
   * stock 3, minimum 5), Teh Rp3.000 (cost 0, no stock).
   *  - owner cash 5 Gula = 5.000
   *  - Siti kasbon 3 Gula = 3.000 (nothing paid)
   *  - Budi cash 4 Gula with voucher HEMAT (flat Rp500) = 3.500
   *  - Lama cash 2 Gula = 2.000; Lama also bought 1 Gula 40 days ago (returning customer)
   *  - cashier Sari cash 2 Gula = 2.000
   *  - owner cash 1 Gula yesterday = 1.000
   * Today: 5 receipts, Rp15.500 (not the 40 days ago one).
   */
  async function scenario() {
    a = await createStore();
    b = await createStore();
    const cat = await post(a.auth, '/catalog/categories', {
      name: 'Sembako',
    }).expect(201);
    await post(a.auth, '/catalog/categories', { name: 'Kosong' }).expect(201);
    const prod = async (name: string, cost: number, price: number) =>
      (
        await post(a.auth, '/catalog/products', {
          categoryId: cat.body.id,
          name,
          costPrice: cost,
          sellingPrice: price,
        }).expect(201)
      ).body.id as string;
    gula = await prod('Gula', 600, 1000);
    kopi = await prod('Kopi', 1500, 2000);
    await prod('Teh', 0, 3000);
    await post(a.auth, '/stock/opening', { productId: gula, qty: 500 }).expect(
      201,
    );
    await post(a.auth, '/stock/opening', { productId: kopi, qty: 3 }).expect(
      201,
    );
    kasbonMethod = (
      await post(a.auth, '/payment-methods', {
        name: 'Kasbon',
        kind: 'credit',
      }).expect(201)
    ).body.id;
    await post(a.auth, '/vouchers', {
      name: 'Hemat lima ratus',
      code: 'HEMAT',
      type: 'flat',
      nominal: 500,
      kuota: 10,
      startDate: jakarta(),
      expired: jakarta(1),
    }).expect(201);
    await post(a.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const member = async (name: string) =>
      (
        await post(a.auth, '/members', {
          name,
          code: `M${randomUUID().slice(0, 6)}`,
        }).expect(201)
      ).body.id as string;
    const siti = await member('Siti');
    const budi = await member('Budi');
    const lama = await member('Lama');
    const sale = async (auth: string, qty: number, extra: object = {}) =>
      (
        await post(auth, '/sales', {
          lines: [{ productId: gula, qty }],
          paid: qty * 1000,
          ...extra,
        }).expect(201)
      ).body as { id: string };
    await sale(a.auth, 5);
    await post(a.auth, '/sales', {
      lines: [{ productId: gula, qty: 3 }],
      memberId: siti,
      paymentMethodId: kasbonMethod,
      paid: 0,
    }).expect(201);
    await sale(a.auth, 4, { memberId: budi, voucherCode: 'HEMAT', paid: 3500 });
    await sale(a.auth, 2, { memberId: lama });
    const old = await sale(a.auth, 1, { memberId: lama });
    await admin`update pos.sales set paid_at = paid_at - interval '40 days' where id = ${old.id}`;
    const yday = await sale(a.auth, 1);
    await admin`update pos.sales set paid_at = paid_at - interval '1 day' where id = ${yday.id}`;
    sari = await createCashier(app, a, ['sales.create']);
    await post(sari.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    await sale(sari.auth, 2);
  }

  beforeAll(scenario);

  it('Riwayat penjualan: today, seven days, today by payment method', async () => {
    const r = (await get(a.auth, '/summaries/sales-history').expect(200)).body;
    expect(r.today).toEqual({ count: 5, total: 15_500 });
    expect(r.days).toHaveLength(7);
    expect(r.days[6]).toMatchObject({
      date: jakarta(),
      total: 15_500,
      count: 5,
    });
    expect(r.days[5]).toMatchObject({
      date: jakarta(-1),
      total: 1000,
      count: 1,
    });
    expect(r.days[0].total).toBe(0);
    expect(arr(r.methods).map((m: { amount: number }) => m.amount)).toEqual([
      12_500, 3000,
    ]);
    expect(r.methods[1].name).toBe('Kasbon');
  });

  it('Pelanggan: biggest this month, new against returning, kasbon still owed', async () => {
    const r = (await get(a.auth, '/summaries/members').expect(200)).body;
    expect(r.total).toBe(3);
    expect(r.top).toEqual([
      { name: 'Budi', receipts: 1, amount: 3500 },
      { name: 'Siti', receipts: 1, amount: 3000 },
      { name: 'Lama', receipts: 1, amount: 2000 },
    ]);
    expect(r).toMatchObject({
      newCount: 2,
      returningCount: 1,
      kasbonRest: 3000,
    });
  });

  it('Produk: stock status and margin; Kategori and Metode pembayaran', async () => {
    const r = (await get(a.auth, '/summaries/products').expect(200)).body;
    expect(r.total).toBe(3);
    expect(r.stock).toEqual({ ok: 1, low: 1, out: 1 });
    expect(r.attention).toBe(2);
    expect(r.noCost).toBe(1);
    expect(r.margins).toEqual([
      { name: 'Gula', percent: 40 },
      { name: 'Kopi', percent: 25 },
    ]);

    const month = (await get(a.auth, '/summaries/payment-methods').expect(200))
      .body;
    const total = nums(
      arr(month.methods).map((m): number => Number(m.amount)),
    ).reduce((s, m) => s + m, 0);
    expect(total).toBe(15_500 + (yesterdayInMonth ? 1000 : 0));
    expect(month.activeCount).toBeGreaterThanOrEqual(2);

    const c = (await get(a.auth, '/summaries/categories').expect(200)).body;
    const sembako = arr(c.categories).find(
      (x: { name: string }) => x.name === 'Sembako',
    )!;
    // Line totals before the voucher: 5.000 + 3.000 + 4.000 + 2.000 + 2.000 (+ yesterday 1.000).
    expect(sembako.revenue).toBe(16_000 + (yesterdayInMonth ? 1000 : 0));
    // Gula left: 500 − 5 − 3 − 4 − 2 − 1 − 2 (the 40 days ago and yesterday sales took stock too) = 482.
    expect(sembako.stockValue).toBe(482 * 600 + 3 * 1500);
    expect(sembako.products).toBe(3);
    expect(
      arr(c.categories).find((x: { name: string }) => x.name === 'Kosong'),
    ).toMatchObject({
      products: 0,
      revenue: 0,
      stockValue: 0,
    });
  });

  it('Voucher: quota used against the full quota, redemptions of seven days', async () => {
    const r = (await get(a.auth, '/summaries/vouchers').expect(200)).body;
    expect(r.vouchers).toEqual([
      { name: 'Hemat lima ratus', code: 'HEMAT', used: 1, quota: 10 },
    ]);
    expect(r.days).toHaveLength(7);
    expect(r.days[6]).toEqual({ date: jakarta(), count: 1 });
  });

  it('Staf: sales per cashier this month and receipts per hour', async () => {
    const r = (await get(a.auth, '/summaries/staff').expect(200)).body;
    const sariRow = arr(r.cashiers).find(
      (c: { name: string }) => c.name === 'Sari',
    );
    expect(sariRow).toMatchObject({ receipts: 1, amount: 2000 });
    const owner = arr(r.cashiers).find(
      (c: { name: string }) => c.name === 'Pemilik',
    )!;
    expect(owner.amount).toBe(13_500 + (yesterdayInMonth ? 1000 : 0));
    expect(r.hours).toHaveLength(24);
    expect(nums(r.hours).reduce((s, h) => s + h, 0)).toBe(
      5 + (yesterdayInMonth ? 1 : 0),
    );
  });

  it('Pemasok: approved purchases per month, six months', async () => {
    const sup = await post(a.auth, '/suppliers', { name: 'CV Sumber' }).expect(
      201,
    );
    const o = await post(a.auth, '/purchasing/orders', {
      supplierId: sup.body.id,
      paymentMethod: 'Tunai',
      lines: [{ productId: gula, qty: 5, unitCost: 600 }],
    }).expect(201);
    await post(a.auth, `/purchasing/orders/${o.body.id}/approve`, {}).expect(
      200,
    );
    const r = (await get(a.auth, '/summaries/suppliers').expect(200)).body;
    expect(r.supplierCount).toBe(1);
    expect(r.months).toHaveLength(6);
    expect(r.months[5]).toEqual({ month: jakarta().slice(0, 7), total: 3000 });
    expect(r.months[0].total).toBe(0);
  });

  it('Stok opname: the shortage and the surplus of the latest approved opname, valued only with reports.view', async () => {
    expect(
      (await get(a.auth, '/summaries/stock-opname').expect(200)).body,
    ).toEqual({ opname: null });
    const onHand = async (id: string) =>
      (await get(a.auth, `/stock/products/${id}`).expect(200)).body
        .onHand as number;
    const gulaNow = await onHand(gula);
    const so = await post(a.auth, '/stock-opnames', {
      lines: [
        { productId: gula, countedQty: gulaNow + 4 },
        { productId: kopi, countedQty: 1 },
      ],
    }).expect(201);
    // A draft is not a result yet.
    expect(
      (await get(a.auth, '/summaries/stock-opname').expect(200)).body,
    ).toEqual({ opname: null });
    await post(a.auth, `/stock-opnames/${so.body.id}/approve`, {}).expect(200);
    const r = (await get(a.auth, '/summaries/stock-opname').expect(200)).body;
    expect(r).toMatchObject({ shortQty: -2, overQty: 4, shortValue: -3000 });
    expect(r.lines).toEqual([
      { name: 'Gula', diff: 4 },
      { name: 'Kopi', diff: -2 },
    ]);
    const c = await createCashier(app, a, ['purchasing.manage']);
    const plain = (await get(c.auth, '/summaries/stock-opname').expect(200))
      .body;
    expect(plain.shortQty).toBe(-2);
    expect(plain.shortValue).toBeNull();
  });

  it('Kelengkapan toko: steps done as the store is set up, tax counts once a tax above 0 is saved', async () => {
    const steps = async (s: Store) =>
      (await get(s.auth, '/summaries/setup').expect(200)).body as {
        doneCount: number;
        complete: boolean;
        steps: any[];
      };
    // A store of its own: this one sells, and store B must stay empty for the cross-tenant checks.
    const c = await createStore();
    const empty = await steps(c);
    expect(empty).toMatchObject({ doneCount: 0, complete: false });
    // v2 (UMK-2131): owner PIN, first stock-in, first sale and an optional cashier, each with why it matters.
    expect(empty.steps.map((x: { key: string }) => x.key)).toEqual([
      'profile',
      'owner_pin',
      'products',
      'methods',
      'tax',
      'stock_in',
      'first_sale',
      'cashier',
    ]);
    // Each step links to the screen that does it (not a redirect).
    expect(empty.steps.map((x: { to: string }) => x.to)).toEqual([
      '/pengaturan',
      '/pengaturan/keamanan',
      '/catalog/products',
      '/metode-pembayaran',
      '/pengaturan',
      '/pembelian',
      '/kasir',
      '/staf',
    ]);
    for (const x of empty.steps) expect(x.why).toMatch(/\S.*\.$/);
    expect(
      empty.steps
        .filter((x: { optional: boolean }) => x.optional)
        .map((x: { key: string }) => x.key),
    ).toEqual(['cashier']);
    await http()
      .put('/store/profile')
      .set('Authorization', c.auth)
      .send({
        name: 'Toko B',
        businessType: 'retail',
        address: 'Jl. B 1',
      })
      .expect(200);
    const cat = await post(c.auth, '/catalog/categories', { name: 'X' }).expect(
      201,
    );
    const product = (
      await post(c.auth, '/catalog/products', {
        categoryId: cat.body.id,
        name: 'P',
        sellingPrice: 1000,
      }).expect(201)
    ).body.id as string;
    // The store's Tunai method is seeded the first time the menu or a sale needs it: that is the step.
    await get(c.auth, '/payment-methods').expect(200);
    const three = await steps(c);
    expect(three.steps.filter((x: { done: boolean }) => x.done)).toHaveLength(
      3,
    );
    // Selling or opening the menus does not count as choosing the tax.
    expect(three.steps.find((x: { key: string }) => x.key === 'tax').done).toBe(
      false,
    );
    const setTax = (taxBps: number) =>
      http()
        .put('/sales/settings')
        .set('Authorization', c.auth)
        .send({ taxBps })
        .expect(200);
    const taxSetAt = async () =>
      (
        await admin<{ at: Date | null }[]>`
          select tax_set_at as at from pos.sales_settings where tenant_id = ${c.tenantId}`
      )[0]?.at ?? null;
    // Nothing saved yet: the step is open. Saving 0% ("tidak memungut pajak") is a choice and completes it.
    expect(await taxSetAt()).toBeNull();
    expect(await steps(c)).toMatchObject({ doneCount: 3, complete: false });
    await setTax(0);
    const first = await taxSetAt();
    expect(first).not.toBeNull();
    expect(await steps(c)).toMatchObject({ doneCount: 4, complete: false });
    // Saved again (another tax, or back to 0): the first time stays.
    await setTax(500);
    await setTax(0);
    expect(await taxSetAt()).toEqual(first);
    const done = async () =>
      (await steps(c)).steps
        .filter((x: { done: boolean }) => x.done)
        .map((x: { key: string }) => x.key);
    // The owner's PIN (made on a fresh sign-in), the first stock-in and the first sale.
    await http()
      .put('/void-pin')
      .set('Authorization', c.freshAuth)
      .send({ pin: '135790' })
      .expect(200);
    expect(await done()).toContain('owner_pin');
    await post(c.auth, '/stock/opening', { productId: product, qty: 5 }).expect(
      201,
    );
    expect(await done()).toContain('stock_in');
    await post(c.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    expect(await steps(c)).toMatchObject({ doneCount: 6, complete: false });
    await post(c.auth, '/sales', {
      lines: [{ productId: product, qty: 1 }],
      paid: 1000,
    }).expect(201);
    // Every required step done: the board is complete although no cashier was invited (optional).
    expect(await steps(c)).toMatchObject({ doneCount: 7, complete: true });
    expect(await done()).not.toContain('cashier');
    await createCashier(app, c, ['sales.create']);
    expect(await steps(c)).toMatchObject({ doneCount: 8, complete: true });
    // Cross-tenant: store B's PIN does not tick store A's board.
    expect(
      (await steps(a)).steps.find((x: { key: string }) => x.key === 'owner_pin')
        .done,
    ).toBe(false);
  });

  it("days are the store's own around midnight (Asia/Jayapura), a void takes off its total and count, inactive products are not counted", async () => {
    const c = await createStore();
    const tz = 'Asia/Jayapura'; // UTC+9: local midnight is 15:00 UTC of the day before
    const jayapura = (offsetDays = 0) =>
      new Date(Date.now() + 9 * 3_600_000 + offsetDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
    await http()
      .put('/reports/settings')
      .set('Authorization', c.auth)
      .send({ timezone: tz })
      .expect(200);
    const cat = await post(c.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    const product = async (name: string) =>
      (
        await post(c.auth, '/catalog/products', {
          categoryId: cat.body.id,
          name,
          costPrice: 500,
          sellingPrice: 1000,
        }).expect(201)
      ).body.id as string;
    const air = await product('Air');
    const lawas = await product('Lawas');
    await admin`update pos.products set is_active = false where id = ${lawas}`;
    await post(c.auth, '/stock/opening', { productId: air, qty: 100 }).expect(
      201,
    );
    await post(c.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    await http()
      .put('/void-pin')
      .set('Authorization', c.freshAuth)
      .send({ pin: '246810' })
      .expect(200);
    const sell = async (qty: number) =>
      (
        await post(c.auth, '/sales', {
          lines: [{ productId: air, qty }],
          paid: qty * 1000,
        }).expect(201)
      ).body.id as string;
    const atMidnight = await sell(1);
    const justBefore = await sell(2);
    const voided = await sell(4);
    // Today's local midnight, and one second before it (yesterday's last second).
    await admin`update pos.sales
      set paid_at = date_trunc('day', now() at time zone ${tz}) at time zone ${tz}
      where id = ${atMidnight}`;
    await admin`update pos.sales
      set paid_at = (date_trunc('day', now() at time zone ${tz}) at time zone ${tz}) - interval '1 second'
      where id = ${justBefore}`;
    await post(c.auth, `/sales/${voided}/void`, {
      reasonCode: 'wrong_item_or_qty',
      approverId: c.userId,
      pin: '246810',
    }).expect(201);
    const r = (await get(c.auth, '/summaries/sales-history').expect(200)).body;
    expect(r.timezone).toBe(tz);
    // Today: 1.000 (midnight) + 4.000 (voided) − 4.000 (its void); 2 receipts − 1 void.
    expect(r.days[6]).toEqual({ date: jayapura(), total: 1000, count: 1 });
    expect(r.today).toEqual({ count: 1, total: 1000 });
    expect(r.days[5]).toEqual({ date: jayapura(-1), total: 2000, count: 1 });
    expect(r.methods).toEqual([{ name: 'Tunai', amount: 1000 }]);
    const cats = (await get(c.auth, '/summaries/categories').expect(200)).body;
    expect(cats.categories).toEqual([
      expect.objectContaining({ name: 'Minuman', products: 1 }),
    ]);
  });

  describe('daily target', () => {
    const put = (auth: string, body: object) =>
      http()
        .put('/summaries/daily-target')
        .set('Authorization', auth)
        .send(body);

    it("is optional, set and cleared by the owner, percent from today's net total", async () => {
      expect(
        (await get(a.auth, '/summaries/daily-target').expect(200)).body,
      ).toEqual({
        set: false,
        target: null,
        today: 15_500,
        percent: null,
      });
      expect((await put(a.auth, { target: 31_000 }).expect(200)).body).toEqual({
        set: true,
        target: 31_000,
        today: 15_500,
        percent: 50,
      });
      expect(
        (await put(a.auth, { target: 10_000 }).expect(200)).body.percent,
      ).toBe(155);
      expect(
        (await put(a.auth, { target: null }).expect(200)).body,
      ).toMatchObject({ set: false, target: null, percent: null });
    });

    it("progress is on the dashboard's basis: net sales WITHOUT tax, voids taken off (UMK-2117)", async () => {
      const t = await createStore();
      const cat = await post(t.auth, '/catalog/categories', {
        name: 'Umum',
      }).expect(201);
      const teh = (
        await post(t.auth, '/catalog/products', {
          categoryId: cat.body.id,
          name: 'Es Teh',
          costPrice: 5000,
          sellingPrice: 10_000,
        }).expect(201)
      ).body.id as string;
      await post(t.auth, '/stock/opening', { productId: teh, qty: 100 }).expect(
        201,
      );
      await post(t.auth, '/shifts/open', { openingCash: 0 }).expect(201);
      await http()
        .put('/void-pin')
        .set('Authorization', t.freshAuth)
        .send({ pin: '246810' })
        .expect(200);
      await http()
        .put('/sales/settings')
        .set('Authorization', t.auth)
        .send({ taxBps: 1000 })
        .expect(200);
      const sell = async (qty: number) =>
        (
          await post(t.auth, '/sales', {
            lines: [{ productId: teh, qty }],
            paid: 1_000_000,
          }).expect(201)
        ).body as { id: string; total: number };
      const widget = async () =>
        (
          await get(t.auth, '/reports/widgets/overview?period=today').expect(
            200,
          )
        ).body.current.sales as number;
      const target = async (t0: number) =>
        (
          await http()
            .put('/summaries/daily-target')
            .set('Authorization', t.auth)
            .send({ target: t0 })
            .expect(200)
        ).body as { today: number; percent: number };

      // 5 x 10.000 = 50.000 + 10% tax = 55.000 paid: the target sees 50.000, not 55.000.
      const first = await sell(5);
      expect(first.total).toBe(55_000);
      let r = await target(100_000);
      expect(r).toMatchObject({ today: 50_000, percent: 50 });
      expect(r.today).toBe(await widget());

      // A second taxed sale (2 x 10.000 + 2.000 tax) and the first one's void (taken off WITH its tax out).
      await sell(2);
      expect((await target(100_000)).today).toBe(70_000);
      await post(t.auth, `/sales/${first.id}/void`, {
        reasonCode: 'wrong_item_or_qty',
        approverId: t.userId,
        pin: '246810',
      }).expect(201);
      r = await target(100_000);
      expect(r).toMatchObject({ today: 20_000, percent: 20 });
      expect(r.today).toBe(await widget());
    });

    it('a cashier without reports.view gets the percent only: never the store total nor the target in rupiah', async () => {
      // No target: nothing at all, not even today's total.
      expect(
        (await get(sari.auth, '/summaries/daily-target').expect(200)).body,
      ).toEqual({ set: false, target: null, today: null, percent: null });
      await put(a.auth, { target: 31_000 }).expect(200);
      expect(
        (await get(sari.auth, '/summaries/daily-target').expect(200)).body,
      ).toEqual({ set: true, target: null, today: null, percent: 50 });
      // reports.view sees the figures.
      const viewer = await createCashier(app, a, ['reports.view']);
      expect(
        (await get(viewer.auth, '/summaries/daily-target').expect(200)).body,
      ).toEqual({ set: true, target: 31_000, today: 15_500, percent: 50 });
      await put(a.auth, { target: null }).expect(200);
    });

    it('is set by the owner only: an admin with every Admin permission gets 403 and changes nothing', async () => {
      const adminStaff = await createCashier(app, a, [...ADMIN_PERMISSIONS]);
      await put(adminStaff.auth, { target: 20_000 }).expect(403);
      // Refused before the body is read: a bad body is 403 too, not 422.
      await put(adminStaff.auth, { target: 'x' }).expect(403);
      expect(
        (await get(adminStaff.auth, '/summaries/daily-target').expect(200)).body
          .target,
      ).toBeNull();
      await put(a.auth, { target: 20_000 }).expect(200);
      expect(
        (await get(adminStaff.auth, '/summaries/daily-target').expect(200)).body
          .target,
      ).toBe(20_000);
      await put(a.auth, { target: null }).expect(200);
    });

    it('refuses bad targets with 422 and leaves the stored one', async () => {
      await put(a.auth, { target: 31_000 }).expect(200);
      for (const target of [0, -5, 12.5, '2000', 1_000_000_001])
        await put(a.auth, { target }).expect(422);
      await put(a.auth, {}).expect(422);
      await put(a.auth, { target: 5000, tenantId: b.tenantId }).expect(422);
      expect(
        (await get(a.auth, '/summaries/daily-target').expect(200)).body.target,
      ).toBe(31_000);
    });

    it("is the store's own: store B has no target and sees none of A's sales", async () => {
      const r = (await get(b.auth, '/summaries/daily-target').expect(200)).body;
      expect(r).toEqual({ set: false, target: null, today: 0, percent: null });
    });

    it('a cashier reads it for the receipt but cannot set it; a role with neither cannot read', async () => {
      expect(
        (await get(sari.auth, '/summaries/daily-target').expect(200)).body,
      ).toMatchObject({ set: true, percent: 50 });
      await put(sari.auth, { target: 5000 }).expect(403);
      const none = await createCashier(app, a, ['expenses.manage']);
      await get(none.auth, '/summaries/daily-target').expect(403);
    });
  });

  it('401 without a session', async () => {
    await http().get('/summaries/sales-history').expect(401);
    await http().get('/summaries/daily-target').expect(401);
    await http()
      .put('/summaries/daily-target')
      .send({ target: 5000 })
      .expect(401);
  });

  it('each menu summary opens with its own permission alone, and is 403 with every permission but that one', async () => {
    const routes: Array<[string, Permission]> = [
      ['sales-history', 'reports.view'],
      ['members', 'members.manage'],
      ['products', 'catalog.manage'],
      ['categories', 'catalog.manage'],
      ['payment-methods', 'catalog.manage'],
      ['stock-opname', 'purchasing.manage'],
      ['suppliers', 'purchasing.manage'],
      ['vouchers', 'vouchers.manage'],
      ['staff', 'staff.manage'],
      ['setup', 'catalog.manage'],
    ];
    const only = new Map<Permission, string>();
    const allBut = new Map<Permission, string>();
    for (const [, perm] of routes) {
      if (only.has(perm)) continue;
      only.set(perm, (await createCashier(app, a, [perm])).auth);
      allBut.set(
        perm,
        (
          await createCashier(
            app,
            a,
            PERMISSIONS.filter((p) => p !== perm),
          )
        ).auth,
      );
    }
    for (const [path, perm] of routes) {
      await get(only.get(perm)!, `/summaries/${path}`).expect(200);
      await get(allBut.get(perm)!, `/summaries/${path}`).expect(403);
    }
  });

  it('cost and profit figures are null without reports.view', async () => {
    const c = await createCashier(app, a, ['catalog.manage', 'members.manage']);
    const products = (await get(c.auth, '/summaries/products').expect(200))
      .body;
    expect(products.stock).toEqual({ ok: 1, low: 1, out: 1 });
    expect(products.margins).toBeNull();
    expect(products.noCost).toBeNull();
    const cats = (await get(c.auth, '/summaries/categories').expect(200)).body;
    expect(cats.categories[0].revenue).toBeNull();
    expect(cats.categories[0].stockValue).toBeNull();
    // Kasbon owed is a receivable figure: neither reports.view nor receivables.manage, no figure.
    const members = (await get(c.auth, '/summaries/members').expect(200)).body;
    expect(members.kasbonRest).toBeNull();
    // Spend per customer is takings: the top customers come with their receipt count only.
    expect(members.top).toHaveLength(3);
    for (const m of arr(members.top)) {
      expect(m.receipts).toBe(1);
      expect(m.amount).toBeNull();
    }
  });

  it('revenue per method and per cashier is null without reports.view; the counts stay', async () => {
    const c = await createCashier(app, a, ['catalog.manage', 'staff.manage']);
    const methods = (
      await get(c.auth, '/summaries/payment-methods').expect(200)
    ).body;
    expect(methods.methods.length).toBeGreaterThan(0);
    const uses = nums(
      arr(methods.methods).map((m): number => Number(m.uses)),
    ).reduce((x, y) => x + y, 0);
    expect(uses).toBe(5 + (yesterdayInMonth ? 1 : 0));
    for (const m of arr(methods.methods)) expect(m.amount).toBeNull();
    const staff = (await get(c.auth, '/summaries/staff').expect(200)).body;
    expect(arr(staff.cashiers).find((x) => x.name === 'Sari')).toEqual({
      name: 'Sari',
      receipts: 1,
      amount: null,
    });
    for (const x of arr(staff.cashiers)) expect(x.amount).toBeNull();
  });

  it('store B sees nothing of store A on any summary', async () => {
    const all = [
      'sales-history',
      'members',
      'products',
      'categories',
      'payment-methods',
      'stock-opname',
      'suppliers',
      'vouchers',
      'staff',
    ];
    for (const path of all) {
      const text = JSON.stringify(
        (await get(b.auth, `/summaries/${path}`).expect(200)).body,
      );
      for (const secret of [
        'Siti',
        'Budi',
        'Lama',
        'Gula',
        'Sari',
        'HEMAT',
        'Sembako',
        'Kopi',
      ])
        expect(text).not.toContain(secret);
    }
    const hist = (await get(b.auth, '/summaries/sales-history').expect(200))
      .body;
    expect(hist.today).toEqual({ count: 0, total: 0 });
    expect(hist.methods).toEqual([]);
    const methods = (
      await get(b.auth, '/summaries/payment-methods').expect(200)
    ).body;
    expect(methods.methods).toEqual([]);
    const staff = (await get(b.auth, '/summaries/staff').expect(200)).body;
    expect(staff.cashiers).toEqual([]);
    expect(nums(staff.hours).every((h) => h === 0)).toBe(true);
    const sup = (await get(b.auth, '/summaries/suppliers').expect(200)).body;
    expect(sup.supplierCount).toBe(0);
    expect(arr(sup.months).every((m) => m.total === 0)).toBe(true);
    const vouchers = (await get(b.auth, '/summaries/vouchers').expect(200))
      .body;
    expect(vouchers.vouchers).toEqual([]);
    expect(arr(vouchers.days).every((d) => d.count === 0)).toBe(true);
    expect(
      (await get(b.auth, '/summaries/stock-opname').expect(200)).body,
    ).toEqual({ opname: null });
  });
});
