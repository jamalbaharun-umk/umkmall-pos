-- POS database role and schema (UMK-1924 U0). Run ONCE per environment by a UMKMall database owner,
-- before pos-api's first migration. Set the password separately and store it only in the deploy
-- environment:  ALTER ROLE pos_app PASSWORD '<from the secret store>';
-- Idempotent: safe to re-run. test/db.e2e-spec.ts applies this exact file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app LOGIN;
  END IF;
END
$$;

-- The POS owns its schema and nothing else.
CREATE SCHEMA IF NOT EXISTS pos AUTHORIZATION pos_app;

-- The only grant into UMKMall's schema: enough to declare the tenant foreign key to users(id).
GRANT USAGE ON SCHEMA public TO pos_app;
GRANT REFERENCES (id) ON public.users TO pos_app;

-- Check (expect: false, true):
--   SELECT has_table_privilege('pos_app', 'public.users', 'SELECT'),
--          has_column_privilege('pos_app', 'public.users', 'id', 'REFERENCES');
