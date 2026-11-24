import { deleteOrder } from '../src/purge/purge.service';
import {
  CANCEL,
  createApp,
  createStore,
  DAY,
  Harness,
  MINUTE,
} from './support/fixtures';

// Tables without tenant_id, on purpose. Anything else in `payment` must carry tenant_id, or the purge's
// runtime discovery (src/purge/purge.service.ts) would miss it and leave a store's rows behind after erasure.
const GLOBAL_TABLES = ['__drizzle_migrations'];

describe('tenant purge', () => {
  let h: Harness;
  let defaults: object;
  beforeAll(async () => {
    h = await createApp();
    defaults = { ...h.settings };
  });
  afterEach(() => {
    h.pg.reset();
    Object.assign(h.settings, defaults);
  });
  afterAll(() => h.close());

  async function tenantTables(): Promise<string[]> {
    const rows = await h.sql<{ name: string }[]>`
      select c.relname as name from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'payment' and c.relkind = 'r' and a.attname = 'tenant_id' and not a.attisdropped
      order by 1`;
    return rows.map((r) => r.name);
  }

  async function rowCounts(tenantId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const t of await tenantTables()) {
      const [{ n }] = await h.sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from payment."${t}" where tenant_id = $1`,
        [tenantId],
      );
      counts[t] = n;
    }
    return counts;
  }

  /**
   * One store with rows in every tenant table and nothing in flight: a paid and a voided CASHAC payment, a QR
   * payment paid by webhook and refunded, and unmatched money that was refunded.
   */
  async function seededStore() {
    const s = createStore(h.app);
    await s.charge();
    const voided = await s.charge();
    await s.post(`/payments/${voided.id}/void`, CANCEL).expect(200);
    const qr = await s.qr();
    h.pg.pay(qr.id);
    await h.deliver(qr.id).expect(200);
    h.pg.pay(qr.id, undefined, { force: true });
    await h.deliver(qr.id).expect(200);
    await s.post(`/payments/${qr.id}/refund`, CANCEL).expect(200);
    return s;
  }

  it('guard: every payment table except the migrations journal carries tenant_id', async () => {
    const rows = await h.sql<{ name: string; has: boolean }[]>`
      select c.relname as name, exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as has
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'payment' and c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThan(GLOBAL_TABLES.length);
    expect(
      rows
        .filter((r) => !r.has && !GLOBAL_TABLES.includes(r.name))
        .map((r) => r.name),
    ).toEqual([]);
  });

  it('deletes every row of one tenant, leaves another untouched, and is idempotent', async () => {
    const a = await seededStore();
    const b = await seededStore();

    const before = await rowCounts(a.tenantId);
    expect(Object.keys(before).sort()).toEqual([
      'outbox',
      'payment_events',
      'payments',
      'unmatched_receipts',
      'webhook_events',
    ]);
    // The seed must reach every tenant table, or this test proves nothing.
    expect(
      Object.entries(before)
        .filter(([, n]) => n === 0)
        .map(([t]) => t),
    ).toEqual([]);
    const bBefore = await rowCounts(b.tenantId);

    await a.post('/internal/tenants/purge').expect(200, { purged: true });

    const after = await rowCounts(a.tenantId);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect((await a.get('/payments').expect(200)).body.total).toBe(0);

    expect(await rowCounts(b.tenantId)).toEqual(bBefore);
    expect((await b.get('/payments').expect(200)).body.total).toBe(3);

    // A retry finds nothing; so does a tenant that never had a payment.
    await a.post('/internal/tenants/purge').expect(200, { purged: false });
    await createStore(h.app)
      .post('/internal/tenants/purge')
      .expect(200, { purged: false });
  });

  it('ignores a tenant id in the body: only the header’s tenant is purged', async () => {
    const a = await seededStore();
    const b = await seededStore();
    const bBefore = await rowCounts(b.tenantId);
    await a
      .post('/internal/tenants/purge', {
        tenantId: b.tenantId,
        tenant_id: b.tenantId,
      })
      .expect(200, { purged: true });
    expect(await rowCounts(b.tenantId)).toEqual(bBefore);
  });

  it('M13 erasing a store while a payment waits or a refund is under way is refused with what blocks it; allowed once they are resolved', async () => {
    const s = await seededStore();
    const waiting = await s.qr();
    const refunding = await s.qr();
    h.pg.pay(refunding.id);
    await h.deliver(refunding.id).expect(200);
    h.pg.refundMode = 'pending';
    await s.post(`/payments/${refunding.id}/refund`, CANCEL).expect(200);
    const before = await rowCounts(s.tenantId);

    const refused = await s.post('/internal/tenants/purge').expect(409);
    expect(refused.body).toMatchObject({
      code: 'payments_in_flight',
      meta: { waiting: 1, refunding: 1, refundFailed: 0 },
    });
    expect(await rowCounts(s.tenantId)).toEqual(before);

    await s
      .post(`/payments/${waiting.id}/cancel`, { actorRef: 'owner' })
      .expect(200);
    const still = await s.post('/internal/tenants/purge').expect(409);
    expect(still.body.meta).toEqual({
      waiting: 0,
      refunding: 1,
      refundFailed: 0,
    });
    for (const key of Object.keys(h.pg.bills.get(refunding.id)!.refunds))
      h.pg.finishRefund(key, 'succeeded');
    await h.deliver(refunding.id).expect(200);
    await s.post('/internal/tenants/purge').expect(200, { purged: true });
  });

  it('M19 a waiting payment always ends by expiry, and a refused refund blocks erasure for 30 days, not forever', async () => {
    const s = createStore(h.app);
    const stuck = await s.qr();
    const p = await s.qr();
    h.pg.pay(p.id);
    await h.deliver(p.id).expect(200);
    h.pg.refundMode = 'refuse';
    await s.post(`/payments/${p.id}/refund`, CANCEL).expect(200);

    const refused = await s.post('/internal/tenants/purge').expect(409);
    expect(refused.body.meta).toEqual({
      waiting: 1,
      refunding: 0,
      refundFailed: 1,
    });

    // Nobody ever pays or cancels the QR: it expires at the PG, and the reconciliation closes it.
    h.clock.advance(26 * MINUTE);
    h.pg.expire(stuck.id);
    await h.reconcile.tick();
    expect((await s.read(stuck.id)).status).toBe('expired');

    // Day 29: the refused refund still blocks. Day 31: it no longer does.
    h.clock.advance(29 * DAY);
    const day29 = await s.post('/internal/tenants/purge').expect(409);
    expect(day29.body.meta).toEqual({
      waiting: 0,
      refunding: 0,
      refundFailed: 1,
    });
    h.clock.advance(2 * DAY);
    await s.post('/internal/tenants/purge').expect(200, { purged: true });

    // The cap is configuration.
    const t = createStore(h.app);
    const q = await t.qr();
    h.pg.pay(q.id);
    await h.deliver(q.id).expect(200);
    await t.post(`/payments/${q.id}/refund`, CANCEL).expect(200);
    await t.post('/internal/tenants/purge').expect(409);
    h.settings.purgeFailedRefundBlockMs = 0;
    await t.post('/internal/tenants/purge').expect(200, { purged: true });
  });

  it('orders deletes children before parents and refuses a cycle', () => {
    expect(
      deleteOrder(
        ['payments', 'payment_events'],
        [{ child: 'payment_events', parent: 'payments' }],
      ),
    ).toEqual(['payment_events', 'payments']);
    expect(() =>
      deleteOrder(
        ['a', 'b'],
        [
          { child: 'a', parent: 'b' },
          { child: 'b', parent: 'a' },
        ],
      ),
    ).toThrow(/cycle/);
  });
});
