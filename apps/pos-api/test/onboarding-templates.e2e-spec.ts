import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
type Unpriced = { id: string; name: string; unit: string; category: string };

/** UMK-2128: business templates on the first screen and "Isi harga" (design 44). */
describe('onboarding templates and prices (UMK-2128)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const post = (auth: string, path: string, body: object = {}) =>
    http()
      .post(path)
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const get = (auth: string, path: string) =>
    http().get(path).set('Authorization', auth);
  const unpriced = async (s: Store) =>
    (await get(s.auth, '/onboarding/unpriced').expect(200)).body as {
      data: Unpriced[];
      total: number;
    };

  let a: Store;
  let b: Store;
  beforeAll(async () => {
    app = await createApp();
    a = await createStore();
    b = await createStore();
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists the seven templates with their product counts', async () => {
    const { data } = (await get(a.auth, '/onboarding/templates').expect(200))
      .body as {
      data: Array<{ key: string; name: string; productCount: number }>;
    };
    expect(data).toHaveLength(7);
    expect(data.find((t) => t.key === 'warung_makan')).toMatchObject({
      name: 'Warung makan',
      productCount: 24,
    });
  });

  it('applies a template: categories, unpriced products off the till, Tunai and QRIS toko, tax 0%', async () => {
    const res = await post(
      a.auth,
      '/onboarding/templates/warung_makan/apply',
    ).expect(200);
    expect(res.body).toEqual({
      template: 'warung_makan',
      created: 24,
      skipped: 0,
      unpriced: 24,
    });
    const cats = (await get(a.auth, '/catalog/categories').expect(200)).body
      .data as Array<{ name: string }>;
    expect(cats.map((c) => c.name).sort()).toEqual(
      ['Lauk', 'Mi dan sup', 'Minuman', 'Nasi'].sort(),
    );
    const list = await unpriced(a);
    expect(list.total).toBe(24);
    expect(list.data.find((p) => p.name === 'Teh es')).toMatchObject({
      unit: 'GELAS',
      category: 'Minuman',
    });
    const product = (
      await get(a.auth, `/catalog/products/${list.data[0].id}`).expect(200)
    ).body;
    expect(product).toMatchObject({
      sellingPrice: 0,
      isActive: false,
      type: 'non_stock',
    });
    const methods = (await get(a.auth, '/payment-methods').expect(200)).body
      .data as Array<{ name: string; kind: string }>;
    expect(methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Tunai', kind: 'cash' }),
        expect.objectContaining({ name: 'QRIS toko', kind: 'wallet' }),
      ]),
    );
    const setup = (await get(a.auth, '/summaries/setup').expect(200)).body
      .steps as Array<{ key: string; done: boolean; to: string }>;
    expect(setup.find((s) => s.key === 'tax')?.done).toBe(true);
    // Unpriced products are not yet products the till sells: the step stays open and leads to "Isi harga".
    expect(setup.find((s) => s.key === 'products')).toMatchObject({
      done: false,
      to: '/mulai/harga',
    });
    // An unpriced product cannot be sold.
    await post(a.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    await post(a.auth, '/sales', {
      lines: [{ productId: list.data[0].id, qty: 1 }],
      paid: 1000,
    }).expect(422);
  });

  it('a second apply adds nothing twice and keeps a tax the store chose', async () => {
    await http()
      .put('/sales/settings')
      .set('Authorization', a.auth)
      .send({ taxBps: 1100 })
      .expect(200);
    const res = await post(
      a.auth,
      '/onboarding/templates/warung_makan/apply',
    ).expect(200);
    expect(res.body).toMatchObject({ created: 0, skipped: 24, unpriced: 24 });
    const settings = (await get(a.auth, '/sales/settings').expect(200)).body;
    expect(settings.taxBps).toBe(1100);
    const methods = (await get(a.auth, '/payment-methods').expect(200)).body
      .data as Array<{ name: string }>;
    expect(methods.filter((m) => m.name === 'QRIS toko')).toHaveLength(1);
  });

  it('"Isi harga" prices products, puts them on sale and reports rows it cannot save', async () => {
    const list = await unpriced(a);
    const teh = list.data.find((p) => p.name === 'Teh es')!;
    const nasi = list.data.find((p) => p.name === 'Nasi goreng')!;
    const res = await post(a.auth, '/onboarding/prices', {
      items: [
        { id: teh.id, sellingPrice: 4000 },
        { id: nasi.id, sellingPrice: 15000 },
        { id: randomUUID(), sellingPrice: 1000 },
      ],
    }).expect(200);
    expect(res.body.priced).toBe(2);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.unpriced).toBe(22);
    const product = (
      await get(a.auth, `/catalog/products/${teh.id}`).expect(200)
    ).body;
    expect(product).toMatchObject({ sellingPrice: 4000, isActive: true });
    const steps = (await get(a.auth, '/summaries/setup').expect(200)).body
      .steps as Array<{ key: string; done: boolean; to: string }>;
    expect(steps.find((s) => s.key === 'products')).toMatchObject({
      done: true,
      to: '/catalog/products',
    });
    await post(a.auth, '/sales', {
      lines: [{ productId: teh.id, qty: 1 }],
      paid: 10000,
    }).expect(201);
    // A priced product is no longer waiting: a second price through this route is refused per row.
    const again = await post(a.auth, '/onboarding/prices', {
      items: [{ id: teh.id, sellingPrice: 1 }],
    }).expect(200);
    expect(again.body).toMatchObject({ priced: 0 });
  });

  it('refuses bad input with 422 and an unknown template with 404', async () => {
    for (const body of [
      {},
      { items: [] },
      { items: [{ id: 'x', sellingPrice: 1000 }] },
      { items: [{ id: randomUUID(), sellingPrice: 0 }] },
      { items: [{ id: randomUUID(), sellingPrice: 1.5 }] },
      { items: [{ id: randomUUID(), sellingPrice: 1000, isActive: false }] },
    ])
      await post(a.auth, '/onboarding/prices', body).expect(422);
    const id = randomUUID();
    await post(a.auth, '/onboarding/prices', {
      items: [
        { id, sellingPrice: 1000 },
        { id, sellingPrice: 2000 },
      ],
    }).expect(422);
    await post(a.auth, '/onboarding/templates/nope/apply').expect(404);
    await post(a.auth, '/onboarding/templates/NOPE%20X/apply').expect(404);
  });

  it('needs catalog.manage', async () => {
    const cashier = await createCashier(app, a, ['sales.create']);
    await get(cashier.auth, '/onboarding/templates').expect(403);
    await post(cashier.auth, '/onboarding/templates/kue_roti/apply').expect(
      403,
    );
    await get(cashier.auth, '/onboarding/unpriced').expect(403);
    await post(cashier.auth, '/onboarding/prices', {
      items: [{ id: randomUUID(), sellingPrice: 1000 }],
    }).expect(403);
  });

  it("cross-tenant: store B sees none of A's unpriced products and cannot price them", async () => {
    const mine = await unpriced(a);
    expect((await unpriced(b)).total).toBe(0);
    const res = await post(b.auth, '/onboarding/prices', {
      items: [{ id: mine.data[0].id, sellingPrice: 5000 }],
    }).expect(200);
    expect(res.body).toMatchObject({ priced: 0, unpriced: 0 });
    const product = (
      await get(a.auth, `/catalog/products/${mine.data[0].id}`).expect(200)
    ).body;
    expect(product).toMatchObject({ sellingPrice: 0, isActive: false });
    // B's own apply makes B's rows only.
    await post(b.auth, '/onboarding/templates/kue_roti/apply').expect(200);
    expect((await unpriced(b)).total).toBe(20);
    expect((await unpriced(a)).total).toBe(mine.total);
  });
});
