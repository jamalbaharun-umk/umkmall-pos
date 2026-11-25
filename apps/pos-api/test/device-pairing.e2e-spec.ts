import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import {
  MAX_LIVE_PAIRINGS,
  MAX_LIVE_PAIRINGS_PER_ADDRESS,
  PAIRING_CODE_TTL_SECONDS,
  PAIRING_STATUS_POLLS_PER_MINUTE,
  PAIRING_TOKEN_GRACE_SECONDS,
} from '../src/staff/device-pairing';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Pairing a cashier device by a 6-digit code (UMK-2022). */
describe('device pairing code (UMK-2022)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    // As behind one proxy (POS_TRUSTED_PROXIES=1): the client address is the X-Forwarded-For entry.
    (app as NestExpressApplication).set('trust proxy', 1);
  });
  afterEach(async () => {
    // Open codes are global: leave none behind for the next test's cap and collisions.
    await admin`delete from pos.device_pairings where claimed_at is null`;
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  /** The signed-out device asks for a code. */
  const start = async () =>
    (await http().post('/auth/device/pairing').expect(201)).body as {
      pairingToken: string;
      code: string;
      expiresIn: number;
    };
  const status = (pairingToken: string) =>
    http().post('/auth/device/pairing/status').send({ pairingToken });
  /** A request for a code from this network address. */
  const startFrom = (address: string) =>
    http().post('/auth/device/pairing').set('X-Forwarded-For', address);
  const openFrom = async (address: string) =>
    (
      await admin<{ n: number }[]>`
        select count(*)::int as n from pos.device_pairings
        where requester_hash = ${sha256(address)} and claimed_at is null and expires_at > now()`
    )[0].n;
  const pair = (auth: string, code: string, name = 'Tablet depan') =>
    http()
      .post('/staff/devices/pair')
      .set('Authorization', auth)
      .send({ code, name });
  /** A code that is certainly not open now. */
  const wrongCode = async () => {
    for (;;) {
      const code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
      const [hit] =
        await admin`select 1 from pos.device_pairings where code_hash = ${sha256(code)}`;
      if (!hit) return code;
    }
  };
  const staffOf = async (s: Store, pin = '123456') =>
    (
      await http()
        .post('/staff')
        .set('Authorization', s.auth)
        .send({ name: `Sari ${Math.random().toString(36).slice(2, 8)}`, pin })
        .expect(201)
    ).body.id as string;

  it('pairs: the device shows a code, the owner enters it on their own device, the device gets its token and staff sign in by PIN', async () => {
    const s = await createStore();
    const staffId = await staffOf(s);

    const device = await start();
    expect(device.code).toMatch(/^[0-9]{6}$/);
    expect(device.expiresIn).toBe(PAIRING_CODE_TTL_SECONDS);
    expect(PAIRING_CODE_TTL_SECONDS).toBe(600);
    const waiting = await status(device.pairingToken).expect(200);
    expect(waiting.body).toEqual({
      status: 'pending',
      expiresIn: expect.any(Number),
    });

    const paired = await pair(s.auth, device.code, 'Tablet depan').expect(201);
    // The owner's device sees the new device, and never its token.
    expect(paired.body).toEqual({
      device: {
        id: expect.any(String),
        name: 'Tablet depan',
        createdAt: expect.any(String),
      },
    });
    expect(JSON.stringify(paired.body)).not.toContain(
      device.pairingToken.split('.')[1],
    );

    const done = await status(device.pairingToken).expect(200);
    expect(done.body).toEqual({
      status: 'paired',
      deviceToken: expect.stringMatching(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/),
      device: { id: paired.body.device.id, name: 'Tablet depan' },
    });
    // The device token is the bound device's id and the secret the device was handed at the start.
    expect(done.body.deviceToken).toBe(
      `${paired.body.device.id}.${device.pairingToken.split('.')[1]}`,
    );

    // The paired device works exactly as one bound the old way.
    const names = await http()
      .get('/auth/device/staff')
      .set('X-Pos-Device', done.body.deviceToken)
      .expect(200);
    expect((names.body as { id: string }[]).map((m) => m.id)).toEqual([
      staffId,
    ]);
    const signIn = await http()
      .post('/auth/pin')
      .set('X-Pos-Device', done.body.deviceToken)
      .send({ staffId, pin: '123456' })
      .expect(200);
    await http()
      .get('/tenant/me')
      .set('Authorization', `Bearer ${signIn.body.sessionToken}`)
      .expect(200);
    const list = await http()
      .get('/staff/devices')
      .set('Authorization', s.auth)
      .expect(200);
    expect((list.body as { id: string }[]).map((d) => d.id)).toContain(
      paired.body.device.id,
    );
    // Binding on the same device, the old way, still works.
    await http()
      .post('/staff/devices')
      .set('Authorization', s.auth)
      .send({ name: 'Kasir belakang' })
      .expect(201);
  });

  it('stores only hashes: neither the code nor the device secret is in the database', async () => {
    const device = await start();
    const [id, secret] = device.pairingToken.split('.');
    const [row] =
      await admin`select * from pos.device_pairings where id = ${id}`;
    expect(row).toMatchObject({
      tenant_id: null,
      code_hash: sha256(device.code),
      secret_hash: sha256(secret),
      claimed_at: null,
      device_id: null,
    });
    const text = JSON.stringify(row);
    expect(text).not.toContain(secret);
    expect(Object.values(row)).not.toContain(device.code);
    const s = await createStore();
    await pair(s.auth, device.code).expect(201);
    const [used] =
      await admin`select * from pos.device_pairings where id = ${id}`;
    // Used: even the code's hash is gone.
    expect(used).toMatchObject({ tenant_id: s.tenantId, code_hash: null });
    expect(used.claimed_at).not.toBeNull();
  });

  it('a code works once: the second use is refused, also by the same store, and binds nothing', async () => {
    const a = await createStore();
    const b = await createStore();
    const device = await start();
    await pair(a.auth, device.code).expect(201);
    const again = await pair(a.auth, device.code, 'Lagi').expect(422);
    expect(again.body.errors).toEqual({
      code: 'Kode pasang salah atau sudah tidak berlaku',
    });
    await pair(b.auth, device.code).expect(422);
    const count = async (s: Store) =>
      (
        await admin<
          { n: number }[]
        >`select count(*)::int as n from pos.devices where tenant_id = ${s.tenantId}`
      )[0].n;
    expect(await count(a)).toBe(1);
    expect(await count(b)).toBe(0);
  });

  it('two owners entering the same code at once: exactly one store gets the device', async () => {
    const a = await createStore();
    const b = await createStore();
    const device = await start();
    const results = await Promise.all([
      pair(a.auth, device.code),
      pair(b.auth, device.code),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    const rows = await admin`
      select tenant_id from pos.devices where tenant_id in (${a.tenantId}, ${b.tenantId})`;
    expect(rows).toHaveLength(1);
  });

  it('an expired code is refused, and its pairing is gone for the device too', async () => {
    const s = await createStore();
    const device = await start();
    const id = device.pairingToken.split('.')[0];
    await admin`update pos.device_pairings set expires_at = now() - interval '1 second' where id = ${id}`;
    await pair(s.auth, device.code).expect(422);
    await status(device.pairingToken).expect(404);
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from pos.devices where tenant_id = ${s.tenantId}`;
    expect(n).toBe(0);
    // The same code can be drawn again once the old one expired: the old row does not block it.
    await admin`update pos.device_pairings set code_hash = ${sha256('000000')} where id = ${id}`;
    await admin`
      insert into pos.device_pairings (code_hash, secret_hash, expires_at)
      values (${sha256('111111')}, 'x', now() + interval '10 minutes')`;
    await pair(s.auth, '000000').expect(422);
    await pair(s.auth, '111111').expect(201);
  });

  it('the code is never accepted from a signed-out caller, nor without staff.manage', async () => {
    const s = await createStore();
    const device = await start();
    // No session: the claim route is not public.
    await http()
      .post('/staff/devices/pair')
      .send({ code: device.code, name: 'x' })
      .expect(401);
    // The device's own (public) routes take no code: sending one binds nothing.
    await http()
      .post('/auth/device/pairing')
      .send({ code: device.code, name: 'x' })
      .expect(201);
    await http()
      .post('/auth/device/pairing/status')
      .send({ pairingToken: device.pairingToken, code: device.code })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('pending'));
    // A device token is not a session.
    const bound = await createCashier(app, s, ['sales.create']);
    await http()
      .post('/staff/devices/pair')
      .set('X-Pos-Device', bound.deviceToken)
      .send({ code: device.code, name: 'x' })
      .expect(401);
    // A cashier without staff.manage: 403. The default Admin role does not manage devices either.
    await pair(bound.auth, device.code).expect(403);
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from pos.device_pairings
      where id = ${device.pairingToken.split('.')[0]} and claimed_at is null`;
    expect(n).toBe(1);
    // Staff with the device permission may pair, into their own store.
    const manager = await createCashier(app, s, ['staff.manage']);
    await pair(manager.auth, device.code).expect(201);
    const [row] = await admin`
      select tenant_id from pos.device_pairings where id = ${device.pairingToken.split('.')[0]}`;
    expect(row.tenant_id).toBe(s.tenantId);
  });

  it('binds the device to the store of the session that entered the code, and to no other (cross-tenant)', async () => {
    const a = await createStore();
    const b = await createStore();
    const aStaff = await staffOf(a);
    const bStaff = await staffOf(b, '654321');
    const device = await start();
    // A tenant id in the body is not read.
    const paired = await http()
      .post('/staff/devices/pair')
      .set('Authorization', a.auth)
      .send({ code: device.code, name: 'Tablet A', tenantId: b.tenantId })
      .expect(201);
    const { deviceToken } = (await status(device.pairingToken).expect(200))
      .body;
    // Store B does not see the device, cannot revoke it, and its staff cannot sign in on it.
    const bList = await http()
      .get('/staff/devices')
      .set('Authorization', b.auth)
      .expect(200);
    expect(JSON.stringify(bList.body)).not.toContain(paired.body.device.id);
    await http()
      .post(`/staff/devices/${paired.body.device.id}/revoke`)
      .set('Authorization', b.auth)
      .expect(404);
    await http()
      .post('/auth/pin')
      .set('X-Pos-Device', deviceToken)
      .send({ staffId: bStaff, pin: '654321' })
      .expect(401);
    const names = await http()
      .get('/auth/device/staff')
      .set('X-Pos-Device', deviceToken)
      .expect(200);
    expect((names.body as { id: string }[]).map((m) => m.id)).toEqual([aStaff]);
    await http()
      .post('/auth/pin')
      .set('X-Pos-Device', deviceToken)
      .send({ staffId: aStaff, pin: '123456' })
      .expect(200);
  });

  it('locks a store after 5 wrong codes, with the PIN sign-in backoff, per store', async () => {
    const s = await createStore();
    const other = await createStore();
    const device = await start();
    const bad = await wrongCode();
    for (let i = 0; i < 4; i++) await pair(s.auth, bad).expect(422);
    const fifth = await pair(s.auth, bad).expect(429);
    expect(fifth.body).toEqual({
      message: 'Terlalu banyak kode salah, coba lagi nanti',
      retryAfter: 30,
    });
    expect(fifth.headers['retry-after']).toBe('30');
    // Locked: even the right code is refused, and it is not used up.
    const locked = await pair(s.auth, device.code).expect(429);
    expect(locked.body.retryAfter).toBeLessThanOrEqual(30);
    // The lock is this store's: another store pairs.
    const second = await start();
    await pair(other.auth, second.code).expect(201);

    // After the lock the next wrong code doubles it; a right one clears the count.
    const unlock = () =>
      admin`update pos.device_pairing_attempts set locked_until = now() - interval '1 second'
            where tenant_id = ${s.tenantId}`;
    await unlock();
    expect((await pair(s.auth, bad).expect(429)).body.retryAfter).toBe(60);
    await unlock();
    await pair(s.auth, device.code).expect(201);
    const [attempt] = await admin`
      select failures, locked_until from pos.device_pairing_attempts where tenant_id = ${s.tenantId}`;
    expect(attempt).toEqual({ failures: 0, locked_until: null });
  });

  it('serializes parallel guesses: at most 5 failures before the lock', async () => {
    const s = await createStore();
    const bad = await wrongCode();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => pair(s.auth, bad)),
    );
    expect(results.filter((r) => r.status === 422)).toHaveLength(4);
    expect(results.filter((r) => r.status === 429)).toHaveLength(8);
    const [attempt] = await admin`
      select failures from pos.device_pairing_attempts where tenant_id = ${s.tenantId}`;
    expect(attempt.failures).toBe(5);
  });

  it('revoking a paired device ends its sessions, its token and its pairing', async () => {
    const s = await createStore();
    const staffId = await staffOf(s);
    const device = await start();
    const paired = await pair(s.auth, device.code).expect(201);
    const { deviceToken } = (await status(device.pairingToken).expect(200))
      .body;
    const signIn = await http()
      .post('/auth/pin')
      .set('X-Pos-Device', deviceToken)
      .send({ staffId, pin: '123456' })
      .expect(200);
    const auth = `Bearer ${signIn.body.sessionToken}`;
    await http().get('/tenant/me').set('Authorization', auth).expect(200);

    await http()
      .post(`/staff/devices/${paired.body.device.id}/revoke`)
      .set('Authorization', s.auth)
      .expect(204);
    // The cashier's session is over, the device cannot sign anyone in, and it cannot fetch its token again.
    await http().get('/tenant/me').set('Authorization', auth).expect(401);
    await http()
      .post('/auth/pin')
      .set('X-Pos-Device', deviceToken)
      .send({ staffId, pin: '123456' })
      .expect(401);
    await http()
      .get('/auth/device/staff')
      .set('X-Pos-Device', deviceToken)
      .expect(401);
    await status(device.pairingToken).expect(404);
  });

  it('the status route answers only the device that holds the secret', async () => {
    const s = await createStore();
    const mine = await start();
    const other = await start();
    await pair(s.auth, mine.code).expect(201);
    const [mineId] = mine.pairingToken.split('.');
    const otherSecret = other.pairingToken.split('.')[1];
    // The paired pairing's id with another secret: nothing.
    await status(`${mineId}.${otherSecret}`).expect(404);
    await status(`${mineId}.${'A'.repeat(43)}`).expect(404);
    await status(
      '00000000-0000-4000-8000-000000000000.' + 'A'.repeat(43),
    ).expect(404);
    await status('not-a-token').expect(404);
    await http().post('/auth/device/pairing/status').send({}).expect(422);
    await status(other.pairingToken)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('pending'));
  });

  it('answers 422 on a bad code or name', async () => {
    const s = await createStore();
    for (const body of [
      {},
      { code: '12345', name: 'x' },
      { code: '1234567', name: 'x' },
      { code: 'abcdef', name: 'x' },
      { code: 123456, name: 'x' },
      { code: '123456' },
      { code: '123456', name: ' ' },
      { code: '123456', name: 'x'.repeat(61) },
    ])
      await http()
        .post('/staff/devices/pair')
        .set('Authorization', s.auth)
        .send(body)
        .expect(422);
    // A malformed code is not a guess: it does not count towards the lock.
    const [attempt] = await admin`
      select failures from pos.device_pairing_attempts where tenant_id = ${s.tenantId}`;
    expect(attempt).toBeUndefined();
  });

  it('limits how many codes are open at once', async () => {
    await admin`
      insert into pos.device_pairings (code_hash, secret_hash, expires_at)
      select 'cap-' || g, 'x', now() + interval '10 minutes'
      from generate_series(1, ${MAX_LIVE_PAIRINGS}) g`;
    const res = await http().post('/auth/device/pairing').expect(429);
    expect(res.body).toEqual({
      message: 'Terlalu banyak permintaan kode, coba lagi nanti',
    });
    // Expired and used ones do not count.
    await admin`update pos.device_pairings set expires_at = now() - interval '1 second'
                where code_hash = 'cap-1'`;
    await start();
  });

  it('caps the open codes of one network address, without touching another address', async () => {
    const s = await createStore();
    const codes: string[] = [];
    for (let i = 0; i < MAX_LIVE_PAIRINGS_PER_ADDRESS; i++)
      codes.push((await startFrom('203.0.113.7').expect(201)).body.code);
    const res = await startFrom('203.0.113.7').expect(429);
    expect(res.body).toEqual({
      message: 'Terlalu banyak permintaan kode, coba lagi nanti',
    });
    // Another address (another shop) still gets its code.
    await startFrom('203.0.113.8').expect(201);
    // Only hashes: the address itself is not stored.
    const stored = await admin<{ requester_hash: string }[]>`
      select distinct requester_hash from pos.device_pairings where claimed_at is null`;
    expect(stored.map((r) => r.requester_hash).sort()).toEqual(
      [sha256('203.0.113.7'), sha256('203.0.113.8')].sort(),
    );
    // A used code no longer counts, and neither does an expired one.
    await pair(s.auth, codes[0]).expect(201);
    await startFrom('203.0.113.7').expect(201);
    await startFrom('203.0.113.7').expect(429);
    await admin`update pos.device_pairings set expires_at = now() - interval '1 second'
                where code_hash = ${sha256(codes[1])}`;
    await startFrom('203.0.113.7').expect(201);
  });

  it('parallel requests cannot pass the per-address cap together', async () => {
    const results = await Promise.all(
      Array.from({ length: 3 * MAX_LIVE_PAIRINGS_PER_ADDRESS }, () =>
        startFrom('203.0.113.20'),
      ),
    );
    const by = (code: number) => results.filter((r) => r.status === code);
    expect(by(201)).toHaveLength(MAX_LIVE_PAIRINGS_PER_ADDRESS);
    expect(by(429)).toHaveLength(2 * MAX_LIVE_PAIRINGS_PER_ADDRESS);
    expect(await openFrom('203.0.113.20')).toBe(MAX_LIVE_PAIRINGS_PER_ADDRESS);
  });

  it('parallel requests from many addresses cannot pass the global cap together', async () => {
    await admin`
      insert into pos.device_pairings (code_hash, secret_hash, expires_at)
      select 'cap-' || g, 'x', now() + interval '10 minutes'
      from generate_series(1, ${MAX_LIVE_PAIRINGS - 2}) g`;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => startFrom(`198.51.100.${i + 1}`)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 429)).toHaveLength(10);
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from pos.device_pairings
      where claimed_at is null and expires_at > now()`;
    expect(n).toBe(MAX_LIVE_PAIRINGS);
  });

  it('limits the status polls of one network address per minute', async () => {
    const poll = (address: string) =>
      http()
        .post('/auth/device/pairing/status')
        .set('X-Forwarded-For', address)
        .send({ pairingToken: 'not-a-token' });
    // Within one minute of the clock, or the count starts again: at most two tries.
    for (let tries = 0; ; tries++) {
      const minute = Math.floor(Date.now() / 60_000);
      const statuses: number[] = [];
      for (let i = 0; i <= PAIRING_STATUS_POLLS_PER_MINUTE; i++)
        statuses.push((await poll(`192.0.2.${10 + tries}`)).status);
      if (Math.floor(Date.now() / 60_000) !== minute && tries === 0) continue;
      expect(statuses.slice(0, -1).every((code) => code === 404)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
      break;
    }
    await poll('192.0.2.99').expect(404);
  });

  it('a device paired just before its code ended can still fetch its token', async () => {
    const s = await createStore();
    const device = await start();
    const id = device.pairingToken.split('.')[0];
    await admin`update pos.device_pairings set expires_at = now() + interval '2 seconds' where id = ${id}`;
    await pair(s.auth, device.code).expect(201);
    const [{ left }] = await admin<{ left: number }[]>`
      select extract(epoch from expires_at - now())::int as left from pos.device_pairings where id = ${id}`;
    expect(left).toBeGreaterThan(PAIRING_TOKEN_GRACE_SECONDS - 30);
    expect(left).toBeLessThanOrEqual(PAIRING_TOKEN_GRACE_SECONDS);
    // Past the code's own end the token is still answered…
    await admin`update pos.device_pairings set expires_at = expires_at - interval '5 seconds' where id = ${id}`;
    expect((await status(device.pairingToken).expect(200)).body.status).toBe(
      'paired',
    );
    // …and not after the grace.
    await admin`update pos.device_pairings set expires_at = now() - interval '1 second' where id = ${id}`;
    await status(device.pairingToken).expect(404);
  });

  it('the store purge tables: a claimed pairing and the attempts carry the store’s tenant id', async () => {
    const s = await createStore();
    const device = await start();
    await pair(s.auth, await wrongCode()).expect(422);
    await pair(s.auth, device.code).expect(201);
    const [{ pairings, attempts }] = await admin<
      { pairings: number; attempts: number }[]
    >`
      select (select count(*)::int from pos.device_pairings where tenant_id = ${s.tenantId}) as pairings,
             (select count(*)::int from pos.device_pairing_attempts where tenant_id = ${s.tenantId}) as attempts`;
    expect({ pairings, attempts }).toEqual({ pairings: 1, attempts: 1 });
  });
});
