import { INestApplication, UnprocessableEntityException } from '@nestjs/common';
import request from 'supertest';
import { DB, type Db } from '../src/db/db.module';
import { StockService } from '../src/stock/stock.service';
import { createApp, createStore } from './support/fixtures';

type Store = Awaited<ReturnType<typeof createStore>>;

describe('stock (U3)', () => {
  let app: INestApplication;
  let db: Db;
  let stock: StockService;
  let a: Store;
  let b: Store;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    db = app.get(DB);
    stock = app.get(StockService);
    a = await createStore();
    b = await createStore();
  });
  afterAll(async () => {
    await app.close();
  });

  async function product(
    store: Store,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const cat = await http()
      .post('/catalog/categories')
      .set('Authorization', store.auth)
      .send({ name: `Kat ${Math.random()}` })
      .expect(201);
    const res = await http()
      .post('/catalog/products')
      .set('Authorization', store.auth)
      .send({
        categoryId: cat.body.id,
        name: 'Es Teh Manis',
        costPrice: 2000,
        sellingPrice: 5000,
        ...extra,
      })
      .expect(201);
    return res.body.id as string;
  }

  const receive = (
    store: Store,
    productId: string,
    qty: number,
    unitCost: number,
  ) =>
    db.transaction((tx) =>
      stock.receive(tx, {
        tenantId: store.tenantId,
        productId,
        qty,
        unitCost,
        source: 'purchase',
        actorId: store.userId,
      }),
    );

  const consume = (store: Store, productId: string, qty: number) =>
    db.transaction((tx) =>
      stock.consume(tx, {
        tenantId: store.tenantId,
        productId,
        qty,
        actorId: store.userId,
      }),
    );

  it('opening stock: once per product, defaults to the product cost', async () => {
    const id = await product(a);
    await http()
      .post('/stock/opening')
      .set('Authorization', a.auth)
      .send({ productId: id, qty: 50 })
      .expect(201);
    const res = await http()
      .get(`/stock/products/${id}`)
      .set('Authorization', a.auth)
      .expect(200);
    expect(res.body).toMatchObject({ tracked: true, onHand: 50 });
    expect(res.body.batches[0]).toMatchObject({
      unitCost: 2000,
      source: 'opening',
    });
    await http()
      .post('/stock/opening')
      .set('Authorization', a.auth)
      .send({ productId: id, qty: 5 })
      .expect(409);
  });

  it('draws FIFO: cost spans the oldest batch then the next', async () => {
    const id = await product(a);
    await receive(a, id, 2, 1000);
    await receive(a, id, 5, 1500);
    expect(await consume(a, id, 3)).toEqual({ costTotal: 2 * 1000 + 1 * 1500 });
    expect(await stock.onHand(a.tenantId, [id])).toEqual({ [id]: 4 });
    const res = await http()
      .get(`/stock/products/${id}`)
      .set('Authorization', a.auth)
      .expect(200);
    // The first batch is spent; only the second remains.
    expect(res.body.batches).toHaveLength(1);
    expect(res.body.batches[0]).toMatchObject({
      qtyRemaining: 4,
      unitCost: 1500,
    });
  });

  it('refuses a draw larger than stock with 422 and changes nothing', async () => {
    const id = await product(a);
    await receive(a, id, 2, 1000);
    await expect(consume(a, id, 3)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(await stock.onHand(a.tenantId, [id])).toEqual({ [id]: 2 });
  });

  it('a service product draws nothing and costs cost_price × qty', async () => {
    const id = await product(a, { type: 'service', costPrice: 700 });
    expect(await consume(a, id, 3)).toEqual({ costTotal: 2100 });
    expect(await stock.onHand(a.tenantId, [id])).toEqual({});
    await http()
      .post('/stock/opening')
      .set('Authorization', a.auth)
      .send({ productId: id, qty: 1 })
      .expect(422);
  });

  it('adjust: negative draws FIFO, positive adds a batch at the latest cost', async () => {
    const id = await product(a);
    await receive(a, id, 3, 1000);
    await receive(a, id, 3, 1200);
    const adj = (delta: number) =>
      db.transaction((tx) =>
        stock.adjust(tx, {
          tenantId: a.tenantId,
          productId: id,
          delta,
          reason: 'opname',
          actorId: a.userId,
        }),
      );
    await adj(-4);
    await adj(2);
    const res = await http()
      .get(`/stock/products/${id}`)
      .set('Authorization', a.auth)
      .expect(200);
    expect(res.body.onHand).toBe(4);
    const batches = res.body.batches as { unitCost: number }[];
    expect(batches.map((x) => x.unitCost)).toEqual([1200, 1200]);
  });

  it('two concurrent draws of the last unit sell exactly one', async () => {
    const id = await product(a);
    await receive(a, id, 1, 1000);

    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let firstDrew!: () => void;
    const drew = new Promise<void>((r) => (firstDrew = r));

    // Transaction 1 takes the unit and keeps its transaction (and row lock) open.
    const t1 = db.transaction(async (tx) => {
      await stock.consume(tx, {
        tenantId: a.tenantId,
        productId: id,
        qty: 1,
        actorId: a.userId,
      });
      firstDrew();
      await hold;
    });
    await drew;

    let t2Settled = false;
    const t2 = consume(a, id, 1).then(
      (v) => v,
      (e: unknown) => e,
    );
    void t2.finally(() => (t2Settled = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(t2Settled).toBe(false); // blocked on the batch row lock

    release();
    await t1;
    expect(await t2).toBeInstanceOf(UnprocessableEntityException);
    expect(await stock.onHand(a.tenantId, [id])).toEqual({ [id]: 0 });
  });

  it('cross-tenant: store B cannot read or stock A’s product', async () => {
    const id = await product(a);
    await http()
      .get(`/stock/products/${id}`)
      .set('Authorization', b.auth)
      .expect(404);
    await http()
      .post('/stock/opening')
      .set('Authorization', b.auth)
      .send({ productId: id, qty: 5 })
      .expect(404);
    await expect(consume(b, id, 1)).rejects.toThrow('Produk tidak ditemukan');
    expect(await stock.onHand(b.tenantId, [id])).toEqual({});
  });

  it('bad input answers 422; a non-uuid id 404', async () => {
    await http()
      .post('/stock/opening')
      .set('Authorization', a.auth)
      .send({ productId: 'x', qty: 1.5 })
      .expect(422);
    await http()
      .get('/stock/products/not-a-uuid')
      .set('Authorization', a.auth)
      .expect(404);
  });
});
