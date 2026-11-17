import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Permission } from '../../src/staff/permissions';
import { createStore } from './fixtures';

type Store = Awaited<ReturnType<typeof createStore>>;

/** Through the real API: a role with `permissions`, a cashier with PIN `pin`, a bound device. */
// Staff names are unique per store: the first cashier is "Sari", later ones in the same store "Sari 2", ...
const perStore = new Map<string, number>();
function cashierName(tenantId: string): string {
  const n = (perStore.get(tenantId) ?? 0) + 1;
  perStore.set(tenantId, n);
  return n === 1 ? 'Sari' : `Sari ${n}`;
}

export async function createCashier(
  app: INestApplication,
  store: Store,
  permissions: Permission[] = ['sales.create'],
  pin = '123456',
) {
  const http = () => request(app.getHttpServer());
  const role = await http()
    .post('/roles')
    .set('Authorization', store.auth)
    .send({ name: `role-${Math.random().toString(36).slice(2)}`, permissions })
    .expect(201);
  const member = await http()
    .post('/staff')
    .set('Authorization', store.auth)
    .send({ name: cashierName(store.tenantId), pin, roleIds: [role.body.id] })
    .expect(201);
  const device = await http()
    .post('/staff/devices')
    .set('Authorization', store.auth)
    .send({ name: 'Kasir depan' })
    .expect(201);
  const deviceToken: string = device.body.deviceToken;
  const signIn = (p = pin) =>
    http()
      .post('/auth/pin')
      .set('X-Pos-Device', deviceToken)
      .send({ staffId: member.body.id, pin: p });
  const res = await signIn().expect(200);
  return {
    staffId: member.body.id as string,
    roleId: role.body.id as string,
    deviceId: device.body.device.id as string,
    deviceToken,
    auth: `Bearer ${res.body.sessionToken}`,
    signIn,
  };
}
