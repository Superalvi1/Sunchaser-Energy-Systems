-- READ-ONLY PRE-FLIGHT for scripts/smart-quote-versions-schema.sql
--
-- Run on the PRODUCTION database from a machine that can reach it, as the same role that will run the migration (normally the
-- Railway "postgres" superuser). Nothing here writes: every statement is a SELECT and the whole script runs in a READ ONLY
-- transaction that is rolled back. It prints counts and object names only - never customer values.
--
--   PGOPTIONS='-c default_transaction_read_only=on' \
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 [-v volume_bytes=1073741824] -f scripts/smart-quote-versions-preflight.sql | tee preflight.out
--   grep -E '\| BLOCKER +\|' preflight.out      # must print nothing before the migration is applied
--
-- Status words: PASS (assumption confirmed) | INFO (read it) | WARN (understand it, usually proceed) | BLOCKER (do not migrate).
-- Run it again immediately before applying: the "open transactions" and "locks" rows are only meaningful at that moment.

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
\pset border 1
\if :{?volume_bytes}
\else
\set volume_bytes 1073741824
\endif
begin transaction read only;
\echo
\echo === 1. Assumptions checked against the live catalogue ===
with
expected_cols(c) as (values ('id'),('quote_number'),('lead_id'),('customer_id'),('version_number'),('source'),('client_name'),('client_phone'),
  ('client_city'),('system_capacity_kw'),('panel'),('inverter'),('battery'),('structure'),('lines'),('subtotal_pkr'),('discount_pkr'),
  ('total_pkr'),('payload_sha256'),('generated_at'),('created_at'),('pdf_file_name'),('pdf_file_url'),('pdf_storage_path'),('pdf_sha256'),
  ('pdf_size_bytes'),('pdf_saved_at')),
col_type(tbl, col, typ) as (
  select c.relname, a.attname, format_type(a.atttypid, a.atttypmod)
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p')
),
checks(ord, area, item, status, detail) as (
  -- ---- server ----
  select 10, 'server', 'PostgreSQL version', case when current_setting('server_version_num')::int >= 140000 then 'PASS' else 'BLOCKER' end,
         current_setting('server_version') || ' (needs >= 14; production is documented as 17)'
  union all select 11, 'server', 'connected to a primary (not a standby)', case when pg_is_in_recovery() then 'BLOCKER' else 'PASS' end, 'pg_is_in_recovery=' || pg_is_in_recovery()
  union all select 12, 'server', 'default_transaction_read_only is off for normal sessions', case when exists (select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) c where c = 'default_transaction_read_only=on' and s.setdatabase in (0, (select oid from pg_database where datname = current_database())) and s.setrole in (0, (select oid from pg_roles where rolname = current_user))) or exists (select 1 from pg_settings where name = 'default_transaction_read_only' and setting = 'on' and source in ('configuration file', 'command line')) then 'BLOCKER' else 'PASS' end,
         'a server/database/role default of on would make the migration fail (this script forces read-only for its own session only)'
  union all select 13, 'server', 'migration role', case when has_schema_privilege(current_user, 'public', 'CREATE') then 'PASS' else 'BLOCKER' end,
         'current_user=' || current_user || ', superuser=' || (select rolsuper from pg_roles where rolname = current_user) || ', CREATE on schema public=' || has_schema_privilege(current_user, 'public', 'CREATE')
  union all select 14, 'server', 'REFERENCES privilege on leads and customers', case when coalesce(has_table_privilege(current_user, to_regclass('public.leads'), 'REFERENCES'), false) and coalesce(has_table_privilege(current_user, to_regclass('public.customers'), 'REFERENCES'), false) then 'PASS' else 'BLOCKER' end,
         'needed for the two foreign keys'
  union all select 15, 'server', 'timeouts that can interrupt or stall the migration', 'INFO',
         'statement_timeout=' || current_setting('statement_timeout') || ', lock_timeout=' || current_setting('lock_timeout') || ', idle_in_transaction_session_timeout=' || current_setting('idle_in_transaction_session_timeout')
  union all select 16, 'server', 'database encoding / collation', 'INFO',
         (select pg_encoding_to_char(encoding) || ' / ' || datcollate from pg_database where datname = current_database())
  -- ---- foreign-key targets ----
  union all select 20, 'schema', 'public.leads exists', case when to_regclass('public.leads') is not null then 'PASS' else 'BLOCKER' end, coalesce(to_regclass('public.leads')::text, 'missing')
  union all select 21, 'schema', 'leads.id type is text (the new lead_id is text)', case when (select typ from col_type where tbl = 'leads' and col = 'id') = 'text' then 'PASS' else 'BLOCKER' end,
         coalesce((select typ from col_type where tbl = 'leads' and col = 'id'), 'column missing')
  union all select 22, 'schema', 'leads.id is a plain unique key (FK target)', case when exists (select 1 from pg_index i where i.indrelid = to_regclass('public.leads') and i.indisunique and i.indisvalid and i.indnatts = 1 and i.indpred is null and i.indexprs is null and (select attname from pg_attribute where attrelid = i.indrelid and attnum = i.indkey[0]) = 'id') then 'PASS' else 'BLOCKER' end,
         'a partial or expression index cannot be referenced'
  union all select 23, 'schema', 'leads columns the application reads: ' || col, case when exists (select 1 from col_type where tbl = 'leads' and col_type.col = x.col) then 'PASS' else 'BLOCKER' end,
         coalesce((select typ from col_type where tbl = 'leads' and col_type.col = x.col), 'missing')
         from (values ('deleted_at'),('notes'),('phone'),('name'),('customer_id'),('location'),('created_at'),('lead_source')) x(col)
  union all select 24, 'schema', 'public.customers exists', case when to_regclass('public.customers') is not null then 'PASS' else 'BLOCKER' end, coalesce(to_regclass('public.customers')::text, 'missing')
  union all select 25, 'schema', 'customers.id type is text (customer_id is text)', case when (select typ from col_type where tbl = 'customers' and col = 'id') = 'text' then 'PASS' else 'BLOCKER' end,
         coalesce((select typ from col_type where tbl = 'customers' and col = 'id'), 'column missing')
  union all select 26, 'schema', 'customers.id is a plain unique key (FK target)', case when exists (select 1 from pg_index i where i.indrelid = to_regclass('public.customers') and i.indisunique and i.indisvalid and i.indnatts = 1 and i.indpred is null and i.indexprs is null and (select attname from pg_attribute where attrelid = i.indrelid and attnum = i.indkey[0]) = 'id') then 'PASS' else 'BLOCKER' end, ''
  union all select 27, 'schema', 'invoices.created_by_user_id (production-only column) exists', case when exists (select 1 from col_type where tbl = 'invoices' and col = 'created_by_user_id') then 'PASS' else 'WARN' end,
         coalesce((select typ from col_type where tbl = 'invoices' and col = 'created_by_user_id'), 'missing - payment/invoice code that reads it will fail; not part of this migration')
  union all select 28, 'schema', 'invoices.id / invoice_payments.id / invoice_payments.invoice_id types', 'INFO',
         coalesce((select typ from col_type where tbl = 'invoices' and col = 'id'), '?') || ' / ' || coalesce((select typ from col_type where tbl = 'invoice_payments' and col = 'id'), '?') || ' / ' || coalesce((select typ from col_type where tbl = 'invoice_payments' and col = 'invoice_id'), '?')
  -- ---- roles used by revoke / grant / policy ----
  union all select 40, 'roles', 'role ' || r || ' exists', case when exists (select 1 from pg_roles where rolname = r) then 'PASS' else 'BLOCKER' end, 'revoke/grant/create policy name this role'
         from unnest(array['anon', 'authenticated', 'service_role']) r
  union all select 41, 'roles', 'service_role bypasses RLS (info: the policy is still created)', 'INFO', coalesce((select 'rolbypassrls=' || rolbypassrls::text || ', login=' || rolcanlogin::text from pg_roles where rolname = 'service_role'), 'role missing')
  union all select 42, 'roles', 'roles that can switch to service_role (PostgREST connection roles)', case when n > 0 then 'PASS' else 'WARN' end,
         coalesce(names, 'none: PostgREST cannot SET ROLE service_role, the CRM would get permission errors')
         from (select count(*) n, string_agg(m.rolname, ', ' order by m.rolname) names from pg_roles m where m.rolname !~ '^pg_' and m.rolname <> 'service_role' and pg_has_role(m.oid, (select oid from pg_roles where rolname = 'service_role'), 'MEMBER') and not m.rolsuper) q
  union all select 43, 'roles', 'anon/authenticated can already read leads, customers or users', case when exists (select 1 from pg_roles r cross join (values ('leads'), ('customers'), ('users')) t(n) where r.rolname in ('anon', 'authenticated') and coalesce(has_table_privilege(r.oid, to_regclass('public.' || t.n), 'SELECT'), false)) then 'WARN' else 'PASS' end,
         coalesce((select string_agg(r.rolname || ' can read ' || t.n, ', ') from pg_roles r cross join (values ('leads'), ('customers'), ('users')) t(n) where r.rolname in ('anon', 'authenticated') and coalesce(has_table_privilege(r.oid, to_regclass('public.' || t.n), 'SELECT'), false)), 'no') ||
         '. supabase-schema.sql creates RLS policies "for all using (true)" with no role, so only table grants protect these tables (users holds password hashes). If WARN: review the grants - outside this migration, but urgent.'
  union all select 44, 'roles', 'default privileges that auto-grant new public tables to anon/authenticated/PUBLIC', case when n = 0 then 'PASS' else 'WARN' end,
         n || ' rule(s). New tables - including smart_quote_versions_rollback_backup - would be readable by those roles unless revoked (the fixed rollback revokes them)'
         from (select count(*) n from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclobjtype = 'r' and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))) q
  -- ---- target objects must not collide ----
  union all select 50, 'target', 'public.smart_quote_versions does not exist yet', case when to_regclass('public.smart_quote_versions') is null then 'PASS' else 'WARN' end,
         case when to_regclass('public.smart_quote_versions') is null then 'absent (expected before the first apply)' else 'ALREADY EXISTS: create table if not exists will NOT change it. Run scripts/smart-quote-versions-verify.sql to compare its shape.' end
  union all select 51, 'target', 'missing columns if the table already exists', case when to_regclass('public.smart_quote_versions') is null then 'PASS' when n = 0 then 'PASS' else 'BLOCKER' end,
         case when to_regclass('public.smart_quote_versions') is null then 'n/a' else coalesce(names, 'none missing') end
         from (select count(*) n, string_agg(c, ', ') names from expected_cols e where to_regclass('public.smart_quote_versions') is not null and not exists (select 1 from col_type where tbl = 'smart_quote_versions' and col = e.c)) q
  union all select 52, 'target', 'index/constraint names free for the new table', case when n = 0 then 'PASS' else 'BLOCKER' end, coalesce(names, 'free')
         from (select count(*) n, string_agg(c.relname || ' on ' || coalesce(t.relname, '?'), ', ') names from pg_class c join pg_namespace ns on ns.oid = c.relnamespace left join pg_index i on i.indexrelid = c.oid left join pg_class t on t.oid = i.indrelid
               where ns.nspname = 'public' and c.relname in ('smart_quote_versions_pkey', 'smart_quote_versions_quote_number_key', 'smart_quote_versions_lead_version_key', 'smart_quote_versions_lead_created_idx')
                 and coalesce(t.relname, '') <> 'smart_quote_versions') q
  union all select 53, 'target', 'function public.smart_quote_versions_immutable() present', 'INFO', case when to_regprocedure('public.smart_quote_versions_immutable()') is null then 'absent' else 'present (create or replace will overwrite it)' end
  union all select 54, 'target', 'leftover rollback backup table present', case when to_regclass('public.smart_quote_versions_rollback_backup') is null then 'PASS' else 'WARN' end,
         case when to_regclass('public.smart_quote_versions_rollback_backup') is null then 'absent' else 'present from an earlier rollback: it may hold customer phone numbers - review and drop only after export' end
  -- ---- concurrency ----
  union all select 60, 'activity', 'can see other sessions (pg_read_all_stats / superuser)', case when pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER') then 'PASS' else 'WARN' end, 'without it the next rows are blind'
  union all select 61, 'activity', 'transactions open for more than 30 seconds (other sessions)', case when n = 0 then 'PASS' else 'WARN' end,
         n || ' session(s); oldest ' || coalesce(oldest, '-') || '. A transaction that touched leads/customers makes the migration wait for it, and every later write to those tables queues behind the waiting migration.'
         from (select count(*) n, max(now() - xact_start)::text oldest from pg_stat_activity where pid <> pg_backend_pid() and backend_type = 'client backend' and xact_start < now() - interval '30 seconds') q
  union all select 62, 'activity', 'sessions idle in transaction', case when n = 0 then 'PASS' else 'WARN' end, n || ' session(s)' from (select count(*) n from pg_stat_activity where pid <> pg_backend_pid() and state like 'idle in transaction%') q
  union all select 63, 'activity', 'prepared (two-phase) transactions', case when n = 0 then 'PASS' else 'BLOCKER' end, n || ' pending' from (select count(*) n from pg_prepared_xacts) q
  union all select 64, 'activity', 'locks held by other sessions on leads/customers', case when n = 0 then 'PASS' else 'WARN' end, n || ' lock(s); the migration needs SHARE ROW EXCLUSIVE on both tables, which conflicts with ROW EXCLUSIVE (any open write)'
         from (select count(*) n from pg_locks l join pg_class c on c.oid = l.relation where l.pid <> pg_backend_pid() and l.granted and c.relname in ('leads', 'customers') and c.relnamespace = 'public'::regnamespace and l.mode in ('RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')) q
  union all select 65, 'activity', 'PostgREST sessions listening on channel pgrst (NOTIFY reload works)', case when n > 0 then 'PASS' else 'WARN' end,
         n || ' LISTEN session(s). If 0: NOTIFY will not reload the schema cache - restart or SIGUSR1 PostgREST after the migration (pooler in front, channel disabled, or no visibility).'
         from (select count(*) n from pg_stat_activity where query ilike 'listen%pgrst%') q
  union all select 66, 'activity', 'connections in use / max', 'INFO', (select count(*) from pg_stat_activity where backend_type = 'client backend') || ' / ' || current_setting('max_connections')
  -- ---- size ----
  union all select 70, 'size', 'database size vs volume (:volume_bytes bytes assumed)', case when pg_database_size(current_database()) > :volume_bytes::bigint * 0.7 then 'WARN' else 'PASS' end,
         pg_size_pretty(pg_database_size(current_database())) || ' of ' || pg_size_pretty(:volume_bytes::bigint) || ' (' || round(100.0 * pg_database_size(current_database()) / :volume_bytes::bigint, 1) || '%); the migration adds well under 1 MB, a pg_dump needs scratch space elsewhere'
  union all select 72, 'size', 'extensions installed', 'INFO', (select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension)
  -- ---- other objects touching leads (side effects to know about) ----
  union all select 80, 'impact', 'foreign keys already pointing at leads / customers', 'INFO', (select count(*) from pg_constraint where contype = 'f' and confrelid = to_regclass('public.leads')) || ' / ' || (select count(*) from pg_constraint where contype = 'f' and confrelid = to_regclass('public.customers'))
  union all select 81, 'impact', 'triggers on leads / customers', 'INFO', coalesce((select string_agg(c.relname || '.' || t.tgname, ', ') from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.oid in (to_regclass('public.leads'), to_regclass('public.customers'))), 'none')
  union all select 82, 'impact', 'row-level security on leads / customers', 'INFO', coalesce((select string_agg(relname || '=' || relrowsecurity::text, ', ') from pg_class where oid in (to_regclass('public.leads'), to_regclass('public.customers'))), 'n/a')
)
select area, item, status, detail from checks order by ord, item;

\echo
\echo === 2. Data the migration will meet (counts only) ===
select $q$
  select 'leads' as measure, count(*)::text as value, 'total / active / soft-deleted = ' || count(*) || ' / ' || count(*) filter (where deleted_at is null) || ' / ' || count(*) filter (where deleted_at is not null) as note from public.leads
$q$ where to_regclass('public.leads') is not null and coalesce(has_table_privilege(current_user, to_regclass('public.leads'), 'SELECT'), false) \gexec
select $q$ select 'customers' as measure, count(*)::text as value, '' as note from public.customers $q$ where to_regclass('public.customers') is not null and coalesce(has_table_privilege(current_user, to_regclass('public.customers'), 'SELECT'), false) \gexec
select $q$ select 'quotations' as measure, count(*)::text as value, '' as note from public.quotations $q$ where to_regclass('public.quotations') is not null and coalesce(has_table_privilege(current_user, to_regclass('public.quotations'), 'SELECT'), false) \gexec
select $q$ select 'invoices / invoice_payments' as measure, (select count(*) from public.invoices) || ' / ' || (select count(*) from public.invoice_payments) as value, '' as note $q$ where to_regclass('public.invoices') is not null and coalesce(has_table_privilege(current_user, to_regclass('public.invoices'), 'SELECT'), false) and to_regclass('public.invoice_payments') is not null and coalesce(has_table_privilege(current_user, to_regclass('public.invoice_payments'), 'SELECT'), false) \gexec
select $q$ select 'customer_documents' as measure, count(*)::text as value, '' as note from public.customer_documents $q$ where to_regclass('public.customer_documents') is not null and coalesce(has_table_privilege(current_user, to_regclass('public.customer_documents'), 'SELECT'), false) \gexec
select $q$
  select 'legacy Smart Quote blocks in lead notes' as measure, count(*) filter (where notes like '%SMART_QUOTE_V1%')::text as value,
         'distinct quote numbers=' || count(distinct substring(notes from '(?n)^Quote: (.*)$')) filter (where notes like '%SMART_QUOTE_V1%')
         || ', malformed or missing quote number (will not become version 1)=' || count(*) filter (where notes like '%SMART_QUOTE_V1%' and coalesce(substring(notes from '(?n)^Quote: (.*)$'), '') !~ '^SES-[0-9]{8}-[0-9]{4}$')
         || ', with archived PDF=' || count(*) filter (where notes like '%SMART_QUOTE_V1%' and notes like '%PdfArchive: {%') as note
  from public.leads
$q$ where to_regclass('public.leads') is not null and coalesce(has_table_privilege(current_user, to_regclass('public.leads'), 'SELECT'), false) \gexec
select $q$
  select 'quote numbers used by more than one lead (unique quote_number)' as measure, count(*)::text as value, 'a duplicate would keep only one legacy block as a version' as note
  from (select substring(notes from '(?n)^Quote: (.*)$') q from public.leads where notes like '%SMART_QUOTE_V1%' group by 1 having count(*) > 1) d
$q$ where to_regclass('public.leads') is not null and coalesce(has_table_privilege(current_user, to_regclass('public.leads'), 'SELECT'), false) \gexec
select $q$
  select 'active leads sharing one phone number (groups / largest group)' as measure, count(*)::text || ' / ' || coalesce(max(n), 0) as value,
         'phone-based matching picks one lead per canonical phone; groups > 0 means legacy duplicates exist' as note
  from (select right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) k, count(*) n from public.leads where deleted_at is null and length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10 group by 1 having count(*) > 1) d
$q$ where to_regclass('public.leads') is not null and coalesce(has_table_privilege(current_user, to_regclass('public.leads'), 'SELECT'), false) \gexec
select $q$ select 'WAL directory size' as measure, pg_size_pretty(sum(size)) as value, '' as note from pg_ls_waldir() $q$ where pg_has_role(current_user, 'pg_monitor', 'MEMBER') \gexec
select $q$
  select 'five largest tables' as measure, string_agg(relname || ' ' || pg_size_pretty(pg_total_relation_size(oid)), ', ' order by pg_total_relation_size(oid) desc) as value, '' as note
  from (select oid, relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace order by pg_total_relation_size(oid) desc limit 5) t
$q$ \gexec

\echo
\echo === 3. Result ===
with s as (
  select 1 as one
)
select 'Review every BLOCKER and WARN row above. Zero BLOCKER rows is required before scripts/smart-quote-versions-schema.sql is applied.' as result from s;
rollback;
