-- UMK-1924 U8: UMKMall's archive_deleted_users() (pg_cron, role `postgres`) skips a user who still owns a
-- store, so it waits for the POS purge. It may read pos.tenants (id, user_id) and nothing else in pos.
-- The policy matters only where `postgres` is not a true superuser (managed Postgres): without it, RLS on
-- pos.tenants would hide every row and the check would wrongly see "no store". Skipped where no `postgres`
-- role exists (local and CI databases).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT USAGE ON SCHEMA pos TO postgres;
    GRANT SELECT (id, user_id) ON pos.tenants TO postgres;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'pos' AND tablename = 'tenants' AND policyname = 'tenants_postgres_read'
    ) THEN
      CREATE POLICY tenants_postgres_read ON pos.tenants FOR SELECT TO postgres USING (true);
    END IF;
  END IF;
END
$$;
