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

-- The only grant into UMKMall's schema: enough to declare the tenant foreign key to users(id). public.users
-- has deny-all RLS (UMKMall migration 0058), so pos_app reads nothing there. The U8 purge asks UMKMall's
-- SECURITY DEFINER function public.pos_account_erasable(uuid) instead (UMKMall migration 0198,
-- UMKMall/umkmall#1839); it takes the row lock and answers whether the account is marked to_delete.
-- Order per environment: UMKMall migration 0198 → this script (grants EXECUTE below, also when pos_app was
-- created after 0198 ran) → only then POS_PURGE_ENABLED=true on UMKMall's purge-pos-stores job.
GRANT USAGE ON SCHEMA public TO pos_app;
GRANT REFERENCES (id) ON public.users TO pos_app;
DO $$
BEGIN
  IF to_regprocedure('public.pos_account_erasable(uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.pos_account_erasable(uuid) TO pos_app;
  END IF;
END
$$;
-- Withdrawn 2026-11-18 (useless under RLS); revoked so environments that ran the earlier version lose it.
-- Re-run this script on every existing environment (owner step).
REVOKE SELECT (id, delete_status_flag) ON public.users FROM pos_app;

-- Check (expect: false, true, false, true):
--   SELECT has_table_privilege('pos_app', 'public.users', 'SELECT'),
--          has_column_privilege('pos_app', 'public.users', 'id', 'REFERENCES'),
--          has_column_privilege('pos_app', 'public.users', 'id', 'SELECT'),
--          has_function_privilege('pos_app', 'public.pos_account_erasable(uuid)', 'EXECUTE');

-- Not here: UMKMall's archive_deleted_users() (pg_cron, role `postgres`) reads pos.tenants (id, user_id) to
-- skip users whose store the POS has not purged yet (UMK-1924 U8). That grant needs pos.tenants to exist, so
-- it is a POS migration (apps/pos-api/drizzle/0012_tenants_postgres_read.sql, run by pos_app as owner), not
-- part of this pre-migration script.
