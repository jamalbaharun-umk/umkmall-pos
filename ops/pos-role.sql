-- POS database role and schema (UMK-1924 U0). Run ONCE per environment by a UMKMall database owner,
-- before pos-api's first migration. Set the password separately and store it only in the deploy
-- environment:  ALTER ROLE pos_app PASSWORD '<from the secret store>';
-- Idempotent: safe to re-run. test/db.e2e-spec.ts applies this exact file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app LOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL; -- created concurrently (roles are cluster-wide); nothing to do
END
$$;

-- The POS owns its schema and nothing else.
CREATE SCHEMA IF NOT EXISTS pos AUTHORIZATION pos_app;

-- The only grants into UMKMall's schema: enough to declare the tenant foreign key to users(id), and to read
-- whether an account is being deleted, so the purge refuses a reactivated account (UMK-1924 U8, owner
-- decision 2026-11-17). Column-level only: pos_app reads no name, phone or any other column of users.
-- EXISTING ENVIRONMENTS MUST RE-RUN THIS SCRIPT (owner step) to get the delete_status_flag grant; until then
-- every purge fails with 503 (permission denied on the check).
GRANT USAGE ON SCHEMA public TO pos_app;
GRANT REFERENCES (id) ON public.users TO pos_app;
GRANT SELECT (id, delete_status_flag) ON public.users TO pos_app;

-- Check (expect: false, true, true, true, false):
--   SELECT has_table_privilege('pos_app', 'public.users', 'SELECT'),
--          has_column_privilege('pos_app', 'public.users', 'id', 'REFERENCES'),
--          has_column_privilege('pos_app', 'public.users', 'id', 'SELECT'),
--          has_column_privilege('pos_app', 'public.users', 'delete_status_flag', 'SELECT'),
--          has_column_privilege('pos_app', 'public.users', 'phone', 'SELECT');  -- any other column: false

-- Not here: UMKMall's archive_deleted_users() (pg_cron, role `postgres`) reads pos.tenants (id, user_id) to
-- skip users whose store the POS has not purged yet (UMK-1924 U8). That grant needs pos.tenants to exist, so
-- it is a POS migration (apps/pos-api/drizzle/0012_tenants_postgres_read.sql, run by pos_app as owner), not
-- part of this pre-migration script.
