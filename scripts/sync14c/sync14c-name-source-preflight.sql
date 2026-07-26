-- =============================================================================
-- SYNC-14C-A — name_source constraint preflight (READ-ONLY)
-- =============================================================================
-- Mode: SELECT / catalog inspection / RAISE NOTICE only.
-- NO DDL. NO DML. Do NOT apply the forward migration from this file.
--
-- Run manually in Supabase SQL Editor against the intended project AFTER
-- confirming project ref in the Dashboard and PITR/backup readiness.
--
-- Expected: operator reviews result sets + final NOTICE summary.
-- Any STOP:* notice means do not proceed to forward migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Session identity (informational — not project-ref proof)
-- -----------------------------------------------------------------------------
select
  version() as postgres_version,
  current_database() as current_database,
  current_user as current_user,
  session_user as session_user,
  current_setting('server_version_num') as server_version_num,
  timezone('utc', now()) as utc_now;

-- -----------------------------------------------------------------------------
-- 1. Table / column presence
-- -----------------------------------------------------------------------------
select
  c.relname as table_name,
  a.attname as column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
  a.attnotnull as not_null
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'whatsapp_contacts'
  and a.attnum > 0
  and not a.attisdropped
  and a.attname in (
    'id',
    'company_id',
    'phone_e164',
    'profile_name',
    'name_source',
    'wa_jid',
    'is_business_contact',
    'last_synced_at'
  )
order by a.attname;

-- -----------------------------------------------------------------------------
-- 2. Existing name_source check constraint definition
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 3. Indexes relevant to phone / JID identity
-- -----------------------------------------------------------------------------
select
  i.relname as index_name,
  ix.indisunique as is_unique,
  pg_get_indexdef(i.oid) as index_def
from pg_index ix
join pg_class t on t.oid = ix.indrelid
join pg_class i on i.oid = ix.indexrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'whatsapp_contacts'
  and (
    pg_get_indexdef(i.oid) ilike '%phone_e164%'
    or pg_get_indexdef(i.oid) ilike '%wa_jid%'
    or pg_get_indexdef(i.oid) ilike '%company_id%'
  )
order by i.relname;

-- -----------------------------------------------------------------------------
-- 4. RLS + policies + grants (must remain backend/service_role; do not weaken)
-- -----------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'whatsapp_contacts';

select
  pol.polname as policy_name,
  pol.polcmd as command,
  pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
  pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expr
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'whatsapp_contacts'
order by pol.polname;

select
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'whatsapp_contacts'
order by grantee, privilege_type;

-- -----------------------------------------------------------------------------
-- 4b. Schema guard before any direct table row queries
-- -----------------------------------------------------------------------------
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

  raise notice 'PASS: SYNC-14C-A preflight schema guard — table/column present';
end $$;

-- -----------------------------------------------------------------------------
-- 5. Distinct name_source values and counts
-- -----------------------------------------------------------------------------
select
  coalesce(name_source, '<NULL>') as name_source,
  count(*)::bigint as row_count
from public.whatsapp_contacts
group by name_source
order by row_count desc, name_source;

-- -----------------------------------------------------------------------------
-- 6. Invalid / unexpected name_source values
--    (relative to CURRENT production allow-list from SYNC-1 history migration)
-- -----------------------------------------------------------------------------
select
  id,
  company_id,
  phone_e164,
  name_source,
  left(coalesce(profile_name, ''), 80) as profile_name_preview
from public.whatsapp_contacts
where name_source is not null
  and name_source not in (
    'manual',
    'whatsapp_saved',
    'whatsapp_push',
    'whatsapp_short',
    'phone',
    -- already-expanded environments (idempotent preflight)
    'whatsapp_verified',
    'whatsapp_legacy'
  )
order by company_id, phone_e164
limit 200;

-- -----------------------------------------------------------------------------
-- 7. Null-source rows (app treats nonempty + null as whatsapp_legacy effective)
-- -----------------------------------------------------------------------------
select
  count(*) filter (
    where name_source is null
  )::bigint as null_source_total,
  count(*) filter (
    where name_source is null
      and nullif(btrim(profile_name), '') is not null
  )::bigint as null_source_with_profile_name,
  count(*) filter (
    where name_source is null
      and nullif(btrim(profile_name), '') is null
  )::bigint as null_source_without_profile_name
from public.whatsapp_contacts;

select
  id,
  company_id,
  phone_e164,
  left(coalesce(profile_name, ''), 80) as profile_name_preview,
  wa_jid
from public.whatsapp_contacts
where name_source is null
  and nullif(btrim(profile_name), '') is not null
order by updated_at desc nulls last
limit 100;

-- -----------------------------------------------------------------------------
-- 8. Phone-like profile_name rows (should not be stored as display names)
-- -----------------------------------------------------------------------------
select
  id,
  company_id,
  phone_e164,
  profile_name,
  name_source
from public.whatsapp_contacts
where nullif(btrim(profile_name), '') is not null
  and (
    btrim(profile_name) = btrim(phone_e164)
    or btrim(profile_name) = ('+' || btrim(phone_e164))
    or btrim(profile_name) ~ '^\+?[0-9][0-9\s\-()]{6,}$'
  )
order by company_id, phone_e164
limit 200;

select
  count(*)::bigint as phone_like_profile_name_count
from public.whatsapp_contacts
where nullif(btrim(profile_name), '') is not null
  and (
    btrim(profile_name) = btrim(phone_e164)
    or btrim(profile_name) = ('+' || btrim(phone_e164))
    or btrim(profile_name) ~ '^\+?[0-9][0-9\s\-()]{6,}$'
  );

-- -----------------------------------------------------------------------------
-- 9. Duplicate phone / JID risks
-- -----------------------------------------------------------------------------
-- 9a. Duplicate (company_id, phone_e164) — should be zero (unique constraint).
select
  company_id,
  phone_e164,
  count(*)::bigint as dup_count
from public.whatsapp_contacts
group by company_id, phone_e164
having count(*) > 1
order by dup_count desc
limit 50;

-- 9b. Duplicate non-null (company_id, wa_jid) — should be zero if unique index exists.
select
  company_id,
  wa_jid,
  count(*)::bigint as dup_count
from public.whatsapp_contacts
where wa_jid is not null
group by company_id, wa_jid
having count(*) > 1
order by dup_count desc
limit 50;

-- 9c. Same wa_jid mapped to multiple phone_e164 within a company (data smell).
select
  company_id,
  wa_jid,
  count(distinct phone_e164)::bigint as distinct_phones,
  array_agg(distinct phone_e164 order by phone_e164) as phones
from public.whatsapp_contacts
where wa_jid is not null
group by company_id, wa_jid
having count(distinct phone_e164) > 1
order by distinct_phones desc
limit 50;

-- 9d. Same phone_e164 with conflicting name_source across duplicate-looking rows
--     (informational if unique holds; still useful after restores).
select
  company_id,
  phone_e164,
  count(distinct coalesce(name_source, '<NULL>'))::bigint as distinct_sources,
  array_agg(distinct coalesce(name_source, '<NULL>') order by coalesce(name_source, '<NULL>')) as sources
from public.whatsapp_contacts
group by company_id, phone_e164
having count(distinct coalesce(name_source, '<NULL>')) > 1
limit 50;

-- -----------------------------------------------------------------------------
-- 10. Forward-migration compatibility gate (NOTICE / STOP)
-- -----------------------------------------------------------------------------
do $$
declare
  stop_reasons text[] := array[]::text[];
  table_ok boolean;
  col_ok boolean;
  invalid_count bigint;
  dup_phone bigint;
  dup_jid bigint;
  constraint_def text;
  already_expanded boolean := false;
begin
  select exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'whatsapp_contacts' and c.relkind = 'r'
  ) into table_ok;

  if not table_ok then
    stop_reasons := array_append(stop_reasons, 'public.whatsapp_contacts missing');
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whatsapp_contacts'
      and column_name = 'name_source'
  ) into col_ok;

  if table_ok and not col_ok then
    stop_reasons := array_append(stop_reasons, 'whatsapp_contacts.name_source column missing');
  end if;

  if table_ok and col_ok then
    select count(*) into invalid_count
    from public.whatsapp_contacts
    where name_source is not null
      and name_source not in (
        'manual',
        'whatsapp_saved',
        'whatsapp_push',
        'whatsapp_short',
        'phone',
        'whatsapp_verified',
        'whatsapp_legacy'
      );

    if invalid_count > 0 then
      stop_reasons := array_append(
        stop_reasons,
        format('invalid name_source values present (%s rows)', invalid_count)
      );
    end if;

    select count(*) into dup_phone
    from (
      select 1
      from public.whatsapp_contacts
      group by company_id, phone_e164
      having count(*) > 1
    ) d;

    if dup_phone > 0 then
      stop_reasons := array_append(
        stop_reasons,
        format('duplicate (company_id, phone_e164) groups=%s', dup_phone)
      );
    end if;

    select count(*) into dup_jid
    from (
      select 1
      from public.whatsapp_contacts
      where wa_jid is not null
      group by company_id, wa_jid
      having count(*) > 1
    ) d;

    if dup_jid > 0 then
      stop_reasons := array_append(
        stop_reasons,
        format('duplicate (company_id, wa_jid) groups=%s', dup_jid)
      );
    end if;
  end if;

  declare
    -- Read-only stand-in for conbin proof: exact pg_get_expr of the forward
    -- reference predicate (same IN-list order as forward migration).
    expected_expr constant text :=
      '(name_source IS NULL) OR (name_source = ANY (ARRAY[''manual''::text, ''whatsapp_verified''::text, ''whatsapp_saved''::text, ''whatsapp_legacy''::text, ''whatsapp_push''::text, ''whatsapp_short''::text, ''phone''::text]))';
    actual_expr text;
    is_validated boolean;
  begin
    select pg_get_constraintdef(con.oid, true),
           pg_get_expr(con.conbin, con.conrelid),
           con.convalidated
    into constraint_def, actual_expr, is_validated
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'whatsapp_contacts'
      and con.conname = 'whatsapp_contacts_name_source_check'
    limit 1;

    -- Complete predicate equality (R2). Set-only / partial ILIKE is insufficient.
    already_expanded :=
      actual_expr is not distinct from expected_expr
      and coalesce(is_validated, false);
  end;

  if coalesce(array_length(stop_reasons, 1), 0) > 0 then
    raise notice 'STOP: SYNC-14C-A preflight failed: %', array_to_string(stop_reasons, '; ');
  elsif already_expanded then
    raise notice 'PASS: SYNC-14C-A preflight — constraint already expanded; forward migration should no-op';
  else
    raise notice 'PASS: SYNC-14C-A preflight — safe to seek human approval for forward migration';
  end if;
end $$;
