import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
type Row = { id: string; name: string };
const rows = (res: { body: unknown }) => (res.body as { data: Row[] }).data;

describe('stock in (U6)', () => {
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

  async function product(store: Store, extra: Record<string, unknown> = {}) {
    const cat = await http()
      .post('/catalog/categories')
      .set('Authorization', store.auth)
      .send({ name: `Kategori ${Math.random()}` })
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

  async function supplier(store: Store, name = 'CV Sumber Rejeki') {
    const res = await http()
      .post('/suppliers')
      .set('Authorization', store.auth)
      .send({ name, phone: '081234567890', address: 'Jl. Pasar 1' })
      .expect(201);
    return res.body.id as string;
  }

  async function order(
    store: Store,
    lines: { productId: string; qty: number; unitCost: number }[],
  ) {
    const res = await http()
      .post('/purchasing/orders')
      .set('Authorization', store.auth)
      .send({
        supplierId: await supplier(store),
        paymentMethod: 'Tunai',
        lines,
      })
      .expect(201);
    return res.body as { id: string; total: number; status: string };
  }

  async function stockOf(store: Store, productId: string) {
    const res = await http()
      .get(`/stock/products/${productId}`)
      .set('Authorization', store.auth)
      .expect(200);
    return res.body as {
      onHand: number;
      batches: { qtyInitial: number; unitCost: number; source: string }[];
    };
  }

  async function opening(store: Store, productId: string, qty: number) {
    await http()
      .post('/stock/opening')
      .set('Authorization', store.auth)
      .send({ productId, qty })
      .expect(201);
  }

  const approve = (store: Store, id: string) =>
    http()
      .post(`/purchasing/orders/${id}/approve`)
      .set('Authorization', store.auth);

  async function opname(
    store: Store,
    lines: { productId: string; countedQty: number; reason?: string }[],
  ) {
    const res = await http()
      .post('/stock-opnames')
      .set('Authorization', store.auth)
      .send({ note: 'Hitung akhir bulan', lines })
      .expect(201);
    return res.body as {
      id: string;
      status: string;
      lines: { systemQty: number; countedQty: number; difference: number }[];
    };
  }

  const approveOpname = (store: { auth: string }, id: string) =>
    http()
      .post(`/stock-opnames/${id}/approve`)
      .set('Authorization', store.auth);

  describe('slice check', () => {
    it('buy 20 → 47 → 67; opname to 65 shows −2', async () => {
      const p = await product(a);
      await opening(a, p, 47);
      const o = await order(a, [{ productId: p, qty: 20, unitCost: 1800 }]);
      await approve(a, o.id).expect(200);
      expect((await stockOf(a, p)).onHand).toBe(67);

      const so = await opname(a, [{ productId: p, countedQty: 65 }]);
      expect(so.lines[0]).toMatchObject({
        systemQty: 67,
        countedQty: 65,
        difference: -2,
      });
      await approveOpname(a, so.id).expect(200);
      expect((await stockOf(a, p)).onHand).toBe(65);
    });
  });

  describe('approval', () => {
    it('an approved purchase creates a batch at its unit cost', async () => {
      const p = await product(a);
      const o = await order(a, [{ productId: p, qty: 12, unitCost: 1750 }]);
      const res = await approve(a, o.id).expect(200);
      expect(res.body).toMatchObject({ status: 'approved' });
      expect(res.body.approvedAt).toBeTruthy();
      const s = await stockOf(a, p);
      expect(s.onHand).toBe(12);
      expect(s.batches).toEqual([
        expect.objectContaining({
          qtyInitial: 12,
          unitCost: 1750,
          source: 'purchase',
        }),
      ]);
    });

    it('approving twice adds stock once (also when concurrent)', async () => {
      const p = await product(a);
      const o = await order(a, [{ productId: p, qty: 5, unitCost: 1000 }]);
      await approve(a, o.id).expect(200);
      await approve(a, o.id).expect(200);
      expect((await stockOf(a, p)).onHand).toBe(5);

      const o2 = await order(a, [{ productId: p, qty: 3, unitCost: 1000 }]);
      const rs = await Promise.all([approve(a, o2.id), approve(a, o2.id)]);
      expect(rs.map((r) => r.status)).toEqual([200, 200]);
      expect((await stockOf(a, p)).onHand).toBe(8);
    });

    it('a cancelled order adds nothing and cannot be approved; an approved one cannot be cancelled', async () => {
      const p = await product(a);
      const o = await order(a, [{ productId: p, qty: 9, unitCost: 1000 }]);
      await http()
        .post(`/purchasing/orders/${o.id}/cancel`)
        .set('Authorization', a.auth)
        .expect(200);
      await approve(a, o.id).expect(409);
      expect((await stockOf(a, p)).onHand).toBe(0);

      const o2 = await order(a, [{ productId: p, qty: 1, unitCost: 1000 }]);
      await approve(a, o2.id).expect(200);
      await http()
        .post(`/purchasing/orders/${o2.id}/cancel`)
        .set('Authorization', a.auth)
        .expect(409);
    });

    it('an opname to a lower count writes one negative adjustment, once', async () => {
      const p = await product(a);
      await opening(a, p, 10);
      const so = await opname(a, [
        { productId: p, countedQty: 7, reason: 'rusak' },
      ]);
      await approveOpname(a, so.id).expect(200);
      await approveOpname(a, so.id).expect(200);
      expect((await stockOf(a, p)).onHand).toBe(7);
      await http()
        .patch(`/stock-opnames/${so.id}`)
        .set('Authorization', a.auth)
        .send({ note: 'x' })
        .expect(409);
      await http()
        .delete(`/stock-opnames/${so.id}`)
        .set('Authorization', a.auth)
        .expect(409);
    });

    it('approval applies the count against on-hand at approval, not at saving (sales in between)', async () => {
      const p = await product(a);
      await opening(a, p, 20);
      const so = await opname(a, [{ productId: p, countedQty: 15 }]);
      expect(so.lines[0].systemQty).toBe(20);
      await http()
        .post('/shifts/open')
        .set('Authorization', a.auth)
        .send({ openingCash: 0 });
      await http()
        .post('/sales')
        .set('Authorization', a.auth)
        .set('Idempotency-Key', `opname-race-${p}`)
        .send({ lines: [{ productId: p, qty: 2 }], paid: 10_000 })
        .expect(201);
      const draft = await http()
        .get(`/stock-opnames/${so.id}`)
        .set('Authorization', a.auth)
        .expect(200);
      expect(draft.body.lines[0]).toMatchObject({
        systemQty: 18,
        difference: -3,
      });
      await approveOpname(a, so.id).expect(200);
      expect((await stockOf(a, p)).onHand).toBe(15);
      const done = await http()
        .get(`/stock-opnames/${so.id}`)
        .set('Authorization', a.auth)
        .expect(200);
      expect(done.body.lines[0]).toMatchObject({
        systemQty: 18,
        countedQty: 15,
        difference: -3,
      });
    });

    it('an opname to a higher count adds an adjustment batch; deleting a draft changes nothing', async () => {
      const p = await product(a);
      await opening(a, p, 4);
      const draft = await opname(a, [{ productId: p, countedQty: 100 }]);
      await http()
        .delete(`/stock-opnames/${draft.id}`)
        .set('Authorization', a.auth)
        .expect(204);
      expect((await stockOf(a, p)).onHand).toBe(4);

      const so = await opname(a, [{ productId: p, countedQty: 6 }]);
      await approveOpname(a, so.id).expect(200);
      const s = await stockOf(a, p);
      expect(s.onHand).toBe(6);
      expect(s.batches.map((x) => x.source)).toContain('adjustment');
    });
  });

  describe('suppliers', () => {
    it('creates, lists, updates and soft-deletes', async () => {
      const s = await createStore();
      const id = await supplier(s, 'UD Maju');
      await http()
        .patch(`/suppliers/${id}`)
        .set('Authorization', s.auth)
        .send({ phone: null })
        .expect(200)
        .expect((r) => expect(r.body.phone).toBeNull());
      const list = await http()
        .get('/suppliers')
        .set('Authorization', s.auth)
        .expect(200);
      expect(rows(list).map((r) => r.name)).toEqual(['UD Maju']);
      await http()
        .delete(`/suppliers/${id}`)
        .set('Authorization', s.auth)
        .expect(204);
      await http()
        .get(`/suppliers/${id}`)
        .set('Authorization', s.auth)
        .expect(404);
      const after = await http()
        .get('/suppliers')
        .set('Authorization', s.auth)
        .expect(200);
      expect(after.body.data).toEqual([]);
    });

    it('answers 422 on a bad body and 404 on a non-uuid id', async () => {
      await http()
        .post('/suppliers')
        .set('Authorization', a.auth)
        .send({ name: '' })
        .expect(422);
      await http()
        .get('/suppliers/nope')
        .set('Authorization', a.auth)
        .expect(404);
    });

    it("gives store B 404 on store A's supplier", async () => {
      const id = await supplier(a);
      await http()
        .get(`/suppliers/${id}`)
        .set('Authorization', b.auth)
        .expect(404);
      await http()
        .patch(`/suppliers/${id}`)
        .set('Authorization', b.auth)
        .send({ name: 'x' })
        .expect(404);
      await http()
        .delete(`/suppliers/${id}`)
        .set('Authorization', b.auth)
        .expect(404);
      const list = await http()
        .get('/suppliers')
        .set('Authorization', b.auth)
        .expect(200);
      expect(rows(list).map((r) => r.id)).not.toContain(id);
    });
  });

  describe('purchase orders', () => {
    it('computes the total on the server and ignores no client total', async () => {
      const p1 = await product(a);
      const p2 = await product(a);
      const o = await order(a, [
        { productId: p1, qty: 20, unitCost: 2000 },
        { productId: p2, qty: 3, unitCost: 1500 },
      ]);
      expect(o).toMatchObject({ status: 'draft', total: 44_500 });
      await http()
        .post('/purchasing/orders')
        .set('Authorization', a.auth)
        .send({
          supplierId: await supplier(a),
          total: 1,
          lines: [{ productId: p1, qty: 1, unitCost: 1 }],
        })
        .expect(422);
    });

    it('edits only a draft and replaces the lines', async () => {
      const p1 = await product(a);
      const o = await order(a, [{ productId: p1, qty: 1, unitCost: 1000 }]);
      const res = await http()
        .patch(`/purchasing/orders/${o.id}`)
        .set('Authorization', a.auth)
        .send({ lines: [{ productId: p1, qty: 5, unitCost: 900 }] })
        .expect(200);
      expect(res.body.total).toBe(4500);
      expect(res.body.lines).toHaveLength(1);
      await http()
        .post(`/purchasing/orders/${o.id}/cancel`)
        .set('Authorization', a.auth)
        .expect(200)
        .expect((r) => expect(r.body.status).toBe('cancelled'));
      await http()
        .patch(`/purchasing/orders/${o.id}`)
        .set('Authorization', a.auth)
        .send({ note: 'x' })
        .expect(409);
      await http()
        .delete(`/purchasing/orders/${o.id}`)
        .set('Authorization', a.auth)
        .expect(409);
    });

    it("refuses another store's product, a service product and a deleted supplier", async () => {
      const foreign = await product(b);
      const service = await product(a, { type: 'service' });
      const sup = await supplier(a);
      for (const productId of [foreign, service])
        await http()
          .post('/purchasing/orders')
          .set('Authorization', a.auth)
          .send({
            supplierId: sup,
            lines: [{ productId, qty: 1, unitCost: 1 }],
          })
          .expect(422);
      const mine = await product(a);
      await http()
        .delete(`/suppliers/${sup}`)
        .set('Authorization', a.auth)
        .expect(204);
      await http()
        .post('/purchasing/orders')
        .set('Authorization', a.auth)
        .send({
          supplierId: sup,
          lines: [{ productId: mine, qty: 1, unitCost: 1 }],
        })
        .expect(422);
    });

    it("gives store B 404 on every route of store A's order", async () => {
      const o = await order(a, [
        { productId: await product(a), qty: 1, unitCost: 1 },
      ]);
      const url = `/purchasing/orders/${o.id}`;
      await http().get(url).set('Authorization', b.auth).expect(404);
      await http()
        .patch(url)
        .set('Authorization', b.auth)
        .send({ note: 'x' })
        .expect(404);
      await http().delete(url).set('Authorization', b.auth).expect(404);
      for (const action of ['cancel', 'approve'])
        await http()
          .post(`${url}/${action}`)
          .set('Authorization', b.auth)
          .expect(404);
      const list = await http()
        .get('/purchasing/orders')
        .set('Authorization', b.auth)
        .expect(200);
      expect(rows(list).map((r) => r.id)).not.toContain(o.id);
      await http().get(url).set('Authorization', a.auth).expect(200);
    });
  });

  describe('stock opname', () => {
    it("gives store B 404 on every route of store A's opname", async () => {
      const so = await opname(a, [
        { productId: await product(a), countedQty: 3 },
      ]);
      const url = `/stock-opnames/${so.id}`;
      await http().get(url).set('Authorization', b.auth).expect(404);
      await http()
        .patch(url)
        .set('Authorization', b.auth)
        .send({ note: 'x' })
        .expect(404);
      await http().delete(url).set('Authorization', b.auth).expect(404);
      await approveOpname(b, so.id).expect(404);
      const list = await http()
        .get('/stock-opnames')
        .set('Authorization', b.auth)
        .expect(200);
      expect(rows(list).map((r) => r.id)).not.toContain(so.id);
      await http().get(url).set('Authorization', a.auth).expect(200);
    });

    it("refuses another store's product (422)", async () => {
      await http()
        .post('/stock-opnames')
        .set('Authorization', a.auth)
        .send({ lines: [{ productId: await product(b), countedQty: 1 }] })
        .expect(422);
    });
  });

  describe('permissions', () => {
    it('hides purchase costs from a session without purchasing.manage or reports.view', async () => {
      const p = await product(a);
      const o = await order(a, [{ productId: p, qty: 2, unitCost: 1500 }]);
      const plain = await createCashier(app, a, ['sales.create']);
      const list = await http()
        .get('/purchasing/orders')
        .set('Authorization', plain.auth)
        .expect(200);
      expect(
        (list.body as { data: { total?: number }[] }).data.every(
          (r) => r.total === undefined,
        ),
      ).toBe(true);
      const one = await http()
        .get(`/purchasing/orders/${o.id}`)
        .set('Authorization', plain.auth)
        .expect(200);
      expect(one.body.total).toBeUndefined();
      expect(one.body.lines[0]).toMatchObject({ qty: 2 });
      expect(one.body.lines[0].unitCost).toBeUndefined();
      const auditor = await createCashier(app, a, ['reports.view']);
      const seen = await http()
        .get(`/purchasing/orders/${o.id}`)
        .set('Authorization', auditor.auth)
        .expect(200);
      expect(seen.body).toMatchObject({
        total: 3000,
        lines: [{ unitCost: 1500 }],
      });
    });

    it('gives a cashier without purchasing.manage 403 on writes, 2xx with it', async () => {
      const p = await product(a);
      const sup = await supplier(a);
      const o = await order(a, [{ productId: p, qty: 1, unitCost: 1 }]);
      const so = await opname(a, [{ productId: p, countedQty: 1 }]);
      const plain = await createCashier(app, a, ['sales.create']);
      const writes = [
        http().post('/suppliers').send({ name: 'x' }),
        http().patch(`/suppliers/${sup}`).send({ name: 'x' }),
        http().delete(`/suppliers/${sup}`),
        http()
          .post('/purchasing/orders')
          .send({
            supplierId: sup,
            lines: [{ productId: p, qty: 1, unitCost: 1 }],
          }),
        http().patch(`/purchasing/orders/${o.id}`).send({ note: 'x' }),
        http().delete(`/purchasing/orders/${o.id}`),
        http().post(`/purchasing/orders/${o.id}/cancel`),
        http().post(`/purchasing/orders/${o.id}/approve`),
        http()
          .post('/stock-opnames')
          .send({ lines: [{ productId: p, countedQty: 1 }] }),
        http().patch(`/stock-opnames/${so.id}`).send({ note: 'x' }),
        http().delete(`/stock-opnames/${so.id}`),
        http().post(`/stock-opnames/${so.id}/approve`),
      ];
      for (const req of writes)
        await req.set('Authorization', plain.auth).expect(403);
      // Reads need only a session.
      await http()
        .get('/purchasing/orders')
        .set('Authorization', plain.auth)
        .expect(200);

      const buyer = await createCashier(app, a, ['purchasing.manage']);
      await http()
        .post('/suppliers')
        .set('Authorization', buyer.auth)
        .send({ name: 'x' })
        .expect(201);
      await http()
        .post(`/purchasing/orders/${o.id}/approve`)
        .set('Authorization', buyer.auth)
        .expect(200);
      await approveOpname(buyer, so.id).expect(200);
    });
  });
});
