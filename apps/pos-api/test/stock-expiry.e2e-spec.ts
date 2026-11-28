import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
type Row = { name: string; qty: number; expiresAt: string; expired: boolean };

// UMK-2087: an optional expiry date per stock batch, set where stock comes in, and the dashboard's
// "Segera kedaluwarsa" widget. Dates are store calendar days (Asia/Jakarta by default).
describe('stock expiry dates (UMK-2087)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const http = () => request(app.getHttpServer());

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

  /** The store's today, as the server computes it (`YYYY-MM-DD`), plus `plus` days. */
  async function day(plus = 0) {
    const [r] = await admin`
      select to_char((now() at time zone 'Asia/Jakarta')::date + ${plus}::int, 'YYYY-MM-DD') as d`;
    return r.d as string;
  }

  async function product(s: Store, name: string) {
    const cat = await post(s.auth, '/catalog/categories', {
      name: `Kat ${name}`,
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name,
      costPrice: 1000,
      sellingPrice: 2000,
    }).expect(201);
    return p.body.id as string;
  }

  function opening(
    s: Store,
    productId: string,
    qty: number,
    expiresAt?: string,
  ) {
    return post(s.auth, '/stock/opening', {
      productId,
      qty,
      ...(expiresAt && { expiresAt }),
    });
  }

  const stockIn = (s: Store, supplierId: string, lines: object[]) =>
    post(s.auth, '/purchasing/orders/stock-in', { supplierId, lines });

  async function supplier(s: Store) {
    const r = await post(s.auth, '/suppliers', {
      name: 'CV Sumber Rejeki',
    }).expect(201);
    return r.body.id as string;
  }

  const expiring = async (s: Store, query = '') =>
    (await get(s.auth, `/reports/widgets/expiring${query}`).expect(200))
      .body as {
      days: number;
      total: number;
      expired: number;
      rows: Row[];
    };

  describe('receiving', () => {
    it('opening stock keeps an optional expiry date and shows it on the batch', async () => {
      const s = await createStore();
      const withDate = await product(s, 'Susu');
      const without = await product(s, 'Garam');
      const created = await opening(s, withDate, 5, await day(10))
        .expect(201)
        .then((r) => r.body as { expiresAt: string });
      expect(created.expiresAt).toBe(await day(10));
      await opening(s, without, 5).expect(201);
      const a = await get(s.auth, `/stock/products/${withDate}`).expect(200);
      expect(a.body.batches[0].expiresAt).toBe(await day(10));
      const b = await get(s.auth, `/stock/products/${without}`).expect(200);
      expect(b.body.batches[0].expiresAt).toBeNull();
      expect(b.body.onHand).toBe(5);
    });

    it('refuses a date before today and a malformed one with 422, and today is fine', async () => {
      const s = await createStore();
      const p = await product(s, 'Roti');
      const past = await opening(s, p, 5, await day(-1)).expect(422);
      expect(JSON.stringify(past.body)).toContain('expiresAt');
      await opening(s, p, 5, '2026-02-31').expect(422);
      await opening(s, p, 5, '31-12-2026').expect(422);
      // Nothing was received by the refused calls.
      expect(
        (await get(s.auth, `/stock/products/${p}`).expect(200)).body.onHand,
      ).toBe(0);
      await opening(s, p, 5, await day(0)).expect(201);
    });

    it('a purchase stock-in carries each line date onto its batch; a date before today is 422', async () => {
      const s = await createStore();
      const sup = await supplier(s);
      const a = await product(s, 'Yogurt');
      const b = await product(s, 'Mie');
      const order = await stockIn(s, sup, [
        { productId: a, qty: 4, unitCost: 1500, expiresAt: await day(7) },
        { productId: b, qty: 6, unitCost: 900 },
      ])
        .expect(201)
        .then(
          (r) =>
            r.body as {
              lines: { productId: string; expiresAt: string | null }[];
            },
        );
      const line = (id: string) => order.lines.find((l) => l.productId === id)!;
      expect(line(a).expiresAt).toBe(await day(7));
      expect(line(b).expiresAt).toBeNull();
      expect(
        (await get(s.auth, `/stock/products/${a}`).expect(200)).body.batches[0]
          .expiresAt,
      ).toBe(await day(7));
      expect(
        (await get(s.auth, `/stock/products/${b}`).expect(200)).body.batches[0]
          .expiresAt,
      ).toBeNull();
      const bad = await stockIn(s, sup, [
        { productId: a, qty: 1, unitCost: 1500, expiresAt: await day(-1) },
      ]).expect(422);
      expect(JSON.stringify(bad.body)).toContain('lines.0.expiresAt');
      // A draft keeps the date until approval, and approval copies it.
      const draft = await post(s.auth, '/purchasing/orders', {
        supplierId: sup,
        lines: [
          { productId: b, qty: 2, unitCost: 900, expiresAt: await day(3) },
        ],
      }).expect(201);
      await post(s.auth, `/purchasing/orders/${draft.body.id}/approve`, {});
      const batches = (await get(s.auth, `/stock/products/${b}`).expect(200))
        .body.batches as { expiresAt: string | null; qtyRemaining: number }[];
      expect(batches.map((x) => [x.qtyRemaining, x.expiresAt])).toEqual([
        [6, null],
        [2, await day(3)],
      ]);
    });
  });

  describe('approving a saved draft', () => {
    const patch = (auth: string, path: string, body: object) =>
      http().patch(path).set('Authorization', auth).send(body);

    it('refuses a past date when a draft is created or edited, but approves one whose date elapsed since', async () => {
      const s = await createStore();
      const sup = await supplier(s);
      const a = await product(s, 'Roti');
      const line = (expiresAt: string) => ({
        productId: a,
        qty: 3,
        unitCost: 1200,
        expiresAt,
      });
      // Create and edit keep the "not before today" check.
      const bad = await post(s.auth, '/purchasing/orders', {
        supplierId: sup,
        lines: [line(await day(-1))],
      }).expect(422);
      expect(JSON.stringify(bad.body)).toContain('lines.0.expiresAt');
      const draft = await post(s.auth, '/purchasing/orders', {
        supplierId: sup,
        lines: [line(await day(2))],
      }).expect(201);
      const edit = await patch(s.auth, `/purchasing/orders/${draft.body.id}`, {
        lines: [line(await day(-1))],
      }).expect(422);
      expect(JSON.stringify(edit.body)).toContain('lines.0.expiresAt');

      // The date elapses between saving the draft and approving it (aged directly: the API cannot write it).
      await admin`update pos.purchase_order_lines set expires_at = ${await day(-1)}::date where tenant_id = ${s.tenantId} and order_id = ${draft.body.id}`;
      await post(
        s.auth,
        `/purchasing/orders/${draft.body.id}/approve`,
        {},
      ).expect(200);
      const batches = (await get(s.auth, `/stock/products/${a}`).expect(200))
        .body.batches as { expiresAt: string | null; qtyRemaining: number }[];
      expect(batches.map((x) => [x.qtyRemaining, x.expiresAt])).toEqual([
        [3, await day(-1)],
      ]);
      expect(await expiring(s)).toMatchObject({ expired: 1 });
    });
  });

  describe('GET /reports/widgets/expiring', () => {
    it('lists products by earliest date, flags past dates, leaves out empty and undated batches', async () => {
      const s = await createStore();
      const sup = await supplier(s);
      const late = await product(s, 'Keju');
      const soon = await product(s, 'Susu');
      const gone = await product(s, 'Abu');
      const far = await product(s, 'Beras');
      const none = await product(s, 'Garam');
      const old = await product(s, 'Basi');
      await stockIn(s, sup, [
        { productId: late, qty: 3, unitCost: 100, expiresAt: await day(20) },
        { productId: soon, qty: 4, unitCost: 100, expiresAt: await day(2) },
        { productId: gone, qty: 4, unitCost: 100, expiresAt: await day(1) },
        { productId: far, qty: 4, unitCost: 100, expiresAt: await day(31) },
        { productId: none, qty: 4, unitCost: 100 },
        { productId: old, qty: 9, unitCost: 100, expiresAt: await day(1) },
      ]).expect(201);
      // A second batch of the soon product adds to its quantity; a batch with nothing left is skipped.
      await post(s.auth, '/purchasing/orders/stock-in', {
        supplierId: sup,
        lines: [
          { productId: soon, qty: 5, unitCost: 100, expiresAt: await day(9) },
        ],
      }).expect(201);
      await admin`update pos.stock_batches set qty_remaining = 0 where tenant_id = ${s.tenantId} and product_id = ${gone}`;
      // The dates cannot be set in the past through the API: age one batch directly.
      await admin`update pos.stock_batches set expires_at = ${await day(-3)}::date where tenant_id = ${s.tenantId} and product_id = ${old}`;

      const r = await expiring(s);
      expect(r).toMatchObject({ days: 30, total: 3, expired: 1 });
      expect(
        r.rows.map((x) => [x.name, x.qty, x.expiresAt, x.expired]),
      ).toEqual([
        ['Basi', 9, await day(-3), true],
        ['Susu', 9, await day(2), false],
        ['Keju', 3, await day(20), false],
      ]);

      // `days` narrows the window and `limit` the rows; totals still count every match.
      const narrow = await expiring(s, '?days=5');
      expect(narrow.rows.map((x) => x.name)).toEqual(['Basi', 'Susu']);
      const cut = await expiring(s, '?days=365&limit=1');
      expect(cut).toMatchObject({ total: 4, expired: 1 });
      expect(cut.rows.map((x) => x.name)).toEqual(['Basi']);
    });

    it('validates days and limit with 422', async () => {
      const s = await createStore();
      for (const q of [
        'days=0',
        'days=366',
        'days=abc',
        'days=1.5',
        'days=-3',
        'limit=0',
        'limit=11',
      ])
        await get(s.auth, `/reports/widgets/expiring?${q}`).expect(422);
      await get(s.auth, '/reports/widgets/expiring?days=1').expect(200);
    });

    it('needs reports.view', async () => {
      const s = await createStore();
      const plain = await createCashier(app, s, ['sales.create']);
      const viewer = await createCashier(app, s, ['reports.view']);
      await get(plain.auth, '/reports/widgets/expiring').expect(403);
      await get(viewer.auth, '/reports/widgets/expiring').expect(200);
    });

    it('cross-tenant: store B sees none of store A expiring stock', async () => {
      const a = await createStore();
      const b = await createStore();
      const p = await product(a, 'Susu');
      await opening(a, p, 5, await day(2)).expect(201);
      expect((await expiring(a)).total).toBe(1);
      expect(await expiring(b)).toMatchObject({ total: 0, rows: [] });
      // B cannot receive into A's product either: a foreign product id is 422 on productId.
      await opening(b, p, 5, await day(2)).expect(422);
      expect((await expiring(a)).rows[0].qty).toBe(5);
    });
  });
});
