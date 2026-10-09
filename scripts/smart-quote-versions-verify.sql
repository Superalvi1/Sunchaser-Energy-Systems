-- READ-ONLY POST-MIGRATION VERIFICATION for scripts/smart-quote-versions-schema.sql
--
-- Run right after the migration (and again after the first real quotation). All statements are SELECTs inside a READ ONLY transaction
-- that is rolled back; only counts and object names are printed.
--
--   PGOPTIONS='-c default_transaction_read_only=on' \
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/smart-quote-versions-verify.sql | tee verify.out
--   grep -E '^ FAIL' verify.out      # must print nothing
--
-- Then confirm the API layer (cannot be seen from SQL):
--   1. GET /api/leads/<a lead id>/smart-quote-versions with a staff token  ->  {"available":true,"versions":[...]}   ("available":false means
--      PostgREST has not reloaded its schema cache: restart that service or send it SIGUSR1)
--   2. generate a quotation on the public Smart Quote page with a synthetic phone number you control, then re-run this script.

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
\pset border 1
begin transaction read only;
\echo === Post-migration verification: public.smart_quote_versions ===
with
expected(ord, col, typ, not_null) as (values
  (1,'id','text',true),(2,'quote_number','text',true),(3,'lead_id','text',true),(4,'customer_id','text',false),(5,'version_number','integer',true),
  (6,'source','text',true),(7,'client_name','text',true),(8,'client_phone','text',true),(9,'client_city','text',false),(10,'system_capacity_kw','numeric',true),
  (11,'panel','text',true),(12,'inverter','text',true),(13,'battery','text',true),(14,'structure','text',true),(15,'lines','jsonb',false),
  (16,'subtotal_pkr','numeric',false),(17,'discount_pkr','numeric',false),(18,'total_pkr','numeric',true),(19,'payload_sha256','text',true),
  (20,'generated_at','timestamp with time zone',true),(21,'created_at','timestamp with time zone',true),(22,'pdf_file_name','text',false),
  (23,'pdf_file_url','text',false),(24,'pdf_storage_path','text',false),(25,'pdf_sha256','text',false),(26,'pdf_size_bytes','integer',false),
  (27,'pdf_saved_at','timestamp with time zone',false)),
t as (select to_regclass('public.smart_quote_versions') as oid),
checks(ord, item, ok, detail) as (
  select 1, 'table exists', (select oid from t) is not null, coalesce((select oid::text from t), 'missing')
  union all select 2, 'columns: names, types, nullability',
         (select count(*) = 0 from expected e where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'smart_quote_versions' and c.column_name = e.col and c.data_type = e.typ and (c.is_nullable = 'NO') = e.not_null)),
         coalesce((select string_agg(e.col, ', ') from expected e where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'smart_quote_versions' and c.column_name = e.col and c.data_type = e.typ and (c.is_nullable = 'NO') = e.not_null)), 'all 27 present') ||
         coalesce(' ; unexpected extra columns: ' || (select string_agg(c.column_name, ', ') from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'smart_quote_versions' and c.column_name not in (select col from expected)), '')
  union all select 3, 'primary key (id)', exists (select 1 from pg_constraint where conrelid = (select oid from t) and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'), ''
  union all select 4, 'unique (quote_number)', exists (select 1 from pg_constraint where conrelid = (select oid from t) and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (quote_number)'), ''
  union all select 5, 'unique (lead_id, version_number)', exists (select 1 from pg_constraint where conrelid = (select oid from t) and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (lead_id, version_number)'), ''
  union all select 6, 'foreign key lead_id -> leads(id) ON DELETE RESTRICT', exists (select 1 from pg_constraint where conrelid = (select oid from t) and contype = 'f' and confrelid = 'public.leads'::regclass and confdeltype = 'r'), ''
  union all select 7, 'foreign key customer_id -> customers(id) ON DELETE SET NULL', exists (select 1 from pg_constraint where conrelid = (select oid from t) and contype = 'f' and confrelid = 'public.customers'::regclass and confdeltype = 'n'), ''
  union all select 8, 'check constraints (quote number format, version > 0, total >= 0)', (select count(*) from pg_constraint where conrelid = (select oid from t) and contype = 'c') = 3, (select count(*) || ' check constraint(s)' from pg_constraint where conrelid = (select oid from t) and contype = 'c')
  union all select 9, 'all constraints validated', not exists (select 1 from pg_constraint where conrelid = (select oid from t) and not convalidated), ''
  union all select 10, 'index (lead_id, created_at desc)', exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'smart_quote_versions' and indexname = 'smart_quote_versions_lead_created_idx'), ''
  union all select 11, 'no invalid indexes', not exists (select 1 from pg_index where indrelid = (select oid from t) and (not indisvalid or not indisready)), ''
  union all select 12, 'immutability trigger: BEFORE UPDATE, row level, enabled', exists (select 1 from pg_trigger g where g.tgrelid = (select oid from t) and g.tgname = 'smart_quote_versions_immutable' and g.tgenabled = 'O' and (g.tgtype & 2) = 2 and (g.tgtype & 16) = 16 and (g.tgtype & 1) = 1), 'tgenabled=O means fires for normal sessions'
  union all select 13, 'trigger function exists', to_regprocedure('public.smart_quote_versions_immutable()') is not null, ''
  union all select 14, 'row level security enabled', coalesce((select relrowsecurity from pg_class where oid = (select oid from t)), false), 'forced=' || coalesce((select relforcerowsecurity::text from pg_class where oid = (select oid from t)), '?') || ' (owner bypasses; expected false)'
  union all select 15, 'policy for service_role only (ALL, true/true)', (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'smart_quote_versions' and policyname = 'smart_quote_versions_service_role' and cmd = 'ALL' and roles = '{service_role}' and qual = 'true' and with_check = 'true')
         and (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'smart_quote_versions'), (select string_agg(policyname || ' for ' || roles::text, ', ') from pg_policies where tablename = 'smart_quote_versions')
  union all select 16, 'service_role may SELECT, INSERT and UPDATE', has_table_privilege('service_role', (select oid from t), 'SELECT') and has_table_privilege('service_role', (select oid from t), 'INSERT') and has_table_privilege('service_role', (select oid from t), 'UPDATE'), ''
  union all select 17, 'anon and authenticated have NO privilege at all', not (select coalesce(bool_or(has_table_privilege(r.oid, (select oid from t), p)), false) from pg_roles r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where r.rolname in ('anon', 'authenticated')), ''
  union all select 18, 'PUBLIC has no privilege', not exists (select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = (select oid from t) and a.grantee = 0), ''
  union all select 19, 'a role that PostgREST connects with can become service_role', exists (select 1 from pg_roles m where m.rolname !~ '^pg_' and not m.rolsuper and m.rolname <> 'service_role' and pg_has_role(m.oid, (select oid from pg_roles where rolname = 'service_role'), 'MEMBER')), coalesce((select string_agg(m.rolname, ', ') from pg_roles m where m.rolname !~ '^pg_' and not m.rolsuper and m.rolname <> 'service_role' and pg_has_role(m.oid, (select oid from pg_roles where rolname = 'service_role'), 'MEMBER')), 'none')
  union all select 20, 'PostgREST is listening for schema reloads', exists (select 1 from pg_stat_activity where query ilike 'listen%pgrst%'), 'if FAIL: restart PostgREST, then re-check the API'
  union all select 21, 'rollback backup table (if present) is locked down', coalesce((select relrowsecurity and not exists (select 1 from pg_roles r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where r.rolname in ('anon', 'authenticated', 'service_role') and has_table_privilege(r.oid, c.oid, p)) from pg_class c where c.oid = to_regclass('public.smart_quote_versions_rollback_backup')), true), case when to_regclass('public.smart_quote_versions_rollback_backup') is null then 'not present' else 'present - holds client phone numbers; export and drop when no longer needed' end
  union all select 22, 'service_role has no DELETE/TRUNCATE (the migration grants only select, insert, update; the immutability trigger does not cover DELETE)', not has_table_privilege('service_role', (select oid from t), 'DELETE') and not has_table_privilege('service_role', (select oid from t), 'TRUNCATE'), 'WARN if granted by default privileges or a blanket GRANT ALL: revoke delete, truncate on public.smart_quote_versions from service_role'
)
select case when ok then 'PASS' when ord = 22 then 'WARN' else 'FAIL' end as status, item, detail from checks order by ord;

\echo
\echo === Data integrity (counts only) ===
select $q$
  select 'versions' as measure, count(*)::text as value, 'leads with versions=' || count(distinct lead_id) as note from public.smart_quote_versions
$q$ where to_regclass('public.smart_quote_versions') is not null \gexec
select $q$
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as status, 'version numbers are 1..n without gaps per lead' as item, count(*) || ' lead(s) with a gap' as detail
  from (select lead_id from public.smart_quote_versions group by lead_id having max(version_number) <> count(*)) g
$q$ where to_regclass('public.smart_quote_versions') is not null \gexec
select $q$
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as status, 'every version points at an existing lead' as item, count(*) || ' orphan(s)' as detail
  from public.smart_quote_versions v where not exists (select 1 from public.leads l where l.id = v.lead_id)
$q$ where to_regclass('public.smart_quote_versions') is not null \gexec
select $q$
  select case when count(*) = 0 then 'PASS' else 'WARN' end as status, 'versions whose customer differs from their lead''s customer' as item, count(*) || ' (a lead may have been relinked; review if > 0)' as detail
  from public.smart_quote_versions v join public.leads l on l.id = v.lead_id where v.customer_id is distinct from l.customer_id
$q$ where to_regclass('public.smart_quote_versions') is not null \gexec
select $q$
  select case when count(*) = 0 then 'PASS' else 'WARN' end as status, 'lead summary points at the newest version' as item, count(*) || ' lead(s) whose notes show an older quote than their newest version (a save may be in flight)' as detail
  from (select v.lead_id from public.smart_quote_versions v join public.leads l on l.id = v.lead_id
        where v.version_number = (select max(version_number) from public.smart_quote_versions x where x.lead_id = v.lead_id)
          and l.notes like '%SMART_QUOTE_V1%' and l.notes not like '%Quote: ' || v.quote_number || '%') s
$q$ where to_regclass('public.smart_quote_versions') is not null and to_regclass('public.leads') is not null \gexec
select $q$
  select case when count(*) = 0 then 'PASS' else 'WARN' end as status, 'versions with an archived PDF reference but no stored sha256' as item, count(*) || '' as detail
  from public.smart_quote_versions where pdf_file_url is not null and (pdf_sha256 is null or pdf_size_bytes is null)
$q$ where to_regclass('public.smart_quote_versions') is not null \gexec
rollback;
