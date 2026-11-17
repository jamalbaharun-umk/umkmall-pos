import { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import request from 'supertest';
import { signSession } from '../src/tenancy/session';
import { createApp, createStore } from './support/fixtures';
import { ADMIN_DATABASE_URL } from './support/env';

type Store = Awaited<ReturnType<typeof createStore>>;
type Page = { data: { id: string; name: string }[]; total: number };
const ids = (body: unknown) => (body as Page).data.map((r) => r.id);

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b50000000049454e44ae426082',
  'hex',
);

describe('catalog (U2)', () => {
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

  async function category(store: Store, name = `Minuman ${Math.random()}`) {
    const res = await http()
      .post('/catalog/categories')
      .set('Authorization', store.auth)
      .send({ name })
      .expect(201);
    return res.body as { id: string; name: string };
  }

  async function product(store: Store, extra: Record<string, unknown> = {}) {
    const cat = await category(store);
    const res = await http()
      .post('/catalog/products')
      .set('Authorization', store.auth)
      .send({
        categoryId: cat.id,
        name: 'Es Teh Manis',
        costPrice: 2000,
        sellingPrice: 5000,
        ...extra,
      })
      .expect(201);
    return res.body as {
      id: string;
      sku: string;
      categoryId: string;
      barcodes: string[];
    };
  }

  describe('slice check', () => {
    it('Es Teh Manis in store A is invisible to store B', async () => {
      const s1 = await createStore();
      const s2 = await createStore();
      const p = await product(s1, { name: 'Es Teh Manis' });

      const listA = await http()
        .get('/catalog/products')
        .set('Authorization', s1.auth)
        .expect(200);
      expect((listA.body as Page).data.map((r) => r.name)).toEqual([
        'Es Teh Manis',
      ]);

      const listB = await http()
        .get('/catalog/products')
        .set('Authorization', s2.auth)
        .expect(200);
      expect(listB.body).toMatchObject({ data: [], total: 0 });
      await http()
        .get(`/catalog/products/${p.id}`)
        .set('Authorization', s2.auth)
        .expect(404);
    });
  });

  describe('categories', () => {
    it('creates, lists, renames and deletes', async () => {
      const store = await createStore();
      const c = await category(store, 'Makanan');
      const list = await http()
        .get('/catalog/categories')
        .set('Authorization', store.auth)
        .expect(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({ id: c.id, name: 'Makanan' }),
      ]);
      const renamed = await http()
        .patch(`/catalog/categories/${c.id}`)
        .set('Authorization', store.auth)
        .send({ name: 'Makanan Berat' })
        .expect(200);
      expect(renamed.body.name).toBe('Makanan Berat');
      await http()
        .delete(`/catalog/categories/${c.id}`)
        .set('Authorization', store.auth)
        .expect(204);
      const after = await http()
        .get('/catalog/categories')
        .set('Authorization', store.auth);
      expect(after.body.data).toEqual([]);
    });

    it('refuses a duplicate name in the same store with 409, allows it in another', async () => {
      await category(a, 'Snack');
      await http()
        .post('/catalog/categories')
        .set('Authorization', a.auth)
        .send({ name: 'Snack' })
        .expect(409);
      await category(b, 'Snack');
    });

    it('refuses deleting a category that has products with 409', async () => {
      const p = await product(a);
      await http()
        .delete(`/catalog/categories/${p.categoryId}`)
        .set('Authorization', a.auth)
        .expect(409);
    });

    it('answers 422 on a bad body', async () => {
      for (const body of [
        {},
        { name: '' },
        { name: 5 },
        { name: 'x', extra: 1 },
      ])
        await http()
          .post('/catalog/categories')
          .set('Authorization', a.auth)
          .send(body)
          .expect(422);
    });
  });

  describe('products', () => {
    it('creates, reads, updates and soft-deletes', async () => {
      const p = await product(a, {
        name: 'Kopi Susu',
        unit: 'GELAS',
        type: 'non_stock',
        barcodes: ['899000111'],
      });
      const got = await http()
        .get(`/catalog/products/${p.id}`)
        .set('Authorization', a.auth)
        .expect(200);
      expect(got.body).toMatchObject({
        name: 'Kopi Susu',
        unit: 'GELAS',
        type: 'non_stock',
        costPrice: 2000,
        sellingPrice: 5000,
        isActive: true,
        barcodes: ['899000111'],
        images: [],
      });
      expect(got.body.category.id).toBe(p.categoryId);

      const upd = await http()
        .patch(`/catalog/products/${p.id}`)
        .set('Authorization', a.auth)
        .send({ sellingPrice: 6000, isActive: false, barcodes: ['899000222'] })
        .expect(200);
      expect(upd.body).toMatchObject({
        sellingPrice: 6000,
        isActive: false,
        barcodes: ['899000222'],
      });

      await http()
        .delete(`/catalog/products/${p.id}`)
        .set('Authorization', a.auth)
        .expect(204);
      await http()
        .get(`/catalog/products/${p.id}`)
        .set('Authorization', a.auth)
        .expect(404);
      // Its barcode is free again.
      await product(a, { barcodes: ['899000222'] });
    });

    it('searches by name, SKU and barcode, filters by category, paginates', async () => {
      const store = await createStore();
      const cat = await category(store, 'Minuman');
      const other = await category(store, 'Makanan');
      const make = (name: string, categoryId: string, extra = {}) =>
        http()
          .post('/catalog/products')
          .set('Authorization', store.auth)
          .send({ categoryId, name, sellingPrice: 1000, ...extra })
          .expect(201);
      await make('Es Jeruk', cat.id, { sku: 'JRK-1' });
      await make('Es Teh', cat.id, { barcodes: ['12345678'] });
      await make('Nasi Goreng', other.id);
      const list = (query: Record<string, string | number>) =>
        http()
          .get('/catalog/products')
          .query(query)
          .set('Authorization', store.auth)
          .expect(200)
          .then((r) => r.body as Page & { page: number; perPage: number });
      const names = (body: { data: { name: string }[] }) =>
        body.data.map((p) => p.name).sort();

      expect(names(await list({ q: 'es' }))).toEqual(['Es Jeruk', 'Es Teh']);
      expect(names(await list({ q: 'jrk-1' }))).toEqual(['Es Jeruk']);
      expect(names(await list({ q: '345' }))).toEqual(['Es Teh']);
      expect(names(await list({ q: '%' }))).toEqual([]);
      expect(names(await list({ categoryId: other.id }))).toEqual([
        'Nasi Goreng',
      ]);
      const page = await list({ perPage: 2, page: 2 });
      expect(page).toMatchObject({ page: 2, perPage: 2, total: 3 });
      expect(page.data).toHaveLength(1);
      await http()
        .get('/catalog/products')
        .query({ perPage: 1000 })
        .set('Authorization', store.auth)
        .expect(422);
    });

    it('generates a SKU without spaces when blank, unique per store', async () => {
      const store = await createStore();
      const cat = await category(store, 'Min uman');
      const skus: string[] = [];
      for (const sku of [undefined, '', undefined]) {
        const res = await http()
          .post('/catalog/products')
          .set('Authorization', store.auth)
          .send({ categoryId: cat.id, name: 'Es Teh', sellingPrice: 1000, sku })
          .expect(201);
        skus.push(res.body.sku);
      }
      for (const sku of skus)
        expect(sku).toMatch(/^[A-Z0-9]+-[A-Z0-9]+-\d{4}$/);
      expect(skus[0]).toBe('MIN-EST-0001');
      expect(new Set(skus).size).toBe(3);
    });

    it('skips a generated SKU the owner already took by hand', async () => {
      const store = await createStore();
      const cat = await category(store, 'Minuman');
      const send = (sku?: string) =>
        http().post('/catalog/products').set('Authorization', store.auth).send({
          categoryId: cat.id,
          name: 'Es Teh',
          sellingPrice: 1000,
          sku,
        });
      await send('MIN-EST-0002').expect(201);
      const res = await send().expect(201);
      expect(res.body.sku).toBe('MIN-EST-0003');
    });

    it('refuses a duplicate SKU or barcode in the same store with 409', async () => {
      const store = await createStore();
      await product(store, { sku: 'DUP-1', barcodes: ['BC-0001'] });
      const cat = await category(store);
      const base = { categoryId: cat.id, name: 'Lain', sellingPrice: 1000 };
      await http()
        .post('/catalog/products')
        .set('Authorization', store.auth)
        .send({ ...base, sku: 'DUP-1' })
        .expect(409);
      await http()
        .post('/catalog/products')
        .set('Authorization', store.auth)
        .send({ ...base, barcodes: ['BC-0001'] })
        .expect(409);
      // Another store may use the same codes.
      await product(b, { sku: 'DUP-1', barcodes: ['BC-0001'] });
    });

    it('refuses fractional, negative, string or inverted prices and spaced SKUs with 422', async () => {
      const cat = await category(a);
      const base = { categoryId: cat.id, name: 'Harga', sellingPrice: 5000 };
      for (const bad of [
        { sellingPrice: 1500.5 },
        { sellingPrice: -1 },
        { sellingPrice: '5000' },
        { costPrice: 0.1 },
        { costPrice: 6000 },
        { sku: 'MIN-ES -0001' },
        { barcodes: ['AB 12'] },
        { barcodes: ['ABC1', 'ABC1'] },
        { type: 'gift' },
        { categoryId: 'nope' },
      ])
        await http()
          .post('/catalog/products')
          .set('Authorization', a.auth)
          .send({ ...base, ...bad })
          .expect(422);
      const p = await product(a);
      await http()
        .patch(`/catalog/products/${p.id}`)
        .set('Authorization', a.auth)
        .send({ costPrice: 9000 })
        .expect(422);
      await http()
        .patch(`/catalog/products/${p.id}`)
        .set('Authorization', a.auth)
        .send({ sellingPrice: 99.9 })
        .expect(422);
    });

    it('lets a cashier read but not write the catalog', async () => {
      const cashier = await signSession(
        { tenantId: a.tenantId, actorId: 'staff-1', kind: 'cashier' },
        process.env.POS_SESSION_SECRET!,
      );
      const p = await product(a);
      await http()
        .get(`/catalog/products/${p.id}`)
        .set('Authorization', `Bearer ${cashier}`)
        .expect(200);
      await http()
        .patch(`/catalog/products/${p.id}`)
        .set('Authorization', `Bearer ${cashier}`)
        .send({ name: 'Murah' })
        .expect(403);
    });
  });

  describe('images', () => {
    it('stores under the tenant prefix and serves bytes only through the API', async () => {
      const p = await product(a);
      const up = await http()
        .post(`/catalog/products/${p.id}/images`)
        .set('Authorization', a.auth)
        .attach('file', PNG, { filename: 'x.html', contentType: 'text/html' })
        .expect(201);
      expect(up.body).toMatchObject({
        contentType: 'image/png',
        sizeBytes: PNG.length,
      });

      const got = await http()
        .get(`/catalog/products/${p.id}/images/${up.body.id}`)
        .set('Authorization', a.auth)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(got.headers['content-type']).toBe('image/png');
      expect(got.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0);

      const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
      try {
        const [row] = await admin<{ storage_key: string }[]>`
          select storage_key from pos.product_images where id = ${up.body.id}`;
        expect(
          row.storage_key.startsWith(`tenants/${a.tenantId}/products/${p.id}/`),
        ).toBe(true);
        const file = path.join(process.env.POS_STORAGE_DIR!, row.storage_key);
        expect(existsSync(file)).toBe(true);

        const detail = await http()
          .get(`/catalog/products/${p.id}`)
          .set('Authorization', a.auth);
        expect(detail.body.images).toEqual([
          { id: up.body.id, contentType: 'image/png', sizeBytes: PNG.length },
        ]);

        await http()
          .delete(`/catalog/products/${p.id}/images/${up.body.id}`)
          .set('Authorization', a.auth)
          .expect(204);
        expect(existsSync(file)).toBe(false);
      } finally {
        await admin.end();
      }
    });

    it('refuses a non-image or a missing file with 422', async () => {
      const p = await product(a);
      await http()
        .post(`/catalog/products/${p.id}/images`)
        .set('Authorization', a.auth)
        .attach('file', Buffer.from('<script>alert(1)</script>'), {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(422);
      await http()
        .post(`/catalog/products/${p.id}/images`)
        .set('Authorization', a.auth)
        .expect(422);
    });
  });

  describe('cross-tenant: store B never reaches store A', () => {
    let pA: { id: string; categoryId: string };
    let imageA: string;

    beforeAll(async () => {
      pA = await product(a, { barcodes: [`X-${Date.now()}`] });
      const up = await http()
        .post(`/catalog/products/${pA.id}/images`)
        .set('Authorization', a.auth)
        .attach('file', PNG, 'p.png')
        .expect(201);
      imageA = up.body.id;
    });

    it('excludes A from B lists', async () => {
      const cats = await http()
        .get('/catalog/categories')
        .set('Authorization', b.auth);
      expect(ids(cats.body)).not.toContain(pA.categoryId);
      const prods = await http()
        .get('/catalog/products')
        .set('Authorization', b.auth);
      expect(ids(prods.body)).not.toContain(pA.id);
      const filtered = await http()
        .get('/catalog/products')
        .query({ categoryId: pA.categoryId })
        .set('Authorization', b.auth);
      expect(filtered.body).toMatchObject({ data: [], total: 0 });
    });

    it('answers 404 to B on every route that names an A id', async () => {
      const cases: [string, string, object?][] = [
        ['patch', `/catalog/categories/${pA.categoryId}`, { name: 'Curian' }],
        ['delete', `/catalog/categories/${pA.categoryId}`],
        ['get', `/catalog/products/${pA.id}`],
        ['patch', `/catalog/products/${pA.id}`, { name: 'Curian' }],
        ['delete', `/catalog/products/${pA.id}`],
        ['get', `/catalog/products/${pA.id}/images/${imageA}`],
        ['delete', `/catalog/products/${pA.id}/images/${imageA}`],
      ];
      for (const [method, url, body] of cases) {
        const req = (
          http() as unknown as Record<string, (u: string) => request.Test>
        )
          [method](url)
          .set('Authorization', b.auth);
        const res = await (body ? req.send(body) : req);
        expect(`${method} ${url} ${res.status}`).toBe(`${method} ${url} 404`);
      }
      await http()
        .post(`/catalog/products/${pA.id}/images`)
        .set('Authorization', b.auth)
        .attach('file', PNG, 'p.png')
        .expect(404);
    });

    it('answers 404 to B on A image id under a B product', async () => {
      const pB = await product(b);
      await http()
        .get(`/catalog/products/${pB.id}/images/${imageA}`)
        .set('Authorization', b.auth)
        .expect(404);
    });

    it('refuses B attaching A category to its product with 422', async () => {
      await http()
        .post('/catalog/products')
        .set('Authorization', b.auth)
        .send({ categoryId: pA.categoryId, name: 'Curian', sellingPrice: 1 })
        .expect(422);
      const pB = await product(b);
      await http()
        .patch(`/catalog/products/${pB.id}`)
        .set('Authorization', b.auth)
        .send({ categoryId: pA.categoryId })
        .expect(422);
    });

    it('left A untouched', async () => {
      const got = await http()
        .get(`/catalog/products/${pA.id}`)
        .set('Authorization', a.auth)
        .expect(200);
      expect(got.body.name).toBe('Es Teh Manis');
      expect(got.body.images).toHaveLength(1);
    });
  });
});
