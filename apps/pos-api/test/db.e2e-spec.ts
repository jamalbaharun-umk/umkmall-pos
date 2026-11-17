import { readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { ADMIN_DATABASE_URL, APP_DATABASE_URL } from './support/env';

// U0 DoD "pos-role": RLS on every pos table, migrations journal inside pos, and the pos_app role
// can declare the tenant FK but cannot read UMKMall's public tables.
describe('pos schema and role', () => {
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const app = postgres(APP_DATABASE_URL, { max: 1 });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  it('enables RLS on every table in schema pos', async () => {
    const rows = await admin<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pos' and c.relkind = 'r' and c.relname <> '__drizzle_migrations'`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual(
      [],
    );
  });

  it('keeps the migrations journal in pos, not public', async () => {
    const [row] = await admin<{ schema: string | null }[]>`
      select to_regclass('pos.__drizzle_migrations')::text as schema`;
    expect(row.schema).not.toBeNull();
    const [pub] = await admin<{ t: string | null }[]>`
      select to_regclass('public.__drizzle_migrations')::text as t`;
    expect(pub.t).toBeNull();
  });

  it('lets pos_app read public.users (id, delete_status_flag) and no other column', async () => {
    await expect(
      app`select id, delete_status_flag from public.users limit 1`,
    ).resolves.toBeDefined();
    await expect(app`select * from public.users limit 1`).rejects.toThrow(
      /permission denied/,
    );
    await expect(app`select phone from public.users limit 1`).rejects.toThrow(
      /permission denied/,
    );
  });

  it('grants pos_app on public.users only REFERENCES (id) and SELECT (id, delete_status_flag)', async () => {
    const [p] = await admin<Record<string, boolean>[]>`
      select has_table_privilege('pos_app', 'public.users', 'SELECT') as sel,
             has_table_privilege('pos_app', 'public.users', 'UPDATE') as upd,
             has_column_privilege('pos_app', 'public.users', 'id', 'REFERENCES') as ref,
             has_column_privilege('pos_app', 'public.users', 'id', 'SELECT') as id,
             has_column_privilege('pos_app', 'public.users', 'delete_status_flag', 'SELECT') as flag,
             has_column_privilege('pos_app', 'public.users', 'phone', 'SELECT') as phone`;
    expect(p).toEqual({
      sel: false,
      upd: false,
      ref: true,
      id: true,
      flag: true,
      phone: false,
    });
  });

  it('restricts deleting a UMKMall user that still has a store', async () => {
    const [u] = await admin<
      { id: string }[]
    >`insert into public.users default values returning id`;
    await app`insert into pos.tenants (user_id) values (${u.id})`;
    await expect(
      admin`delete from public.users where id = ${u.id}`,
    ).rejects.toThrow(/foreign key/);
  });

  // U8: UMKMall's archival (role `postgres`) reads pos.tenants (id, user_id) to wait for the purge; nothing
  // else. Local/CI clusters have no `postgres` role, so create a plain (non-superuser) one and re-apply the
  // migration as its owner, pos_app: non-superuser is the strict case, where the RLS policy is needed too.
  it('lets the postgres role read pos.tenants (id, user_id) and no other pos data', async () => {
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres NOLOGIN; END IF;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
    await app.unsafe(
      readFileSync(
        path.join(__dirname, '..', 'drizzle', '0012_tenants_postgres_read.sql'),
        'utf8',
      ),
    );
    const [u] = await admin<
      { id: string }[]
    >`insert into public.users default values returning id`;
    await app`insert into pos.tenants (user_id) values (${u.id})`;

    const asPostgres = async <T>(query: string): Promise<T[]> =>
      admin.begin(async (tx) => {
        await tx.unsafe('set local role postgres');
        return tx.unsafe(query) as unknown as T[];
      }) as Promise<T[]>;
    const rows = await asPostgres<{ user_id: string }>(
      `select id, user_id from pos.tenants where user_id = '${u.id}'`,
    );
    expect(rows).toHaveLength(1);
    await expect(
      asPostgres('select created_at from pos.tenants limit 1'),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asPostgres('select 1 from pos.products limit 1'),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asPostgres(
        `update pos.tenants set user_id = user_id where user_id = '${u.id}'`,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
