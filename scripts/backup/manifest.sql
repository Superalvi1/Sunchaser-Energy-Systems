-- Deterministic, read-only manifest of a CRM database.
-- Used by pg-backup.sh (on the source, inside the dump's exported snapshot) and by restore-verify.sh (on the restored
-- database). A restore is only accepted when both manifests are identical (info lines excluded).
--
--   psql -X -qAt -F "$(printf '\t')" -v ON_ERROR_STOP=1 [-v snap=<exported snapshot id>] -f manifest.sql | LC_ALL=C sort
--
-- Output: one TSV line per fact:  kind <TAB> name <TAB> value [<TAB> value ...]
--   info   ...  informational only (never compared)
--   table  schema.table  <row count>  <md5 over the sorted md5 of every row's text form>   (order independent)
--   tattr  schema.table  relkind, owner, row-level security enabled/forced, column count
--   seq    schema.sequence  last_value  is_called   (restore may only be >= source when the source was written during the dump)
--   defs   <object kind>  <count>  <md5 of the sorted definitions>   (columns, constraints, indexes, triggers, policies, functions, views, ACLs)
--   count  <what>  <n>
--   ext / role / member / owner  ...
-- No row contents are ever printed: only counts and hashes.
-- Rows are hashed through their text form with fixed session settings, so the same data yields the same hash on any
-- server of the same major version. Memory use is ~35 bytes per row of the largest table (fine for a 50 MB database;
-- revisit above ~10 million rows in one table).

begin isolation level repeatable read read only;
\if :{?snap}
set transaction snapshot :'snap';
\endif
set local search_path = pg_catalog;
set local timezone = 'UTC';
set local datestyle = 'ISO, MDY';
set local intervalstyle = 'postgres';
set local extra_float_digits = 1;
set local bytea_output = 'hex';
set local lc_monetary = 'C';
set local standard_conforming_strings = on;
set local statement_timeout = 0;
\pset fieldsep '\t'
\pset tuples_only on
\pset format unaligned

-- ---- informational ----
select 'info', 'server_version', current_setting('server_version');
select 'info', 'server_version_num', current_setting('server_version_num');
select 'info', 'database', current_database();
select 'info', 'encoding', pg_encoding_to_char(encoding) from pg_database where datname = current_database();
select 'info', 'datcollate', datcollate from pg_database where datname = current_database();
select 'info', 'datctype', datctype from pg_database where datname = current_database();
select 'info', 'datlocprovider', datlocprovider::text from pg_database where datname = current_database();
select 'info', 'system_identifier', system_identifier::text from pg_control_system();
select 'info', 'manifest_generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

-- ---- one line per table: row count + order-independent content hash ----
select format($q$select 'table', %L, count(*)::text, coalesce(md5(string_agg(h, '' order by h collate "C")), md5('')) from (select md5(t::text) as h from %s t) s$q$,
              n.nspname || '.' || c.relname, format('%I.%I', n.nspname, c.relname))
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
  and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
order by n.nspname, c.relname
\gexec

select 'tattr', n.nspname || '.' || c.relname,
       'kind=' || c.relkind::text, 'owner=' || pg_get_userbyid(c.relowner),
       'rls=' || c.relrowsecurity::text, 'force=' || c.relforcerowsecurity::text,
       'cols=' || (select count(*) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'S') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
  and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');

-- ---- sequences (value and is_called of every sequence) ----
select format($q$select 'seq', %L, coalesce((select last_value::text from %s), ''), (select is_called::text from %s)$q$,
              n.nspname || '.' || c.relname, format('%I.%I', n.nspname, c.relname), format('%I.%I', n.nspname, c.relname))
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'S' and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
order by n.nspname, c.relname
\gexec

-- ---- definition hashes: any change to a column, constraint, index, trigger, policy, function, view or ACL changes the hash ----
with objs as (
  select 'columns' as k, format('%s.%s.%s %s notnull=%s default=%s identity=%s generated=%s', n.nspname, c.relname, a.attname,
         format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), ''), a.attidentity, a.attgenerated) as def
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
  union all
  select 'constraints', format('%s.%s %s %s validated=%s', n.nspname, coalesce(c.relname, t.typname), k.conname, pg_get_constraintdef(k.oid), k.convalidated)
  from pg_constraint k join pg_namespace n on n.oid = k.connamespace left join pg_class c on c.oid = k.conrelid left join pg_type t on t.oid = k.contypid
  where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
  union all
  select 'indexes', pg_get_indexdef(i.indexrelid)
  from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
  union all
  select 'triggers', format('%s.%s %s', n.nspname, c.relname, pg_get_triggerdef(g.oid))
  from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not g.tgisinternal and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
  union all
  select 'policies', format('%s.%s %s permissive=%s roles=%s cmd=%s using=%s check=%s', schemaname, tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, ''))
  from pg_policies
  union all
  select 'functions', pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prokind in ('f', 'p', 'w') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  union all
  select 'function_acls', format('%s.%s(%s) acl=%s owner=%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), coalesce(p.proacl::text, ''), pg_get_userbyid(p.proowner))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  union all
  select 'views', format('%s.%s %s', n.nspname, c.relname, pg_get_viewdef(c.oid))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('v', 'm') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
  union all
  select 'relation_acls', format('%s.%s acl=%s', n.nspname, c.relname, coalesce(c.relacl::text, ''))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
  union all
  select 'schema_acls', format('%s owner=%s acl=%s', nspname, pg_get_userbyid(nspowner), coalesce(nspacl::text, ''))
  from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'
  union all
  select 'default_acls', format('role=%s schema=%s type=%s acl=%s', pg_get_userbyid(defaclrole), coalesce(defaclnamespace::regnamespace::text, ''), defaclobjtype, defaclacl::text)
  from pg_default_acl
  union all
  select 'types', format('%s.%s %s', n.nspname, t.typname, t.typtype)
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where t.typtype in ('e', 'd', 'c') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
    and (t.typtype <> 'c' or exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind = 'c'))
)
select 'defs', k, count(*)::text, coalesce(md5(string_agg(def, E'\n' order by def collate "C")), md5(''))
from objs group by k
order by k;

select 'count', 'tables_rls_enabled', count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and c.relrowsecurity and n.nspname !~ '^pg_' and n.nspname <> 'information_schema';
select 'count', 'policies', count(*)::text from pg_policies;
select 'count', 'triggers', count(*)::text from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace where not g.tgisinternal and n.nspname !~ '^pg_' and n.nspname <> 'information_schema';
select 'count', 'constraints_' || contype::text, count(*)::text from pg_constraint k join pg_namespace n on n.oid = k.connamespace where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' group by contype;
select 'count', 'constraints_not_validated', count(*)::text from pg_constraint k join pg_namespace n on n.oid = k.connamespace where not k.convalidated and n.nspname !~ '^pg_' and n.nspname <> 'information_schema';
select 'count', 'indexes', count(*)::text from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname !~ '^pg_' and n.nspname <> 'information_schema';
select 'count', 'invalid_indexes', count(*)::text from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace where (not i.indisvalid or not i.indisready) and n.nspname !~ '^pg_' and n.nspname <> 'information_schema';
select 'count', 'functions', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
select 'count', 'sequences', count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'S' and n.nspname !~ '^pg_' and n.nspname <> 'information_schema';
select 'count', 'large_objects', count(*)::text from pg_largeobject_metadata;

select 'ext', extname, extversion from pg_extension;
select 'schema', nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema';
-- roles that the schema depends on (superuser flag deliberately ignored: restores never create superusers)
select 'role', rolname, 'login=' || rolcanlogin::text, 'inherit=' || rolinherit::text, 'bypassrls=' || rolbypassrls::text, 'createdb=' || rolcreatedb::text, 'createrole=' || rolcreaterole::text
from pg_roles where rolname !~ '^pg_';
select 'member', pg_get_userbyid(roleid) || '->' || pg_get_userbyid(member) from pg_auth_members where pg_get_userbyid(roleid) !~ '^pg_' and pg_get_userbyid(member) !~ '^pg_';
select 'owner', pg_get_userbyid(c.relowner), count(*)::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'S') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
group by c.relowner;
rollback;
