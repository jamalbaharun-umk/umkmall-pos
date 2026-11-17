import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';

// Every refusal on the sales, shift, supplier, purchase and stock-opname endpoints answers with the shared shape
// `{ message, errors: { field: "<Indonesian message>" } }` and the right status (UI parity B, owner 2026-11-17).

type Store = Awaited<ReturnType<typeof createStore>>;
type Refusal = { message: string; errors: Record<string, string> };

describe('validation: sales, shifts, suppliers, purchasing, stock opname', () => {
  let app: INestApplication;
  let s: Store;
  let productId: string;
  let supplierId: string;
  const http = () => request(app.getHttpServer());
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    http()
      .post(path)
      .set('Authorization', s.auth)
      .set(headers)
      .send(body as object);
  const sell = (body: unknown) =>
    post('/sales', body, { 'Idempotency-Key': randomUUID() });

  /** Status plus the exact message on one field. */
  async function refused(
    res: request.Test,
    status: number,
    field: string,
    message: string,
  ) {
    const r = await res.expect(status);
    expect((r.body as Refusal).errors?.[field]).toBe(message);
    return r.body as Refusal;
  }

  beforeAll(async () => {
    app = await createApp();
    s = await createStore();
    const cat = await post('/catalog/categories', { name: 'Minuman' }).expect(
      201,
    );
    const p = await post('/catalog/products', {
      categoryId: cat.body.id,
      name: 'Es Teh Manis',
      costPrice: 2000,
      sellingPrice: 5000,
    }).expect(201);
    productId = p.body.id as string;
    await post('/stock/opening', { productId, qty: 2 }).expect(201);
    supplierId = (
      await post('/suppliers', { name: 'CV Sumber Rejeki' }).expect(201)
    ).body.id as string;
  });
  afterAll(async () => {
    await app.close();
  });

  describe('sales', () => {
    it('no open shift: 422 "Buka shift dulu sebelum berjualan"', async () => {
      const body = await refused(
        sell({ lines: [{ productId, qty: 1 }], paid: 5000 }),
        422,
        '_',
        'Buka shift dulu sebelum berjualan',
      );
      expect(body.message).toBe('Buka shift dulu sebelum berjualan');
    });

    it('missing, wrong type, out of range, too long, missing key', async () => {
      await post('/shifts/open', { openingCash: 0 }).expect(201);
      await refused(
        sell({ lines: [{ productId, qty: 1 }] }),
        422,
        'paid',
        'Wajib diisi',
      );
      await refused(
        sell({ lines: [{ productId, qty: 1 }], paid: '5000' }),
        422,
        'paid',
        'Harus berupa angka',
      );
      await refused(
        sell({ lines: [{ productId, qty: 0 }], paid: 5000 }),
        422,
        'lines.0.qty',
        'Jumlah harus lebih dari 0',
      );
      await refused(
        sell({ lines: [{ productId, qty: 1.5 }], paid: 5000 }),
        422,
        'lines.0.qty',
        'Jumlah harus bilangan bulat',
      );
      await refused(sell({ lines: [], paid: 0 }), 422, 'lines', 'Wajib diisi');
      await refused(
        sell({
          lines: [
            { productId, qty: 1 },
            { productId, qty: 1 },
          ],
          paid: 10_000,
        }),
        422,
        'lines',
        'Satu produk cukup satu baris',
      );
      await refused(
        sell({
          lines: [{ productId, qty: 1 }],
          paid: 5000,
          note: 'x'.repeat(201),
        }),
        422,
        'note',
        'Maksimal 200 karakter',
      );
      await refused(
        post('/sales', { lines: [{ productId, qty: 1 }], paid: 5000 }),
        422,
        'idempotencyKey',
        'Wajib diisi',
      );
    });

    it('unknown product, insufficient stock (names the product), underpayment', async () => {
      await refused(
        sell({ lines: [{ productId: randomUUID(), qty: 1 }], paid: 5000 }),
        422,
        'lines.0.productId',
        'Produk tidak ditemukan atau tidak aktif',
      );
      await refused(
        sell({ lines: [{ productId, qty: 3 }], paid: 20_000 }),
        422,
        'lines.0.qty',
        'Stok Es Teh Manis tidak cukup (sisa 2)',
      );
      const under = await refused(
        sell({ lines: [{ productId, qty: 1 }], paid: 4999 }),
        422,
        'paid',
        'Uang dibayar kurang dari total',
      );
      expect((under as unknown as { total: number }).total).toBe(5000);
    });

    it('history: a bad date filter is a field error', async () => {
      await refused(
        http().get('/sales?from=kemarin').set('Authorization', s.auth),
        422,
        'from',
        'Format tidak valid',
      );
    });
  });

  describe('shifts', () => {
    it('negative cash 422, second open 409, close without a shift 409', async () => {
      const other = await createStore();
      const as = (path: string, body: unknown) =>
        http()
          .post(path)
          .set('Authorization', other.auth)
          .send(body as object);
      await refused(
        as('/shifts/open', { openingCash: -1 }),
        422,
        'openingCash',
        'Minimal 0',
      );
      await refused(as('/shifts/open', {}), 422, 'openingCash', 'Wajib diisi');
      const none = await as('/shifts/current/close', { countedCash: 0 }).expect(
        409,
      );
      expect(none.body.message).toBe('Tidak ada shift yang terbuka');
      await as('/shifts/open', { openingCash: 0 }).expect(201);
      const twice = await as('/shifts/open', { openingCash: 0 }).expect(409);
      expect(twice.body.message).toBe('Shift Anda masih terbuka');
    });
  });

  describe('suppliers', () => {
    it('required name, lengths, unknown keys', async () => {
      await refused(post('/suppliers', {}), 422, 'name', 'Wajib diisi');
      await refused(
        post('/suppliers', { name: '  ' }),
        422,
        'name',
        'Wajib diisi',
      );
      await refused(
        post('/suppliers', { name: 'x', phone: '1'.repeat(31) }),
        422,
        'phone',
        'Maksimal 30 karakter',
      );
      await refused(
        post('/suppliers', { name: 'x', email: 'a@b.c' }),
        422,
        'email',
        'Isian tidak dikenal',
      );
      await refused(
        http()
          .patch(`/suppliers/${supplierId}`)
          .set('Authorization', s.auth)
          .send({ name: '' }),
        422,
        'name',
        'Wajib diisi',
      );
    });
  });

  describe('purchase orders', () => {
    const line = (extra: object = {}) => ({
      productId,
      qty: 1,
      unitCost: 1000,
      ...extra,
    });
    it('supplier, lines, qty, unit cost, total overflow, foreign product', async () => {
      await refused(
        post('/purchasing/orders', { lines: [line()] }),
        422,
        'supplierId',
        'Wajib diisi',
      );
      await refused(
        post('/purchasing/orders', {
          supplierId: randomUUID(),
          lines: [line()],
        }),
        422,
        'supplierId',
        'Pemasok tidak ditemukan',
      );
      await refused(
        post('/purchasing/orders', { supplierId, lines: [] }),
        422,
        'lines',
        'Wajib diisi',
      );
      await refused(
        post('/purchasing/orders', { supplierId, lines: [line({ qty: 0 })] }),
        422,
        'lines.0.qty',
        'Jumlah harus lebih dari 0',
      );
      await refused(
        post('/purchasing/orders', {
          supplierId,
          lines: [line({ unitCost: 1.5 })],
        }),
        422,
        'lines.0.unitCost',
        'Harga beli harus bilangan bulat rupiah',
      );
      await refused(
        post('/purchasing/orders', {
          supplierId,
          lines: [line({ unitCost: 2_000_000_000 })],
        }),
        422,
        'lines.0.unitCost',
        'Harga beli maksimal Rp1.000.000.000',
      );
      // 100.000 × Rp1.000.000.000 × 11 lines: each line legal, the total past Rp1 triliun.
      const big = Array.from({ length: 11 }, () => ({
        productId: randomUUID(),
        qty: 100_000,
        unitCost: 1_000_000_000,
      }));
      await refused(
        post('/purchasing/orders', { supplierId, lines: big }),
        422,
        'lines',
        'Total pembelian maksimal Rp1.000.000.000.000',
      );
      await refused(
        post('/purchasing/orders', { supplierId, lines: [line(), line()] }),
        422,
        'lines',
        'Satu produk cukup satu baris',
      );
      await refused(
        post('/purchasing/orders', {
          supplierId,
          lines: [line({ productId: randomUUID() })],
        }),
        422,
        'lines.0.productId',
        'Produk tidak ditemukan atau tidak memakai stok',
      );
    });
  });

  describe('stock opname', () => {
    it('lines required, counted qty range, foreign product', async () => {
      await refused(post('/stock-opnames', {}), 422, 'lines', 'Wajib diisi');
      await refused(
        post('/stock-opnames', { lines: [{ productId, countedQty: -1 }] }),
        422,
        'lines.0.countedQty',
        'Jumlah tidak boleh negatif',
      );
      await refused(
        post('/stock-opnames', { lines: [{ productId, countedQty: 'lima' }] }),
        422,
        'lines.0.countedQty',
        'Harus berupa angka',
      );
      await refused(
        post('/stock-opnames', {
          lines: [{ productId: randomUUID(), countedQty: 1 }],
        }),
        422,
        'lines.0.productId',
        'Produk tidak ditemukan atau tidak memakai stok',
      );
    });
  });
});
