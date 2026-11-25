import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { PAYMENT_ADAPTERS } from '../../src/adapters/adapter';
import { cashacAdapters } from '../../src/adapters/cashac.adapter';
import { AppModule } from '../../src/app.module';
import { Clock, PaymentSettings } from '../../src/config';
import { DB, Db } from '../../src/db/db.module';
import { merchantAccounts } from '../../src/db/schema';
import { ReconciliationService } from '../../src/payments/reconciliation.service';
import { ADMIN_DATABASE_URL } from './env';
import { FakeGateway } from './fake-gateway';
import { merchantValues } from './merchants';

export const SERVICE_KEY = () => process.env.PAYMENT_SERVICE_KEY!;
export const MINUTE = 60_000;
export const DAY = 86_400_000;

/** A clock the test moves. Starts at the real time, so database defaults and it agree. */
export class FakeClock extends Clock {
  private offset = 0;
  now(): Date {
    return new Date(Date.now() + this.offset);
  }
  advance(ms: number) {
    this.offset += ms;
  }
}

export interface Harness {
  app: INestApplication;
  pg: FakeGateway;
  clock: FakeClock;
  settings: PaymentSettings;
  reconcile: ReconciliationService;
  /** Direct SQL as the database owner, for assertions only. */
  sql: postgres.Sql;
  /** POSTs a signed fake-PG notification for a bill. */
  deliver: (reference: string, eventId?: string) => request.Test;
  close: () => Promise<void>;
}

/** The real app, with the test-only fake gateway next to the shipped CASHAC adapters, and a fake clock. */
export async function createApp(): Promise<Harness> {
  const pg = new FakeGateway();
  const clock = new FakeClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYMENT_ADAPTERS)
    .useValue([...cashacAdapters(), pg])
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  const sql = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  return {
    app,
    pg,
    clock,
    settings: app.get(PaymentSettings),
    reconcile: app.get(ReconciliationService),
    sql,
    deliver: (reference, eventId) => {
      const hook = pg.webhook(reference, eventId);
      return request(app.getHttpServer())
        .post('/webhooks/fake')
        .set('Content-Type', 'application/json')
        .set('X-Fake-Signature', hook.signature)
        .send(hook.body);
    },
    close: async () => {
      await app.close();
      await sql.end();
    },
  };
}

export interface Payment {
  id: string;
  orderRef: string;
  status: string;
  [key: string]: any;
}

/**
 * A calling service acting for one store: every request carries the service key and that store's tenant id,
 * as pos-api will send them. A store is just a fresh uuid (the tenant lives in the caller's database).
 *
 * The store is seeded as onboarded at the `fake` gateway (active, every fake method on), so a test about
 * payments can charge a PG method at once; `{ merchant: false }` gives a store that never onboarded. The seed
 * is written while the store object is built, and every request of the store waits for it.
 */
export function createStore(
  app: INestApplication,
  options: { merchant?: boolean } = {},
) {
  const tenantId = randomUUID();
  const http = () => request(app.getHttpServer());
  const seeded: Promise<unknown> =
    options.merchant === false
      ? Promise.resolve()
      : // `.execute()` runs the insert once; the query builder itself would run again on every `then`.
        app
          .get<Db>(DB)
          .insert(merchantAccounts)
          .values(merchantValues({ tenantId }))
          .execute();
  const sign = (req: request.Test) => {
    // A supertest request is sent when it is awaited: hold that until the seed is in.
    const send = req.then.bind(req);
    req.then = ((ok: never, ko: never) =>
      seeded.then(() => send(ok, ko))) as typeof req.then;
    return req
      .set('X-Payment-Service-Key', SERVICE_KEY())
      .set('X-Tenant-Id', tenantId);
  };
  const post = (url: string, body: object = {}, idempotencyKey?: string) => {
    const req = sign(http().post(url));
    if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
    return req.send(body);
  };
  /** Charges as pos-api does: the key is the order reference plus the attempt number. */
  const chargeRaw = (over: Record<string, unknown> = {}) => {
    const body = {
      orderRef: `order-${randomUUID()}`,
      attempt: 1,
      method: 'cash',
      amount: 25_000,
      actorRef: 'cashier-1',
      ...over,
    };
    return post('/payments', body, `${body.orderRef}:${body.attempt}`);
  };
  return {
    tenantId,
    get: (url: string) => sign(http().get(url)),
    post,
    chargeRaw,
    /** Charges a new order and returns the payment (201 expected). */
    charge: async (over: Record<string, unknown> = {}): Promise<Payment> =>
      (await chargeRaw(over).expect(201)).body as Payment,
    /** A QR payment waiting for the payer. */
    qr: async (over: Record<string, unknown> = {}): Promise<Payment> => {
      const res = await chargeRaw({ method: 'fake_qris', ...over }).expect(201);
      expect(res.body.status).toBe('pending');
      return res.body as Payment;
    },
    read: async (id: string): Promise<Payment> =>
      (await sign(http().get(`/payments/${id}`)).expect(200)).body as Payment,
  };
}
export type Store = ReturnType<typeof createStore>;

export const CANCEL = {
  reasonCode: 'customer_cancelled',
  actorRef: 'cashier-1',
  approvedBy: 'supervisor-9',
};

/** Audit rows of a payment, oldest first. */
export const auditOf = (sql: postgres.Sql, paymentId: string) =>
  sql<
    {
      from_status: string | null;
      to_status: string;
      source: string;
      actor_ref: string;
      approved_by: string | null;
      reason_code: string | null;
      note: string | null;
    }[]
  >`select from_status, to_status, source, actor_ref, approved_by, reason_code, note
    from payment.payment_events where payment_id = ${paymentId} order by created_at, id`;

/** Topics of the outbox notices of a payment, oldest first. */
export const outboxOf = async (sql: postgres.Sql, paymentId: string) =>
  (
    await sql<{ topic: string }[]>`
      select topic from payment.outbox where payment_id = ${paymentId} order by created_at, id`
  ).map((r) => r.topic);

export const unmatchedOf = (sql: postgres.Sql, paymentId: string) =>
  sql<
    {
      id: string;
      kind: string;
      gross_amount: string;
      needs_review: boolean;
      refund_status: string;
      refund_actor: string | null;
    }[]
  >`select id, kind, gross_amount, needs_review, refund_status, refund_actor
    from payment.unmatched_receipts where payment_id = ${paymentId} order by created_at, id`;
