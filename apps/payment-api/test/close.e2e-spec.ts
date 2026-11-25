import { randomUUID } from 'node:crypto';
import {
  auditOf,
  createApp,
  createStore,
  Harness,
  outboxOf,
} from './support/fixtures';

/**
 * `POST /payments/close`: the caller gave up on a charge whose answer it never got. The key is closed for
 * good, so that charge can never be paid later (pos-api cancels a sale only on this answer, UMK-1991).
 */
describe('payments: close a charge key', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createApp();
  });
  afterAll(() => h.close());

  const body = (orderRef: string, over: Record<string, unknown> = {}) => ({
    orderRef,
    attempt: 1,
    method: 'cash',
    amount: 5200,
    actorRef: 'cashier-1',
    ...over,
  });
  const rows = (tenantId: string) =>
    h.sql<{ id: string; status: string; idempotency_key: string }[]>`
      select id, status, idempotency_key from payment.payments
      where tenant_id = ${tenantId} order by created_at, id`;

  it('writes a cancelled payment under a key that has none; a charge that arrives later answers it and never pays', async () => {
    const s = createStore(h.app);
    const orderRef = `sale-${randomUUID()}`;
    const key = `${orderRef}:1`;
    const closed = await s
      .post('/payments/close', body(orderRef), key)
      .expect(201);
    expect(closed.body).toMatchObject({
      orderRef,
      status: 'cancelled',
      amount: 5200,
      idempotencyKey: key,
      paidAt: null,
    });
    expect(await auditOf(h.sql, closed.body.id)).toMatchObject([
      { from_status: null, to_status: 'created', source: 'close' },
      { from_status: 'created', to_status: 'cancelled', source: 'close' },
    ]);
    expect(await outboxOf(h.sql, closed.body.id)).toEqual([
      'payment.cancelled',
    ]);

    // The charge that was on its way lands now.
    const late = await s.post('/payments', body(orderRef), key).expect(200);
    expect(late.body).toMatchObject({
      id: closed.body.id,
      status: 'cancelled',
    });
    // A repeated close answers the same row.
    const again = await s
      .post('/payments/close', body(orderRef), key)
      .expect(200);
    expect(again.body.id).toBe(closed.body.id);
    expect(await rows(s.tenantId)).toMatchObject([
      { id: closed.body.id, status: 'cancelled' },
    ]);
    expect(await auditOf(h.sql, closed.body.id)).toHaveLength(2);
    // The order is free for a new attempt.
    const second = await s
      .post('/payments', body(orderRef, { attempt: 2 }), `${orderRef}:2`)
      .expect(201);
    expect(second.body.status).toBe('paid');
  });

  it('answers the payment that already has the key, unchanged: a paid one stays paid', async () => {
    const s = createStore(h.app);
    const orderRef = `sale-${randomUUID()}`;
    const key = `${orderRef}:1`;
    const paid = await s.post('/payments', body(orderRef), key).expect(201);
    const closed = await s
      .post('/payments/close', body(orderRef), key)
      .expect(200);
    expect(closed.body).toMatchObject({ id: paid.body.id, status: 'paid' });
    expect(await auditOf(h.sql, paid.body.id)).toHaveLength(2);
    // The key with another request is refused, as for a charge.
    const other = await s
      .post('/payments/close', body(orderRef, { amount: 1 }), key)
      .expect(409);
    expect(other.body.code).toBe('idempotency_key_reused');
    expect((await s.read(paid.body.id)).status).toBe('paid');
  });

  it('a close and a charge at the same instant leave one payment, and both answers name it', async () => {
    const s = createStore(h.app);
    for (let i = 0; i < 15; i++) {
      const orderRef = `sale-${randomUUID()}`;
      const key = `${orderRef}:1`;
      const [a, b] = await Promise.all([
        s.post('/payments/close', body(orderRef), key),
        s.post('/payments', body(orderRef), key),
      ]);
      expect([200, 201]).toContain(a.status);
      expect([200, 201]).toContain(b.status);
      expect(a.body.id).toBe(b.body.id);
      expect(a.body.status).toBe(b.body.status);
      expect(['paid', 'cancelled']).toContain(a.body.status);
      const mine = (await rows(s.tenantId)).filter(
        (r) => r.idempotency_key === key,
      );
      expect(mine).toMatchObject([{ id: a.body.id, status: a.body.status }]);
    }
  });

  it('is per tenant, needs the key header and a valid body', async () => {
    const a = createStore(h.app);
    const b = createStore(h.app);
    const orderRef = `sale-${randomUUID()}`;
    const key = `${orderRef}:1`;
    await a.post('/payments', body(orderRef), key).expect(201);
    // The same key in another store is another payment.
    const closed = await b
      .post('/payments/close', body(orderRef), key)
      .expect(201);
    expect(closed.body.status).toBe('cancelled');
    expect((await rows(a.tenantId))[0].status).toBe('paid');
    await a.get(`/payments/${closed.body.id}`).expect(404);

    await b.post('/payments/close', body('x')).expect(422);
    await b
      .post('/payments/close', body('x', { amount: 1.5 }), 'x:1')
      .expect(422);
    await b
      .post('/payments/close', body('x', { method: 'kasbon' }), 'x:1')
      .expect(422);
    await b
      .post('/payments/close', { ...body('x'), tenantId: a.tenantId }, 'x:1')
      .expect(201);
    expect(await rows(a.tenantId)).toHaveLength(1);
  });
});
