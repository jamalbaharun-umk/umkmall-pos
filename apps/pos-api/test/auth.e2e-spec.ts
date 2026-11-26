import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { createApp } from './support/fixtures';
import { ADMIN_DATABASE_URL } from './support/env';

// The dev sign-in (local work without UMKMall). The owner's WhatsApp sign-in is test/otp-sign-in.e2e-spec.ts.
describe('dev sign-in', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  async function umkmallUser(): Promise<string> {
    const [u] = await admin<
      { id: string }[]
    >`insert into public.users default values returning id`;
    return u.id;
  }
  const http = () => request(app.getHttpServer());
  const devSignIn = (userId: string) =>
    http().post('/auth/dev/sign-in').send({ userId });

  it('signs in an existing UMKMall user outside production', async () => {
    const userId = await umkmallUser();
    const res = await devSignIn(userId).expect(200);
    expect(res.body.tenant.id).toEqual(expect.any(String));
    await devSignIn(randomUUID()).expect(422);
  });

  it('is a sign-in: fresh for the owner PIN reset (UMK-2054)', async () => {
    const sub = await umkmallUser();
    const res = await devSignIn(sub).expect(200);
    const auth = `Bearer ${res.body.sessionToken as string}`;
    await http()
      .put('/void-pin')
      .set('Authorization', auth)
      .send({ pin: '482913' })
      .expect(200);
    await http()
      .delete(`/void-pin/${sub}`)
      .set('Authorization', auth)
      .expect(200);
  });

  it('is refused in production', async () => {
    const userId = await umkmallUser();
    process.env.NODE_ENV = 'production';
    try {
      await devSignIn(userId).expect(404);
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('the shared-cookie owner sign-in is gone (UMK-2065)', async () => {
    await http()
      .post('/auth/umkmall/session')
      .set('Cookie', 'auth_token=at')
      .expect(404);
  });
});
