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
-- Production has deny-all RLS on every public table (UMKMall migration 0058); so does the stub.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- Stand-in for UMKMall's personal columns, so tests can prove pos_app cannot read them.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
