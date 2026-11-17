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

  it('refuses pos_app on public.users reads', async () => {
    await expect(app`select id from public.users limit 1`).rejects.toThrow(
      /permission denied/,
    );
  });

  it('lets pos_app reference public.users(id) and nothing more', async () => {
    const [p] = await admin<{ sel: boolean; ref: boolean }[]>`
      select has_table_privilege('pos_app', 'public.users', 'SELECT') as sel,
             has_column_privilege('pos_app', 'public.users', 'id', 'REFERENCES') as ref`;
    expect(p).toEqual({ sel: false, ref: true });
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
});
