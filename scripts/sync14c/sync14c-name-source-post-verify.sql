-- =============================================================================
-- SYNC-14C-A / R2 — post-migration verification
-- =============================================================================
-- Proves the complete forward CHECK predicate via pg_constraint.conbin against
-- an ephemeral exact reference constraint. No row mutation.
--
-- Failure mode: RAISE EXCEPTION (non-zero / aborted script), not NOTICE-only.
-- =============================================================================

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
end $$;

select
  con.conname as constraint_name,
  con.convalidated as is_validated,
  pg_get_constraintdef(con.oid, true) as constraint_def,
  pg_get_expr(con.conbin, con.conrelid) as constraint_expr
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
  table_oid oid;
  canonical_name constant text := 'whatsapp_contacts_name_source_check';
  temp_name constant text := 'whatsapp_contacts_name_source_check_v14c';
  ref_name constant text := 'whatsapp_contacts_name_source_check_ref_fwd';
  proven boolean := false;
  is_validated boolean := false;
  invalid_count bigint;
  rls_on boolean;
  anon_dml bigint;
  auth_dml bigint;
  stop_reasons text[] := array[]::text[];
begin
  select c.oid into table_oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'whatsapp_contacts' and c.relkind = 'r';

  if table_oid is null then
    raise exception 'STOP: SYNC-14C-A post-verify failed: public.whatsapp_contacts missing';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = ref_name
  ) then
    execute format(
      'alter table public.whatsapp_contacts drop constraint %I',
      ref_name
    );
  end if;

  alter table public.whatsapp_contacts
    add constraint whatsapp_contacts_name_source_check_ref_fwd
    check (
      name_source is null
      or name_source in (
        'manual',
        'whatsapp_verified',
        'whatsapp_saved',
        'whatsapp_legacy',
        'whatsapp_push',
        'whatsapp_short',
        'phone'
      )
    ) not valid;

  select (c.conbin = r.conbin), c.convalidated
  into proven, is_validated
  from pg_constraint r
  left join pg_constraint c
    on c.conrelid = r.conrelid
   and c.conname = canonical_name
   and c.contype = 'c'
  where r.conrelid = table_oid
    and r.conname = ref_name;

  alter table public.whatsapp_contacts
    drop constraint whatsapp_contacts_name_source_check_ref_fwd;

  if not coalesce(proven, false) then
    stop_reasons := array_append(
      stop_reasons,
      'canonical constraint conbin does not equal exact forward reference predicate'
    );
  end if;

  if not coalesce(is_validated, false) then
    stop_reasons := array_append(stop_reasons, 'canonical constraint not validated');
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid
      and conname in (
        temp_name,
        ref_name,
        'whatsapp_contacts_name_source_check_rollback',
        'whatsapp_contacts_name_source_check_ref_rb'
      )
  ) then
    stop_reasons := array_append(
      stop_reasons,
      'temporary/reference name_source constraint still present'
    );
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
  where c.oid = table_oid;

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
    raise exception 'STOP: SYNC-14C-A post-verify failed: %', array_to_string(stop_reasons, '; ');
  end if;

  raise notice 'PASS: SYNC-14C-A post-verify — expanded name_source constraint healthy (conbin-proven)';
end $$;
