import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PAYMENT_ADAPTERS } from '../../src/adapters/adapter';
import { cashacAdapters } from '../../src/adapters/cashac.adapter';
import { AppModule } from '../../src/app.module';
import { FakeOnlineAdapter } from './fake-online.adapter';

export const SERVICE_KEY = () => process.env.PAYMENT_SERVICE_KEY!;

/** The real app, plus the test-only fake online adapter next to the shipped CASHAC ones. */
export async function createApp(): Promise<{
  app: INestApplication;
  fakeOnline: FakeOnlineAdapter;
}> {
  const fakeOnline = new FakeOnlineAdapter();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYMENT_ADAPTERS)
    .useValue([...cashacAdapters(), fakeOnline])
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, fakeOnline };
}

/**
 * A calling service acting for one store: every request carries the service key and that store's tenant id,
 * as pos-api will send them. A store is just a fresh uuid (the tenant lives in the caller's database).
 */
export function createStore(app: INestApplication) {
  const tenantId = randomUUID();
  const http = () => request(app.getHttpServer());
  const sign = (req: request.Test) =>
    req
      .set('X-Payment-Service-Key', SERVICE_KEY())
      .set('X-Tenant-Id', tenantId);
  return {
    tenantId,
    get: (url: string) => sign(http().get(url)),
    post: (url: string, body: object = {}, idempotencyKey?: string) => {
      const req = sign(http().post(url));
      if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
      return req.send(body);
    },
    /** Charges a new order and returns the payment. */
    charge: async (over: Record<string, unknown> = {}) => {
      const res = await sign(http().post('/payments'))
        .set('Idempotency-Key', randomUUID())
        .send({
          orderRef: `order-${randomUUID()}`,
          method: 'cash',
          amount: 25_000,
          actorRef: 'cashier-1',
          ...over,
        })
        .expect(201);
      return res.body as { id: string; orderRef: string; status: string };
    },
  };
}

export const CANCEL = {
  reason: 'Customer changed their mind',
  actorRef: 'cashier-1',
  approvedBy: 'supervisor-9',
};
