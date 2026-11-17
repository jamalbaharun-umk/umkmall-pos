import { Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { lockSeconds } from '../src/staff/pin-auth.controller';
import { RequirePermission } from '../src/staff/require-permission';
import { signSession } from '../src/tenancy/session';
import { ADMIN_DATABASE_URL } from './support/env';
import { createStore } from './support/fixtures';
import { createCashier } from './support/staff';

// Stands in for U3's override route: proves the decorator other units use.
@Controller('test-probe')
class ProbeController {
  @Post('override')
  @RequirePermission('sales.price_override')
  override() {
    return { ok: true };
  }
}

describe('staff, roles, devices and PIN sign-in (U4)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  describe('roles', () => {
    it('seeds Pemilik and Kasir on first use and manages roles', async () => {
      const a = await createStore();
      const list = await http().get('/roles').set('Authorization', a.auth);
      expect(list.status).toBe(200);
      expect((list.body as { name: string }[]).map((r) => r.name)).toEqual([
        'Kasir',
        'Pemilik',
      ]);
      expect(list.body[0].permissions).toEqual(['sales.create']);

      const created = await http()
        .post('/roles')
        .set('Authorization', a.auth)
        .send({ name: 'Supervisor', permissions: ['reports.view'] })
        .expect(201);
      await http()
        .patch(`/roles/${created.body.id}`)
        .set('Authorization', a.auth)
        .send({ permissions: ['reports.view', 'sales.price_override'] })
        .expect(200)
        .expect(({ body }) =>
          expect(body.permissions).toEqual([
            'reports.view',
            'sales.price_override',
          ]),
        );
      await http()
        .post('/roles')
        .set('Authorization', a.auth)
        .send({ name: 'Supervisor' })
        .expect(409);
      await http()
        .post('/roles')
        .set('Authorization', a.auth)
        .send({ name: 'X', permissions: ['root.everything'] })
        .expect(422);
      await http()
        .get('/roles/permissions')
        .set('Authorization', a.auth)
        .expect(200)
        .expect(({ body }) => expect(body).toContain('sales.price_override'));
      await http()
        .delete(`/roles/${created.body.id}`)
        .set('Authorization', a.auth)
        .expect(204);
      await http()
        .get(`/roles/${created.body.id}`)
        .set('Authorization', a.auth)
        .expect(404);
    });
  });

  describe('staff CRUD', () => {
    it('creates, reads, updates and soft-deletes staff without exposing the PIN', async () => {
      const a = await createStore();
      const created = await http()
        .post('/staff')
        .set('Authorization', a.auth)
        .send({ name: 'Budi', pin: '4321' })
        .expect(201);
      const text = JSON.stringify(created.body);
      expect(text).not.toContain('4321');
      expect(text).not.toMatch(/pin|scrypt/i);
      expect(created.body).toMatchObject({
        name: 'Budi',
        active: true,
        roles: [],
      });

      const [row] = await admin<{ pin_hash: string }[]>`
        select pin_hash from pos.staff where id = ${created.body.id}`;
      expect(row.pin_hash).toMatch(/^scrypt\$/);
      expect(row.pin_hash).not.toContain('4321');

      const id = created.body.id;
      await http()
        .patch(`/staff/${id}`)
        .set('Authorization', a.auth)
        .send({ name: 'Budi S' })
        .expect(200)
        .expect(({ body }) => expect(body.name).toBe('Budi S'));
      const list = await http()
        .get('/staff')
        .set('Authorization', a.auth)
        .expect(200);
      expect(JSON.stringify(list.body)).not.toMatch(/pin_?hash|scrypt/i);
      expect((list.body as { id: string }[]).map((s) => s.id)).toContain(id);

      await http()
        .delete(`/staff/${id}`)
        .set('Authorization', a.auth)
        .expect(204);
      await http().get(`/staff/${id}`).set('Authorization', a.auth).expect(404);
      const [gone] = await admin<{ deleted_at: Date | null }[]>`
        select deleted_at from pos.staff where id = ${id}`;
      expect(gone.deleted_at).not.toBeNull();
    });

    it('answers 422 on a bad body and 404 on a non-UUID id', async () => {
      const a = await createStore();
      await http()
        .post('/staff')
        .set('Authorization', a.auth)
        .send({ name: 'Budi', pin: '12' })
        .expect(422);
      await http()
        .get('/staff/not-a-uuid')
        .set('Authorization', a.auth)
        .expect(404);
    });
  });

  describe('cross-tenant', () => {
    it("gives store B 404 on store A's staff, roles, devices and sessions", async () => {
      const a = await createStore();
      const b = await createStore();
      const cashier = await createCashier(app, a);
      const [session] = await admin<{ id: string }[]>`
        select id from pos.staff_sessions where staff_id = ${cashier.staffId}`;
      for (const path of [
        `/staff/${cashier.staffId}`,
        `/roles/${cashier.roleId}`,
      ]) {
        await http().get(path).set('Authorization', b.auth).expect(404);
        await http()
          .patch(path)
          .set('Authorization', b.auth)
          .send({ name: 'Hijacked' })
          .expect(404);
        await http().delete(path).set('Authorization', b.auth).expect(404);
      }
      await http()
        .post(`/staff/devices/${cashier.deviceId}/revoke`)
        .set('Authorization', b.auth)
        .expect(404);
      await http()
        .post(`/staff/sessions/${session.id}/revoke`)
        .set('Authorization', b.auth)
        .expect(404);

      // B cannot attach A's role to its own staff.
      await http()
        .post('/staff')
        .set('Authorization', b.auth)
        .send({ name: 'Eko', pin: '1111', roleIds: [cashier.roleId] })
        .expect(422);

      for (const path of [
        '/staff',
        '/roles',
        '/staff/devices',
        '/staff/sessions',
      ]) {
        const res = await http()
          .get(path)
          .set('Authorization', b.auth)
          .expect(200);
        const ids = JSON.stringify(res.body);
        for (const id of [
          cashier.staffId,
          cashier.roleId,
          cashier.deviceId,
          session.id,
        ])
          expect(ids).not.toContain(id);
      }

      // A's device cannot sign in B's staff.
      const bStaff = await http()
        .post('/staff')
        .set('Authorization', b.auth)
        .send({ name: 'Eko', pin: '1111' })
        .expect(201);
      await http()
        .post('/auth/pin')
        .set('X-Pos-Device', cashier.deviceToken)
        .send({ staffId: bStaff.body.id, pin: '1111' })
        .expect(401);

      // A's data is untouched.
      await http()
        .get(`/staff/${cashier.staffId}`)
        .set('Authorization', a.auth)
        .expect(200)
        .expect(({ body }) => expect(body.name).toBe('Sari'));
      await http()
        .get('/tenant/me')
        .set('Authorization', cashier.auth)
        .expect(200);
    });
  });

  describe('PIN sign-in', () => {
    it('signs a cashier in on a bound device with their permissions', async () => {
      const a = await createStore();
      const cashier = await createCashier(app, a, ['sales.create']);
      const res = await cashier.signIn().expect(200);
      expect(res.body.staff).toEqual({ id: cashier.staffId, name: 'Sari' });
      expect(res.body.permissions).toEqual(['sales.create']);
      expect(JSON.stringify(res.body)).not.toContain('123456');
      const me = await http()
        .get('/tenant/me')
        .set('Authorization', cashier.auth)
        .expect(200);
      expect(me.body.actor).toEqual({ id: cashier.staffId, kind: 'cashier' });
      await http()
        .get('/auth/device/staff')
        .set('X-Pos-Device', cashier.deviceToken)
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual([{ id: cashier.staffId, name: 'Sari' }]),
        );
    });

    it('refuses a missing or forged device token', async () => {
      const a = await createStore();
      const cashier = await createCashier(app, a);
      const [id] = cashier.deviceToken.split('.');
      await http()
        .post('/auth/pin')
        .send({ staffId: cashier.staffId, pin: '123456' })
        .expect(401);
      await http()
        .post('/auth/pin')
        .set('X-Pos-Device', `${id}.${'A'.repeat(43)}`)
        .send({ staffId: cashier.staffId, pin: '123456' })
        .expect(401);
      await http()
        .get('/auth/device/staff')
        .set('X-Pos-Device', 'nope')
        .expect(401);
    });

    it('locks the cashier after 5 wrong PINs, with doubling backoff', async () => {
      const a = await createStore();
      const cashier = await createCashier(app, a);
      for (let i = 0; i < 4; i++) await cashier.signIn('000000').expect(401);
      const fifth = await cashier.signIn('000000').expect(429);
      expect(fifth.headers['retry-after']).toBe('30');

      // Locked: even the right PIN is refused, and the PIN is not checked.
      const locked = await cashier.signIn('123456').expect(429);
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

      // Lock expires; the next wrong PIN doubles it.
      await admin`update pos.pin_attempts set locked_until = now() - interval '1 second'
        where staff_id = ${cashier.staffId}`;
      const sixth = await cashier.signIn('000000').expect(429);
      expect(sixth.headers['retry-after']).toBe('60');

      // A new PIN from the owner clears the lockout.
      await http()
        .patch(`/staff/${cashier.staffId}`)
        .set('Authorization', a.auth)
        .send({ pin: '7777' })
        .expect(200);
      await cashier.signIn('7777').expect(200);
    });

    it('keeps lockout per store + cashier', async () => {
      const a = await createStore();
      const one = await createCashier(app, a);
      const two = await createCashier(app, a);
      for (let i = 0; i < 5; i++) await one.signIn('000000');
      await one.signIn().expect(429);
      await two.signIn().expect(200);
    });

    it('serializes parallel guesses: at most 5 failures before the lock', async () => {
      const a = await createStore();
      const cashier = await createCashier(app, a);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => cashier.signIn('000000')),
      );
      expect(results.filter((r) => r.status === 401)).toHaveLength(4);
      expect(results.filter((r) => r.status === 429)).toHaveLength(6);
    });

    it('computes the backoff: 30 s doubling, capped at 15 min', () => {
      expect([4, 5, 6, 7, 20].map(lockSeconds)).toEqual([0, 30, 60, 120, 900]);
    });
  });

  describe('revocation', () => {
    it('refuses PIN sign-in on a revoked device and ends its sessions', async () => {
      const a = await createStore();
      const cashier = await createCashier(app, a);
      await http()
        .post(`/staff/devices/${cashier.deviceId}/revoke`)
        .set('Authorization', a.auth)
        .expect(204);
      await cashier.signIn().expect(401);
      await http()
        .get('/tenant/me')
        .set('Authorization', cashier.auth)
        .expect(401);
    });

    it('revokes one cashier session and leaves the others', async () => {
      const a = await createStore();
      const cashier = await createCashier(app, a);
      const second = await cashier.signIn().expect(200);
      const sessions = await http()
        .get('/staff/sessions')
        .set('Authorization', a.auth)
        .expect(200);
      expect(sessions.body).toHaveLength(2);
      const oldest = sessions.body[1].id;
      await http()
        .post(`/staff/sessions/${oldest}/revoke`)
        .set('Authorization', a.auth)
        .expect(204);
      await http()
        .get('/tenant/me')
        .set('Authorization', cashier.auth)
        .expect(401);
      await http()
        .get('/tenant/me')
        .set('Authorization', `Bearer ${second.body.sessionToken}`)
        .expect(200);
    });

    it('ends the session when the cashier is deactivated', async () => {
      const a = await createStore();
      const cashier = await createCashier(app, a);
      await http()
        .patch(`/staff/${cashier.staffId}`)
        .set('Authorization', a.auth)
        .send({ active: false })
        .expect(200);
      await http()
        .get('/tenant/me')
        .set('Authorization', cashier.auth)
        .expect(401);
      await cashier.signIn().expect(401);
    });

    it('refuses a cashier token without a session id', async () => {
      const a = await createStore();
      const cashier = await createCashier(app, a);
      const bare = await signSession(
        { tenantId: a.tenantId, actorId: cashier.staffId, kind: 'cashier' },
        process.env.POS_SESSION_SECRET!,
      );
      await http()
        .get('/tenant/me')
        .set('Authorization', `Bearer ${bare}`)
        .expect(401);
    });
  });

  describe('permissions', () => {
    it('gives a cashier without staff.manage 403 on every management route', async () => {
      const a = await createStore();
      const cashier = await createCashier(app, a, ['sales.create']);
      for (const path of [
        '/staff',
        '/roles',
        '/staff/devices',
        '/staff/sessions',
      ])
        await http().get(path).set('Authorization', cashier.auth).expect(403);
      await http()
        .post('/staff')
        .set('Authorization', cashier.auth)
        .send({ name: 'Me', pin: '1234' })
        .expect(403);
      await http()
        .patch(`/roles/${cashier.roleId}`)
        .set('Authorization', cashier.auth)
        .send({ permissions: ['staff.manage'] })
        .expect(403);
    });

    it('lets a cashier with staff.manage manage staff', async () => {
      const a = await createStore();
      const manager = await createCashier(app, a, ['staff.manage']);
      await http().get('/staff').set('Authorization', manager.auth).expect(200);
    });

    it('gates the price override: 403 without, 201 with the permission and for owners', async () => {
      const a = await createStore();
      const plain = await createCashier(app, a, ['sales.create']);
      const trusted = await createCashier(app, a, ['sales.price_override']);
      await http()
        .post('/test-probe/override')
        .set('Authorization', plain.auth)
        .expect(403);
      await http()
        .post('/test-probe/override')
        .set('Authorization', trusted.auth)
        .expect(201);
      await http()
        .post('/test-probe/override')
        .set('Authorization', a.auth)
        .expect(201);
    });

    it('applies a role change on the next request, not at token expiry', async () => {
      const a = await createStore();
      const cashier = await createCashier(app, a, ['sales.price_override']);
      await http()
        .patch(`/roles/${cashier.roleId}`)
        .set('Authorization', a.auth)
        .send({ permissions: ['sales.create'] })
        .expect(200);
      await http()
        .post('/test-probe/override')
        .set('Authorization', cashier.auth)
        .expect(403);
    });
  });
});
