-- Disposable PostgreSQL role bootstrap for messaging schema tests.
-- Emulates Supabase role names only as needed for privilege validation.
-- This is NOT full Supabase/PostgREST parity.
--
-- Roles:
--   anon          — browser/anonymous PostgREST role (NOLOGIN)
--   authenticated — logged-in PostgREST role (NOLOGIN)
--   service_role  — trusted server role (NOLOGIN; SET ROLE in tests)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- Allow the session login role to assume emulated roles during tests.
GRANT anon TO CURRENT_USER;
GRANT authenticated TO CURRENT_USER;
GRANT service_role TO CURRENT_USER;

COMMENT ON ROLE anon IS 'Emulated Supabase anon role for disposable messaging tests';
COMMENT ON ROLE authenticated IS 'Emulated Supabase authenticated role for disposable messaging tests';
COMMENT ON ROLE service_role IS 'Emulated Supabase service_role (BYPASSRLS) for disposable messaging tests';
