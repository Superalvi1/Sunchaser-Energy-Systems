-- Deterministic text snapshot of the public schema's structure, taken with plain queries so it works with ANY psql version against ANY server
-- version (pg_dump refuses a client older than the server, and CI's client is not always the server's version).
-- Excludes the app and app_rollback_backup schemas and extension-owned objects. One line per object, sorted.
select line from (
  select 'col ' || c.table_name || '.' || c.column_name || ' ' || c.data_type || ' null=' || c.is_nullable || ' default=' || coalesce(c.column_default, '') as line
    from information_schema.columns c where c.table_schema = 'public'
  union all select 'con ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
  union all select 'idx ' || indexdef from pg_indexes where schemaname = 'public'
  union all select 'trg ' || pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
  union all select 'pol ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
  union all select 'rls ' || relname || ' ' || relrowsecurity::text from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
  union all select 'fn ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all select 'view ' || viewname || ' ' || md5(definition) from pg_views where schemaname = 'public'
) s order by line;
