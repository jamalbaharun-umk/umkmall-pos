-- LOCAL AND CI ONLY. A stub of UMKMall's public.users so the tenant foreign key can be created.
-- Never run against a UMKMall database: there, public.users is real and owned by UMKMall.
-- Idempotent and additive: per-session test databases keep public.users between runs.
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Same name, type and values as UMKMall's (packages/database/src/schema/users.ts): null = active,
-- 'to_delete' = inside the deletion grace window, 'archived' = archived. The purge reads it (U8).
DO $$
BEGIN
  CREATE TYPE public.user_delete_status_flag AS ENUM ('to_delete', 'archived');
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL;
END
$$;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS delete_status_flag public.user_delete_status_flag;
-- When the owner asked for deletion; the 30-day grace window runs from here (UMKMall's archiver cutoff).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS delete_date timestamptz;
-- Production has deny-all RLS on every public table (UMKMall migration 0058); so does the stub.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- Stand-in for UMKMall's personal columns, so tests can prove pos_app cannot read them.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;

-- Same definition as UMKMall migration 0198 (UMKMall/umkmall#1839), owned by the admin role. pos_app cannot
-- read public.users; the purge asks this. EXECUTE is granted by ops/pos-role.sql, as in production.
CREATE OR REPLACE FUNCTION public.pos_account_erasable(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Same cutoff as archive_deleted_users() Step 1 (30 days): inside the grace window the owner can still cancel, so
  -- not even the POS's own credential may erase the store early.
  PERFORM 1 FROM public.users
  WHERE id = p_user_id AND delete_status_flag = 'to_delete' AND delete_date <= now() - interval '30 days'
  FOR SHARE;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_account_erasable(uuid) FROM PUBLIC;
