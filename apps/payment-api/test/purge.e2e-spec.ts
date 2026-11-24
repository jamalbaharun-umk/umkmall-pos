import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import { deleteOrder } from '../src/purge/purge.service';
import { ADMIN_DATABASE_URL } from './support/env';
import { CANCEL, createApp, createStore } from './support/fixtures';

// Tables without tenant_id, on purpose. Anything else in `payment` must carry tenant_id, or the purge's
// runtime discovery (src/purge/purge.service.ts) would miss it and leave a store's rows behind after erasure.
const GLOBAL_TABLES = ['__drizzle_migrations'];

describe('tenant purge', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });

  beforeAll(async () => {
    ({ app } = await createApp());
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  async function tenantTables(): Promise<string[]> {
    const rows = await admin<{ name: string }[]>`
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
      const [{ n }] = await admin.unsafe<{ n: number }[]>(
        `select count(*)::int as n from payment."${t}" where tenant_id = $1`,
        [tenantId],
      );
      counts[t] = n;
    }
    return counts;
  }

  /** One store with rows in every tenant table: a paid, a voided and a pending online payment. */
  async function seededStore() {
    const s = createStore(app);
    await s.charge();
    const voided = await s.charge({ method: 'kasbon' });
    await s.post(`/payments/${voided.id}/void`, CANCEL).expect(200);
    await s.charge({ method: 'fake_online' });
    return s;
  }

  it('guard: every payment table except the migrations journal carries tenant_id', async () => {
    const rows = await admin<{ name: string; has: boolean }[]>`
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
    expect(Object.keys(before).length).toBeGreaterThanOrEqual(2);
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
    await createStore(app)
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
