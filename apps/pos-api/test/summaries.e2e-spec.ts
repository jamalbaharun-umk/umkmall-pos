import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_PERMISSIONS } from '../src/staff/permissions';
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
      { name: 'Budi', amount: 3500 },
      { name: 'Siti', amount: 3000 },
      { name: 'Lama', amount: 2000 },
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

  it('Kelengkapan toko: steps done as the store is set up, tax counts once chosen even at 0', async () => {
    const steps = async (s: Store) =>
      (await get(s.auth, '/summaries/setup').expect(200)).body as {
        doneCount: number;
        complete: boolean;
        steps: any[];
      };
    const empty = await steps(b);
    expect(empty).toMatchObject({ doneCount: 0, complete: false });
    expect(empty.steps.map((x: { key: string }) => x.key)).toEqual([
      'profile',
      'products',
      'methods',
      'tax',
    ]);
    await http()
      .put('/store/profile')
      .set('Authorization', b.auth)
      .send({
        name: 'Toko B',
        businessType: 'retail',
        address: 'Jl. B 1',
      })
      .expect(200);
    const cat = await post(b.auth, '/catalog/categories', { name: 'X' }).expect(
      201,
    );
    await post(b.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'P',
      sellingPrice: 1000,
    }).expect(201);
    // The store's Tunai method is seeded the first time the menu or a sale needs it: that is the step.
    await get(b.auth, '/payment-methods').expect(200);
    const three = await steps(b);
    expect(three.steps.filter((x: { done: boolean }) => x.done)).toHaveLength(
      3,
    );
    // Selling or opening the menus does not count as choosing the tax.
    expect(three.steps.find((x: { key: string }) => x.key === 'tax').done).toBe(
      false,
    );
    await http()
      .put('/sales/settings')
      .set('Authorization', b.auth)
      .send({ taxBps: 0 })
      .expect(200);
    expect(await steps(b)).toMatchObject({ doneCount: 4, complete: true });
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

  it('every menu summary is 403 without the permission that opens the menu', async () => {
    const routes: Array<[string, string]> = [
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
    for (const [path] of routes) {
      await get(sari.auth, `/summaries/${path}`).expect(403);
      await get(a.auth, `/summaries/${path}`).expect(200);
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
    expect(
      (await get(c.auth, '/summaries/members').expect(200)).body.kasbonRest,
    ).toBeNull();
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
    expect(
      (await get(b.auth, '/summaries/stock-opname').expect(200)).body,
    ).toEqual({ opname: null });
  });
});
