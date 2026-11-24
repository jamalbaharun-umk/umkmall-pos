-- payment-api database role and schema (UMK-1991). Run ONCE per environment by a database owner, connected
-- to the payment database, before payment-api's first migration:
--   CREATE DATABASE payment;            -- once, from any other database (not part of this script)
--   \c payment
--   \i ops/payment-role.sql
-- Set the password separately and store it only in the deploy environment:
--   ALTER ROLE payment_app PASSWORD '<from the secret store>';
-- Idempotent: safe to re-run. apps/payment-api/test/support/global-setup.ts applies this exact file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payment_app') THEN
    CREATE ROLE payment_app LOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL; -- created concurrently (roles are cluster-wide); nothing to do
END
$$;

-- payment-api owns its schema and nothing else. It has no grant in the POS database or in UMKMall's
-- `public`: a tenant is a plain uuid the calling service vouches for, with no foreign key.
CREATE SCHEMA IF NOT EXISTS payment AUTHORIZATION payment_app;

-- Nothing of payment-api lives in `public` of this database; PUBLIC loses CREATE there on clusters older
-- than Postgres 15, where it was still the default.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Check (expect: true, false):
--   SELECT has_schema_privilege('payment_app', 'payment', 'CREATE'),
--          has_database_privilege('payment_app', current_database(), 'CREATE');
