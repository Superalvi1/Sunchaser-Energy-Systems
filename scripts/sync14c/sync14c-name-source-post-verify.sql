-- =============================================================================
-- SYNC-14C-A / R1 — post-migration verification (READ-ONLY)
-- =============================================================================
-- Mode: SELECT / RAISE NOTICE only. NO DDL. NO DML.
-- Run after sync14c-name-source-forward-migration.sql.
-- Exact allow-list equality + convalidated=true required for PASS.
-- =============================================================================

-- Schema guard before any direct table row queries
do $$
begin
  if to_regclass('public.whatsapp_contacts') is null then
    raise exception 'STOP: public.whatsapp_contacts does not exist';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whatsapp_contacts'
      and column_name = 'name_source'
  ) then
    raise exception 'STOP: whatsapp_contacts.name_source column missing';
  end if;

  raise notice 'PASS: SYNC-14C-A post-verify schema guard — table/column present';
end $$;

select
  con.conname as constraint_name,
  con.convalidated as is_validated,
  pg_get_constraintdef(con.oid, true) as constraint_def
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'whatsapp_contacts'
  and con.contype = 'c'
  and con.conname like '%name_source%'
order by con.conname;

select
  coalesce(name_source, '<NULL>') as name_source,
  count(*)::bigint as row_count
from public.whatsapp_contacts
group by name_source
order by row_count desc, name_source;

select
  count(*)::bigint as invalid_name_source_count
from public.whatsapp_contacts
where name_source is not null
  and name_source not in (
    'manual',
    'whatsapp_verified',
    'whatsapp_saved',
    'whatsapp_legacy',
    'whatsapp_push',
    'whatsapp_short',
    'phone'
  );

-- RLS must still be enabled; no new permissive policies expected.
select
  c.relname,
  c.relrowsecurity as rls_enabled,
  (
    select count(*)::int
    from pg_policy pol
    where pol.polrelid = c.oid
  ) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'whatsapp_contacts';

select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'whatsapp_contacts'
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
order by grantee, privilege_type;

do $$
declare
  def text;
  is_validated boolean;
  invalid_count bigint;
  rls_on boolean;
  anon_dml bigint;
  auth_dml bigint;
  stop_reasons text[] := array[]::text[];
  expected text[] := array[
    'manual',
    'phone',
    'whatsapp_legacy',
    'whatsapp_push',
    'whatsapp_saved',
    'whatsapp_short',
    'whatsapp_verified'
  ];
  parsed text[];
  def_norm text;
  exact boolean := false;
begin
  select pg_get_constraintdef(con.oid, true), con.convalidated
  into def, is_validated
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'whatsapp_contacts'
    and con.conname = 'whatsapp_contacts_name_source_check';

  if def is null then
    stop_reasons := array_append(stop_reasons, 'canonical constraint missing');
  else
    def_norm := lower(def);
    if def_norm ~ 'check\s*\('
       and def_norm ~ 'name_source\s+is\s+null'
       and (
         def_norm ~ 'name_source\s*=\s*any\s*\(\s*array\s*\['
         or def_norm ~ 'name_source\s+in\s*\('
       )
       and def_norm !~ '\bor\s+true\b'
       and def_norm !~ '=\s*true\b'
       and def_norm !~ '\bsimilar\s+to\b'
       and def_norm !~ '\slike\s'
       and def_norm !~ '~'
       and def_norm !~ '\bin\s*\(\s*select\b'
    then
      select coalesce(array_agg(x order by x), array[]::text[])
      into parsed
      from (
        select distinct m[1] as x
        from regexp_matches(def, '''([^'']+)''', 'g') as m
      ) s;
      exact := parsed is not distinct from expected;
    end if;

    if not exact then
      stop_reasons := array_append(
        stop_reasons,
        format('canonical constraint not exact expanded allow-list; def=%s', def)
      );
    end if;

    if not coalesce(is_validated, false) then
      stop_reasons := array_append(stop_reasons, 'canonical constraint not validated');
    end if;
  end if;

  if exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'whatsapp_contacts'
      and con.conname = 'whatsapp_contacts_name_source_check_v14c'
  ) then
    stop_reasons := array_append(stop_reasons, 'temporary v14c constraint still present');
  end if;

  select count(*) into invalid_count
  from public.whatsapp_contacts
  where name_source is not null
    and name_source not in (
      'manual',
      'whatsapp_verified',
      'whatsapp_saved',
      'whatsapp_legacy',
      'whatsapp_push',
      'whatsapp_short',
      'phone'
    );

  if invalid_count > 0 then
    stop_reasons := array_append(
      stop_reasons,
      format('invalid name_source rows=%s', invalid_count)
    );
  end if;

  select c.relrowsecurity into rls_on
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'whatsapp_contacts';

  if coalesce(rls_on, false) is not true then
    stop_reasons := array_append(stop_reasons, 'RLS disabled on whatsapp_contacts');
  end if;

  select count(*) into anon_dml
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'whatsapp_contacts'
    and grantee = 'anon'
    and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

  select count(*) into auth_dml
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'whatsapp_contacts'
    and grantee = 'authenticated'
    and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

  if anon_dml > 0 or auth_dml > 0 then
    stop_reasons := array_append(
      stop_reasons,
      'anon/authenticated DML privileges present on whatsapp_contacts'
    );
  end if;

  if coalesce(array_length(stop_reasons, 1), 0) > 0 then
    raise notice 'STOP: SYNC-14C-A post-verify failed: %', array_to_string(stop_reasons, '; ');
  else
    raise notice 'PASS: SYNC-14C-A post-verify — expanded name_source constraint healthy';
  end if;
end $$;
