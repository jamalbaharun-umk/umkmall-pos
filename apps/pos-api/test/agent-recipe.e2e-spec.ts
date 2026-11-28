import { INestApplication } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';

type Store = Awaited<ReturnType<typeof createStore>>;
type Json = Record<string, any>;

// UMK-2127: the agent's create_recipe (new products only, draft for existing ones) and the recipe breakdown in
// hpp_product_data.
describe('agent recipes (UMK-2127)', () => {
  let app: INestApplication;
  let base: string;
  let a: Store;
  let b: Store;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const clients: Client[] = [];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}`;
    a = await createStore();
    b = await createStore();
  });
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
    await admin.end();
  });

  async function agent(store: Store, scopes = ['pos.read', 'pos.write']) {
    const r = await http()
      .post('/auth/dev/agent-session')
      .send({ userId: store.userId, scopes })
      .expect(200);
    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: {
          headers: { Authorization: `Bearer ${r.body.sessionToken}` },
        },
      }),
    );
    clients.push(client);
    return client;
  }
  async function call(client: Client, name: string, args: Json = {}) {
    const r = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    const text = r.content[0].text;
    return r.isError ? { error: text } : { data: JSON.parse(text) as Json };
  }

  const cats = new Map<string, string>();
  async function category(store: Store) {
    if (!cats.has(store.tenantId))
      cats.set(
        store.tenantId,
        (
          await http()
            .post('/catalog/categories')
            .set('Authorization', store.auth)
            .send({ name: 'Dapur' })
            .expect(201)
        ).body.id,
      );
    return cats.get(store.tenantId)!;
  }
  async function product(store: Store, name: string, extra: Json = {}) {
    const res = await http()
      .post('/catalog/products')
      .set('Authorization', store.auth)
      .send({
        categoryId: await category(store),
        name,
        sellingPrice: 10_000,
        ...extra,
      })
      .expect(201);
    return res.body.id as string;
  }
  async function ingredient(
    store: Store,
    name: string,
    cost: number,
    unit = 'GRAM',
  ) {
    const id = await product(store, name, {
      type: 'ingredient',
      unit,
      sellingPrice: 1,
    });
    await http()
      .put(`/ingredient-costs/${id}`)
      .set('Authorization', store.auth)
      .send({ cost })
      .expect(200);
    return id;
  }
  const productRow = async (store: Store, id: string) =>
    (
      await http()
        .get(`/catalog/products/${id}`)
        .set('Authorization', store.auth)
        .expect(200)
    ).body as Json;
  const recipeCount = async () => {
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from pos.recipes where tenant_id = ${a.tenantId}`;
    return n;
  };
  const key = () => `rcp-${randomUUID()}`;

  it('previews, then creates a new product and its recipe once per key, with no cost price', async () => {
    const tepung = await ingredient(a, 'Tepung', 10);
    const gula = await ingredient(a, 'Gula', 20);
    const dus = await ingredient(a, 'Dus', 500, 'PCS');
    const client = await agent(a);
    const input = {
      newProduct: {
        name: 'Brownies Kukus',
        categoryId: await category(a),
        sellingPrice: 25_000,
        unit: 'Loyang',
      },
      yieldQty: 10,
      yieldUnit: 'potong',
      laborCost: 5_000,
      lines: [
        { ingredientId: tepung, quantity: 500, wastePercent: 10 },
        { ingredientId: gula, quantity: 250 },
        { ingredientId: dus, quantity: 1 },
      ],
    };
    const before = await recipeCount();
    const k = key();

    const preview = await call(client, 'create_recipe', {
      ...input,
      idempotencyKey: k,
    });
    expect(preview.data).toMatchObject({
      preview: true,
      wouldCreate: { product: { name: 'Brownies Kukus' } },
    });
    expect(await recipeCount()).toBe(before);

    const first = await call(client, 'create_recipe', {
      ...input,
      idempotencyKey: k,
      confirm: true,
    });
    expect(first.error).toBeUndefined();
    const productId = first.data!.productId as string;
    // 500 g at Rp10 with 10 % waste (5.000 / 0,9 = 5.556 rounded up), 250 g at Rp20 (5.000), one box (500): 11.056 a batch, 1.106 a portion.
    expect(first.data).toMatchObject({
      recipe: {
        batchCost: 11_056,
        costPerPortion: 1_106,
        fullCostPerPortion: 1_606,
        yieldQty: 10,
      },
      provenance: { tool: 'create_recipe', by: 'agent' },
    });
    expect(await recipeCount()).toBe(before + 1);
    // The cost is not applied: the product has no cost price, the selling price is the one sent.
    const row = await productRow(a, productId);
    expect(row.sellingPrice).toBe(25_000);
    expect(row.costPrice ?? 0).toBe(0);
    expect(row.sku).toMatch(/^RC-[0-9a-f]{12}$/);

    // The same recipe through the REST route says the same.
    const rec = await http()
      .get(`/recipes/${(first.data!.recipe as Json).id}`)
      .set('Authorization', a.auth)
      .expect(200);
    expect(rec.body.costPerPortion).toBe(1_106);

    // A retry with the key answers the first result; nothing is made twice.
    const again = await call(client, 'create_recipe', {
      ...input,
      idempotencyKey: k,
      confirm: true,
    });
    expect(again.data).toEqual(first.data);
    expect(await recipeCount()).toBe(before + 1);

    // The call is on record, as the agent, with what it created.
    const [call1] = await admin<{ actor_id: string; result_refs: string[] }[]>`
      select actor_id, result_refs from pos.agent_tool_calls
      where tenant_id = ${a.tenantId} and tool = 'create_recipe' and outcome = 'ok'`;
    expect(call1.actor_id).toBe(a.userId);
    expect(call1.result_refs).toContain(productId);
  });

  it('uses a sub-recipe line and refuses unknown, non-ingredient, cyclic and strict-schema input', async () => {
    const cabai = await ingredient(a, 'Cabai', 30);
    const client = await agent(a);
    const mk = (name: string, lines: Json[], extra: Json = {}) =>
      call(client, 'create_recipe', {
        newProduct: { name, categoryId: undefined, sellingPrice: 5_000 },
        yieldQty: 1,
        lines,
        idempotencyKey: key(),
        confirm: true,
        ...extra,
      });
    const cat = await category(a);
    const make = (name: string, lines: Json[], extra: Json = {}) =>
      call(client, 'create_recipe', {
        newProduct: { name, categoryId: cat, sellingPrice: 5_000 },
        yieldQty: 2,
        lines,
        idempotencyKey: key(),
        confirm: true,
        ...extra,
      });
    void mk;
    const base = await make('Sambal', [{ ingredientId: cabai, quantity: 100 }]);
    const subId = (base.data!.recipe as Json).id as string;
    const withSub = await make('Nasi Sambal', [
      { subRecipeId: subId, quantity: 1 },
      { ingredientId: cabai, quantity: 10 },
    ]);
    expect(withSub.data!.recipe).toMatchObject({
      lines: [
        { kind: 'sub_recipe', name: 'Sambal' },
        { kind: 'ingredient', name: 'Cabai' },
      ],
    });

    const before = await recipeCount();
    const plain = await product(a, 'Kopi biasa');
    for (const lines of [
      [{ ingredientId: randomUUID(), quantity: 1 }], // unknown
      [{ ingredientId: plain, quantity: 1 }], // not an ingredient
      [{ subRecipeId: randomUUID(), quantity: 1 }], // unknown sub-recipe
    ]) {
      const r = await make('Gagal', lines);
      expect(r.error).toMatch(/Baris 1/);
    }
    expect(await recipeCount()).toBe(before);
    // Nothing was made for the refused calls either.
    const list = await http()
      .get('/catalog/products')
      .query({ q: 'Gagal' })
      .set('Authorization', a.auth)
      .expect(200);
    expect(list.body.total).toBe(0);

    // Strict input: the agent has no way to send a cost price, a SKU or an ingredient product.
    const okLines = [{ ingredientId: cabai, quantity: 1 }];
    for (const bad of [
      {
        newProduct: {
          name: 'X',
          categoryId: cat,
          sellingPrice: 1,
          costPrice: 1,
        },
      },
      {
        newProduct: { name: 'X', categoryId: cat, sellingPrice: 1, sku: 'ABC' },
      },
      {
        newProduct: {
          name: 'X',
          categoryId: cat,
          sellingPrice: 1,
          type: 'ingredient',
        },
      },
    ]) {
      const r = await make('X', okLines, bad);
      expect(r.error).toBeDefined();
    }
    expect(
      (
        await make('X', okLines, {
          lines: [{ ingredientId: cabai, quantity: 1, price: 5 }],
        })
      ).error,
    ).toBeDefined();
    // Both or neither of productId / newProduct, a bad waste, a zero yield.
    expect((await make('X', okLines, { productId: plain })).error).toMatch(
      /tepat satu/,
    );
    expect(
      (
        await call(client, 'create_recipe', {
          yieldQty: 1,
          lines: okLines,
          idempotencyKey: key(),
          confirm: true,
        })
      ).error,
    ).toMatch(/tepat satu/);
    expect(
      (
        await make('X', [
          { ingredientId: cabai, quantity: 1, wastePercent: 99999 },
        ])
      ).error,
    ).toMatch(/Susut/);
    expect((await make('X', okLines, { yieldQty: 0 })).error).toMatch(/Hasil/);
  });

  it('refuses a cycle and a too-deep chain with the route message, then reuses the product on a retry with the same key', async () => {
    const cabai = await ingredient(a, 'Cabai merah', 30);
    const client = await agent(a);
    const cat = await category(a);
    const make = (name: string, lines: Json[], k = key()) =>
      call(client, 'create_recipe', {
        newProduct: { name, categoryId: cat, sellingPrice: 5_000 },
        yieldQty: 1,
        lines,
        idempotencyKey: k,
        confirm: true,
      });
    // A chain at the depth limit: the next one that nests it is refused by the route after the preflight passed.
    let prev = (await make('Lv0', [{ ingredientId: cabai, quantity: 1 }])).data!
      .recipe as Json;
    let refusedAt = 0;
    let k = key();
    for (let i = 1; i <= 12; i++) {
      k = key();
      const r = await make(
        `Lv${i}`,
        [{ subRecipeId: prev.id, quantity: 1 }],
        k,
      );
      if (r.error) {
        refusedAt = i;
        expect(r.error).toMatch(/tingkat/);
        expect(r.error).toMatch(/productId/);
        break;
      }
      prev = r.data!.recipe as Json;
    }
    expect(refusedAt).toBeGreaterThan(0);
    // The product of the refused try exists once; the same key finds it, so no second product appears.
    const count = async () =>
      (
        await http()
          .get('/catalog/products')
          .query({ q: `Lv${refusedAt}` })
          .set('Authorization', a.auth)
          .expect(200)
      ).body.total as number;
    expect(await count()).toBe(1);
    const retry = await make(
      `Lv${refusedAt}`,
      [{ subRecipeId: prev.id, quantity: 1 }],
      k,
    );
    expect(retry.error).toMatch(/tingkat/);
    expect(await count()).toBe(1);
  });

  const productCount = async (store: Store, q: string) =>
    (
      await http()
        .get('/catalog/products')
        .query({ q })
        .set('Authorization', store.auth)
        .expect(200)
    ).body.total as number;

  it('requires a selling price of at least Rp1 for a new product, and writes nothing otherwise', async () => {
    const bahan = await ingredient(a, 'Bahan harga nol', 10);
    const client = await agent(a);
    const input = {
      newProduct: {
        name: 'Gratisan Nol',
        categoryId: await category(a),
        sellingPrice: 0,
      },
      yieldQty: 1,
      lines: [{ ingredientId: bahan, quantity: 1 }],
      idempotencyKey: key(),
    };
    const before = await recipeCount();
    for (const confirm of [false, true]) {
      const r = await call(client, 'create_recipe', { ...input, confirm });
      expect(r.error).toMatch(/sellingPrice/);
    }
    expect(await productCount(a, 'Gratisan Nol')).toBe(0);
    expect(await recipeCount()).toBe(before);
    // Rp1 is the lowest price that passes.
    const ok = await call(client, 'create_recipe', {
      ...input,
      newProduct: { ...input.newProduct, sellingPrice: 1 },
      confirm: true,
    });
    expect(ok.error).toBeUndefined();
  });

  it('refuses a retry of a freed key that changes the new product, and writes no second product', async () => {
    const bahan = await ingredient(a, 'Bahan kunci', 1_000_000);
    const client = await agent(a);
    const cat = await category(a);
    const k = key();
    const send = (name: string, sellingPrice: number, quantity: number) =>
      call(client, 'create_recipe', {
        newProduct: { name, categoryId: cat, sellingPrice },
        yieldQty: 1,
        lines: [{ ingredientId: bahan, quantity }],
        idempotencyKey: k,
        confirm: true,
      });
    const before = await recipeCount();
    // First try: the product is made, the route refuses the recipe (cost cap), the key is freed.
    const bad = await send('Kunci Pertama', 7_000, 10_000_000);
    expect(bad.error).toMatch(/productId/);
    expect(await productCount(a, 'Kunci Pertama')).toBe(1);
    // Another product body under the same key: refused, not silently the first product.
    const other = await send('Kunci Kedua', 9_000, 1);
    expect(other.error).toMatch(/kunci idempotensi/i);
    expect(await productCount(a, 'Kunci Kedua')).toBe(0);
    expect(await recipeCount()).toBe(before);
    // The same product with corrected lines still works, once.
    const fixed = await send('Kunci Pertama', 7_000, 1);
    expect(fixed.error).toBeUndefined();
    expect(await recipeCount()).toBe(before + 1);
    expect(await productCount(a, 'Kunci Pertama')).toBe(1);
  });

  it('refuses a recipe above the Rp1.000.000.000.000 cap through the agent', async () => {
    const mahal = await ingredient(a, 'Bahan mahal', 1_000_000);
    const client = await agent(a);
    const before = await recipeCount();
    const r = await call(client, 'create_recipe', {
      newProduct: {
        name: 'Resep Terlalu Mahal',
        categoryId: await category(a),
        sellingPrice: 1_000,
      },
      yieldQty: 1,
      lines: [{ ingredientId: mahal, quantity: 10_000_000 }],
      idempotencyKey: key(),
      confirm: true,
    });
    expect(r.error).toMatch(/terlalu besar/i);
    expect(await recipeCount()).toBe(before);
  });

  it('only drafts for an existing product: nothing written, cost and price untouched', async () => {
    const tepung = await ingredient(a, 'Tepung draf', 10);
    const existing = await product(a, 'Roti lama', {
      costPrice: 4_000,
      sellingPrice: 9_000,
      type: 'non_stock',
    });
    const client = await agent(a);
    const before = await recipeCount();
    const r = await call(client, 'create_recipe', {
      productId: existing,
      yieldQty: 4,
      lines: [{ ingredientId: tepung, quantity: 200 }],
      idempotencyKey: key(),
      confirm: true,
    });
    expect(r.data).toMatchObject({
      draft: true,
      written: false,
      product: { id: existing, costPrice: 4_000, sellingPrice: 9_000 },
    });
    expect(await recipeCount()).toBe(before);
    expect(await productRow(a, existing)).toMatchObject({
      costPrice: 4_000,
      sellingPrice: 9_000,
    });
  });

  it('needs the pos.write consent, like its sibling write tools', async () => {
    const tepung = await ingredient(a, 'Tepung izin', 10);
    const client = await agent(a, ['pos.read']);
    const before = await recipeCount();
    const r = await call(client, 'create_recipe', {
      newProduct: {
        name: 'Tanpa izin',
        categoryId: await category(a),
        sellingPrice: 1_000,
      },
      yieldQty: 1,
      lines: [{ ingredientId: tepung, quantity: 1 }],
      idempotencyKey: key(),
      confirm: true,
    });
    expect(r.error).toMatch(/pos\.write/);
    expect(await recipeCount()).toBe(before);
    // The routes are shut to a read-only agent as well.
    const s = await http()
      .post('/auth/dev/agent-session')
      .send({ userId: a.userId, scopes: ['pos.read'] })
      .expect(200);
    await http()
      .post('/recipes')
      .set('Authorization', `Bearer ${s.body.sessionToken}`)
      .send({})
      .expect(403);
  });

  it("store B's agent cannot reach store A's ingredient, sub-recipe or product", async () => {
    const tepung = await ingredient(a, 'Tepung A', 10);
    const made = await call(await agent(a), 'create_recipe', {
      newProduct: {
        name: 'Resep A',
        categoryId: await category(a),
        sellingPrice: 1_000,
      },
      yieldQty: 1,
      lines: [{ ingredientId: tepung, quantity: 1 }],
      idempotencyKey: key(),
      confirm: true,
    });
    const recipeA = (made.data!.recipe as Json).id as string;
    const productA = made.data!.productId as string;
    const clientB = await agent(b);
    const catB = await category(b);
    const bIngredient = await ingredient(b, 'Tepung B', 10);
    const tryB = (lines: Json[], extra: Json = {}) =>
      call(clientB, 'create_recipe', {
        newProduct: { name: 'Curi', categoryId: catB, sellingPrice: 1_000 },
        yieldQty: 1,
        lines,
        idempotencyKey: key(),
        confirm: true,
        ...extra,
      });
    expect((await tryB([{ ingredientId: tepung, quantity: 1 }])).error).toMatch(
      /tidak ditemukan/,
    );
    expect((await tryB([{ subRecipeId: recipeA, quantity: 1 }])).error).toMatch(
      /tidak ditemukan/,
    );
    // An existing product of A as a draft target, and its breakdown through B's hpp data.
    expect(
      (
        await call(clientB, 'create_recipe', {
          productId: productA,
          yieldQty: 1,
          lines: [{ ingredientId: bIngredient, quantity: 1 }],
          idempotencyKey: key(),
        })
      ).error,
    ).toBeDefined();
    const list = await http()
      .get('/catalog/products')
      .query({ q: 'Curi' })
      .set('Authorization', b.auth)
      .expect(200);
    expect(list.body.total).toBe(0);
    const hpp = await call(clientB, 'hpp_product_data', {
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(
      (hpp.data!.products as Json[]).some((p) => p.recipe !== undefined),
    ).toBe(false);
  });

  it('hpp_product_data carries the recipe breakdown; a product without a recipe keeps its old shape', async () => {
    const store = await createStore();
    const tepung = await ingredient(store, 'Tepung H', 10);
    const gula = await product(store, 'Gula tanpa harga', {
      type: 'ingredient',
      unit: 'GRAM',
      sellingPrice: 1,
    });
    const cat = await category(store);
    const write = await agent(store);
    const made = await call(write, 'create_recipe', {
      newProduct: { name: 'Kue H', categoryId: cat, sellingPrice: 8_000 },
      yieldQty: 5,
      laborCost: 1_000,
      lines: [
        { ingredientId: tepung, quantity: 100 },
        { ingredientId: gula, quantity: 50 },
      ],
      idempotencyKey: key(),
      confirm: true,
    });
    const plainId = await product(store, 'Teh tanpa resep', {
      type: 'non_stock',
    });
    // Only the read consent: the breakdown is a read.
    const read = await agent(store, ['pos.read']);
    const hpp = await call(read, 'hpp_product_data', {
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(hpp.error).toBeUndefined();
    const rows = hpp.data!.products as Json[];
    const kue = rows.find((r) => r.productId === made.data!.productId)!;
    const rec = await http()
      .get(`/recipes/${(made.data!.recipe as Json).id}`)
      .set('Authorization', store.auth)
      .expect(200);
    expect(kue.recipe).toMatchObject({
      id: rec.body.id,
      yieldQty: 5,
      laborCost: 1_000,
      batchCost: 1_000,
      costPerPortion: 200,
      fullCostPerPortion: 400,
      fixedCostsIncluded: false,
      missingCostIngredientIds: [gula],
    });
    expect(kue.recipe.costPerPortion).toBe(rec.body.costPerPortion);
    expect(kue.recipe.lines).toMatchObject([
      { name: 'Tepung H', quantity: 100, cost: 1_000, missingCost: false },
      { name: 'Gula tanpa harga', quantity: 50, missingCost: true },
    ]);
    // The row's own cost price is still the product's (none): the recipe never wrote it.
    expect(kue.costPrice ?? 0).toBe(0);
    const plain = rows.find((r) => r.productId === plainId)!;
    expect('recipe' in plain).toBe(false);
    expect(Object.keys(plain).sort()).toEqual(
      [
        'productId',
        'sku',
        'name',
        'unit',
        'type',
        'category',
        'sellingPrice',
        'costPrice',
        'units',
        'priceTiers',
        'stock',
        'hppRef',
        'sold',
        'purchases',
      ].sort(),
    );
  });

  it('GET /recipes/breakdown needs reports.view or catalog.manage and validates its ids', async () => {
    await http()
      .get('/recipes/breakdown')
      .query({ productIds: 'nope' })
      .set('Authorization', a.auth)
      .expect(422);
    await http()
      .get('/recipes/breakdown')
      .set('Authorization', a.auth)
      .expect(422);
  });
});
