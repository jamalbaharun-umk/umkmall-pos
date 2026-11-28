import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { signSession } from '../src/tenancy/session';
import { PERMISSIONS } from '../src/staff/permissions';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';
import { ADMIN_DATABASE_URL } from './support/env';

describe('session guard and tenant context', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('answers /health without a session', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200, { status: 'ok' });
  });

  it('refuses a request with no session', async () => {
    await request(app.getHttpServer()).get('/tenant/me').expect(401);
  });

  it('refuses a token signed with another key', async () => {
    const store = await createStore();
    const forged = await signSession(
      { tenantId: store.tenantId, actorId: store.userId, kind: 'owner' },
      'a-different-key-that-is-at-least-32-chars-long',
    );
    await request(app.getHttpServer())
      .get('/tenant/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('serves each store only its own tenant', async () => {
    const a = await createStore();
    const b = await createStore();
    const resA = await request(app.getHttpServer())
      .get('/tenant/me')
      .set('Authorization', a.auth)
      .expect(200);
    const resB = await request(app.getHttpServer())
      .get('/tenant/me')
      .set('Authorization', b.auth)
      .expect(200);
    expect(resA.body.tenant.id).toBe(a.tenantId);
    expect(resB.body.tenant.id).toBe(b.tenantId);
  });

  it('names the signed-in actor and lists their permissions', async () => {
    const a = await createStore();
    const owner = await request(app.getHttpServer())
      .get('/tenant/me')
      .set('Authorization', a.auth)
      .expect(200);
    expect(owner.body.actor).toEqual({
      id: a.userId,
      kind: 'owner',
      name: null,
      permissions: [...PERMISSIONS],
    });
    const cashier = await createCashier(app, a, [
      'sales.create',
      'catalog.manage',
    ]);
    const me = await request(app.getHttpServer())
      .get('/tenant/me')
      .set('Authorization', cashier.auth)
      .expect(200);
    expect(me.body.actor.name).toBe('Sari');
    expect([...me.body.actor.permissions].sort()).toEqual([
      'catalog.manage',
      'sales.create',
    ]);
  });

  it('never resolves a cashier of another store', async () => {
    const a = await createStore();
    const b = await createStore();
    const cashier = await createCashier(app, a);
    const forged = await signSession(
      { tenantId: b.tenantId, actorId: cashier.staffId, kind: 'cashier' },
      process.env.POS_SESSION_SECRET!,
    );
    await request(app.getHttpServer())
      .get('/tenant/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('tells the owner shell about solo-owner mode (UMK-2121), and a cashier nothing', async () => {
    const a = await createStore();
    const me = async (auth: string) =>
      (
        await request(app.getHttpServer())
          .get('/tenant/me')
          .set('Authorization', auth)
          .expect(200)
      ).body.solo as Record<string, boolean> | null;
    expect(await me(a.auth)).toEqual({
      active: true,
      storeCash: false,
      ownerPin: false,
      freshSignIn: false,
    });
    expect((await me(a.freshAuth))?.freshSignIn).toBe(true);
    await request(app.getHttpServer())
      .put('/void-pin')
      .set('Authorization', a.freshAuth)
      .send({ pin: '480613' })
      .expect(200);
    expect((await me(a.auth))?.ownerPin).toBe(true);
    // Cash outside the drawer keeps Kas toko in the menu.
    const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
    try {
      await admin`insert into pos.store_cash_entries (tenant_id, direction, kind, amount, actor_id, actor_kind)
                  values (${a.tenantId}, 'in', 'receivable_payment', 5000, ${a.userId}, 'owner')`;
    } finally {
      await admin.end();
    }
    expect((await me(a.auth))?.storeCash).toBe(true);
    // The first staff member ends solo-owner mode; the cashier's own answer carries no solo block.
    const cashier = await createCashier(app, a, ['sales.create']);
    expect((await me(a.auth))?.active).toBe(false);
    expect(await me(cashier.auth)).toBeNull();
    // Store B is unaffected by A.
    const b = await createStore();
    expect(await me(b.auth)).toMatchObject({
      active: true,
      storeCash: false,
      ownerPin: false,
    });
  });
});
