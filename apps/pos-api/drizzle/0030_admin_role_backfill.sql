-- UMK-2021: the default "Admin" role for stores that already have their roles.
-- A store whose roles were never used has none yet: it gets Pemilik, Admin and Kasir on first use
-- (StaffAccess.ensureRoles). A store that already has a role named "admin" (any case) keeps it untouched.
-- The set is a snapshot of ADMIN_PERMISSIONS (src/staff/permissions.ts) at this commit: every permission
-- except staff.manage and payments.manage. Existing "Pemilik" roles are not changed.
WITH added AS (
  INSERT INTO "pos"."roles" ("tenant_id", "name")
  SELECT DISTINCT r."tenant_id", 'Admin'
  FROM "pos"."roles" r
  WHERE NOT EXISTS (
    SELECT 1 FROM "pos"."roles" a
    WHERE a."tenant_id" = r."tenant_id" AND lower(a."name") = 'admin'
  )
  RETURNING "id", "tenant_id"
)
INSERT INTO "pos"."role_permissions" ("tenant_id", "role_id", "permission")
SELECT added."tenant_id", added."id", p."permission"
FROM added
CROSS JOIN unnest(ARRAY[
  'sales.create',
  'sales.price_override',
  'catalog.manage',
  'reports.view',
  'purchasing.manage',
  'members.manage',
  'vouchers.manage',
  'receivables.manage',
  'sales.void',
  'expenses.manage',
  'store_cash.manage'
]) AS p("permission");
