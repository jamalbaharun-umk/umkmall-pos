import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { ADMIN_DATABASE_URL, APP_DATABASE_URL, TEST_DB } from './support/env';

// The payment database as ops/payment-role.sql and the migrations build it (global-setup applies both).
describe('payment schema and role', () => {
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const app = postgres(APP_DATABASE_URL, { max: 1 });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  it('runs in its own database, never a POS one', async () => {
    const [row] = await app<{ db: string; who: string }[]>`
      select current_database() as db, current_user as who`;
    expect(row).toEqual({ db: TEST_DB, who: 'payment_app' });
    expect(row.db.startsWith('pos')).toBe(false);
    const [pos] = await admin<{ s: string | null }[]>`
      select to_regnamespace('pos')::text as s`;
    expect(pos.s).toBeNull();
  });

  it('enables RLS on every table in schema payment', async () => {
    const rows = await admin<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'payment' and c.relkind = 'r' and c.relname <> '__drizzle_migrations'`;
    expect(rows.map((r) => r.relname).sort()).toEqual([
      'payment_events',
      'payments',
    ]);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual(
      [],
    );
  });

  it('keeps the migrations journal in payment, not public', async () => {
    const [row] = await admin<{ t: string | null }[]>`
      select to_regclass('payment.__drizzle_migrations')::text as t`;
    expect(row.t).not.toBeNull();
    const [pub] = await admin<{ t: string | null }[]>`
      select to_regclass('public.__drizzle_migrations')::text as t`;
    expect(pub.t).toBeNull();
  });

  it('lets payment_app own its schema and create nothing outside it', async () => {
    const [p] = await admin<Record<string, boolean>[]>`
      select has_schema_privilege('payment_app', 'payment', 'CREATE') as own,
             has_database_privilege('payment_app', current_database(), 'CREATE') as db,
             has_schema_privilege('payment_app', 'public', 'CREATE') as pub,
             (select rolsuper or rolbypassrls or rolcreatedb or rolcreaterole
                from pg_roles where rolname = 'payment_app') as elevated`;
    expect(p).toEqual({ own: true, db: false, pub: false, elevated: false });
    await expect(app.unsafe('create schema other')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      app.unsafe('create table public.leak (id int)'),
    ).rejects.toThrow(/permission denied/);
  });

  it('stores money as bigint and refuses a negative amount or a second live payment at the database', async () => {
    const [col] = await admin<{ data_type: string }[]>`
      select data_type from information_schema.columns
      where table_schema = 'payment' and table_name = 'payments' and column_name = 'amount'`;
    expect(col.data_type).toBe('bigint');

    const tenant = randomUUID();
    const insert = (amount: number, key: string, status = 'paid') =>
      app`insert into payment.payments
            (tenant_id, order_ref, method, amount, status, idempotency_key, request_hash)
          values (${tenant}, 'o-1', 'cash', ${amount}, ${status}::payment.payment_status, ${key}, 'h')`;
    await expect(insert(-1, 'k-neg')).rejects.toThrow(/amount_non_negative/);
    await insert(1, 'k-1');
    await expect(insert(1, 'k-1b', 'failed')).resolves.toBeDefined();
    await expect(insert(1, 'k-2', 'pending')).rejects.toThrow(
      /payments_tenant_order_live/,
    );
    await expect(insert(1, 'k-1', 'failed')).rejects.toThrow(
      /payments_tenant_idempotency_key/,
    );
    await app`delete from payment.payments where tenant_id = ${tenant}`;
  });
});
