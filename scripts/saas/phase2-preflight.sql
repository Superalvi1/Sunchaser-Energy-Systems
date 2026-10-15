-- Phase 2 preflight. READ ONLY: every statement is a SELECT and the transaction is read-only.
-- Run on the target database BEFORE phase2-company-foundation.sql and keep the output with the approval record.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/saas/phase2-preflight.sql
-- A line starting with BLOCKER must be resolved first. WARN needs a decision. INFO is for the record.
begin read only;
\pset format aligned
\pset border 1

\echo '== 1. Server and roles'
select current_database() as database, version() as server_version, current_setting('server_version_num')::int >= 140000 as pg14_or_newer;
select rolname, rolsuper as superuser, rolbypassrls as bypass_rls from pg_roles where rolname in ('postgres','anon','authenticated','service_role','authenticator','crm_tenant') order by 1;
select case when exists (select 1 from pg_roles where rolname = 'service_role') then 'INFO service_role exists' else 'BLOCKER service_role role is missing: the CRM key cannot work as assumed' end as check_service_role;
select case when exists (select 1 from pg_roles where rolname = 'authenticator') then 'INFO authenticator exists (PostgREST login role)' else 'WARN no authenticator role: grant crm_tenant to the role PostgREST logs in as' end as check_authenticator;
select case when exists (select 1 from pg_roles where rolname = 'crm_tenant') then 'WARN crm_tenant already exists (migration is idempotent; confirm it is ours)' else 'INFO crm_tenant does not exist yet' end as check_tenant_role;
select case when exists (select 1 from pg_namespace where nspname = 'app') then 'WARN schema app already exists' else 'INFO schema app is free' end as check_app_schema;
select case when to_regclass('public.companies') is not null or to_regclass('public.company_memberships') is not null then 'BLOCKER companies/company_memberships already exist' else 'INFO new table names are free' end as check_new_tables;

\echo '== 2. Tables in public that scripts/saas/table-classification.json must cover (compare by eye or with the checker)'
select c.relname as table_name, c.relrowsecurity as rls_enabled, (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies,
       exists (select 1 from information_schema.columns k where k.table_schema='public' and k.table_name=c.relname and k.column_name='company_id') as has_company_id,
       c.reltuples::bigint as approx_rows
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1;

\echo '== 3. Legacy policies open to everyone (using (true)) — the exposure the migration removes'
select tablename, policyname, roles, cmd, qual from pg_policies where schemaname='public' and qual='true' order by 1,2;
\echo '== 3b. Who can reach those tables today (privileges held by anon / authenticated / PUBLIC). Any row here with a table above is a LIVE EXPOSURE through PostgREST.'
select grantee, count(distinct table_name) as tables_granted, string_agg(distinct privilege_type, ',') as privileges
from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','PUBLIC') group by 1;
select case when exists (select 1 from information_schema.role_table_grants g join pg_policies p on p.tablename=g.table_name and p.schemaname='public' and p.qual='true'
                         where g.table_schema='public' and g.grantee in ('anon','authenticated','PUBLIC'))
            then 'WARN anon/authenticated/PUBLIC hold table privileges AND an open policy exists: data may be readable without the service key. Check PostgREST db-anon-role and network exposure.'
            else 'INFO no open policy is combined with anon/authenticated/PUBLIC table privileges' end as check_open_exposure;

\echo '== 4. Functions that bypass row security (SECURITY DEFINER) — the tenant role will lose EXECUTE on all application functions'
select p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer, n.nspname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by p.prosecdef desc, 1;

\echo '== 5. Existing company_id columns (type and default) — the migration reuses these in place'
select table_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and column_name='company_id' order by 1;

\echo '== 6. Unique keys on tenant-looking tables that do NOT include company_id (cross-company collision / probing risk; tracked as Phase 3/4 work)'
select c.conrelid::regclass as table_name, c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.contype in ('u') and c.connamespace='public'::regnamespace and pg_get_constraintdef(c.oid) not like '%company_id%' order by 1,2;

\echo '== 7. Triggers on public tables (the migration adds tenant_ref_check; confirm nothing conflicts)'
select tgrelid::regclass as table_name, tgname, pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'pg_%' order by 1,2;

\echo '== 8. Is it safe to run now? long transactions and size'
select pid, now() - xact_start as open_for, state, left(query, 80) as query from pg_stat_activity where xact_start is not null and now() - xact_start > interval '30 seconds' and pid <> pg_backend_pid();
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select case when exists (select 1 from pg_stat_activity where xact_start is not null and now() - xact_start > interval '5 minutes' and pid <> pg_backend_pid())
            then 'WARN a transaction has been open for over 5 minutes: it can block the migration (lock_timeout will fail it safely)' else 'INFO no long-running transactions' end as check_long_tx;

\echo '== 9. Users that will become members of the founding company'
select role, account_status, count(*) from public.users group by 1,2 order by 1,2;
select case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='is_platform_admin') then 'WARN users.is_platform_admin already exists' else 'INFO users.is_platform_admin will be added (default false)' end as check_platform_flag;

\echo '== 10. Tables the code uses that are not in tracked SQL (expect: bills)'
select to_regclass('public.bills') is not null as bills_exists;

rollback;
