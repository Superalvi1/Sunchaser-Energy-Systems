-- READ-ONLY preflight for scripts/session-revocation-schema.sql. Changes nothing (no DDL, no DML).
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/session-revocation-preflight.sql
\set ON_ERROR_STOP on
begin read only;

select
  to_regclass('public.users') is not null                                           as users_table_exists,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='users' and column_name='session_epoch') as session_epoch_present,
  to_regclass('public.revoked_sessions') is not null                                as revoked_sessions_present,
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='users' and column_name='session_epoch')
        and to_regclass('public.revoked_sessions') is not null
       then 'already applied (re-applying is a harmless no-op)'
       else 'not (fully) applied - safe to apply; the app is unaffected until then' end as verdict;

-- Size of the table the migration alters (adding a column with a constant default is a metadata-only change on PG 11+).
select count(*) as users_rows from public.users;
select version() as postgres_version;

-- The service role the app uses must exist for the grants/policy in the migration.
select exists (select 1 from pg_roles where rolname = 'service_role') as service_role_exists;

rollback;
