import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
type Errors = Record<string, string>;

// UMK-2125 recipes R1: ingredient products, recipes, sub-recipes, cost per portion, "apply cost".
describe('recipes R1 (UMK-2125)', () => {
  let app: INestApplication;
  let a: Store;
  let b: Store;
  const http = () => request(app.getHttpServer());
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  // A second owner connection that holds a product's row lock while a request is in flight.
  const locker = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });

  /** Resolves once `n` backends of this database wait for a lock: the requests are in flight. */
  async function untilWaiting(n: number) {
    for (let i = 0; i < 400; i++) {
      const [{ waiting }] = await admin<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_locks l
        join pg_stat_activity a on a.pid = l.pid
        where not l.granted and a.datname = current_database()`;
      if (waiting >= n) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`fewer than ${n} requests reached the lock`);
  }

  beforeAll(async () => {
    app = await createApp();
    a = await createStore();
    b = await createStore();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
    await locker.end();
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
        sellingPrice: 3_000,
        ...extra,
      })
      .expect(201);
    return res.body.id as string;
  }
  const ingredient = (store: Store, name: string, unit = 'GRAM') =>
    product(store, name, { type: 'ingredient', unit, sellingPrice: 1 });

  const manualCost = (
    store: Store,
    productId: string,
    cost: number,
    perQty = 1,
  ) =>
    http()
      .put(`/ingredient-costs/${productId}`)
      .set('Authorization', store.auth)
      .send({ cost, perQty });

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

  const createRecipe = (store: Store, body: object, auth = store.auth) =>
    http().post('/recipes').set('Authorization', auth).send(body);
  const getRecipe = (store: Store, id: string, auth = store.auth) =>
    http().get(`/recipes/${id}`).set('Authorization', auth);

  /** A recipe of one ingredient line (cost Rp1 per unit), for graph tests. */
  async function simpleRecipe(store: Store, lines?: object[]) {
    const ing = await ingredient(store, `Bahan ${randomUUID().slice(0, 6)}`);
    await manualCost(store, ing, 1).expect(200);
    const p = await ingredient(store, `Olahan ${randomUUID().slice(0, 6)}`);
    const res = await createRecipe(store, {
      productId: p,
      yieldQty: 1,
      lines: lines ?? [{ ingredientId: ing, quantity: 10 }],
    }).expect(201);
    return res.body.id as string;
  }

  it('costs a recipe with a sub-recipe, waste and packaging from manual costs, rounded up once', async () => {
    const singkong = await ingredient(a, 'Singkong');
    const minyak = await ingredient(a, 'Minyak goreng', 'ML');
    const cabai = await ingredient(a, 'Cabai');
    const plastik = await ingredient(a, 'Plastik + stiker', 'PCS');
    await manualCost(a, singkong, 6_000, 1_000).expect(200);
    await manualCost(a, minyak, 17_000, 1_000).expect(200);
    await manualCost(a, cabai, 12_400, 100).expect(200);
    await manualCost(a, plastik, 250).expect(200);

    const balado = await ingredient(a, 'Bumbu balado');
    const sub = await createRecipe(a, {
      productId: balado,
      yieldQty: 1,
      yieldUnit: 'resep',
      lines: [{ ingredientId: cabai, quantity: 100 }],
    }).expect(201);
    expect(sub.body.costPerPortion).toBe(12_400);

    const keripik = await product(a, 'Keripik balado', {
      sellingPrice: 3_000,
    });
    const res = await createRecipe(a, {
      productId: keripik,
      yieldQty: 40,
      yieldUnit: 'bungkus',
      laborCost: 20_000,
      lines: [
        { ingredientId: singkong, quantity: 5_000 },
        // 700 ml left in the food, 30% stays in the pan: 1.000 ml bought.
        { ingredientId: minyak, quantity: 700, wastePercent: 30 },
        { subRecipeId: sub.body.id, quantity: 1 },
        { ingredientId: plastik, quantity: 40 },
      ],
    }).expect(201);
    expect(res.body).toMatchObject({
      product: { id: keripik, sellingPrice: 3_000, costPrice: 0 },
      yieldQty: 40,
      yieldUnit: 'bungkus',
      batchCost: 69_400,
      costPerPortion: 1_735,
      // (69.400 + 20.000) / 40 = 2.235
      fullCostPerPortion: 2_235,
      fixedCostsIncluded: false,
      missingCostIngredientIds: [],
    });
    expect(res.body.lines).toHaveLength(4);
    expect(res.body.lines[0]).toMatchObject({
      kind: 'ingredient',
      name: 'Singkong',
      unit: 'GRAM',
      quantity: 5_000,
      cost: 30_000,
      unitCost: { amount: 6_000, per: 1_000, source: 'manual' },
    });
    expect(res.body.lines[1]).toMatchObject({ wastePercent: 30, cost: 17_000 });
    expect(res.body.lines[2]).toMatchObject({
      kind: 'sub_recipe',
      name: 'Bumbu balado',
      unit: 'resep',
      cost: 12_400,
    });

    const list = await http()
      .get('/recipes')
      .set('Authorization', a.auth)
      .expect(200);
    expect(list.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: res.body.id,
          costPerPortion: 1_735,
          missingCost: false,
        }),
      ]),
    );
  });

  it('follows the latest purchase cost; a new purchase changes the recipe cost; apply-cost sets cost_price only', async () => {
    const tepung = await ingredient(a, 'Tepung');
    await manualCost(a, tepung, 50).expect(200);
    const roti = await product(a, 'Roti', { sellingPrice: 5_000 });
    const r = await createRecipe(a, {
      productId: roti,
      yieldQty: 10,
      lines: [{ ingredientId: tepung, quantity: 1_000 }],
    }).expect(201);
    expect(r.body.costPerPortion).toBe(5_000); // manual: 1.000 × 50 / 10

    await buy(a, tepung, 12);
    const first = await getRecipe(a, r.body.id).expect(200);
    expect(first.body.costPerPortion).toBe(1_200);
    expect(first.body.lines[0].unitCost).toEqual({
      amount: 12,
      per: 1,
      source: 'purchase',
    });

    await buy(a, tepung, 15);
    const second = await getRecipe(a, r.body.id).expect(200);
    expect(second.body.costPerPortion).toBe(1_500);

    // The price never changes by itself: nothing was written to the product yet.
    let p = await http()
      .get(`/catalog/products/${roti}`)
      .set('Authorization', a.auth)
      .expect(200);
    expect(p.body).toMatchObject({ costPrice: 0, sellingPrice: 5_000 });

    const applied = await http()
      .post(`/recipes/${r.body.id}/apply-cost`)
      .set('Authorization', a.auth)
      .expect(200);
    expect(applied.body).toEqual({
      productId: roti,
      costPrice: 1_500,
      sellingPrice: 5_000,
    });
    p = await http()
      .get(`/catalog/products/${roti}`)
      .set('Authorization', a.auth)
      .expect(200);
    expect(p.body).toMatchObject({ costPrice: 1_500, sellingPrice: 5_000 });
  });

  it('apply-cost refuses a missing ingredient cost, a cost above the selling price and an ingredient product', async () => {
    const garam = await ingredient(a, 'Garam');
    const sup = await product(a, 'Sup', { sellingPrice: 1_000 });
    const r = await createRecipe(a, {
      productId: sup,
      yieldQty: 1,
      lines: [{ ingredientId: garam, quantity: 10 }],
    }).expect(201);
    expect(r.body.missingCostIngredientIds).toEqual([garam]);
    expect(r.body.lines[0]).toMatchObject({
      unitCost: null,
      missingCost: true,
    });
    const apply = () =>
      http()
        .post(`/recipes/${r.body.id}/apply-cost`)
        .set('Authorization', a.auth);
    const missing = await apply().expect(422);
    expect(missing.body.errors).toHaveProperty('lines');

    await manualCost(a, garam, 101).expect(200); // 1.010 > 1.000
    const above = await apply().expect(422);
    expect(above.body.errors).toHaveProperty('costPrice');

    const sub = await simpleRecipe(a);
    await http()
      .post(`/recipes/${sub}/apply-cost`)
      .set('Authorization', a.auth)
      .expect(422);
  });

  it('apply-cost and every recipe read need catalog.manage', async () => {
    const id = await simpleRecipe(a);
    const parent = await product(a, 'Paket', { sellingPrice: 9_000 });
    const r = await createRecipe(a, {
      productId: parent,
      yieldQty: 1,
      lines: [{ subRecipeId: id, quantity: 1 }],
    }).expect(201);

    const kasir = await createCashier(app, a, ['sales.create']);
    await http()
      .post(`/recipes/${r.body.id}/apply-cost`)
      .set('Authorization', kasir.auth)
      .expect(403);
    await getRecipe(a, r.body.id, kasir.auth).expect(403);
    await http().get('/recipes').set('Authorization', kasir.auth).expect(403);
    await createRecipe(
      a,
      {
        productId: await product(a, 'Lain'),
        yieldQty: 1,
        lines: [{ subRecipeId: id, quantity: 1 }],
      },
      kasir.auth,
    ).expect(403);

    const admin = await createCashier(app, a, ['catalog.manage']);
    const ok = await http()
      .post(`/recipes/${r.body.id}/apply-cost`)
      .set('Authorization', admin.auth)
      .expect(200);
    expect(ok.body.costPrice).toBe(10);
  });

  it('refuses a cycle and a 4th level with 422', async () => {
    const c = await simpleRecipe(a);
    const bId = await simpleRecipe(a, [{ subRecipeId: c, quantity: 1 }]);
    const top = await simpleRecipe(a, [{ subRecipeId: bId, quantity: 1 }]);

    // top → b → c is 3 levels; using top under c closes a cycle.
    const cycle = await http()
      .patch(`/recipes/${c}`)
      .set('Authorization', a.auth)
      .send({ lines: [{ subRecipeId: top, quantity: 1 }] })
      .expect(422);
    expect(cycle.body.errors).toHaveProperty('lines');
    expect(cycle.body.message).toMatch(/berputar/);

    // A recipe that uses itself.
    const self = await http()
      .patch(`/recipes/${c}`)
      .set('Authorization', a.auth)
      .send({ lines: [{ subRecipeId: c, quantity: 1 }] })
      .expect(422);
    expect(self.body.message).toMatch(/berputar/);

    // A 4th level above: a new recipe using top.
    const deep = await createRecipe(a, {
      productId: await product(a, 'Terlalu dalam'),
      yieldQty: 1,
      lines: [{ subRecipeId: top, quantity: 1 }],
    }).expect(422);
    expect(deep.body.message).toMatch(/3 tingkat/);
    // ... and a 4th level below: c gains a sub-recipe of its own.
    const d = await simpleRecipe(a);
    await http()
      .patch(`/recipes/${c}`)
      .set('Authorization', a.auth)
      .send({ lines: [{ subRecipeId: d, quantity: 1 }] })
      .expect(422);

    // Nothing was written by the refusals: c still costs its one ingredient line.
    const still = await getRecipe(a, c).expect(200);
    expect(still.body.lines).toHaveLength(1);
    expect(still.body.lines[0].kind).toBe('ingredient');
  });

  it('validates input with 422 and refuses a second recipe for a product with 409', async () => {
    const p = await product(a, 'Validasi');
    const ing = await ingredient(a, 'Gula');
    const bad = async (body: object) =>
      (await createRecipe(a, body).expect(422)).body.errors as Errors;
    expect(
      await bad({
        productId: p,
        yieldQty: 0,
        lines: [{ ingredientId: ing, quantity: 1 }],
      }),
    ).toHaveProperty('yieldQty');
    expect(
      await bad({
        productId: p,
        yieldQty: 1,
        lines: [{ ingredientId: ing, quantity: 1.5 }],
      }),
    ).toHaveProperty(['lines.0.quantity']);
    expect(
      await bad({
        productId: p,
        yieldQty: 1,
        lines: [{ ingredientId: ing, quantity: 1, wastePercent: 95 }],
      }),
    ).toHaveProperty(['lines.0.wastePercent']);
    expect(await bad({ productId: p, yieldQty: 1, lines: [] })).toHaveProperty(
      'lines',
    );
    expect(
      await bad({ productId: p, yieldQty: 1, lines: [{ quantity: 1 }] }),
    ).toHaveProperty(['lines.0.ingredientId']);
    // A sellable product is not an ingredient.
    expect(
      await bad({
        productId: p,
        yieldQty: 1,
        lines: [{ ingredientId: p, quantity: 1 }],
      }),
    ).toHaveProperty(['lines.0.ingredientId']);
    expect(
      await bad({
        productId: p,
        yieldQty: 1,
        lines: [{ subRecipeId: randomUUID(), quantity: 1 }],
      }),
    ).toHaveProperty(['lines.0.subRecipeId']);
    expect(
      await bad({
        productId: randomUUID(),
        yieldQty: 1,
        lines: [{ ingredientId: ing, quantity: 1 }],
      }),
    ).toHaveProperty('productId');
    await manualCost(a, ing, -1).expect(422);

    await createRecipe(a, {
      productId: p,
      yieldQty: 1,
      lines: [{ ingredientId: ing, quantity: 1 }],
    }).expect(201);
    await createRecipe(a, {
      productId: p,
      yieldQty: 2,
      lines: [{ ingredientId: ing, quantity: 1 }],
    }).expect(409);
  });

  it('updates and deletes a recipe; a recipe used as a sub-recipe cannot be deleted', async () => {
    const sub = await simpleRecipe(a);
    const top = await simpleRecipe(a, [{ subRecipeId: sub, quantity: 2 }]);
    const upd = await http()
      .patch(`/recipes/${top}`)
      .set('Authorization', a.auth)
      .send({ yieldQty: 4, note: 'Baru' })
      .expect(200);
    expect(upd.body).toMatchObject({
      yieldQty: 4,
      note: 'Baru',
      batchCost: 20,
      costPerPortion: 5,
    });
    await http()
      .delete(`/recipes/${sub}`)
      .set('Authorization', a.auth)
      .expect(409);
    await http()
      .delete(`/recipes/${top}`)
      .set('Authorization', a.auth)
      .expect(204);
    await getRecipe(a, top).expect(404);
    await http()
      .delete(`/recipes/${sub}`)
      .set('Authorization', a.auth)
      .expect(204);
  });

  it("cross-tenant: store B gets 404 on store A's recipe and ingredient cost, and cannot name A's rows", async () => {
    const id = await simpleRecipe(a);
    const before = await getRecipe(a, id).expect(200);
    const aIngredient = before.body.lines[0].ingredientId as string;

    await getRecipe(b, id).expect(404);
    await http()
      .patch(`/recipes/${id}`)
      .set('Authorization', b.auth)
      .send({ yieldQty: 99 })
      .expect(404);
    await http()
      .post(`/recipes/${id}/apply-cost`)
      .set('Authorization', b.auth)
      .expect(404);
    await http()
      .delete(`/recipes/${id}`)
      .set('Authorization', b.auth)
      .expect(404);
    await manualCost(b, aIngredient, 1).expect(404);
    await http()
      .delete(`/ingredient-costs/${aIngredient}`)
      .set('Authorization', b.auth)
      .expect(404);
    const list = await http()
      .get('/recipes')
      .set('Authorization', b.auth)
      .expect(200);
    expect((list.body.data as { id: string }[]).map((r) => r.id)).not.toContain(
      id,
    );

    // B cannot use A's ingredient, A's recipe as a sub-recipe, or A's product.
    const bProduct = await product(b, 'Punya B');
    const errs = async (body: object) =>
      (await createRecipe(b, body).expect(422)).body.errors as Errors;
    expect(
      await errs({
        productId: bProduct,
        yieldQty: 1,
        lines: [{ ingredientId: aIngredient, quantity: 1 }],
      }),
    ).toHaveProperty(['lines.0.ingredientId']);
    expect(
      await errs({
        productId: bProduct,
        yieldQty: 1,
        lines: [{ subRecipeId: id, quantity: 1 }],
      }),
    ).toHaveProperty(['lines.0.subRecipeId']);
    expect(
      await errs({
        productId: before.body.product.id,
        yieldQty: 1,
        lines: [{ subRecipeId: id, quantity: 1 }],
      }),
    ).toHaveProperty('productId');

    // A's recipe is untouched.
    const after = await getRecipe(a, id).expect(200);
    expect(after.body.yieldQty).toBe(before.body.yieldQty);
  });

  it('an ingredient is stocked and bought, but never sold', async () => {
    const kopi = await ingredient(a, 'Biji kopi');
    await buy(a, kopi, 200);
    const stock = await http()
      .get(`/stock/products/${kopi}`)
      .set('Authorization', a.auth)
      .expect(200);
    expect(stock.body).toMatchObject({ tracked: true, onHand: 10_000 });
    const listed = await http()
      .get('/catalog/products')
      .query({ type: 'ingredient' })
      .set('Authorization', a.auth)
      .expect(200);
    expect(listed.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: kopi,
          type: 'ingredient',
          stock: 10_000,
        }),
      ]),
    );

    await http()
      .post('/shifts/open')
      .set('Authorization', a.auth)
      .send({ openingCash: 0 })
      .expect(201);
    const sale = await http()
      .post('/sales')
      .set('Authorization', a.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ lines: [{ productId: kopi, qty: 1 }], paid: 10_000 })
      .expect(422);
    expect(sale.body.errors).toHaveProperty(['lines.0.productId']);
  });

  describe('review follow-ups (PR 89)', () => {
    const applyCost = (store: Store, id: string) =>
      http().post(`/recipes/${id}/apply-cost`).set('Authorization', store.auth);
    const costRow = async (productId: string) =>
      (
        await admin<
          {
            cost_price: number;
            selling_price: number;
            cost_set_at: Date | null;
          }[]
        >`select cost_price::int as cost_price, selling_price::int as selling_price, cost_set_at
            from pos.products where id = ${productId}`
      )[0];

    it('refuses figures beyond the cap with 422 (recipe write and manual cost), never a rounded number', async () => {
      const ing = await ingredient(a, 'Saffron');
      await manualCost(a, ing, 1_000_000_000_000).expect(200);
      const c = await createRecipe(a, {
        productId: await ingredient(a, 'Olahan saffron'),
        yieldQty: 1,
        lines: [{ ingredientId: ing, quantity: 1 }],
      }).expect(201);
      // 10.000.000 × Rp1.000.000.000.000 per batch: far past the cap (and past 2^53 one level up).
      const tooMuch = await createRecipe(a, {
        productId: await product(a, 'Saffron jumbo'),
        yieldQty: 1,
        lines: [{ subRecipeId: c.body.id, quantity: 10_000_000 }],
      }).expect(422);
      expect(tooMuch.body.errors).toHaveProperty('lines');

      // A recipe within the cap, then a manual cost that would push it past: refused, the old cost kept.
      const garam = await ingredient(a, 'Garam laut');
      await manualCost(a, garam, 1).expect(200);
      const r = await createRecipe(a, {
        productId: await product(a, 'Asinan'),
        yieldQty: 1,
        lines: [{ ingredientId: garam, quantity: 10_000_000 }],
      }).expect(201);
      expect(r.body.costPerPortion).toBe(10_000_000);
      const refused = await manualCost(a, garam, 1_000_000).expect(422);
      expect(refused.body.errors).toHaveProperty('cost');
      expect(
        (await getRecipe(a, r.body.id).expect(200)).body.costPerPortion,
      ).toBe(10_000_000);
      // A smaller yield of a sub-recipe raises its parents too: checked on update as well.
      const sub = await createRecipe(a, {
        productId: await ingredient(a, 'Bumbu garam'),
        yieldQty: 1_000_000,
        lines: [{ ingredientId: ing, quantity: 1 }],
      }).expect(201);
      await createRecipe(a, {
        productId: await product(a, 'Paket bumbu'),
        yieldQty: 1,
        // Rp1.000.000 per portion × 100.000 = Rp100.000.000.000, within the cap
        lines: [{ subRecipeId: sub.body.id, quantity: 100_000 }],
      }).expect(201);
      await http()
        .patch(`/recipes/${sub.body.id}`)
        .set('Authorization', a.auth)
        .send({ yieldQty: 1 })
        .expect(422);
      expect((await getRecipe(a, sub.body.id).expect(200)).body.yieldQty).toBe(
        1_000_000,
      );
    });

    it('apply-cost judges the selling price under the product row lock; cost_set_at is set once and kept', async () => {
      const kopi = await ingredient(a, 'Kopi bubuk');
      await manualCost(a, kopi, 100).expect(200);
      const es = await product(a, 'Es kopi', { sellingPrice: 5_000 });
      const r = await createRecipe(a, {
        productId: es,
        yieldQty: 1,
        lines: [{ ingredientId: kopi, quantity: 15 }],
      }).expect(201);
      expect(r.body.costPerPortion).toBe(1_500);
      expect((await costRow(es)).cost_set_at).toBeNull();

      // The owner lowers the price below the cost while apply-cost is in flight: apply-cost waits for the row
      // and judges the new price.
      const [pending] = await locker.begin(async (sql) => {
        await sql`select id from pos.products where id = ${es} for update`;
        const inFlight = applyCost(a, r.body.id).then((x) => x);
        await untilWaiting(1);
        await sql`update pos.products set selling_price = 1000 where id = ${es}`;
        return [inFlight];
      });
      const refused = await Promise.resolve(pending);
      expect(refused.status).toBe(422);
      expect(refused.body.errors).toHaveProperty('costPrice');
      expect(await costRow(es)).toMatchObject({
        cost_price: 0,
        selling_price: 1_000,
        cost_set_at: null,
      });

      await admin`update pos.products set selling_price = 5000 where id = ${es}`;
      await applyCost(a, r.body.id).expect(200);
      const first = await costRow(es);
      expect(first.cost_price).toBe(1_500);
      expect(first.cost_set_at).toBeInstanceOf(Date);

      await manualCost(a, kopi, 120).expect(200);
      const again = await applyCost(a, r.body.id).expect(200);
      expect(again.body.costPrice).toBe(1_800);
      // the trigger keeps the first time the cost went above 0
      expect((await costRow(es)).cost_set_at).toEqual(first.cost_set_at);
    });

    const deletedFlags = (body: { lines: { deleted: boolean }[] }) =>
      body.lines.map((l) => l.deleted);

    it('flags a deleted ingredient in the reads (also through a sub-recipe) and apply-cost refuses it', async () => {
      const susu = await ingredient(a, 'Susu');
      const gula = await ingredient(a, 'Gula aren');
      await manualCost(a, susu, 20).expect(200);
      await manualCost(a, gula, 30).expect(200);
      const sirup = await createRecipe(a, {
        productId: await ingredient(a, 'Sirup aren'),
        yieldQty: 1,
        lines: [{ ingredientId: gula, quantity: 10 }],
      }).expect(201);
      const latte = await product(a, 'Latte aren', { sellingPrice: 9_000 });
      const r = await createRecipe(a, {
        productId: latte,
        yieldQty: 1,
        lines: [
          { ingredientId: susu, quantity: 100 },
          { subRecipeId: sirup.body.id, quantity: 1 },
        ],
      }).expect(201);
      expect(r.body.deletedIngredientIds).toEqual([]);
      expect(deletedFlags(r.body)).toEqual([false, false]);

      await http()
        .delete(`/catalog/products/${gula}`)
        .set('Authorization', a.auth)
        .expect(204);
      const read = await getRecipe(a, r.body.id).expect(200);
      expect(read.body.deletedIngredientIds).toEqual([gula]);
      expect(deletedFlags(read.body)).toEqual([false, true]);
      // still costed, only flagged
      expect(read.body.costPerPortion).toBe(2_300);
      const sub = await getRecipe(a, sirup.body.id).expect(200);
      expect(sub.body.lines[0]).toMatchObject({
        ingredientId: gula,
        deleted: true,
      });
      const list = await http()
        .get('/recipes')
        .set('Authorization', a.auth)
        .expect(200);
      expect(
        (list.body.data as { id: string; deletedIngredient: boolean }[]).find(
          (x) => x.id === r.body.id,
        ),
      ).toMatchObject({ deletedIngredient: true });

      const refused = await applyCost(a, r.body.id).expect(422);
      expect(refused.body.errors).toHaveProperty('lines');
      expect((await costRow(latte)).cost_price).toBe(0);
    });

    it('the till lists no ingredient (use=sale), the stock pickers list products and ingredients (use=stock)', async () => {
      const c = await createStore();
      const barang = await product(c, 'Teh botol');
      const bahan = await ingredient(c, 'Daun teh');
      const jasa = await product(c, 'Cuci gelas', { type: 'service' });
      const ids = async (query: object) =>
        (
          (
            await http()
              .get('/catalog/products')
              .query(query)
              .set('Authorization', c.auth)
              .expect(200)
          ).body.data as { id: string }[]
        )
          .map((p) => p.id)
          .sort();
      expect(await ids({ use: 'sale' })).toEqual([barang, jasa].sort());
      expect(await ids({ use: 'stock' })).toEqual([barang, bahan].sort());
      await http()
        .get('/catalog/products')
        .query({ use: 'all' })
        .set('Authorization', c.auth)
        .expect(422);

      // The products summary counts the ingredient on the shelf, but not in "modal belum diisi".
      const sum = await http()
        .get('/summaries/products')
        .set('Authorization', c.auth)
        .expect(200);
      expect(sum.body).toMatchObject({
        total: 2,
        stock: { ok: 0, low: 0, out: 2 },
        noCost: 1,
      });
    });
  });
});
