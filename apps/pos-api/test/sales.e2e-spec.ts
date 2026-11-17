import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
type Line = {
  productId: string;
  unitPrice: number;
  lineTotal: number;
  costTotal?: number;
  priceOverriddenBy: string | null;
};
type Sale = {
  id: string;
  number: number;
  shiftId: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  change: number;
  costTotal?: number;
  overrideBy: string | null;
  lines: Line[];
};

describe('sales and shifts (U3)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  /** A store with "Es Teh Manis" (Rp5.000, cost Rp2.000) and opening stock `qty`. */
  async function storeWithProduct(qty = 50) {
    const store = await createStore();
    const cat = await http()
      .post('/catalog/categories')
      .set('Authorization', store.auth)
      .send({ name: 'Minuman' })
      .expect(201);
    const p = await http()
      .post('/catalog/products')
      .set('Authorization', store.auth)
      .send({
        categoryId: cat.body.id,
        name: 'Es Teh Manis',
        costPrice: 2000,
        sellingPrice: 5000,
      })
      .expect(201);
    const productId = p.body.id as string;
    await http()
      .post('/stock/opening')
      .set('Authorization', store.auth)
      .send({ productId, qty })
      .expect(201);
    return { store, productId };
  }

  const openShift = (auth: string, openingCash = 100_000) =>
    http()
      .post('/shifts/open')
      .set('Authorization', auth)
      .send({ openingCash });

  const sell = (auth: string, body: object, key: string = randomUUID()) =>
    http()
      .post('/sales')
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);

  const onHand = async (store: Store, productId: string) =>
    (
      await http()
        .get(`/stock/products/${productId}`)
        .set('Authorization', store.auth)
        .expect(200)
    ).body.onHand as number;

  it('slice check: 3 × Rp5.000 paid Rp20.000 → change Rp5.000, stock 50 → 47, shift id', async () => {
    const { store, productId } = await storeWithProduct(50);
    const shift = await openShift(store.auth).expect(201);
    const res = await sell(store.auth, {
      lines: [{ productId, qty: 3 }],
      paid: 20_000,
    }).expect(201);
    const sale = res.body as Sale;
    expect(sale).toMatchObject({
      number: 1,
      shiftId: shift.body.id,
      subtotal: 15_000,
      discount: 0,
      tax: 0,
      total: 15_000,
      paid: 20_000,
      change: 5_000,
      costTotal: 6_000,
      overrideBy: null,
    });
    expect(await onHand(store, productId)).toBe(47);
  });

  it('ignores a client price and discount without sales.price_override', async () => {
    const { store, productId } = await storeWithProduct();
    const cashier = await createCashier(app, store, ['sales.create']);
    await openShift(cashier.auth).expect(201);
    const res = await sell(cashier.auth, {
      lines: [{ productId, qty: 5, price: 1 }],
      discount: 10_000,
      paid: 25_000,
    }).expect(201);
    const sale = res.body as Sale;
    expect(sale).toMatchObject({
      total: 25_000,
      discount: 0,
      overrideBy: null,
    });
    expect(sale.lines[0]).toMatchObject({
      unitPrice: 5000,
      priceOverriddenBy: null,
    });
    // A cashier without reports.view never sees cost.
    expect(sale.costTotal).toBeUndefined();
    expect(sale.lines[0].costTotal).toBeUndefined();
  });

  it('uses the client price with sales.price_override, records the actor and stores cost', async () => {
    const { store, productId } = await storeWithProduct();
    const cashier = await createCashier(app, store, [
      'sales.create',
      'sales.price_override',
    ]);
    await openShift(cashier.auth).expect(201);
    const res = await sell(cashier.auth, {
      lines: [{ productId, qty: 2, price: 4000 }],
      paid: 8000,
    }).expect(201);
    const created = res.body as Sale;
    expect(created.lines[0]).toMatchObject({
      unitPrice: 4000,
      priceOverriddenBy: cashier.staffId,
    });
    const owner = await http()
      .get(`/sales/${created.id}`)
      .set('Authorization', store.auth)
      .expect(200);
    expect(owner.body).toMatchObject({
      total: 8000,
      costTotal: 4000,
      overrideBy: cashier.staffId,
    });
    expect((owner.body as Sale).lines[0]).toMatchObject({
      listPrice: 5000,
      costTotal: 4000,
    });
  });

  it('a retry with the same Idempotency-Key returns the first sale (sequential and concurrent)', async () => {
    const { store, productId } = await storeWithProduct(50);
    await openShift(store.auth).expect(201);
    const body = { lines: [{ productId, qty: 1 }], paid: 5000 };

    const key = randomUUID();
    const first = await sell(store.auth, body, key).expect(201);
    const again = await sell(store.auth, body, key).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await onHand(store, productId)).toBe(49);

    const key2 = randomUUID();
    const [x, y] = await Promise.all([
      sell(store.auth, body, key2),
      sell(store.auth, body, key2),
    ]);
    expect(x.status).toBe(201);
    expect(y.status).toBe(201);
    expect(x.body.id).toBe(y.body.id);
    expect(await onHand(store, productId)).toBe(48);

    const list = await http()
      .get('/sales')
      .set('Authorization', store.auth)
      .expect(200);
    expect(list.body.total).toBe(2);
  });

  it('the same Idempotency-Key with a different cart is refused, never replayed as the old sale', async () => {
    const { store, productId } = await storeWithProduct(50);
    await openShift(store.auth).expect(201);
    const key = randomUUID();
    const first = await sell(
      store.auth,
      { lines: [{ productId, qty: 1 }], paid: 5000 },
      key,
    ).expect(201);
    // The cart changed after a timed-out (but committed) first try: same key, more items.
    const changed = await sell(
      store.auth,
      { lines: [{ productId, qty: 3 }], paid: 15_000 },
      key,
    ).expect(422);
    expect(changed.body.message).toBe(
      'Permintaan berbeda dengan transaksi sebelumnya',
    );
    await sell(
      store.auth,
      { lines: [{ productId, qty: 1 }], paid: 5000, note: 'x' },
      key,
    ).expect(422);
    // An identical retry still returns the first sale; stock moved once.
    const again = await sell(
      store.auth,
      { lines: [{ productId, qty: 1 }], paid: 5000 },
      key,
    ).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await onHand(store, productId)).toBe(49);
  });

  it('refuses a sale without an open shift (422)', async () => {
    const { store, productId } = await storeWithProduct();
    await sell(store.auth, {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
    }).expect(422);
    expect(await onHand(store, productId)).toBe(50);
  });

  it('refuses paid < total, oversell, unknown or duplicate product, bad body and missing key (422)', async () => {
    const { store, productId } = await storeWithProduct(2);
    await openShift(store.auth).expect(201);
    const line = { productId, qty: 1 };
    await sell(store.auth, { lines: [line], paid: 4999 }).expect(422);
    await sell(store.auth, {
      lines: [{ productId, qty: 3 }],
      paid: 15_000,
    }).expect(422);
    await sell(store.auth, {
      lines: [{ productId: randomUUID(), qty: 1 }],
      paid: 5000,
    }).expect(422);
    await sell(store.auth, { lines: [line, line], paid: 10_000 }).expect(422);
    await sell(store.auth, { lines: [], paid: 0 }).expect(422);
    await sell(store.auth, {
      lines: [{ productId, qty: 1.5 }],
      paid: 10_000,
    }).expect(422);
    await sell(store.auth, { lines: [line], paid: '5000' }).expect(422);
    await http()
      .post('/sales')
      .set('Authorization', store.auth)
      .send({ lines: [line], paid: 5000 })
      .expect(422);
    await sell(store.auth, { lines: [line], paid: 5000 }, 'short').expect(422);
    expect(await onHand(store, productId)).toBe(2);
  });

  it('computes tax on the amount after the discount', async () => {
    const { store, productId } = await storeWithProduct();
    await http()
      .put('/sales/settings')
      .set('Authorization', store.auth)
      .send({ taxBps: 1000 })
      .expect(200);
    await openShift(store.auth).expect(201);
    const res = await sell(store.auth, {
      lines: [{ productId, qty: 3 }],
      discount: 5000,
      paid: 11_000,
    }).expect(201);
    // (15.000 − 5.000) × 10% = 1.000; Lakasir taxed the 15.000 before the discount.
    expect(res.body).toMatchObject({
      subtotal: 15_000,
      discount: 5000,
      tax: 1000,
      total: 11_000,
      change: 0,
    });
    await http()
      .put('/sales/settings')
      .set('Authorization', store.auth)
      .send({ taxBps: 10_001 })
      .expect(422);
  });

  it('shifts: one open per actor; close reconciles counted against expected; no sale after close', async () => {
    const { store, productId } = await storeWithProduct();
    const shift = await openShift(store.auth, 100_000).expect(201);
    await openShift(store.auth).expect(409);
    await sell(store.auth, {
      lines: [{ productId, qty: 3 }],
      paid: 20_000,
    }).expect(201);
    await sell(store.auth, {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
    }).expect(201);

    const current = await http()
      .get('/shifts/current')
      .set('Authorization', store.auth)
      .expect(200);
    expect(current.body.shift).toMatchObject({
      id: shift.body.id,
      cashSales: 20_000,
      salesCount: 2,
      expectedCash: 120_000,
    });

    const closed = await http()
      .post('/shifts/current/close')
      .set('Authorization', store.auth)
      .send({ countedCash: 119_000 })
      .expect(200);
    expect(closed.body).toMatchObject({
      id: shift.body.id,
      openingCash: 100_000,
      cashSales: 20_000,
      salesCount: 2,
      expectedCash: 120_000,
      countedCash: 119_000,
      difference: -1000,
    });
    expect(closed.body.closedAt).toBeTruthy();

    await sell(store.auth, {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
    }).expect(422);
    await http()
      .post('/shifts/current/close')
      .set('Authorization', store.auth)
      .send({ countedCash: 0 })
      .expect(409);
    const none = await http()
      .get('/shifts/current')
      .set('Authorization', store.auth)
      .expect(200);
    expect(none.body.shift).toBeNull();
    // A new shift can open after the close.
    await openShift(store.auth).expect(201);
  });

  it('cashiers see only their own sales and shifts; the receipt names the cashier', async () => {
    const { store, productId } = await storeWithProduct();
    const cashier = await createCashier(app, store, ['sales.create']);
    await openShift(store.auth).expect(201);
    await openShift(cashier.auth).expect(201);
    const mine = await sell(cashier.auth, {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
    }).expect(201);
    const owners = await sell(store.auth, {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
    }).expect(201);

    const list = await http()
      .get('/sales')
      .set('Authorization', cashier.auth)
      .expect(200);
    const rows = list.body.data as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([mine.body.id]);
    await http()
      .get(`/sales/${owners.body.id}`)
      .set('Authorization', cashier.auth)
      .expect(404);
    const all = await http()
      .get('/sales')
      .set('Authorization', store.auth)
      .expect(200);
    expect(all.body.total).toBe(2);

    const shifts = await http()
      .get('/shifts')
      .set('Authorization', cashier.auth)
      .expect(200);
    expect(shifts.body.total).toBe(1);

    const receipt = await http()
      .get(`/sales/${mine.body.id}/receipt`)
      .set('Authorization', cashier.auth)
      .expect(200);
    expect(receipt.body).toMatchObject({
      number: mine.body.number,
      cashier: 'Sari',
      paymentMethod: 'Tunai',
      total: 5000,
      lines: [
        { name: 'Es Teh Manis', qty: 1, unitPrice: 5000, lineTotal: 5000 },
      ],
    });
  });

  it('history: note on the sale and receipt, cashier name, date range and summary', async () => {
    const { store, productId } = await storeWithProduct();
    const cashier = await createCashier(app, store, ['sales.create']);
    await openShift(store.auth).expect(201);
    await openShift(cashier.auth).expect(201);
    const noted = await sell(cashier.auth, {
      lines: [{ productId, qty: 2 }],
      paid: 10_000,
      note: '  tanpa es  ',
    }).expect(201);
    await sell(store.auth, {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
    }).expect(201);
    await sell(store.auth, {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
      note: 'x'.repeat(201),
    }).expect(422);

    const receipt = await http()
      .get(`/sales/${noted.body.id}/receipt`)
      .set('Authorization', store.auth)
      .expect(200);
    expect(receipt.body.note).toBe('tanpa es');

    const all = await http()
      .get('/sales')
      .set('Authorization', store.auth)
      .expect(200);
    const rows = all.body.data as {
      cashier: string;
      note?: string;
      costTotal?: number;
    }[];
    expect(rows.map((r) => r.cashier).sort()).toEqual(['Pemilik', 'Sari']);
    expect(rows.every((r) => typeof r.costTotal === 'number')).toBe(true);
    expect(all.body.summary).toEqual({
      count: 2,
      revenue: 15_000,
      discount: 0,
    });

    const hour = 60 * 60 * 1000;
    const range = (from: number, to: number) =>
      `/sales?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`;
    const now = Date.now();
    const today = await http()
      .get(range(now - hour, now + hour))
      .set('Authorization', store.auth)
      .expect(200);
    expect(today.body.total).toBe(2);
    const earlier = await http()
      .get(range(now - 3 * hour, now - 2 * hour))
      .set('Authorization', store.auth)
      .expect(200);
    expect(earlier.body).toMatchObject({
      total: 0,
      data: [],
      summary: { count: 0, revenue: 0 },
    });
    await http()
      .get('/sales?from=kemarin')
      .set('Authorization', store.auth)
      .expect(422);

    // A cashier without reports.view never sees cost in the list.
    const own = await http()
      .get('/sales')
      .set('Authorization', cashier.auth)
      .expect(200);
    expect(own.body.data[0].costTotal).toBeUndefined();
  });

  it('a cashier without sales.create cannot open a shift or sell (403)', async () => {
    const { store, productId } = await storeWithProduct();
    const cashier = await createCashier(app, store, ['reports.view']);
    await openShift(cashier.auth).expect(403);
    await sell(cashier.auth, {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
    }).expect(403);
  });

  it('cross-tenant: store B gets 404 on A’s sale, receipt and shift and cannot sell A’s product', async () => {
    const { store: a, productId } = await storeWithProduct();
    const shift = await openShift(a.auth).expect(201);
    const sale = await sell(a.auth, {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
    }).expect(201);

    const { store: b } = await storeWithProduct();
    for (const path of [
      `/sales/${sale.body.id}`,
      `/sales/${sale.body.id}/receipt`,
      `/shifts/${shift.body.id}`,
    ])
      await http().get(path).set('Authorization', b.auth).expect(404);
    const salesB = await http()
      .get('/sales')
      .set('Authorization', b.auth)
      .expect(200);
    expect(salesB.body.total).toBe(0);
    const filtered = await http()
      .get(`/sales?shiftId=${shift.body.id}`)
      .set('Authorization', b.auth)
      .expect(200);
    expect(filtered.body.total).toBe(0);
    const shiftsB = await http()
      .get('/shifts')
      .set('Authorization', b.auth)
      .expect(200);
    expect(shiftsB.body.total).toBe(0);

    await openShift(b.auth).expect(201);
    await sell(b.auth, {
      lines: [{ productId, qty: 1 }],
      paid: 5000,
    }).expect(422);
    // A's idempotency key does not leak A's sale to B.
    const reuse = await sell(
      b.auth,
      { lines: [{ productId, qty: 1 }], paid: 5000 },
      'shared-key-123',
    );
    expect(reuse.status).toBe(422);
    expect(await onHand(a, productId)).toBe(49);
  });
});
