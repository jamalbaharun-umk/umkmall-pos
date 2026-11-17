import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signSession } from '../src/tenancy/session';
import { createApp, createStore } from './support/fixtures';

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
});
