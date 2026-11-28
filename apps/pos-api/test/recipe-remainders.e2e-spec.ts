import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

// UMK-2126: the cost-rise read (GET /recipes/cost-alerts) and the suggested price on GET /recipes/:id.
describe('recipe remainders (UMK-2126)', () => {
  let app: INestApplication;
  let a: Store;
  let b: Store;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    a = await createStore();
    b = await createStore();
  });
  afterAll(async () => {
    await app.close();
  });

  const categories = new Map<string, string>();
  async function category(store: Store) {
    const known = categories.get(store.tenantId);
    if (known) return known;
    const res = await http()
      .post('/catalog/categories')
      .set('Authorization', store.auth)
      .send({ name: 'Dapur' })
      .expect(201);
    categories.set(store.tenantId, res.body.id);
    return res.body.id as string;
  }
  async function product(
    store: Store,
    name: string,
    extra: Record<string, unknown> = {},
  ) {
    const res = await http()
      .post('/catalog/products')
      .set('Authorization', store.auth)
      .send({
        categoryId: await category(store),
        name,
        sellingPrice: 8_000,
        ...extra,
      })
      .expect(201);
    return res.body.id as string;
  }
  const ingredient = (store: Store, name: string) =>
    product(store, name, { type: 'ingredient', unit: 'GRAM', sellingPrice: 1 });
  const manualCost = (store: Store, id: string, cost: number) =>
    http()
      .put(`/ingredient-costs/${id}`)
      .set('Authorization', store.auth)
      .send({ cost, perQty: 1 })
      .expect(200);
  async function buy(store: Store, productId: string, unitCost: number) {
    const sup = await http()
      .post('/suppliers')
      .set('Authorization', store.auth)
      .send({ name: 'Pasar Induk' })
      .expect(201);
    const po = await http()
      .post('/purchasing/orders')
      .set('Authorization', store.auth)
      .send({
        supplierId: sup.body.id,
        lines: [{ productId, qty: 10_000, unitCost }],
      })
      .expect(201);
    await http()
      .post(`/purchasing/orders/${po.body.id}/approve`)
      .set('Authorization', store.auth)
      .expect(200);
  }
  /** A product sold at Rp8.000 whose recipe is 1.000 of one ingredient over 10 portions: cost = unit cost × 100. */
  async function recipe(store: Store, name: string, unitCost: number) {
    const ing = await ingredient(store, `Bahan ${name}`);
    await manualCost(store, ing, unitCost);
    const p = await product(store, name);
    const res = await http()
      .post('/recipes')
      .set('Authorization', store.auth)
      .send({
        productId: p,
        yieldQty: 10,
        lines: [{ ingredientId: ing, quantity: 1_000 }],
      })
      .expect(201);
    return { id: res.body.id as string, productId: p, ingredient: ing };
  }
  const ids = (body: unknown) =>
    (body as { rows: { recipeId: string }[] }).rows.map((r) => r.recipeId);
  const apply = (store: Store, id: string) =>
    http()
      .post(`/recipes/${id}/apply-cost`)
      .set('Authorization', store.auth)
      .expect(200);
  const alerts = (store: Store, query = '', auth = store.auth) =>
    http().get(`/recipes/cost-alerts${query}`).set('Authorization', auth);

  describe('cost-rise alert', () => {
    it('lists a rise of 5% or more with integer figures, hides 4% and an unchanged cost, and follows a new purchase', async () => {
      const s = await createStore();
      const roti = await recipe(s, 'Roti', 50); // cost 5.000
      const kue = await recipe(s, 'Kue', 50);
      await apply(s, roti.id);
      await apply(s, kue.id);
      expect((await alerts(s).expect(200)).body).toEqual({
        thresholdPercent: 5,
        total: 0,
        rows: [],
      });

      await buy(s, roti.ingredient, 52); // 5.200: +4%
      expect((await alerts(s).expect(200)).body.rows).toEqual([]);

      await buy(s, roti.ingredient, 53); // 5.300: +6%
      await buy(s, kue.ingredient, 60); // 6.000: +20%
      const res = await alerts(s).expect(200);
      expect(res.body.total).toBe(2);
      // largest rise first
      expect(ids(res.body)).toEqual([kue.id, roti.id]);
      expect(res.body.rows[0]).toEqual({
        recipeId: kue.id,
        product: { id: kue.productId, name: 'Kue' },
        previousCost: 5_000,
        costPerPortion: 6_000,
        risePermille: 200,
        sellingPrice: 8_000,
        marginPermille: 250,
      });
      expect(res.body.rows[1]).toMatchObject({
        previousCost: 5_000,
        costPerPortion: 5_300,
        risePermille: 60,
        marginPermille: 338, // 33,75% rounded half up
      });

      // Applying the new cost clears the card; it never touched the selling price.
      await apply(s, kue.id);
      const after = await alerts(s).expect(200);
      expect(ids(after.body)).toEqual([roti.id]);
      const p = await http()
        .get(`/catalog/products/${kue.productId}`)
        .set('Authorization', s.auth)
        .expect(200);
      expect(p.body).toMatchObject({ costPrice: 6_000, sellingPrice: 8_000 });
    });

    it('hides a fall, a product whose cost price was never set and a recipe with a missing cost', async () => {
      const s = await createStore();
      const never = await recipe(s, 'Belum diatur', 50); // cost_price 0: no baseline
      const fall = await recipe(s, 'Turun', 50);
      await apply(s, fall.id);
      await buy(s, fall.ingredient, 40);
      expect((await alerts(s).expect(200)).body).toMatchObject({
        total: 0,
        rows: [],
      });
      await buy(s, never.ingredient, 90);
      expect((await alerts(s).expect(200)).body.rows).toEqual([]);

      // A manual cost removed after the cost price was applied leaves the recipe incomplete: not listed.
      const gap = await recipe(s, 'Tanpa harga', 50);
      await apply(s, gap.id);
      await buy(s, gap.ingredient, 70);
      expect((await alerts(s).expect(200)).body.total).toBe(1);
      await http()
        .patch(`/recipes/${gap.id}`)
        .set('Authorization', s.auth)
        .send({
          lines: [
            { ingredientId: await ingredient(s, 'Tanpa biaya'), quantity: 5 },
          ],
        })
        .expect(200);
      expect((await alerts(s).expect(200)).body.total).toBe(0);
    });

    it('limits the rows but counts every one', async () => {
      const s = await createStore();
      for (const n of ['A', 'B', 'C']) {
        const r = await recipe(s, `Menu ${n}`, 50);
        await apply(s, r.id);
        await buy(s, r.ingredient, 60);
      }
      const res = await alerts(s, '?limit=2').expect(200);
      expect(res.body.total).toBe(3);
      expect(res.body.rows).toHaveLength(2);
    });

    it('answers 422 for a bad limit', async () => {
      for (const q of ['?limit=0', '?limit=11', '?limit=abc', '?limit=1.5'])
        await alerts(a, q).expect(422);
    });

    it("cross-tenant: store B never sees store A's rows", async () => {
      const mine = await recipe(a, 'Milik A', 50);
      await apply(a, mine.id);
      await buy(a, mine.ingredient, 70);
      const seenByA = (await alerts(a).expect(200)).body;
      expect(ids(seenByA).includes(mine.id)).toBe(true);
      const seenByB = (await alerts(b).expect(200)).body;
      expect(ids(seenByB).includes(mine.id)).toBe(false);
    });

    it('needs catalog.manage', async () => {
      const kasir = await createCashier(app, a, ['sales.create']);
      await alerts(a, '', kasir.auth).expect(403);
      const reports = await createCashier(app, a, ['reports.view']);
      await alerts(a, '', reports.auth).expect(403);
      const owner = await createCashier(app, a, ['catalog.manage']);
      await alerts(a, '', owner.auth).expect(200);
    });
  });

  describe('suggested price', () => {
    const get = (store: Store, id: string, query = '') =>
      http().get(`/recipes/${id}${query}`).set('Authorization', store.auth);

    it('defaults to 60%, rounds up to Rp100 and compares with the current price', async () => {
      const s = await createStore();
      const r = await recipe(s, 'Nasi goreng', 53); // cost 5.300, price 8.000
      const res = await get(s, r.id).expect(200);
      expect(res.body.costPerPortion).toBe(5_300);
      // 5.300 / 0,4 = 13.250 -> 13.300
      expect(res.body.suggestedPrice).toEqual({
        targetMargin: 60,
        price: 13_300,
        currentPrice: 8_000,
        marginAtCurrentPermille: 338,
      });
      // 50%: 10.600 exactly
      expect(
        (await get(s, r.id, '?targetMargin=50').expect(200)).body
          .suggestedPrice,
      ).toMatchObject({ targetMargin: 50, price: 10_600 });
      // an exact multiple stays: 5.000 / 0,5 = 10.000
      const exact = await recipe(s, 'Pas', 50);
      expect(
        (await get(s, exact.id, '?targetMargin=50').expect(200)).body
          .suggestedPrice.price,
      ).toBe(10_000);
      expect(
        (await get(s, r.id, '?targetMargin=1').expect(200)).body.suggestedPrice
          .price,
      ).toBe(5_400); // 5.353,5
      expect(
        (await get(s, r.id, '?targetMargin=90').expect(200)).body.suggestedPrice
          .price,
      ).toBe(53_000);
    });

    it('changes no price by itself', async () => {
      const s = await createStore();
      const r = await recipe(s, 'Tetap', 53);
      await get(s, r.id, '?targetMargin=70').expect(200);
      const p = await http()
        .get(`/catalog/products/${r.productId}`)
        .set('Authorization', s.auth)
        .expect(200);
      expect(p.body).toMatchObject({ sellingPrice: 8_000, costPrice: 0 });
    });

    it('answers 422 outside 1..90 or not a whole number', async () => {
      const r = await recipe(a, 'Batas', 50);
      for (const q of ['0', '91', '1.5', 'abc', '-5', ''])
        await get(a, r.id, `?targetMargin=${q}`).expect(422);
      await http()
        .get(`/recipes/${r.id}?targetMargin=10&targetMargin=20`)
        .set('Authorization', a.auth)
        .expect(422);
    });

    it('is null while an ingredient has no cost', async () => {
      const ing = await ingredient(a, 'Tanpa harga beli');
      const p = await product(a, 'Belum lengkap');
      const r = await http()
        .post('/recipes')
        .set('Authorization', a.auth)
        .send({
          productId: p,
          yieldQty: 1,
          lines: [{ ingredientId: ing, quantity: 10 }],
        })
        .expect(201);
      expect(
        (await get(a, r.body.id).expect(200)).body.suggestedPrice,
      ).toBeNull();
    });

    it("cross-tenant: store B gets 404 on store A's recipe, margin or not", async () => {
      const r = await recipe(a, 'Rahasia A', 50);
      await get(b, r.id).expect(404);
      await get(b, r.id, '?targetMargin=50').expect(404);
    });

    it('needs catalog.manage', async () => {
      const r = await recipe(a, 'Izin', 50);
      const kasir = await createCashier(app, a, ['sales.create']);
      await http()
        .get(`/recipes/${r.id}`)
        .set('Authorization', kasir.auth)
        .expect(403);
    });
  });
});
