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
      'merchant_account_events',
      'merchant_accounts',
      'merchant_webhook_events',
      'outbox',
      'payment_events',
      'payments',
      'unmatched_receipts',
      'webhook_events',
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
    const insert = (
      amount: number,
      key: string,
      attempt: number,
      status = 'paid',
    ) =>
      app`insert into payment.payments
            (tenant_id, order_ref, attempt, method, amount, status, idempotency_key, request_hash)
          values (${tenant}, 'o-1', ${attempt}, 'cash', ${amount},
                  ${status}::payment.payment_status, ${key}, 'h')`;
    await expect(insert(-1, 'k-neg', 1)).rejects.toThrow(/amount_non_negative/);
    await expect(insert(1, 'k-zero', 0)).rejects.toThrow(/attempt_positive/);
    await insert(1, 'k-1', 1);
    // Closed payments of the same order do not take the live slot…
    for (const [n, status] of ['failed', 'expired', 'cancelled'].entries())
      await expect(
        insert(1, `k-closed-${n}`, 10 + n, status),
      ).resolves.toBeDefined();
    // …a second created, pending or paid one is refused by the database itself.
    for (const status of ['created', 'pending', 'paid'])
      await expect(insert(1, `k-${status}`, 2, status)).rejects.toThrow(
        /payments_tenant_order_live/,
      );
    await expect(insert(1, 'k-1', 3, 'failed')).rejects.toThrow(
      /payments_tenant_idempotency_key/,
    );
    await expect(insert(1, 'k-again', 1, 'failed')).rejects.toThrow(
      /payments_tenant_order_attempt/,
    );
    await app`delete from payment.payments where tenant_id = ${tenant}`;
  });

  it('keeps one merchant account per tenant and provider, one event per provider event, and only known statuses and modes', async () => {
    const tenant = randomUUID();
    const insert = (
      status = 'not_submitted',
      mode = 'fake',
      provider = 'fake',
    ) =>
      app`insert into payment.merchant_accounts (tenant_id, provider, mode, status)
          values (${tenant}, ${provider}, ${mode}, ${status})`;
    await insert();
    await expect(insert()).rejects.toThrow(/merchant_accounts_tenant_provider/);
    await expect(insert('approved', 'fake', 'other')).rejects.toThrow(
      /merchant_accounts_status/,
    );
    await expect(insert('active', 'prod', 'other')).rejects.toThrow(
      /merchant_accounts_mode/,
    );
    const event = () =>
      app`insert into payment.merchant_webhook_events (provider, event_id) values ('fake', ${`m-${tenant}`})`;
    await event();
    await expect(event()).rejects.toThrow(
      /merchant_webhook_events_provider_event/,
    );
    // The inbox keeps no body: there is no column for one.
    const cols = await admin<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'payment' and table_name = 'merchant_webhook_events'`;
    expect(cols.map((c) => c.column_name)).not.toContain('body');
    await app`delete from payment.merchant_accounts where tenant_id = ${tenant}`;
    await app`delete from payment.merchant_webhook_events where event_id = ${`m-${tenant}`}`;
  });

  it('records unmatched money and webhook events once each, at the database', async () => {
    const tenant = randomUUID();
    const [p] = await app<{ id: string }[]>`
      insert into payment.payments
        (tenant_id, order_ref, method, amount, status, idempotency_key, request_hash)
      values (${tenant}, 'o-u', 'cash', 1, 'expired', 'k-u', 'h') returning id`;
    const receipt = () =>
      app`insert into payment.unmatched_receipts (tenant_id, payment_id, receipt_ref, kind, gross_amount)
          values (${tenant}, ${p.id}, 'r-1', 'late_payment', 1)`;
    await receipt();
    await expect(receipt()).rejects.toThrow(
      /unmatched_receipts_payment_receipt/,
    );
    const event = () =>
      app`insert into payment.webhook_events (provider, event_id, body) values ('fake', ${`e-${tenant}`}, '{}')`;
    await event();
    await expect(event()).rejects.toThrow(/webhook_events_provider_event/);
    await app`delete from payment.unmatched_receipts where tenant_id = ${tenant}`;
    await app`delete from payment.payments where tenant_id = ${tenant}`;
    await app`delete from payment.webhook_events where event_id = ${`e-${tenant}`}`;
  });
});
