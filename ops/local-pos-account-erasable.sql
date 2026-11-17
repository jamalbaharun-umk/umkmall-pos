-- LOCAL AND CI ONLY. A stub of UMKMall's public.pos_account_erasable (UMKMall/umkmall#1839), so tests reach
-- public.users the way production does: pos_app cannot read the table (RLS, no grant), it can only ask this
-- SECURITY DEFINER function, owned by the admin role, which locks the row and answers whether the account
-- is marked for deletion. Runs after pos-role.sql, because it grants EXECUTE to pos_app.
CREATE OR REPLACE FUNCTION public.pos_account_erasable(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM public.users
  WHERE id = p_user_id AND delete_status_flag = 'to_delete'
  FOR SHARE;
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION public.pos_account_erasable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_account_erasable(uuid) TO pos_app;
