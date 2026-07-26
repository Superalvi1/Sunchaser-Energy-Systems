-- =============================================================================
-- SYNC-14C-A / R3 — post-migration verification
-- =============================================================================
-- Proves the complete forward CHECK predicate via pg_constraint.conbin against
-- an ephemeral exact reference constraint created in this DO block.
--
-- If *_check_ref_fwd already exists ⇒ STOP (never drop unknown pre-existing).
-- Only drop the reference oid created by this successful execution.
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
  con.contype as constraint_type,
  con.convalidated as is_validated,
  pg_get_constraintdef(con.oid, true) as constraint_def,
  pg_get_expr(con.conbin, con.conrelid) as constraint_expr
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'whatsapp_contacts'
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
  canonical_oid oid;
  canonical_contype "char";
  proven boolean := false;
  is_validated boolean := false;
  invalid_count bigint;
  rls_on boolean;
  anon_dml bigint;
  auth_dml bigint;
  stop_reasons text[] := array[]::text[];
  session_ref_oid oid := null;
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
    raise exception
      'STOP: SYNC-14C-A post-verify failed: reference constraint name % already exists (unknown pre-existing object; will not drop)',
      ref_name;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid
      and conname = 'whatsapp_contacts_name_source_check_ref_rb'
  ) then
    raise exception
      'STOP: SYNC-14C-A post-verify failed: reference constraint name whatsapp_contacts_name_source_check_ref_rb already exists (unknown pre-existing object; will not drop)';
  end if;

  select con.oid, con.contype, con.convalidated
  into canonical_oid, canonical_contype, is_validated
  from pg_constraint con
  where con.conrelid = table_oid
    and con.conname = canonical_name;

  if canonical_oid is null then
    stop_reasons := array_append(stop_reasons, 'canonical constraint missing');
  elsif canonical_contype is distinct from 'c' then
    raise exception
      'STOP: SYNC-14C-A post-verify failed: canonical name % is occupied by a non-CHECK constraint (contype=%)',
      canonical_name,
      canonical_contype;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid
      and conname = temp_name
      and contype is distinct from 'c'
  ) then
    raise exception
      'STOP: SYNC-14C-A post-verify failed: temporary name % is occupied by a non-CHECK constraint',
      temp_name;
  end if;

  if coalesce(array_length(stop_reasons, 1), 0) = 0 then
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

    select con.oid into session_ref_oid
    from pg_constraint con
    where con.conrelid = table_oid
      and con.conname = ref_name
      and con.contype = 'c';

    if session_ref_oid is null then
      raise exception
        'STOP: SYNC-14C-A post-verify failed: failed to create session reference constraint %',
        ref_name;
    end if;

    select (c.conbin = r.conbin), c.convalidated
    into proven, is_validated
    from pg_constraint r
    join pg_constraint c on c.oid = canonical_oid and c.contype = 'c'
    where r.oid = session_ref_oid;

    if exists (
      select 1 from pg_constraint
      where oid = session_ref_oid and conname = ref_name
    ) then
      alter table public.whatsapp_contacts
        drop constraint whatsapp_contacts_name_source_check_ref_fwd;
    end if;
    session_ref_oid := null;

    if not coalesce(proven, false) then
      stop_reasons := array_append(
        stop_reasons,
        'canonical constraint conbin does not equal exact forward reference predicate'
      );
    end if;

    if not coalesce(is_validated, false) then
      stop_reasons := array_append(stop_reasons, 'canonical constraint not validated');
    end if;
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
