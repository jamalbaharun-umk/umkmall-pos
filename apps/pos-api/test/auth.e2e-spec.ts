import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, KeyLike, SignJWT } from 'jose';
import postgres from 'postgres';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { ADMIN_DATABASE_URL } from './support/env';

// A local stand-in for UMKMall (#1837): JWKS with a locally generated Ed25519 key, and the liveness route.
type Liveness = 'live' | 'dead' | 'down';
const stub = {
  liveness: 'live' as Liveness,
  calls: [] as { key?: string; body: string }[],
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => resolve(data));
  });
}

describe('UMKMall handoff exchange and owner refresh', () => {
  let app: INestApplication;
  let umkmall: Server;
  let key: KeyLike;
  let otherKey: KeyLike;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });

  beforeAll(async () => {
    ({ privateKey: key } = await generateKeyPair('EdDSA', { crv: 'Ed25519' }));
    ({ privateKey: otherKey } = await generateKeyPair('EdDSA', {
      crv: 'Ed25519',
    }));
    const pub = await exportJWK(key);
    delete pub.d;
    umkmall = createServer((req, res) => {
      if (req.url === '/.well-known/pos-jwks.json') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            keys: [{ ...pub, kid: 'k1', alg: 'EdDSA', use: 'sig' }],
          }),
        );
        return;
      }
      if (req.url === '/auth/pos/liveness' && req.method === 'POST') {
        if (stub.liveness === 'down') return req.socket.destroy();
        void readBody(req).then((body) => {
          stub.calls.push({
            key: req.headers['x-pos-service-key'] as string,
            body,
          });
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ live: stub.liveness === 'live' }));
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => umkmall.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(umkmall.address() as AddressInfo).port}`;
    process.env.UMKMALL_JWKS_URL = `${base}/.well-known/pos-jwks.json`;
    process.env.UMKMALL_API_URL = base;
    app = await createApp();
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

  function handoff(
    sub: string,
    opts: {
      jti?: string;
      iss?: string;
      aud?: string;
      exp?: number;
      signer?: KeyLike;
      kid?: string;
    } = {},
  ) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sid: 'sid-' + sub })
      .setProtectedHeader({ alg: 'EdDSA', kid: opts.kid ?? 'k1', typ: 'JWT' })
      .setIssuer(opts.iss ?? 'umkmall')
      .setAudience(opts.aud ?? 'pos')
      .setSubject(sub)
      .setJti(opts.jti ?? randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(opts.exp ?? now + 300)
      .sign(opts.signer ?? key);
  }

  const exchange = (token: unknown) =>
    request(app.getHttpServer()).post('/auth/umkmall/exchange').send({ token });

  it('exchanges a handoff token for an owner session and creates the store once', async () => {
    const sub = await umkmallUser();
    const first = await exchange(await handoff(sub)).expect(200);
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

    const second = await exchange(await handoff(sub)).expect(200);
    expect(second.body.tenant.id).toBe(first.body.tenant.id);
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from pos.tenants where user_id = ${sub}`;
    expect(n).toBe(1);
  });

  it('accepts each jti once', async () => {
    const sub = await umkmallUser();
    const token = await handoff(sub);
    await exchange(token).expect(200);
    await exchange(token).expect(401);
  });

  it.each<
    [
      string,
      {
        aud?: string;
        iss?: string;
        exp?: number;
        kid?: string;
        unknownKey?: boolean;
      },
    ]
  >([
    ['wrong audience', { aud: 'umkmall-web' }],
    ['wrong issuer', { iss: 'someone-else' }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 10 }],
    ['signed by a key not in the JWKS', { kid: 'k-unknown', unknownKey: true }],
  ])('refuses a token that is %s', async (_, { unknownKey, ...opts }) => {
    const sub = await umkmallUser();
    const signer = unknownKey ? otherKey : undefined;
    await exchange(await handoff(sub, { ...opts, signer })).expect(401);
  });

  it('refuses a token signed with HS256 instead of EdDSA', async () => {
    const sub = await umkmallUser();
    const forged = await new SignJWT({ sid: 's' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setIssuer('umkmall')
      .setAudience('pos')
      .setSubject(sub)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    await exchange(forged).expect(401);
  });

  it('answers 422 for a malformed body', async () => {
    await exchange(undefined).expect(422);
    await exchange(42).expect(422);
  });

  describe('refresh', () => {
    async function ownerSession() {
      const sub = await umkmallUser();
      const res = await exchange(await handoff(sub)).expect(200);
      return {
        sub,
        ...(res.body as { sessionToken: string; tenant: { id: string } }),
      };
    }
    const refresh = (token: string) =>
      request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${token}`);

    it('issues a fresh session for the same store while UMKMall says live', async () => {
      stub.liveness = 'live';
      stub.calls = [];
      const owner = await ownerSession();
      const res = await refresh(owner.sessionToken).expect(200);
      expect(res.body.tenant.id).toBe(owner.tenant.id);
      expect(stub.calls).toEqual([
        {
          key: process.env.POS_SERVICE_KEY,
          body: JSON.stringify({ sid: `sid-${owner.sub}` }),
        },
      ]);
      // the refreshed session still carries the sid, so it can refresh again
      await refresh(res.body.sessionToken).expect(200);
    });

    it('refuses when UMKMall says the session is not live', async () => {
      const owner = await ownerSession();
      stub.liveness = 'dead';
      await refresh(owner.sessionToken).expect(401);
    });

    it('answers 503, never a session, when UMKMall is down', async () => {
      const owner = await ownerSession();
      stub.liveness = 'down';
      const res = await refresh(owner.sessionToken).expect(503);
      expect(res.body.sessionToken).toBeUndefined();
    });

    it('refuses a session without a UMKMall sid', async () => {
      stub.liveness = 'live';
      const store = await createStore(); // owner session signed without sid
      await refresh(store.token).expect(401);
    });
  });

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
