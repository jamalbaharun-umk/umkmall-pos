import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createServer, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import postgres from 'postgres';
import request from 'supertest';
import { createApp } from './support/fixtures';
import { ADMIN_DATABASE_URL } from './support/env';

// A fake UMKMall `GET /api/auth/me` (UMK-1945). `answer` decides each reply; every call's Cookie header is kept.
type Answer = (res: ServerResponse) => void;
const stub = {
  answer: (() => undefined) as Answer,
  cookies: [] as (string | undefined)[],
};
const signedIn =
  (userId: string, setCookies: string[] = []): Answer =>
  (res) => {
    if (setCookies.length) res.setHeader('set-cookie', setCookies);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, user: { id: userId, name: 'x' } }));
  };
const status =
  (code: number, setCookies: string[] = []): Answer =>
  (res) => {
    if (setCookies.length) res.setHeader('set-cookie', setCookies);
    res.statusCode = code;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: false, user: null }));
  };

describe('owner sign-in from the shared UMKMall cookie', () => {
  let app: INestApplication;
  let umkmall: Server;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });

  beforeAll(async () => {
    umkmall = createServer((req, res) => {
      if (req.url === '/api/auth/me' && req.method === 'GET') {
        stub.cookies.push(req.headers.cookie);
        return stub.answer(res);
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => umkmall.listen(0, '127.0.0.1', r));
    process.env.UMKMALL_WEB_URL = `http://127.0.0.1:${(umkmall.address() as AddressInfo).port}/`;
    app = await createApp();
  });

  beforeEach(() => {
    stub.cookies = [];
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
    await new Promise((r) => umkmall.close(r));
  });

  async function umkmallUser(): Promise<string> {
    const [u] = await admin<
      { id: string }[]
    >`insert into public.users default values returning id`;
    return u.id;
  }

  const AUTH = 'auth_token=at; auth_refresh=sid.secret';
  const session = (cookie?: string) => {
    const req = request(app.getHttpServer()).post('/auth/umkmall/session');
    return cookie === undefined ? req : req.set('Cookie', cookie);
  };

  it('opens an owner session for the UMKMall user and creates the store once', async () => {
    const sub = await umkmallUser();
    stub.answer = signedIn(sub);
    const first = await session(AUTH).expect(200);
    expect(first.body).toMatchObject({
      expiresIn: 900,
      tenant: { id: expect.any(String) },
    });
    const me = await request(app.getHttpServer())
      .get('/tenant/me')
      .set('Authorization', `Bearer ${first.body.sessionToken}`)
      .expect(200);
    expect(me.body.tenant.id).toBe(first.body.tenant.id);
    expect(me.body.actor).toMatchObject({ id: sub, kind: 'owner', name: null });

    // the owner refresh is the same call: same store, no second row
    const second = await session(AUTH).expect(200);
    expect(second.body.tenant.id).toBe(first.body.tenant.id);
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from pos.tenants where user_id = ${sub}`;
    expect(n).toBe(1);
  });

  it('forwards only the two UMKMall auth cookies', async () => {
    stub.answer = signedIn(await umkmallUser());
    await session(
      'pos_session=pos-secret; auth_token=at; _ga=x; auth_refresh=sid.secret; pos_device=d; auth_token_x=no',
    ).expect(200);
    expect(stub.cookies).toEqual(['auth_token=at; auth_refresh=sid.secret']);
  });

  it('answers 401 without calling UMKMall when neither auth cookie is there', async () => {
    await session().expect(401);
    await session('pos_session=x; _ga=y').expect(401);
    expect(stub.cookies).toEqual([]);
  });

  it('relays every Set-Cookie from /auth/me unchanged', async () => {
    const minted = [
      'auth_token=new; Path=/; Domain=.umkmall.id; HttpOnly; Secure; SameSite=Lax; Max-Age=900',
      'auth_refresh=sid.minted; Path=/; Domain=.umkmall.id; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000',
    ];
    stub.answer = signedIn(await umkmallUser(), minted);
    const res = await session(AUTH).expect(200);
    expect(res.headers['set-cookie']).toEqual(minted);
  });

  it('answers 401 when UMKMall refuses the cookie, still relaying its Set-Cookie', async () => {
    const cleared = ['auth_token=; Path=/; Max-Age=0'];
    stub.answer = status(401, cleared);
    const res = await session(AUTH).expect(401);
    expect(res.body.sessionToken).toBeUndefined();
    expect(res.headers['set-cookie']).toEqual(cleared);
  });

  it('answers 401 for a 200 that names no user', async () => {
    stub.answer = (res) =>
      res.end(JSON.stringify({ success: false, user: null }));
    await session(AUTH).expect(401);
  });

  it('refuses an account with no users row here with 401, not a 500', async () => {
    stub.answer = signedIn(randomUUID());
    const res = await session(AUTH).expect(401);
    expect(res.body).toEqual({ message: 'Akun UMKMall tidak ditemukan' });
  });

  it.each<[string, Answer]>([
    ['a 5xx', status(502)],
    ['a 429', status(429)],
    ['a dropped connection', (res) => res.socket?.destroy()],
  ])('answers 503, never a session, on %s', async (_, answer) => {
    stub.answer = answer;
    const res = await session(AUTH).expect(503);
    expect(res.body.sessionToken).toBeUndefined();
  });

  it('answers 503 when /auth/me does not answer within 5 s', async () => {
    stub.answer = () => undefined; // never replies
    const started = Date.now();
    await session(AUTH).expect(503);
    expect(Date.now() - started).toBeLessThan(7_000);
  }, 10_000);

  describe('dev sign-in', () => {
    const devSignIn = (userId: string) =>
      request(app.getHttpServer()).post('/auth/dev/sign-in').send({ userId });

    it('signs in an existing UMKMall user outside production', async () => {
      const userId = await umkmallUser();
      const res = await devSignIn(userId).expect(200);
      expect(res.body.tenant.id).toEqual(expect.any(String));
      await devSignIn(randomUUID()).expect(422);
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
  });
});
