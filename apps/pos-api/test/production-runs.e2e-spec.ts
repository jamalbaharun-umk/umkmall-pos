import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

const jakartaDay = (days = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

// UMK-2132 recipes R2 (design 45): a production run draws a recipe's ingredients FIFO and receives the finished
// product as a new batch at the run's real ingredient cost ÷ the actual yield.
describe('production runs (UMK-2132)', () => {
  let app: INestApplication;
  let a: Store;
  let b: Store;
  // Store C holds ingredients at the largest unit cost: kept apart, since any recipe write of a store checks
  // every recipe's cost against the cap.
  let c: Store;
  const http = () => request(app.getHttpServer());
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  // A second owner connection that holds batch row locks while requests are in flight.
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
    c = await createStore();
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
        sellingPrice: 15_000,
        ...extra,
      })
      .expect(201);
    return res.body.id as string;
  }
  const ingredient = (store: Store, name: string, unit = 'GRAM') =>
    product(store, name, { type: 'ingredient', unit, sellingPrice: 1 });

  const opening = (
    store: Store,
    productId: string,
    qty: number,
    unitCost: number,
  ) =>
    http()
      .post('/stock/opening')
      .set('Authorization', store.auth)
      .send({ productId, qty, unitCost })
      .expect(201);

  async function buy(
    store: Store,
    productId: string,
    qty: number,
    unitCost: number,
  ) {
    const sup = await http()
      .post('/suppliers')
      .set('Authorization', store.auth)
      .send({ name: 'Pasar Induk' })
      .expect(201);
    const po = await http()
      .post('/purchasing/orders')
      .set('Authorization', store.auth)
      .send({ supplierId: sup.body.id, lines: [{ productId, qty, unitCost }] })
      .expect(201);
    await http()
      .post(`/purchasing/orders/${po.body.id}/approve`)
      .set('Authorization', store.auth)
      .expect(200);
  }

  async function recipe(store: Store, body: object) {
    const res = await http()
      .post('/recipes')
      .set('Authorization', store.auth)
      .send(body)
      .expect(201);
    return res.body.id as string;
  }

  const run = (
    store: Store,
    body: object,
    key: string | null = randomUUID(),
    auth = store.auth,
  ) => {
    const r = http().post('/production-runs').set('Authorization', auth);
    if (key !== null) r.set('Idempotency-Key', key);
    return r.send(body);
  };

  const onHand = async (store: Store, productId: string) => {
    const res = await http()
      .get(`/stock/products/${productId}`)
      .set('Authorization', store.auth)
      .expect(200);
    return res.body.onHand as number;
  };

  /** Every stock and production figure of a store: equal before and after a refused run. */
  const snapshot = async (tenantId: string) => ({
    batches: await admin`
      select id, qty_remaining from pos.stock_batches where tenant_id = ${tenantId} order by id`,
    movements: (
      await admin`select count(*)::int as n from pos.stock_movements where tenant_id = ${tenantId}`
    )[0].n,
    runs: (
      await admin`select count(*)::int as n from pos.production_runs where tenant_id = ${tenantId}`
    )[0].n,
    lines: (
      await admin`select count(*)::int as n from pos.production_run_lines where tenant_id = ${tenantId}`
    )[0].n,
    audit: (
      await admin`select count(*)::int as n from pos.audit_log where tenant_id = ${tenantId}`
    )[0].n,
  });

  describe('nasi goreng: 2 batches, 19 portions came out', () => {
    let beras: string;
    let telur: string;
    let minyak: string;
    let nasi: string;
    let recipeId: string;
    let runId: string;
    const key = randomUUID();
    const body = () => ({ recipeId, batches: 2, actualYield: 19 });

    beforeAll(async () => {
      beras = await ingredient(a, 'Beras');
      telur = await ingredient(a, 'Telur', 'PCS');
      minyak = await ingredient(a, 'Minyak', 'ML');
      nasi = await product(a, 'Nasi goreng');
      // Beras in two batches: the older (opening, Rp10/g) goes first, then the purchase (Rp12/g).
      await opening(a, beras, 2_000, 10);
      await buy(a, beras, 10_000, 12);
      await opening(a, telur, 30, 2_000);
      await opening(a, minyak, 1_000, 20);
      recipeId = await recipe(a, {
        productId: nasi,
        yieldQty: 10,
        lines: [
          { ingredientId: beras, quantity: 1_500 },
          { ingredientId: telur, quantity: 10 },
          { ingredientId: minyak, quantity: 100, wastePercent: 3 },
        ],
      });
    });

    it('plans the run: ingredients needed (waste included) against stock on hand', async () => {
      const res = await http()
        .get('/production-runs/plan')
        .query({ recipeId, batches: 2 })
        .set('Authorization', a.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        recipeId,
        product: { id: nasi, name: 'Nasi goreng' },
        batches: 2,
        plannedYield: 20,
        canProduce: true,
      });
      const byId = Object.fromEntries(
        (res.body.ingredients as { productId: string }[]).map((i) => [
          i.productId,
          i,
        ]),
      );
      expect(byId[beras]).toMatchObject({
        name: 'Beras',
        unit: 'gram',
        needed: 3_000,
        available: 12_000,
        enough: true,
      });
      expect(byId[telur]).toMatchObject({ needed: 20, available: 30 });
      // 200 ml at 3% waste = 206.18… → 207 ml.
      expect(byId[minyak]).toMatchObject({ needed: 207, available: 1_000 });
    });

    it('draws the ingredients FIFO and receives 19 portions at ceil(real cost ÷ 19)', async () => {
      const res = await run(a, body(), key).expect(201);
      runId = res.body.id;
      // Beras 2.000 g × 10 + 1.000 g × 12 = 32.000; telur 20 × 2.000 = 40.000; minyak 207 × 20 = 4.140.
      const cost = 32_000 + 40_000 + 4_140; // 76.140
      expect(res.body).toMatchObject({
        recipeId,
        productId: nasi,
        productName: 'Nasi goreng',
        batches: 2,
        plannedYield: 20,
        actualYield: 19,
        yieldDifference: -1,
        yieldUnit: 'porsi',
        ingredientCost: cost,
        costPerPortion: Math.ceil(cost / 19), // 4007.36… → 4.008
        date: jakartaDay(),
        actorKind: 'owner',
      });
      expect(res.body.costPerPortion).toBe(4_008);
      expect(
        Object.fromEntries(
          (res.body.lines as { ingredientId: string }[]).map((l) => [
            l.ingredientId,
            l,
          ]),
        ),
      ).toEqual({
        [beras]: {
          ingredientId: beras,
          name: 'Beras',
          unit: 'gram',
          quantity: 3_000,
          cost: 32_000,
        },
        [telur]: {
          ingredientId: telur,
          name: 'Telur',
          unit: 'pcs',
          quantity: 20,
          cost: 40_000,
        },
        [minyak]: {
          ingredientId: minyak,
          name: 'Minyak',
          unit: 'ml',
          quantity: 207,
          cost: 4_140,
        },
      });

      // FIFO: the opening batch of beras is empty, the purchase batch gave the other 1.000 g.
      const berasBatches = await admin<
        { source: string; qty_remaining: number }[]
      >`select source, qty_remaining from pos.stock_batches
        where tenant_id = ${a.tenantId} and product_id = ${beras} order by received_at, id`;
      expect(berasBatches).toEqual([
        { source: 'opening', qty_remaining: 0 },
        { source: 'purchase', qty_remaining: 9_000 },
      ]);
      expect(await onHand(a, telur)).toBe(10);
      expect(await onHand(a, minyak)).toBe(793);

      // The finished product: one new batch of the actual yield at the cost per portion.
      const stock = await http()
        .get(`/stock/products/${nasi}`)
        .set('Authorization', a.auth)
        .expect(200);
      expect(stock.body.onHand).toBe(19);
      expect(stock.body.batches).toEqual([
        expect.objectContaining({
          id: res.body.batchId,
          qtyInitial: 19,
          qtyRemaining: 19,
          unitCost: 4_008,
          source: 'production',
        }),
      ]);
      const [batch] = await admin`
        select source_id from pos.stock_batches where id = ${res.body.batchId}`;
      expect(batch.source_id).toBe(runId);

      // The ledger: each ingredient batch out as production_use, the finished batch in as production.
      const moves = await admin<
        { product_id: string; delta: number; reason: string }[]
      >`select product_id, delta, reason from pos.stock_movements
        where tenant_id = ${a.tenantId} and ref_id = ${runId} order by reason, product_id, delta`;
      expect(moves).toEqual(
        expect.arrayContaining([
          { product_id: nasi, delta: 19, reason: 'production' },
          { product_id: beras, delta: -2_000, reason: 'production_use' },
          { product_id: beras, delta: -1_000, reason: 'production_use' },
          { product_id: telur, delta: -20, reason: 'production_use' },
          { product_id: minyak, delta: -207, reason: 'production_use' },
        ]),
      );
      expect(moves).toHaveLength(5);

      // One audit row, with the run's figures.
      const audit = await admin<
        { event: string; target_id: string; details: Record<string, number> }[]
      >`select event, target_id, details from pos.audit_log
        where tenant_id = ${a.tenantId} and event = 'production_run'`;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        target_id: runId,
        details: {
          batches: 2,
          plannedYield: 20,
          actualYield: 19,
          ingredientCost: cost,
          costPerPortion: 4_008,
        },
      });
    });

    it('a retry with the same key answers the first run and moves no stock; another body is refused', async () => {
      const before = await snapshot(a.tenantId);
      const again = await run(a, body(), key).expect(201);
      expect(again.body.id).toBe(runId);
      expect(await snapshot(a.tenantId)).toEqual(before);

      const other = await run(a, { ...body(), actualYield: 18 }, key).expect(
        422,
      );
      expect(other.body.errors).toHaveProperty('idempotencyKey');
      expect(await snapshot(a.tenantId)).toEqual(before);
    });

    it('missing ingredient stock answers 422 INSUFFICIENT_STOCK naming each shortage, and nothing changes', async () => {
      const before = await snapshot(a.tenantId);
      // 2 batches: telur 20 needed, 10 left.
      const one = await run(a, body()).expect(422);
      expect(one.body).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        message:
          'Bahan tidak cukup: Telur hanya ada 10 pcs, produksi butuh 20 pcs',
        shortages: [
          {
            productId: telur,
            name: 'Telur',
            unit: 'pcs',
            needed: 20,
            available: 10,
          },
        ],
      });
      expect(one.body.errors).toHaveProperty('batches');
      // 7 batches: beras (10.500 vs 9.000) and telur (70 vs 10) short, minyak (722 vs 793) enough.
      const two = await run(a, { ...body(), batches: 7 }).expect(422);
      expect(
        (two.body.shortages as { productId: string; needed: number }[]).map(
          (s) => [s.productId, s.needed],
        ),
      ).toEqual(
        expect.arrayContaining([
          [beras, 10_500],
          [telur, 70],
        ]),
      );
      expect(two.body.shortages).toHaveLength(2);
      expect(await snapshot(a.tenantId)).toEqual(before);

      const plan = await http()
        .get('/production-runs/plan')
        .query({ recipeId, batches: 2 })
        .set('Authorization', a.auth)
        .expect(200);
      expect(plan.body.canProduce).toBe(false);
    });

    it('lists runs newest first, filtered by the store day', async () => {
      const list = (query: object) =>
        http()
          .get('/production-runs')
          .query(query)
          .set('Authorization', a.auth);
      const today = await list({ from: jakartaDay(), to: jakartaDay() }).expect(
        200,
      );
      expect((today.body.data as { id: string }[]).map((r) => r.id)).toContain(
        runId,
      );
      expect(today.body.data[0]).toMatchObject({
        productName: 'Nasi goreng',
        plannedYield: 20,
        actualYield: 19,
      });
      const tomorrow = await list({ from: jakartaDay(1) }).expect(200);
      expect(tomorrow.body).toMatchObject({ data: [], total: 0 });
      const yesterday = await list({ to: jakartaDay(-1) }).expect(200);
      expect(yesterday.body.data).toEqual([]);
      await list({ from: jakartaDay(1), to: jakartaDay() }).expect(422);
      await list({ from: '2026-02-31' }).expect(422);
    });

    it('store B: 404 on store A’s run, 422 naming store A’s recipe, A’s runs not listed', async () => {
      await http()
        .get(`/production-runs/${runId}`)
        .set('Authorization', b.auth)
        .expect(404);
      const named = await run(b, {
        recipeId,
        batches: 1,
        actualYield: 10,
      }).expect(422);
      expect(named.body.errors).toHaveProperty('recipeId');
      await http()
        .get('/production-runs/plan')
        .query({ recipeId, batches: 1 })
        .set('Authorization', b.auth)
        .expect(422);
      const list = await http()
        .get('/production-runs')
        .set('Authorization', b.auth)
        .expect(200);
      expect(list.body.data).toEqual([]);
      // Store A's stock is untouched by B's attempts.
      expect(await onHand(a, telur)).toBe(10);
    });

    it('needs catalog.manage: a cashier without it gets 403, one with it records a run', async () => {
      const kasir = await createCashier(app, a, ['sales.create']);
      await run(a, body(), randomUUID(), kasir.auth).expect(403);
      await http()
        .get('/production-runs')
        .set('Authorization', kasir.auth)
        .expect(403);
      await http()
        .get(`/production-runs/${runId}`)
        .set('Authorization', kasir.auth)
        .expect(403);
      await http()
        .get('/production-runs/plan')
        .query({ recipeId, batches: 1 })
        .set('Authorization', kasir.auth)
        .expect(403);

      const staff = await createCashier(app, a, ['catalog.manage']);
      const res = await run(
        a,
        { recipeId, batches: 1, actualYield: 10, note: 'Pagi' },
        randomUUID(),
        staff.auth,
      ).expect(201);
      expect(res.body).toMatchObject({
        actorKind: 'cashier',
        actorId: staff.staffId,
        note: 'Pagi',
        plannedYield: 10,
        actualYield: 10,
      });
      expect(await onHand(a, telur)).toBe(0);
    });

    it('refuses bad input with 422', async () => {
      const bad = async (body: object, key: string | null = randomUUID()) =>
        (await run(a, body, key).expect(422)).body.errors as Record<
          string,
          string
        >;
      expect(
        await bad({ recipeId, batches: 0, actualYield: 1 }),
      ).toHaveProperty('batches');
      expect(
        await bad({ recipeId, batches: 1.5, actualYield: 1 }),
      ).toHaveProperty('batches');
      expect(await bad({ recipeId, batches: 1 })).toHaveProperty('actualYield');
      expect(
        await bad({ recipeId, batches: 1, actualYield: 0 }),
      ).toHaveProperty('actualYield');
      expect(
        await bad({ recipeId, batches: 1, actualYield: 1, price: 1 }),
      ).toHaveProperty('price');
      expect(
        await bad({ recipeId: 'x', batches: 1, actualYield: 1 }),
      ).toHaveProperty('recipeId');
      expect(
        await bad({ recipeId, batches: 1, actualYield: 1 }, null),
      ).toHaveProperty('idempotencyKey');
      await http()
        .get('/production-runs/not-a-uuid')
        .set('Authorization', a.auth)
        .expect(404);
    });
  });

  describe('a sub-recipe (Bumbu balado inside Keripik balado)', () => {
    let singkong: string;
    let cabai: string;
    let sambal: string;
    let keripik: string;
    let sub: string;
    let top: string;

    beforeAll(async () => {
      singkong = await ingredient(a, 'Singkong');
      cabai = await ingredient(a, 'Cabai');
      sambal = await ingredient(a, 'Bumbu balado');
      keripik = await product(a, 'Keripik balado');
      await opening(a, singkong, 5_000, 6);
      await opening(a, cabai, 1_000, 120);
      // Bumbu: 4 portions from 100 g cabai at 20% waste (125 g taken per batch).
      sub = await recipe(a, {
        productId: sambal,
        yieldQty: 4,
        lines: [{ ingredientId: cabai, quantity: 100, wastePercent: 20 }],
      });
      top = await recipe(a, {
        productId: keripik,
        yieldQty: 10,
        lines: [
          { ingredientId: singkong, quantity: 1_000 },
          { subRecipeId: sub, quantity: 2 },
        ],
      });
    });

    it('refuses a run of the sub-recipe itself (422 RECIPE_USED_AS_SUB_RECIPE), nothing written', async () => {
      // Its run would stock Bumbu balado that the Keripik run never draws (it takes the cabai again).
      const before = await snapshot(a.tenantId);
      const res = await run(a, {
        recipeId: sub,
        batches: 1,
        actualYield: 4,
      }).expect(422);
      expect(res.body).toMatchObject({
        code: 'RECIPE_USED_AS_SUB_RECIPE',
        message:
          'Bumbu balado dipakai sebagai sub-resep di Keripik balado. Catat produksi resep itu saja: bahan mentah Bumbu balado ikut terpakai di sana',
      });
      expect(res.body.errors).toHaveProperty('recipeId');
      expect(await snapshot(a.tenantId)).toEqual(before);

      const plan = await http()
        .get('/production-runs/plan')
        .query({ recipeId: sub, batches: 1 })
        .set('Authorization', a.auth)
        .expect(200);
      expect(plan.body).toMatchObject({
        canProduce: false,
        usedAsSubRecipeIn: [{ recipeId: top, productName: 'Keripik balado' }],
        refusal: { code: 'RECIPE_USED_AS_SUB_RECIPE' },
      });
    });

    it('the parent runs on the raw ingredients; the sub-recipe product itself is not drawn', async () => {
      // 3 batches: singkong 3.000 g; bumbu 6 portions = 1,5 bumbu batches = 187,5 g cabai → 188 g.
      const res = await run(a, {
        recipeId: top,
        batches: 3,
        actualYield: 28,
      }).expect(201);
      const cost = 3_000 * 6 + 188 * 120; // 18.000 + 22.560 = 40.560
      expect(res.body).toMatchObject({
        plannedYield: 30,
        actualYield: 28,
        ingredientCost: cost,
        costPerPortion: Math.ceil(cost / 28), // 1448.57… → 1.449
      });
      expect(
        (res.body.lines as { ingredientId: string; quantity: number }[]).map(
          (l) => [l.ingredientId, l.quantity],
        ),
      ).toEqual(
        expect.arrayContaining([
          [singkong, 3_000],
          [cabai, 188],
        ]),
      );
      expect(res.body.lines).toHaveLength(2);
      expect(await onHand(a, cabai)).toBe(812);
      expect(await onHand(a, sambal)).toBe(0);
      expect(await onHand(a, keripik)).toBe(28);
    });
  });

  it('refuses a recipe with a deleted ingredient (422 INGREDIENT_DELETED), nothing drawn', async () => {
    const gula = await ingredient(a, 'Gula aren');
    const kopi = await ingredient(a, 'Kopi bubuk');
    const es = await product(a, 'Es kopi gula aren');
    await opening(a, gula, 1_000, 30);
    await opening(a, kopi, 1_000, 200);
    const r = await recipe(a, {
      productId: es,
      yieldQty: 1,
      lines: [
        { ingredientId: gula, quantity: 20 },
        { ingredientId: kopi, quantity: 15 },
      ],
    });
    await http()
      .delete(`/catalog/products/${gula}`)
      .set('Authorization', a.auth)
      .expect((res) => expect([200, 204]).toContain(res.status));
    const before = await snapshot(a.tenantId);
    const res = await run(a, {
      recipeId: r,
      batches: 1,
      actualYield: 1,
    }).expect(422);
    expect(res.body).toMatchObject({ code: 'INGREDIENT_DELETED' });
    expect(res.body.errors).toHaveProperty('recipeId');
    expect(await snapshot(a.tenantId)).toEqual(before);
  });

  it('two concurrent runs cannot oversell an ingredient: one succeeds, the other is refused', async () => {
    const tepung = await ingredient(a, 'Tepung');
    const roti = await product(a, 'Roti');
    await opening(a, tepung, 10, 100);
    const r = await recipe(a, {
      productId: roti,
      yieldQty: 1,
      lines: [{ ingredientId: tepung, quantity: 6 }],
    });
    const body = { recipeId: r, batches: 1, actualYield: 1 };

    // Hold the ingredient's batch rows so both requests are in flight together, then let them race.
    const [pending] = await locker.begin(async (sql) => {
      await sql`select id from pos.stock_batches where product_id = ${tepung} for update`;
      const both = Promise.all([
        run(a, body).then((x) => x),
        run(a, body).then((x) => x),
      ]);
      await untilWaiting(2);
      return [both];
    });
    const results = await Promise.resolve(pending);
    expect(results.map((x) => x.status).sort()).toEqual([201, 422]);
    expect(results.find((x) => x.status === 422)!.body).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      shortages: [{ productId: tepung, needed: 6, available: 4 }],
    });
    expect(await onHand(a, tepung)).toBe(4);
    expect(await onHand(a, roti)).toBe(1);
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from pos.production_runs where tenant_id = ${a.tenantId} and recipe_id = ${r}`;
    expect(n).toBe(1);
  });

  it('two concurrent requests with one key record one run', async () => {
    const ragi = await ingredient(a, 'Ragi');
    const donat = await product(a, 'Donat');
    await opening(a, ragi, 100, 50);
    const r = await recipe(a, {
      productId: donat,
      yieldQty: 5,
      lines: [{ ingredientId: ragi, quantity: 10 }],
    });
    const key = randomUUID();
    const body = { recipeId: r, batches: 1, actualYield: 5 };
    const [pending] = await locker.begin(async (sql) => {
      await sql`select id from pos.stock_batches where product_id = ${ragi} for update`;
      const both = Promise.all([
        run(a, body, key).then((x) => x),
        run(a, body, key).then((x) => x),
      ]);
      await untilWaiting(2);
      return [both];
    });
    const [x, y] = await Promise.resolve(pending);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(x.body.id).toBe(y.body.id);
    expect(await onHand(a, ragi)).toBe(90);
    expect(await onHand(a, donat)).toBe(5);
  });

  it('same key, stock for exactly one run, two concurrent requests: one run, both answer it', async () => {
    const susu = await ingredient(a, 'Susu', 'ML');
    const puding = await product(a, 'Puding');
    await opening(a, susu, 500, 30);
    const r = await recipe(a, {
      productId: puding,
      yieldQty: 4,
      lines: [{ ingredientId: susu, quantity: 500 }],
    });
    const key = randomUUID();
    const body = { recipeId: r, batches: 1, actualYield: 4 };
    // Both pass the key lookup, then wait on the batch rows: the loser finds the stock gone, and must still
    // answer the winner's run instead of INSUFFICIENT_STOCK.
    const [pending] = await locker.begin(async (sql) => {
      await sql`select id from pos.stock_batches where product_id = ${susu} for update`;
      const both = Promise.all([
        run(a, body, key).then((x) => x),
        run(a, body, key).then((x) => x),
      ]);
      await untilWaiting(2);
      return [both];
    });
    const [x, y] = await Promise.resolve(pending);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(x.body.id).toBe(y.body.id);
    expect(await onHand(a, susu)).toBe(0);
    expect(await onHand(a, puding)).toBe(4);
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from pos.production_runs where tenant_id = ${a.tenantId} and recipe_id = ${r}`;
    expect(n).toBe(1);
    // Another body under that key is still refused.
    const other = await run(a, { ...body, actualYield: 3 }, key).expect(422);
    expect(other.body.errors).toHaveProperty('idempotencyKey');
  });

  it('refuses a finished product that keeps no stock (422 PRODUCT_NOT_STOCKED), nothing written', async () => {
    const teh = await ingredient(a, 'Daun teh');
    const seduh = await product(a, 'Teh seduh');
    await opening(a, teh, 100, 50);
    const r = await recipe(a, {
      productId: seduh,
      yieldQty: 1,
      lines: [{ ingredientId: teh, quantity: 5 }],
    });
    await admin`update pos.products set type = 'service' where id = ${seduh}`;
    const before = await snapshot(a.tenantId);
    const res = await run(a, {
      recipeId: r,
      batches: 1,
      actualYield: 1,
    }).expect(422);
    expect(res.body).toMatchObject({ code: 'PRODUCT_NOT_STOCKED' });
    expect(res.body.errors).toHaveProperty('recipeId');
    expect(await snapshot(a.tenantId)).toEqual(before);
    const plan = await http()
      .get('/production-runs/plan')
      .query({ recipeId: r, batches: 1 })
      .set('Authorization', a.auth)
      .expect(200);
    expect(plan.body).toMatchObject({
      canProduce: false,
      refusal: { code: 'PRODUCT_NOT_STOCKED' },
    });
  });

  it('refuses an ingredient whose type no longer keeps stock (422 INGREDIENT_NOT_STOCKED naming it), not a shortage', async () => {
    const tepung = await ingredient(a, 'Tepung tapioka');
    const air = await ingredient(a, 'Air galon', 'ML');
    const cireng = await product(a, 'Cireng');
    await opening(a, tepung, 1_000, 15);
    const r = await recipe(a, {
      productId: cireng,
      yieldQty: 10,
      lines: [
        { ingredientId: tepung, quantity: 200 },
        { ingredientId: air, quantity: 100 },
      ],
    });
    // Air galon becomes a non-stock item after the recipe named it: it has no batches to draw.
    await admin`update pos.products set type = 'non_stock' where id = ${air}`;
    const before = await snapshot(a.tenantId);
    const res = await run(a, {
      recipeId: r,
      batches: 1,
      actualYield: 10,
    }).expect(422);
    expect(res.body).toMatchObject({ code: 'INGREDIENT_NOT_STOCKED' });
    expect(res.body.message).toContain('Air galon');
    expect(res.body.message).not.toContain('Tepung tapioka');
    expect(res.body.errors).toHaveProperty('recipeId');
    expect(await snapshot(a.tenantId)).toEqual(before);
  });

  it('refuses a need above the stock column (422 QUANTITY_TOO_LARGE); the plan shows it capped', async () => {
    const garam = await ingredient(a, 'Garam krosok');
    const ikan = await product(a, 'Ikan asin');
    // 10.000.000 g at 90% waste = 100.000.000 g a batch; 1.000 batches = 10^11 g, past the integer column.
    const r = await recipe(a, {
      productId: ikan,
      yieldQty: 1,
      lines: [{ ingredientId: garam, quantity: 10_000_000, wastePercent: 90 }],
    });
    const plan = await http()
      .get('/production-runs/plan')
      .query({ recipeId: r, batches: 1_000 })
      .set('Authorization', a.auth)
      .expect(200);
    expect(plan.body).toMatchObject({
      canProduce: false,
      refusal: { code: 'QUANTITY_TOO_LARGE' },
      ingredients: [{ productId: garam, needed: 2_147_483_647, enough: false }],
    });
    const before = await snapshot(a.tenantId);
    const res = await run(a, {
      recipeId: r,
      batches: 1_000,
      actualYield: 1,
    }).expect(422);
    expect(res.body).toMatchObject({ code: 'QUANTITY_TOO_LARGE' });
    expect(res.body.errors).toHaveProperty('batches');
    expect(await snapshot(a.tenantId)).toEqual(before);
  });

  it('refuses costs past the safe range and a batch cost past the Rp1 triliun cap (422 COST_TOO_LARGE)', async () => {
    const MAX = 1_000_000_000_000;
    const emas = await ingredient(c, 'Emas', 'PCS');
    const perak = await ingredient(c, 'Perak', 'PCS');
    const berlian = await ingredient(c, 'Berlian', 'PCS');
    const mahkota = await product(c, 'Mahkota');
    const tiara = await product(c, 'Tiara');
    const cincin = await product(c, 'Cincin');
    // Every recipe first, while no ingredient has a cost: afterwards a recipe write of store C is over the cap.
    // One draw of 10.000 × Rp1 triliun = 10^16 > Number.MAX_SAFE_INTEGER.
    const one = await recipe(c, {
      productId: mahkota,
      yieldQty: 1,
      lines: [{ ingredientId: emas, quantity: 10_000 }],
    });
    // Two draws of 5.000 × Rp1 triliun each fit; their sum (10^16) does not.
    const sum = await recipe(c, {
      productId: tiara,
      yieldQty: 1,
      lines: [
        { ingredientId: emas, quantity: 5_000 },
        { ingredientId: perak, quantity: 5_000 },
      ],
    });
    // 2 berlian at Rp1 triliun: Rp2 triliun for one ring is past the batch cap, for two rings it is the cap.
    const ring = await recipe(c, {
      productId: cincin,
      yieldQty: 1,
      lines: [{ ingredientId: berlian, quantity: 2 }],
    });
    await opening(c, emas, 10_000, MAX);
    await opening(c, perak, 5_000, MAX);
    await opening(c, berlian, 2, MAX);

    const before = await snapshot(c.tenantId);
    for (const recipeId of [one, sum]) {
      const res = await run(c, { recipeId, batches: 1, actualYield: 1 }).expect(
        422,
      );
      expect(res.body).toMatchObject({ code: 'COST_TOO_LARGE' });
      expect(res.body.errors).toHaveProperty('batches');
    }
    const cap = await run(c, {
      recipeId: ring,
      batches: 1,
      actualYield: 1,
    }).expect(422);
    expect(cap.body).toMatchObject({ code: 'COST_TOO_LARGE' });
    expect(cap.body.errors).toHaveProperty('actualYield');
    expect(await snapshot(c.tenantId)).toEqual(before);

    const ok = await run(c, {
      recipeId: ring,
      batches: 1,
      actualYield: 2,
    }).expect(201);
    expect(ok.body).toMatchObject({
      ingredientCost: 2 * MAX,
      costPerPortion: MAX,
    });
  });

  it('a sale of the finished product goes through while a run of it waits on its ingredient', async () => {
    const mentega = await ingredient(a, 'Mentega');
    const kue = await product(a, 'Kue lapis');
    await opening(a, mentega, 100, 80);
    await opening(a, kue, 5, 1_000);
    const r = await recipe(a, {
      productId: kue,
      yieldQty: 10,
      lines: [{ ingredientId: mentega, quantity: 50 }],
    });
    await http()
      .post('/shifts/open')
      .set('Authorization', a.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ openingCash: 0 })
      .expect(201);
    const [pending] = await locker.begin(async (sql) => {
      await sql`select id from pos.stock_batches where product_id = ${mentega} for update`;
      const running = run(a, {
        recipeId: r,
        batches: 1,
        actualYield: 10,
      }).then((x) => x);
      await untilWaiting(1);
      // The run holds nothing the sale needs: the sale completes while the run still waits.
      await http()
        .post('/sales')
        .set('Authorization', a.auth)
        .set('Idempotency-Key', randomUUID())
        .send({ lines: [{ productId: kue, qty: 1 }], paid: 15_000 })
        .expect(201);
      return [running];
    });
    const res = await Promise.resolve(pending);
    expect(res.status).toBe(201);
    expect(await onHand(a, mentega)).toBe(50);
    expect(await onHand(a, kue)).toBe(5 - 1 + 10);
  });
});
