import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
type Row = { row: number; status: string; errors: string[]; name: string };

/** UMK-2129: product import from CSV with a preview; duplicates reported, never overwritten. */
describe('product import (UMK-2129)', () => {
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
    // Already in store A: SKU KOPI-1 with barcode 899001, named "Kopi bubuk".
    const cat = await post(a.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    await post(a.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Kopi bubuk',
      sku: 'KOPI-1',
      sellingPrice: 10000,
      barcodes: ['899001'],
    }).expect(201);
  });

  const csv = [
    'Nama;Harga jual;Harga modal;SKU;Kategori;Satuan;Barcode;Stok',
    'Beras 5 kg;Rp68.000;60.000;BRS-5;Sembako;karung;;10',
    'Gula 1 kg;16.500;;;sembako;;;',
    'Minyak 1 L;abc;;;;;;',
    'Beras 5 kg;68000;;BRS-5;;;;',
    'Kopi sachet;2.000;;KOPI-1;Minuman;;;',
    'Teh celup;5.000;;;;;899001;',
    'kopi BUBUK;12.000;;;;;;',
    'Es batu;1.000;;;;;;0',
  ].join('\n');

  it('previews every row with its errors and saves nothing', async () => {
    const res = await post(a.auth, '/catalog/products/import/preview', {
      csv,
    }).expect(200);
    const rows = res.body.rows as Row[];
    expect(rows.map((r) => [r.row, r.status, r.errors])).toEqual([
      [2, 'ok', []],
      [3, 'ok', []],
      [4, 'error', ['Harga jual bukan angka rupiah bulat']],
      [5, 'error', ['SKU ganda dengan baris 2', 'Nama ganda dengan baris 2']],
      [6, 'error', ['SKU sudah dipakai produk lain']],
      [7, 'error', ['Barcode sudah dipakai produk lain']],
      [8, 'error', ['Produk dengan nama ini sudah ada']],
      [9, 'ok', []],
    ]);
    expect(res.body).toMatchObject({ total: 8, okCount: 3, errorCount: 5 });
    const list = (await get(a.auth, '/catalog/products').expect(200)).body;
    expect(list.total).toBe(1);
  });

  it('saves only the rows that pass: integer rupiah, categories made once, stock only with a stock cell', async () => {
    const res = await post(a.auth, '/catalog/products/import', { csv }).expect(
      201,
    );
    expect(res.body.created).toBe(3);
    expect((res.body.failed as Row[]).map((f) => f.row)).toEqual([
      4, 5, 6, 7, 8,
    ]);
    const find = async (q: string) =>
      (await get(a.auth, `/catalog/products?q=${encodeURIComponent(q)}`)).body
        .data[0] as Record<string, any>;
    const beras = await find('Beras');
    expect(beras).toMatchObject({
      sku: 'BRS-5',
      sellingPrice: 68000,
      costPrice: 60000,
      unit: 'karung',
      type: 'product',
      stock: 10,
      category: { name: 'Sembako' },
    });
    // "sembako" in another row is the same category (ignoring case); no stock cell → sells without stock.
    const gula = await find('Gula');
    expect(gula).toMatchObject({
      sellingPrice: 16500,
      costPrice: 0,
      type: 'non_stock',
      category: { id: beras.category.id },
    });
    // Stock column with 0: tracked, nothing on hand. No category → "Lainnya".
    const es = await find('Es batu');
    expect(es).toMatchObject({
      type: 'product',
      stock: 0,
      category: { name: 'Lainnya' },
    });
    // The existing product was not touched.
    const kopi = await find('KOPI-1');
    expect(kopi).toMatchObject({ name: 'Kopi bubuk', sellingPrice: 10000 });
    // The same file again saves nothing twice: every name is taken now.
    const again = await post(a.auth, '/catalog/products/import', {
      csv,
    }).expect(201);
    expect(again.body.created).toBe(0);
    expect((await get(a.auth, '/catalog/products')).body.total).toBe(4);
  });

  it('refuses a file it cannot read with 422 CSV_INVALID, and bad bodies with 422', async () => {
    const bad = async (body: object) =>
      (await post(a.auth, '/catalog/products/import/preview', body).expect(422))
        .body as { code?: string; message: string };
    expect(await bad({ csv: 'Produk;Modal\nKopi;1' })).toMatchObject({
      code: 'CSV_INVALID',
      message: expect.stringContaining('Kolom "Nama" dan "Harga jual"'),
    });
    expect((await bad({ csv: 'Nama,Harga\n' })).code).toBe('CSV_INVALID');
    const big = [
      'Nama,Harga',
      ...Array.from({ length: 501 }, (_, i) => `P${i},1000`),
    ].join('\n');
    expect((await bad({ csv: big })).message).toContain('Maksimal 500');
    await bad({});
    await bad({ csv: '' });
    await bad({ csv: 'Nama,Harga\nA,1', extra: 1 });
    await bad({ csv: 'x'.repeat(400_001) });
  });

  it('is for actors who may manage the catalog; each store sees only its own products', async () => {
    const cashier = await createCashier(app, a, ['sales.create']);
    await post(cashier.auth, '/catalog/products/import/preview', {
      csv,
    }).expect(403);
    await post(cashier.auth, '/catalog/products/import', { csv }).expect(403);
    // Store B: A's SKU, barcode and names are free here.
    const res = await post(b.auth, '/catalog/products/import/preview', {
      csv: 'Nama,Harga,SKU,Barcode\nKopi bubuk,1000,KOPI-1,899001',
    }).expect(200);
    expect(res.body.rows[0]).toMatchObject({ status: 'ok', errors: [] });
  });
});
