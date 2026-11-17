import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

/** Status AND Indonesian field message for every refusal of the catalog, staff, roles and the error filter. */
describe('validation: catalog, staff, roles, error filter', () => {
  let app: INestApplication;
  let a: Store;
  const http = () => request(app.getHttpServer());
  const post = (path: string, body: unknown, store = a) =>
    http()
      .post(path)
      .set('Authorization', store.auth)
      .send(body as object);

  async function refused(
    req: request.Test,
    status: number,
    field: string,
    message: string,
  ) {
    const res = await req.expect(status);
    expect(res.body.errors?.[field]).toBe(message);
    expect(typeof res.body.message).toBe('string');
    expect(res.body).not.toHaveProperty('statusCode');
  }

  beforeAll(async () => {
    app = await createApp();
    a = await createStore();
  });
  afterAll(async () => {
    await app.close();
  });

  async function category(name = `Kat ${Math.random()}`) {
    return (await post('/catalog/categories', { name }).expect(201)).body as {
      id: string;
    };
  }

  describe('categories', () => {
    it('name missing, blank or too long → 422; duplicate → 409 on name', async () => {
      await refused(
        post('/catalog/categories', {}),
        422,
        'name',
        'Nama kategori wajib diisi',
      );
      await refused(
        post('/catalog/categories', { name: '  ' }),
        422,
        'name',
        'Nama kategori wajib diisi',
      );
      await refused(
        post('/catalog/categories', { name: 'x'.repeat(121) }),
        422,
        'name',
        'Maksimal 120 karakter',
      );
      await category('Minuman');
      await refused(
        post('/catalog/categories', { name: 'Minuman' }),
        409,
        'name',
        'Nama kategori sudah dipakai',
      );
    });
  });

  describe('products', () => {
    it('required fields, types and ranges answer 422 with the field message', async () => {
      const cat = await category();
      const base = { categoryId: cat.id, name: 'Es Teh', sellingPrice: 5000 };
      const product = (body: Record<string, unknown>) =>
        post('/catalog/products', body);
      await refused(
        product({ ...base, name: undefined }),
        422,
        'name',
        'Nama produk wajib diisi',
      );
      await refused(
        product({ ...base, categoryId: undefined }),
        422,
        'categoryId',
        'Pilih kategori',
      );
      await refused(
        product({ ...base, sellingPrice: undefined }),
        422,
        'sellingPrice',
        'Harga jual wajib diisi',
      );
      await refused(
        product({ ...base, sellingPrice: 0 }),
        422,
        'sellingPrice',
        'Harga jual harus lebih dari 0',
      );
      await refused(
        product({ ...base, sellingPrice: '5000' }),
        422,
        'sellingPrice',
        'Harga jual harus berupa angka',
      );
      await refused(
        product({ ...base, sellingPrice: 10.5 }),
        422,
        'sellingPrice',
        'Harga jual harus bilangan bulat rupiah',
      );
      await refused(
        product({ ...base, costPrice: -1 }),
        422,
        'costPrice',
        'Tidak boleh negatif',
      );
      await refused(
        product({ ...base, costPrice: 6000 }),
        422,
        'costPrice',
        'Harga modal tidak boleh melebihi harga jual',
      );
      await refused(
        product({ ...base, sku: 'A B C' }),
        422,
        'sku',
        'SKU tidak boleh berisi spasi',
      );
      await refused(
        product({ ...base, barcodes: ['12'] }),
        422,
        'barcodes.0',
        'Barcode minimal 3 karakter',
      );
      await refused(
        product({ ...base, barcodes: ['899', '899'] }),
        422,
        'barcodes',
        'Barcode tidak boleh ganda',
      );
      await refused(
        product({
          ...base,
          categoryId: '00000000-0000-4000-8000-000000000000',
        }),
        422,
        'categoryId',
        'Kategori tidak ditemukan',
      );
    });

    it('duplicate SKU or barcode → 409 on the field', async () => {
      const cat = await category();
      const body = { categoryId: cat.id, name: 'Kopi', sellingPrice: 8000 };
      await post('/catalog/products', {
        ...body,
        sku: 'KOPI-1',
        barcodes: ['8990001'],
      }).expect(201);
      await refused(
        post('/catalog/products', { ...body, sku: 'KOPI-1' }),
        409,
        'sku',
        'SKU sudah dipakai produk lain',
      );
      await refused(
        post('/catalog/products', { ...body, barcodes: ['8990001'] }),
        409,
        'barcodes',
        'Barcode sudah dipakai produk lain',
      );
    });

    it('hides the cost price from a cashier without catalog, report or purchasing rights', async () => {
      const cat = await category();
      const made = await post('/catalog/products', {
        categoryId: cat.id,
        name: 'Teh Botol',
        costPrice: 3000,
        sellingPrice: 5000,
      }).expect(201);
      const cashier = await createCashier(app, a, ['sales.create']);
      const one = await http()
        .get(`/catalog/products/${made.body.id}`)
        .set('Authorization', cashier.auth)
        .expect(200);
      expect(one.body).not.toHaveProperty('costPrice');
      expect(one.body.sellingPrice).toBe(5000);
      const list = await http()
        .get('/catalog/products')
        .set('Authorization', cashier.auth)
        .expect(200);
      expect(
        (list.body as { data: object[] }).data.every(
          (p) => !('costPrice' in p),
        ),
      ).toBe(true);
      const owner = await http()
        .get(`/catalog/products/${made.body.id}`)
        .set('Authorization', a.auth)
        .expect(200);
      expect(owner.body.costPrice).toBe(3000);
      const buyer = await createCashier(app, a, ['purchasing.manage']);
      const seen = await http()
        .get(`/catalog/products/${made.body.id}`)
        .set('Authorization', buyer.auth)
        .expect(200);
      expect(seen.body.costPrice).toBe(3000);
    });

    it('an image over 2 MB is a 422 on file', async () => {
      const cat = await category();
      const made = await post('/catalog/products', {
        categoryId: cat.id,
        name: 'Besar',
        sellingPrice: 1000,
      }).expect(201);
      await refused(
        http()
          .post(`/catalog/products/${made.body.id}/images`)
          .set('Authorization', a.auth)
          .attach('file', Buffer.alloc(2 * 1024 * 1024 + 10), 'big.png'),
        422,
        'file',
        'Ukuran gambar maksimal 2 MB',
      );
    });
  });

  describe('staff and roles', () => {
    it('staff name and PIN refusals; duplicate name → 409', async () => {
      await refused(
        post('/staff', { pin: '1234' }),
        422,
        'name',
        'Nama wajib diisi',
      );
      await refused(
        post('/staff', { name: 'Budi' }),
        422,
        'pin',
        'PIN wajib diisi',
      );
      await refused(
        post('/staff', { name: 'Budi', pin: '12a' }),
        422,
        'pin',
        'PIN harus 4 sampai 8 angka',
      );
      await refused(
        post('/staff', {
          name: 'Budi',
          pin: '1234',
          roleIds: ['00000000-0000-4000-8000-000000000000'],
        }),
        422,
        'roleIds',
        'Peran tidak ditemukan',
      );
      const budi = await post('/staff', { name: 'Budi', pin: '1234' }).expect(
        201,
      );
      await refused(
        post('/staff', { name: 'budi', pin: '5678' }),
        409,
        'name',
        'Nama staf sudah dipakai',
      );
      const other = await post('/staff', { name: 'Ani', pin: '5678' }).expect(
        201,
      );
      await refused(
        http()
          .patch(`/staff/${other.body.id}`)
          .set('Authorization', a.auth)
          .send({ name: 'Budi' }),
        409,
        'name',
        'Nama staf sudah dipakai',
      );
      // Renaming to its own name is not a duplicate; another store may use the name.
      await http()
        .patch(`/staff/${budi.body.id}`)
        .set('Authorization', a.auth)
        .send({ name: 'Budi' })
        .expect(200);
      const b = await createStore();
      await post('/staff', { name: 'Budi', pin: '1234' }, b).expect(201);
    });

    it('role and device names are required', async () => {
      await refused(
        post('/roles', { permissions: [] }),
        422,
        'name',
        'Nama peran wajib diisi',
      );
      await refused(
        post('/roles', { name: ' ' }),
        422,
        'name',
        'Nama peran wajib diisi',
      );
      await refused(
        post('/staff/devices', {}),
        422,
        'name',
        'Nama perangkat wajib diisi',
      );
    });

    it('role name duplicate → 409 on name', async () => {
      await post('/roles', { name: 'Gudang', permissions: [] }).expect(201);
      await refused(
        post('/roles', { name: 'Gudang', permissions: [] }),
        409,
        'name',
        'Nama peran sudah dipakai',
      );
    });
  });

  describe('error filter', () => {
    it('a body that is not JSON → 400 in Indonesian', async () => {
      const res = await http()
        .post('/catalog/categories')
        .set('Authorization', a.auth)
        .set('Content-Type', 'application/json')
        .send('{"name":')
        .expect(400);
      expect(res.body).toEqual({ message: 'Format data tidak valid' });
    });

    it("Nest's English defaults become Indonesian", async () => {
      expect((await http().get('/tenant/me').expect(401)).body).toEqual({
        message: 'Sesi berakhir, silakan masuk lagi',
      });
      expect(
        (
          await http()
            .get('/tidak-ada')
            .set('Authorization', a.auth)
            .expect(404)
        ).body,
      ).toEqual({
        message: 'Data tidak ditemukan',
      });
      const cashier = await createCashier(app, a, ['sales.create']);
      expect(
        (
          await post(
            '/catalog/categories',
            { name: 'X' },
            { ...a, auth: cashier.auth },
          ).expect(403)
        ).body,
      ).toEqual({ message: 'Kamu tidak punya izin untuk ini' });
    });

    it('a device header with a non-UUID id is refused, not a 500', async () => {
      await http()
        .get('/auth/device/staff')
        .set('X-Pos-Device', `${'g'.repeat(36)}.${'a'.repeat(43)}`)
        .expect(401);
    });
  });
});
