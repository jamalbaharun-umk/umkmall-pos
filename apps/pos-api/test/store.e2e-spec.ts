import { INestApplication } from '@nestjs/common';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b50000000049454e44ae426082',
  'hex',
);
const profile = {
  name: 'Toko Sari',
  businessType: 'retail',
  address: 'Jl. Melati 1, Bandung',
};

describe('store profile (settings)', () => {
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

  async function refused(
    req: request.Test,
    status: number,
    field: string,
    message: string,
  ) {
    const res = await req.expect(status);
    expect(res.body.errors?.[field]).toBe(message);
  }
  const put = (body: unknown, store = a) =>
    http()
      .put('/store/profile')
      .set('Authorization', store.auth)
      .send(body as object);

  it('starts empty, then saves and updates (upsert); /tenant/me carries the name', async () => {
    const empty = await http()
      .get('/store/profile')
      .set('Authorization', a.auth)
      .expect(200);
    expect(empty.body).toMatchObject({ name: null, hasLogo: false });
    await put(profile).expect(200);
    const res = await put({
      ...profile,
      name: 'Toko Sari Jaya',
      businessType: 'other',
      otherBusinessType: 'Kelontong',
    }).expect(200);
    expect(res.body).toMatchObject({
      name: 'Toko Sari Jaya',
      businessType: 'other',
      otherBusinessType: 'Kelontong',
    });
    const me = await http()
      .get('/tenant/me')
      .set('Authorization', a.auth)
      .expect(200);
    expect(me.body.tenant.name).toBe('Toko Sari Jaya');
  });

  it('refuses missing and invalid fields with their messages', async () => {
    await refused(put({}), 422, 'name', 'Nama toko wajib diisi');
    await refused(put({}), 422, 'address', 'Alamat toko wajib diisi');
    await refused(
      put({ ...profile, businessType: undefined }),
      422,
      'businessType',
      'Pilih jenis usaha',
    );
    await refused(
      put({ ...profile, businessType: 'bank' }),
      422,
      'businessType',
      'Pilihan tidak valid',
    );
    await refused(
      put({ ...profile, businessType: 'other' }),
      422,
      'otherBusinessType',
      'Jenis usaha lainnya wajib diisi',
    );
    await refused(
      put({ ...profile, name: 'x'.repeat(121) }),
      422,
      'name',
      'Maksimal 120 karakter',
    );
  });

  it('logo: needs a saved profile, refuses non-images, serves and deletes', async () => {
    const fresh = await createStore();
    await refused(
      http()
        .post('/store/profile/logo')
        .set('Authorization', fresh.auth)
        .attach('file', PNG, 'logo.png'),
      409,
      'file',
      'Simpan profil toko dulu sebelum mengunggah logo',
    );
    await put(profile).expect(200);
    await refused(
      http()
        .post('/store/profile/logo')
        .set('Authorization', a.auth)
        .attach('file', Buffer.from('hello'), 'x.txt'),
      422,
      'file',
      'Logo harus JPG, PNG atau WebP, maksimal 2 MB',
    );
    const up = await http()
      .post('/store/profile/logo')
      .set('Authorization', a.auth)
      .attach('file', PNG, 'logo.png')
      .expect(201);
    expect(up.body.hasLogo).toBe(true);
    const got = await http()
      .get('/store/profile/logo')
      .set('Authorization', a.auth)
      .expect(200);
    expect(got.headers['content-type']).toBe('image/png');
    // another store never sees it
    await http()
      .get('/store/profile/logo')
      .set('Authorization', b.auth)
      .expect(404);
    const other = await http()
      .get('/store/profile')
      .set('Authorization', b.auth)
      .expect(200);
    expect(other.body.name).toBeNull();
    await http()
      .delete('/store/profile/logo')
      .set('Authorization', a.auth)
      .expect(204);
    await http()
      .get('/store/profile/logo')
      .set('Authorization', a.auth)
      .expect(404);
  });

  it('qris: needs a saved profile, refuses non-images, uploads, replaces (old file deleted), serves and deletes', async () => {
    const fresh = await createStore();
    expect(
      (await http().get('/store/profile').set('Authorization', fresh.auth)).body
        .qrisConfigured,
    ).toBe(false);
    await refused(
      http()
        .post('/store/profile/qris')
        .set('Authorization', fresh.auth)
        .attach('file', PNG, 'qris.png'),
      409,
      'file',
      'Simpan profil toko dulu sebelum mengunggah kode QRIS',
    );
    await put(profile).expect(200);
    await http()
      .get('/store/profile/qris')
      .set('Authorization', a.auth)
      .expect(404);
    await http()
      .delete('/store/profile/qris')
      .set('Authorization', a.auth)
      .expect(404);
    for (const bad of [
      Buffer.from('hello'),
      Buffer.alloc(2 * 1024 * 1024 + 1, 1),
    ]) {
      await refused(
        http()
          .post('/store/profile/qris')
          .set('Authorization', a.auth)
          .attach('file', bad, 'x.png'),
        422,
        'file',
        'Kode QRIS harus JPG, PNG atau WebP, maksimal 2 MB',
      );
    }
    await http()
      .post('/store/profile/qris')
      .set('Authorization', a.auth)
      .expect(422);
    const up = await http()
      .post('/store/profile/qris')
      .set('Authorization', a.auth)
      .attach('file', PNG, 'qris.png')
      .expect(201);
    expect(up.body.qrisConfigured).toBe(true);
    expect(up.body.hasLogo).toBe(false); // the logo is untouched
    const dir = path.join(
      process.env.POS_STORAGE_DIR!,
      'tenants',
      a.tenantId,
      'store',
    );
    const first = readdirSync(dir).filter((f) => f.startsWith('qris-'));
    expect(first).toHaveLength(1);
    const got = await http()
      .get('/store/profile/qris')
      .set('Authorization', a.auth)
      .expect(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0);
    // replace: one file left, a different one
    await http()
      .post('/store/profile/qris')
      .set('Authorization', a.auth)
      .attach('file', PNG, 'again.png')
      .expect(201);
    const second = readdirSync(dir).filter((f) => f.startsWith('qris-'));
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
    // cross-tenant: B sees nothing of A's QRIS, read, delete and upload leave A's alone
    expect(
      (await http().get('/store/profile').set('Authorization', b.auth)).body
        .qrisConfigured,
    ).toBe(false);
    await http()
      .get('/store/profile/qris')
      .set('Authorization', b.auth)
      .expect(404);
    await http()
      .delete('/store/profile/qris')
      .set('Authorization', b.auth)
      .expect(404);
    await put(profile, b).expect(200);
    await http()
      .post('/store/profile/qris')
      .set('Authorization', b.auth)
      .attach('file', PNG, 'b.png')
      .expect(201);
    await http()
      .delete('/store/profile/qris')
      .set('Authorization', b.auth)
      .expect(204);
    await http()
      .get('/store/profile/qris')
      .set('Authorization', a.auth)
      .expect(200);
    // delete
    await http()
      .delete('/store/profile/qris')
      .set('Authorization', a.auth)
      .expect(204);
    await http()
      .get('/store/profile/qris')
      .set('Authorization', a.auth)
      .expect(404);
    expect(readdirSync(dir).filter((f) => f.startsWith('qris-'))).toHaveLength(
      0,
    );
    expect(
      (await http().get('/store/profile').set('Authorization', a.auth)).body
        .qrisConfigured,
    ).toBe(false);
  });

  it('qris: a cashier with sales.create reads it, only catalog.manage changes it', async () => {
    await put(profile).expect(200);
    await http()
      .post('/store/profile/qris')
      .set('Authorization', a.auth)
      .attach('file', PNG, 'q.png')
      .expect(201);
    const cashier = await createCashier(app, a, ['sales.create']);
    expect(
      (await http().get('/store/profile').set('Authorization', cashier.auth))
        .body.qrisConfigured,
    ).toBe(true);
    await http()
      .get('/store/profile/qris')
      .set('Authorization', cashier.auth)
      .expect(200);
    await http()
      .post('/store/profile/qris')
      .set('Authorization', cashier.auth)
      .attach('file', PNG, 'q.png')
      .expect(403);
    await http()
      .delete('/store/profile/qris')
      .set('Authorization', cashier.auth)
      .expect(403);
    await http()
      .delete('/store/profile/qris')
      .set('Authorization', a.auth)
      .expect(204);
  });

  it('a cashier reads the profile but cannot change it without catalog.manage', async () => {
    const cashier = await createCashier(app, a, ['sales.create']);
    await http()
      .get('/store/profile')
      .set('Authorization', cashier.auth)
      .expect(200);
    await put(profile, { ...a, auth: cashier.auth }).expect(403);
    await http()
      .delete('/store/profile/logo')
      .set('Authorization', cashier.auth)
      .expect(403);
    const manager = await createCashier(app, a, ['catalog.manage']);
    await put(profile, { ...a, auth: manager.auth }).expect(200);
  });

  it("store B's save never touches store A", async () => {
    await put(profile).expect(200);
    await put({ ...profile, name: 'Toko B' }, b).expect(200);
    const mine = await http()
      .get('/store/profile')
      .set('Authorization', a.auth)
      .expect(200);
    expect(mine.body.name).toBe('Toko Sari');
  });
});
