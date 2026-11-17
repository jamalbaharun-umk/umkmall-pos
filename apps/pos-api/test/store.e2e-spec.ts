import { INestApplication } from '@nestjs/common';
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
