-- LOCAL AND CI ONLY. A stub of UMKMall's public.users so the tenant foreign key can be created.
-- Never run against a UMKMall database: there, public.users is real and owned by UMKMall.
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
