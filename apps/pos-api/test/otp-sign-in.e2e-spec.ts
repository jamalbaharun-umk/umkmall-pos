import { INestApplication } from '@nestjs/common';
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import postgres from 'postgres';
import request from 'supertest';
import { OTP_REQUESTS_PER_WINDOW } from '../src/auth/auth.controller';
import { createApp } from './support/fixtures';
import { ADMIN_DATABASE_URL } from './support/env';

// A fake UMKMall apps/api native auth (`/mobile/v1/auth/**`, UMK-2065). Each path answers through `routes`; every call
// is kept with its body and bearer.
type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};
type Call = { method: string; path: string; body: unknown; bearer?: string };
const fake = {
  routes: {} as Record<string, (body: Record<string, unknown>) => Reply>,
  calls: [] as Call[],
};
const ok = (body: unknown): Reply => ({
  body: { success: true, ...(body as object) },
});
const noConsentNeeded = () =>
  ok({
    needsConsent: false,
    needsAgeConfirmation: false,
    tos: null,
    privacy: null,
  });
const TOS = { id: 'tos-3', version: '3', title: 'Syarat' };
const PRIVACY = { id: 'priv-2', version: '2', title: 'Privasi' };
const REFRESH = 'r'.repeat(43);

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () =>
      resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}),
    );
  });
}

const claims = (token: string) =>
  JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  ) as Record<string, unknown>;

describe('owner sign-in by WhatsApp OTP through UMKMall native auth (UMK-2065)', () => {
  let app: INestApplication;
  let umkmall: Server;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });

  beforeAll(async () => {
    umkmall = createServer((req, res: ServerResponse) => {
      void readBody(req).then((body) => {
        const path = req.url ?? '';
        const auth = req.headers.authorization;
        fake.calls.push({
          method: req.method ?? '',
          path,
          body,
          ...(auth && { bearer: auth.replace(/^Bearer /, '') }),
        });
        const route = fake.routes[`${req.method} ${path}`];
        const reply = route ? route(body) : { status: 404, body: {} };
        res.statusCode = reply.status ?? 200;
        for (const [k, v] of Object.entries(reply.headers ?? {}))
          res.setHeader(k, v);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(reply.body ?? {}));
      });
    });
    await new Promise<void>((r) => umkmall.listen(0, '127.0.0.1', r));
    process.env.UMKMALL_API_URL = `http://127.0.0.1:${(umkmall.address() as AddressInfo).port}`;
    app = await createApp();
  });

  beforeEach(() => {
    fake.calls = [];
    fake.routes = {
      'POST /mobile/v1/auth/consent/status': noConsentNeeded,
      'POST /mobile/v1/auth/otp/request': () =>
        ok({
          data: {
            phone: '6281234567890',
            otpLength: 6,
            expiresAt: '2026-11-26T09:00:00.000Z',
          },
        }),
    };
  });

  afterAll(async () => {
    delete process.env.UMKMALL_API_URL;
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
  const signedIn =
    (userId: string, extra: Record<string, unknown> = {}) =>
    () =>
      ok({
        message: 'Login berhasil',
        data: {
          accessToken: 'native-access',
          expiresIn: 3600,
          refreshToken: REFRESH,
          user: {
            id: userId,
            phone: '6281234567890',
            name: null,
            role: 'user',
          },
          session: { id: 'sid-1' },
          isNewUser: false,
          ...extra,
        },
      });
  const post = (path: string, body: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .send(body as object);
  const paths = () => fake.calls.map((c) => `${c.method} ${c.path}`);

  describe('POST /auth/otp/request', () => {
    it('sends the code through UMKMall and answers only its length and expiry', async () => {
      const res = await post('/auth/otp/request', {
        phone: '0812-3456-7890',
      }).expect(200);
      expect(res.body).toEqual({
        otpLength: 6,
        expiresAt: '2026-11-26T09:00:00.000Z',
      });
      expect(paths()).toEqual([
        'POST /mobile/v1/auth/consent/status',
        'POST /mobile/v1/auth/otp/request',
      ]);
      expect(fake.calls[1].body).toEqual({ phone: '0812-3456-7890' });
    });

    it('asks for consent first (409 with the live versions) and sends no code', async () => {
      fake.routes['POST /mobile/v1/auth/consent/status'] = () =>
        ok({
          needsConsent: true,
          needsAgeConfirmation: true,
          tos: TOS,
          privacy: PRIVACY,
        });
      const res = await post('/auth/otp/request', {
        phone: '081234567890',
      }).expect(409);
      expect(res.body).toMatchObject({
        code: 'consent_required',
        consent: { tos: TOS, privacy: PRIVACY, needsAgeConfirmation: true },
      });
      expect(paths()).toEqual(['POST /mobile/v1/auth/consent/status']);
      // with the owner's consent, the code goes out
      await post('/auth/otp/request', {
        phone: '081234567890',
        consent: {
          tosVersionId: 'tos-3',
          privacyVersionId: 'priv-2',
          ageConfirmed: true,
        },
      }).expect(200);
      expect(paths()).toContain('POST /mobile/v1/auth/otp/request');
    });

    it('refuses a malformed number with 422 without calling UMKMall', async () => {
      const res = await post('/auth/otp/request', { phone: 'abc' }).expect(422);
      expect(res.body.errors.phone).toBe('Format nomor WhatsApp tidak valid');
      await post('/auth/otp/request', {
        phone: '081234567890',
        tenantId: 'x',
      }).expect(422);
      expect(fake.calls).toEqual([]);
    });

    it("passes UMKMall's lockout on with its wait", async () => {
      fake.routes['POST /mobile/v1/auth/otp/request'] = () => ({
        status: 429,
        body: {
          success: false,
          message: 'Terlalu banyak',
          retryAfterSeconds: 120,
        },
      });
      const res = await post('/auth/otp/request', {
        phone: '081234567890',
      }).expect(429);
      expect(res.headers['retry-after']).toBe('120');
      expect(res.body).toMatchObject({
        code: 'too_many_attempts',
        retryAfterSeconds: 120,
      });
    });

    it('answers 503 when UMKMall fails or answers nonsense', async () => {
      fake.routes['POST /mobile/v1/auth/otp/request'] = () => ({
        status: 504,
        body: { success: false },
      });
      const res = await post('/auth/otp/request', {
        phone: '081234567890',
      }).expect(503);
      expect(res.body.code).toBe('umkmall_unavailable');
      fake.routes['POST /mobile/v1/auth/otp/request'] = () =>
        ok({ data: { nope: 1 } });
      await post('/auth/otp/request', { phone: '081234567890' }).expect(503);
    });
  });

  describe('POST /auth/otp/verify', () => {
    it('opens a fresh owner session for the UMKMall user, creates the store once and hands back the refresh', async () => {
      const sub = await umkmallUser();
      fake.routes['POST /mobile/v1/auth/otp/verify'] = signedIn(sub);
      const first = await post('/auth/otp/verify', {
        phone: '081234567890',
        otp: '123456',
      }).expect(200);
      expect(first.body).toMatchObject({
        expiresIn: 900,
        tenant: { id: expect.any(String) },
        umkmall: { sid: 'sid-1', refreshToken: REFRESH },
      });
      expect(first.body).not.toHaveProperty('accessToken');
      const c = claims(first.body.sessionToken);
      expect(c).toMatchObject({
        sub,
        kind: 'owner',
        tid: first.body.tenant.id,
      });
      expect(c.auth_time).toEqual(expect.any(Number)); // a sign-in: fresh for the owner PIN reset (UMK-2054)
      const me = await request(app.getHttpServer())
        .get('/tenant/me')
        .set('Authorization', `Bearer ${first.body.sessionToken}`)
        .expect(200);
      expect(me.body.actor).toMatchObject({ id: sub, kind: 'owner' });

      const again = await post('/auth/otp/verify', {
        phone: '081234567890',
        otp: '123456',
      }).expect(200);
      expect(again.body.tenant.id).toBe(first.body.tenant.id);
      const [{ n }] = await admin<
        { n: number }[]
      >`select count(*)::int as n from pos.tenants where user_id = ${sub}`;
      expect(n).toBe(1);
    });

    it('records the consent with the new session before handing it out', async () => {
      const sub = await umkmallUser();
      fake.routes['POST /mobile/v1/auth/consent/status'] = () =>
        ok({
          needsConsent: true,
          needsAgeConfirmation: true,
          tos: TOS,
          privacy: PRIVACY,
        });
      fake.routes['POST /mobile/v1/auth/otp/verify'] = signedIn(sub, {
        isNewUser: true,
      });
      fake.routes['POST /mobile/v1/auth/consent/record'] = () => ok({});
      const consent = {
        tosVersionId: 'tos-3',
        privacyVersionId: 'priv-2',
        ageConfirmed: true,
      };

      // without it: refused before the code is spent
      await post('/auth/otp/verify', {
        phone: '081234567890',
        otp: '123456',
      }).expect(409);
      expect(paths()).not.toContain('POST /mobile/v1/auth/otp/verify');

      fake.calls = [];
      await post('/auth/otp/verify', {
        phone: '081234567890',
        otp: '123456',
        consent,
      }).expect(200);
      const record = fake.calls.find(
        (x) => x.path === '/mobile/v1/auth/consent/record',
      );
      expect(record).toEqual({
        method: 'POST',
        path: '/mobile/v1/auth/consent/record',
        body: { ...consent, acceptanceMethod: 'initial_signup' },
        bearer: 'native-access',
      });
    });

    it('ends the UMKMall session and refuses when the consent cannot be recorded', async () => {
      const sub = await umkmallUser();
      fake.routes['POST /mobile/v1/auth/consent/status'] = () =>
        ok({
          needsConsent: true,
          needsAgeConfirmation: false,
          tos: TOS,
          privacy: PRIVACY,
        });
      fake.routes['POST /mobile/v1/auth/otp/verify'] = signedIn(sub);
      fake.routes['POST /mobile/v1/auth/consent/record'] = () => ({
        status: 409,
        body: { success: false },
      });
      fake.routes['DELETE /mobile/v1/auth/session'] = () => ok({});
      const res = await post('/auth/otp/verify', {
        phone: '081234567890',
        otp: '123456',
        consent: { tosVersionId: 'tos-2' },
      }).expect(409);
      expect(res.body.code).toBe('consent_required');
      expect(fake.calls.find((x) => x.method === 'DELETE')?.bearer).toBe(
        'native-access',
      );
    });

    it("answers a wrong or expired code as 422 on otp with UMKMall's words", async () => {
      fake.routes['POST /mobile/v1/auth/otp/verify'] = () => ({
        status: 400,
        body: {
          success: false,
          message: 'Kode OTP salah. Silakan periksa kembali.',
        },
      });
      const res = await post('/auth/otp/verify', {
        phone: '081234567890',
        otp: '000000',
      }).expect(422);
      expect(res.body.errors).toEqual({
        otp: 'Kode OTP salah. Silakan periksa kembali.',
      });
      await post('/auth/otp/verify', {
        phone: '081234567890',
        otp: '12ab',
      }).expect(422);
    });

    it('answers 503 when UMKMall is unreachable', async () => {
      const saved = process.env.UMKMALL_API_URL;
      process.env.UMKMALL_API_URL = 'http://127.0.0.1:9';
      const down = await createApp();
      try {
        await request(down.getHttpServer())
          .post('/auth/otp/verify')
          .send({ phone: '081234567890', otp: '123456' })
          .expect(503);
      } finally {
        process.env.UMKMALL_API_URL = saved;
        await down.close();
      }
    });
  });

  describe('POST /auth/umkmall/refresh', () => {
    it('opens a new owner session that is never fresh and passes a rotated refresh token on', async () => {
      const sub = await umkmallUser();
      fake.routes['POST /mobile/v1/auth/refresh'] = signedIn(sub, {
        refreshToken: 'n'.repeat(43),
      });
      const res = await post('/auth/umkmall/refresh', {
        sid: 'sid-1',
        refreshToken: REFRESH,
      }).expect(200);
      expect(fake.calls[0].body).toEqual({
        sid: 'sid-1',
        refreshToken: REFRESH,
      });
      expect(res.body.umkmall).toEqual({
        sid: 'sid-1',
        refreshToken: 'n'.repeat(43),
      });
      const c = claims(res.body.sessionToken);
      expect(c).toMatchObject({ sub, kind: 'owner' });
      expect(c).not.toHaveProperty('auth_time');
    });

    it("keeps the client's refresh token when UMKMall did not rotate it (grace)", async () => {
      const sub = await umkmallUser();
      fake.routes['POST /mobile/v1/auth/refresh'] = signedIn(sub, {
        refreshToken: undefined,
      });
      const res = await post('/auth/umkmall/refresh', {
        sid: 'sid-1',
        refreshToken: REFRESH,
      }).expect(200);
      expect(res.body.umkmall).toEqual({ sid: 'sid-1' });
    });

    it('answers 401 for a session UMKMall ended and 503 when it fails', async () => {
      fake.routes['POST /mobile/v1/auth/refresh'] = () => ({
        status: 401,
        body: { success: false, code: 'SESSION_ENDED' },
      });
      await post('/auth/umkmall/refresh', {
        sid: 'sid-1',
        refreshToken: REFRESH,
      }).expect(401);
      fake.routes['POST /mobile/v1/auth/refresh'] = () => ({
        status: 500,
        body: {},
      });
      await post('/auth/umkmall/refresh', {
        sid: 'sid-1',
        refreshToken: REFRESH,
      }).expect(503);
      await post('/auth/umkmall/refresh', {
        sid: 'sid 1',
        refreshToken: 'short',
      }).expect(422);
    });
  });

  it('UMK-2054: the OTP sign-in is fresh, its refresh is not, and a new sign-in is fresh again', async () => {
    const sub = await umkmallUser();
    fake.routes['POST /mobile/v1/auth/otp/verify'] = signedIn(sub);
    fake.routes['POST /mobile/v1/auth/refresh'] = signedIn(sub);
    const http = () => request(app.getHttpServer());
    const signIn = async () =>
      `Bearer ${(await post('/auth/otp/verify', { phone: '081234567890', otp: '123456' }).expect(200)).body.sessionToken as string}`;
    const refresh = async () =>
      `Bearer ${(await post('/auth/umkmall/refresh', { sid: 'sid-1', refreshToken: REFRESH }).expect(200)).body.sessionToken as string}`;
    const first = await signIn();
    await http()
      .put('/void-pin')
      .set('Authorization', first)
      .send({ pin: '482913' })
      .expect(200);

    const refreshed = await refresh();
    for (const refusal of [
      await http()
        .delete(`/void-pin/${sub}`)
        .set('Authorization', refreshed)
        .expect(403),
      await http()
        .post(`/void-pin/${sub}/unlock`)
        .set('Authorization', refreshed)
        .expect(403),
    ])
      expect(refusal.body.code).toBe('fresh_sign_in_required');
    await http()
      .get('/void-pin')
      .set('Authorization', refreshed)
      .expect(200, { hasPin: true, lockedUntil: null });

    const again = await signIn();
    await http()
      .post(`/void-pin/${sub}/unlock`)
      .set('Authorization', again)
      .expect(200);
    await http()
      .delete(`/void-pin/${sub}`)
      .set('Authorization', again)
      .expect(200);
  });

  it('refuses a UMKMall account with no users row here with 401, not a 500', async () => {
    fake.routes['POST /mobile/v1/auth/otp/verify'] = signedIn(
      '00000000-0000-4000-8000-0000000000ff',
    );
    await post('/auth/otp/verify', {
      phone: '081234567890',
      otp: '123456',
    }).expect(401);
  });

  it('maps an upper-case user id to the same store and actor', async () => {
    const sub = await umkmallUser();
    fake.routes['POST /mobile/v1/auth/otp/verify'] = signedIn(sub);
    const lower = await post('/auth/otp/verify', {
      phone: '081234567890',
      otp: '123456',
    }).expect(200);
    fake.routes['POST /mobile/v1/auth/otp/verify'] = signedIn(
      sub.toUpperCase(),
    );
    const upper = await post('/auth/otp/verify', {
      phone: '081234567890',
      otp: '123456',
    }).expect(200);
    expect(upper.body.tenant.id).toBe(lower.body.tenant.id);
    expect(claims(upper.body.sessionToken).sub).toBe(sub);
  });

  it('ends a native session that came without a refresh token and answers 503', async () => {
    fake.routes['POST /mobile/v1/auth/otp/verify'] = signedIn(
      await umkmallUser(),
      { refreshToken: undefined },
    );
    fake.routes['DELETE /mobile/v1/auth/session'] = () => ok({});
    await post('/auth/otp/verify', {
      phone: '081234567890',
      otp: '123456',
    }).expect(503);
    expect(fake.calls.find((x) => x.method === 'DELETE')?.bearer).toBe(
      'native-access',
    );
  });

  describe('POST /auth/umkmall/sign-out', () => {
    it("ends the POS's UMKMall session with a fresh access token", async () => {
      fake.routes['POST /mobile/v1/auth/refresh'] = signedIn(
        await umkmallUser(),
        { accessToken: 'for-sign-out' },
      );
      fake.routes['DELETE /mobile/v1/auth/session'] = () => ok({});
      await post('/auth/umkmall/sign-out', {
        sid: 'sid-1',
        refreshToken: REFRESH,
      }).expect(204);
      expect(fake.calls.map((x) => [x.method, x.path, x.bearer])).toEqual([
        ['POST', '/mobile/v1/auth/refresh', undefined],
        ['DELETE', '/mobile/v1/auth/session', 'for-sign-out'],
      ]);
    });

    it('is done when UMKMall already ended the session', async () => {
      fake.routes['POST /mobile/v1/auth/refresh'] = () => ({
        status: 401,
        body: {},
      });
      await post('/auth/umkmall/sign-out', {
        sid: 'sid-1',
        refreshToken: REFRESH,
      }).expect(204);
      expect(paths()).toEqual(['POST /mobile/v1/auth/refresh']);
    });
  });

  it('limits code requests per network address before UMKMall', async () => {
    const fresh = await createApp(); // its own limiter
    try {
      const ask = () =>
        request(fresh.getHttpServer())
          .post('/auth/otp/request')
          .send({ phone: '081234567890' });
      for (let i = 0; i < OTP_REQUESTS_PER_WINDOW; i++) await ask().expect(200);
      fake.calls = [];
      const res = await ask().expect(429);
      expect(res.body.code).toBe('too_many_attempts');
      expect(fake.calls).toEqual([]);
    } finally {
      await fresh.close();
    }
  });
});

describe('WhatsApp OTP sign-in switched off', () => {
  it('answers 404 on every OTP route while UMKMALL_API_URL is unset', async () => {
    delete process.env.UMKMALL_API_URL;
    const app = await createApp();
    try {
      for (const path of [
        '/auth/otp/request',
        '/auth/otp/verify',
        '/auth/umkmall/refresh',
        '/auth/umkmall/sign-out',
      ])
        await request(app.getHttpServer()).post(path).send({}).expect(404);
    } finally {
      await app.close();
    }
  });
});
