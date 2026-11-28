import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

/** UMK-2130: "Produk cepat" from the till, the catalog's "Modal belum diisi" flag and the P&L warning. */
describe('quick product and cost missing (UMK-2130)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const post = (auth: string, path: string, body: object) =>
    http()
      .post(path)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const get = (auth: string, path: string) =>
    http().get(path).set('Authorization', auth);

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  let a: Store;
  let b: Store;
  beforeAll(async () => {
    a = await createStore();
    b = await createStore();
  });

  it('creates a non-stock product in "Lainnya" from name and price, sells it at once, cost optional', async () => {
    const first = await post(a.auth, '/catalog/products/quick', {
      name: 'Nasi uduk',
      sellingPrice: 15000,
    }).expect(201);
    expect(first.body).toMatchObject({
      name: 'Nasi uduk',
      sellingPrice: 15000,
      costPrice: 0,
      type: 'non_stock',
      category: { name: 'Lainnya' },
    });
    expect(first.body.sku).toMatch(/^\S+$/);
    // The second goes into the same "Lainnya", with its cost and the barcode the till scanned.
    const second = await post(a.auth, '/catalog/products/quick', {
      name: 'Kerupuk',
      sellingPrice: 2000,
      costPrice: 1200,
      barcode: '8991234567890',
    }).expect(201);
    expect(second.body.categoryId).toBe(first.body.categoryId);
    expect(second.body.barcodes).toEqual(['8991234567890']);
    const cats = (await get(a.auth, '/catalog/categories').expect(200)).body
      .data as Array<{ name: string }>;
    expect(cats.filter((c) => c.name === 'Lainnya')).toHaveLength(1);
    // Sold right away: non_stock needs no stock-in.
    await post(a.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    await post(a.auth, '/sales', {
      lines: [{ productId: first.body.id, qty: 2 }],
      paid: 30000,
    }).expect(201);
  });

  it('refuses bad input with 422 and only for actors who may manage the catalog', async () => {
    for (const body of [
      {},
      { name: 'X' },
      { name: 'X', sellingPrice: 0 },
      { name: 'X', sellingPrice: 1.5 },
      { name: 'X', sellingPrice: 1000, costPrice: 2000 },
      { name: 'X', sellingPrice: 1000, categoryId: randomUUID() },
      { name: 'X', sellingPrice: 1000, barcode: 'a b' },
    ])
      await post(a.auth, '/catalog/products/quick', body).expect(422);
    const cashier = await createCashier(app, a, ['sales.create']);
    await post(cashier.auth, '/catalog/products/quick', {
      name: 'X',
      sellingPrice: 1000,
    }).expect(403);
    const admin = await createCashier(app, a, [
      'sales.create',
      'catalog.manage',
    ]);
    await post(admin.auth, '/catalog/products/quick', {
      name: 'Es teh',
      sellingPrice: 3000,
    }).expect(201);
  });

  it('flags products without cost: filter and count follow the search; hidden without cost visibility', async () => {
    const list = (auth: string, q = '') =>
      get(auth, `/catalog/products${q}`).expect(200);
    const all = (await list(a.auth)).body;
    expect(all.costMissingCount).toBe(2); // Nasi uduk, Es teh
    const missing = (await list(a.auth, '?cost=missing')).body;
    const names = (missing.data as Array<{ name: string }>).map((p) => p.name);
    expect(names.sort()).toEqual(['Es teh', 'Nasi uduk']);
    expect((await list(a.auth, '?q=nasi')).body.costMissingCount).toBe(1);
    await get(a.auth, '/catalog/products?cost=x').expect(422);
    const cashier = await createCashier(app, a, ['sales.create']);
    const seen = (await list(cashier.auth)).body;
    expect(seen.costMissingCount).toBeUndefined();
    expect(seen.data[0].costPrice).toBeUndefined();
    // Without cost visibility the filter is ignored: the cashier gets every product, not the costless ones.
    const filtered = (await list(cashier.auth, '?cost=missing')).body;
    expect(filtered.total).toBe(seen.total);
    expect(filtered.total).toBeGreaterThan(2);
    // Cross-tenant: store B lists nothing of A's.
    const other = (await list(b.auth, '?cost=missing')).body;
    expect(other).toMatchObject({ total: 0, costMissingCount: 0 });
  });

  it('profit and loss counts the products sold this period without a cost', async () => {
    const pl = async (s: Store) =>
      (await get(s.auth, '/reports/profit-loss?period=today').expect(200))
        .body as { costMissing: unknown };
    // Nasi uduk was sold with cost 0; Kerupuk (cost 1.200) is sold now and does not count.
    const kerupuk = (
      await get(a.auth, '/catalog/products?q=kerupuk').expect(200)
    ).body.data[0].id as string;
    await post(a.auth, '/sales', {
      lines: [{ productId: kerupuk, qty: 1 }],
      paid: 2000,
    }).expect(201);
    expect((await pl(a)).costMissing).toEqual({ products: 1 });
    expect((await pl(b)).costMissing).toEqual({ products: 0 });
  });
});
