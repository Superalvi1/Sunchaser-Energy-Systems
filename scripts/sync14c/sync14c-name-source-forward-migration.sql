-- =============================================================================
-- SYNC-14C-A / R1 — forward migration: expand whatsapp_contacts.name_source
-- =============================================================================
-- REVIEW / MANUAL APPLY ONLY (Supabase SQL Editor).
-- Do NOT auto-apply from the application. Do NOT run until preflight PASSes.
--
-- Purpose:
--   Allow application provenance values introduced by SYNC-14B:
--     whatsapp_verified  — Baileys Contact.verifiedName
--     whatsapp_legacy    — optional stored form of legacy nonempty+null rows
--   Preserve exactly:
--     NULL | manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy
--          | whatsapp_push | whatsapp_short | phone
--
-- Safety (R1):
--   - Exact allow-list semantic equality (not partial ILIKE substring checks).
--   - Never trust/promote temporary constraint by name alone.
--   - Mismatched/unknown temporary definitions STOP fail-closed.
--   - If canonical equality cannot be proven, rebuild the exact constraint.
--   - Final state requires convalidated=true.
--   - Additive allow-list expansion only (no data rewrites).
--   - Does not alter RLS, policies, grants, indexes, or tenant columns.
--
-- Supersedes for apply purposes:
--   scripts/whatsapp-web-contact-name-source-sync14b-migration.sql (PR #12 review-only)
-- =============================================================================

do $$
declare
  table_oid oid;
  canonical_name text := 'whatsapp_contacts_name_source_check';
  temp_name text := 'whatsapp_contacts_name_source_check_v14c';
  expected text[] := array[
    'manual',
    'phone',
    'whatsapp_legacy',
    'whatsapp_push',
    'whatsapp_saved',
    'whatsapp_short',
    'whatsapp_verified'
  ];
  canonical_oid oid;
  temp_oid oid;
  canonical_def text;
  temp_def text;
  canonical_validated boolean;
  temp_validated boolean;
  canonical_exact boolean;
  canonical_exact_validated boolean;
  temp_exact boolean;
  parsed text[];
  def_norm text;
  action text;
begin
  -- -------------------------------------------------------------------------
  -- Schema guard (before any direct table DML/DDL assumptions)
  -- -------------------------------------------------------------------------
  if to_regclass('public.whatsapp_contacts') is null then
    raise exception 'STOP: public.whatsapp_contacts does not exist';
  end if;

  select c.oid into table_oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'whatsapp_contacts' and c.relkind = 'r';

  if table_oid is null then
    raise exception 'STOP: public.whatsapp_contacts does not exist';
  end if;

  if not exists (
    select 1
    from pg_attribute a
    where a.attrelid = table_oid
      and a.attname = 'name_source'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    raise exception 'STOP: whatsapp_contacts.name_source column missing — apply history-sync migration first';
  end if;

  -- Refuse if unexpected values would fail the expanded check.
  if exists (
    select 1
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
      )
  ) then
    raise exception 'STOP: invalid name_source values present — resolve before migration';
  end if;

  -- -------------------------------------------------------------------------
  -- Exact allow-list matcher (fail-closed when unprovable)
  -- -------------------------------------------------------------------------
  -- Returns true only when:
  --   * NULL is explicitly allowed
  --   * form is IN(...) or = ANY(ARRAY[...])
  --   * quoted values equal expected exactly (no missing/extra)
  --   * no widening constructs
  -- Optionally requires convalidated=true.

  -- Load canonical
  select con.oid, pg_get_constraintdef(con.oid, true), con.convalidated
  into canonical_oid, canonical_def, canonical_validated
  from pg_constraint con
  where con.conrelid = table_oid
    and con.conname = canonical_name
    and con.contype = 'c';

  -- Load temporary (never trust by name alone)
  select con.oid, pg_get_constraintdef(con.oid, true), con.convalidated
  into temp_oid, temp_def, temp_validated
  from pg_constraint con
  where con.conrelid = table_oid
    and con.conname = temp_name
    and con.contype = 'c';

  -- Parse/match canonical (definition only)
  canonical_exact := false;
  if canonical_def is not null then
    def_norm := lower(canonical_def);
    parsed := null;
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
        from regexp_matches(canonical_def, '''([^'']+)''', 'g') as m
      ) s;
      canonical_exact := parsed is not distinct from expected;
    end if;
  end if;
  canonical_exact_validated := canonical_exact and coalesce(canonical_validated, false);

  -- Parse/match temporary (definition only)
  temp_exact := false;
  if temp_def is not null then
    def_norm := lower(temp_def);
    parsed := null;
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
        from regexp_matches(temp_def, '''([^'']+)''', 'g') as m
      ) s;
      temp_exact := parsed is not distinct from expected;
    end if;

    if not temp_exact then
      raise exception
        'STOP: temporary constraint % exists but definition is not exactly the SYNC-14C-A expanded allow-list (fail-closed; will not validate/promote unknown constraint). def=%',
        temp_name,
        coalesce(temp_def, '<null>');
    end if;
  end if;

  -- Decision
  if canonical_exact_validated and temp_oid is null then
    action := 'NOOP';
  elsif canonical_exact_validated and temp_exact then
    action := 'CLEANUP_TEMP';
  elsif canonical_exact and not coalesce(canonical_validated, false) and temp_oid is null then
    action := 'VALIDATE_CANONICAL';
  elsif temp_exact then
    action := 'PROMOTE_TEMP';
  else
    action := 'REBUILD';
  end if;

  raise notice 'SYNC-14C-A forward: action=% canonical_exact=% canonical_validated=% temp_exact=%',
    action,
    canonical_exact,
    coalesce(canonical_validated, false),
    temp_exact;

  if action = 'NOOP' then
    comment on column public.whatsapp_contacts.name_source is
      'manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy | whatsapp_push | whatsapp_short | phone — upgrade-only. Legacy nonempty profile_name with null name_source is treated as whatsapp_legacy by the app (not as manual). phone is deprecated and must not be newly written as profile_name.';
    raise notice 'PASS: SYNC-14C-A forward migration complete (idempotent no-op; exact validated allow-list already present)';
    return;
  end if;

  if action = 'CLEANUP_TEMP' then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_v14c;
    comment on column public.whatsapp_contacts.name_source is
      'manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy | whatsapp_push | whatsapp_short | phone — upgrade-only. Legacy nonempty profile_name with null name_source is treated as whatsapp_legacy by the app (not as manual). phone is deprecated and must not be newly written as profile_name.';
    raise notice 'PASS: SYNC-14C-A forward migration complete (canonical exact; dropped leftover proven temporary)';
    return;
  end if;

  if action = 'VALIDATE_CANONICAL' then
    alter table public.whatsapp_contacts
      validate constraint whatsapp_contacts_name_source_check;
    comment on column public.whatsapp_contacts.name_source is
      'manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy | whatsapp_push | whatsapp_short | phone — upgrade-only. Legacy nonempty profile_name with null name_source is treated as whatsapp_legacy by the app (not as manual). phone is deprecated and must not be newly written as profile_name.';

    select con.convalidated, pg_get_constraintdef(con.oid, true)
    into canonical_validated, canonical_def
    from pg_constraint con
    where con.conrelid = table_oid and con.conname = canonical_name;

    if not coalesce(canonical_validated, false) then
      raise exception 'STOP: canonical constraint failed validation';
    end if;

    -- Re-prove exactness after validate
    def_norm := lower(canonical_def);
    select coalesce(array_agg(x order by x), array[]::text[])
    into parsed
    from (
      select distinct m[1] as x
      from regexp_matches(canonical_def, '''([^'']+)''', 'g') as m
    ) s;
    if parsed is distinct from expected
       or def_norm !~ 'name_source\s+is\s+null' then
      raise exception 'STOP: canonical constraint not exact after VALIDATE';
    end if;

    raise notice 'PASS: SYNC-14C-A forward migration complete (validated existing exact canonical)';
    return;
  end if;

  -- PROMOTE_TEMP or REBUILD
  if action = 'REBUILD' then
    if temp_oid is not null then
      -- Should be unreachable: mismatched temp already STOPped; exact temp uses PROMOTE.
      raise exception 'STOP: unexpected temporary constraint state during rebuild';
    end if;

    alter table public.whatsapp_contacts
      add constraint whatsapp_contacts_name_source_check_v14c
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
    raise notice 'SYNC-14C-A forward: added % NOT VALID', temp_name;
  end if;

  -- Validate temporary (SHARE UPDATE EXCLUSIVE)
  alter table public.whatsapp_contacts
    validate constraint whatsapp_contacts_name_source_check_v14c;
  raise notice 'SYNC-14C-A forward: validated %', temp_name;

  -- Prove temporary is still exact + validated before promotion
  select pg_get_constraintdef(con.oid, true), con.convalidated
  into temp_def, temp_validated
  from pg_constraint con
  where con.conrelid = table_oid and con.conname = temp_name;

  def_norm := lower(coalesce(temp_def, ''));
  select coalesce(array_agg(x order by x), array[]::text[])
  into parsed
  from (
    select distinct m[1] as x
    from regexp_matches(temp_def, '''([^'']+)''', 'g') as m
  ) s;

  if parsed is distinct from expected
     or def_norm !~ 'name_source\s+is\s+null'
     or not coalesce(temp_validated, false) then
    raise exception
      'STOP: temporary constraint failed exact+validated proof before promotion; def=%',
      coalesce(temp_def, '<null>');
  end if;

  -- Swap: drop canonical if present, rename temp → canonical
  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = canonical_name
  ) then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check;
  end if;

  alter table public.whatsapp_contacts
    rename constraint whatsapp_contacts_name_source_check_v14c
    to whatsapp_contacts_name_source_check;

  -- Final proof
  select pg_get_constraintdef(con.oid, true), con.convalidated
  into canonical_def, canonical_validated
  from pg_constraint con
  where con.conrelid = table_oid and con.conname = canonical_name;

  def_norm := lower(coalesce(canonical_def, ''));
  select coalesce(array_agg(x order by x), array[]::text[])
  into parsed
  from (
    select distinct m[1] as x
    from regexp_matches(coalesce(canonical_def, ''), '''([^'']+)''', 'g') as m
  ) s;

  if canonical_def is null
     or parsed is distinct from expected
     or def_norm !~ 'name_source\s+is\s+null'
     or not coalesce(canonical_validated, false) then
    raise exception
      'STOP: forward migration did not leave exact validated expanded canonical constraint; def=%',
      coalesce(canonical_def, '<null>');
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = temp_name
  ) then
    raise exception 'STOP: temporary constraint % still present after promotion', temp_name;
  end if;

  comment on column public.whatsapp_contacts.name_source is
    'manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy | whatsapp_push | whatsapp_short | phone — upgrade-only. Legacy nonempty profile_name with null name_source is treated as whatsapp_legacy by the app (not as manual). phone is deprecated and must not be newly written as profile_name.';

  raise notice 'PASS: SYNC-14C-A forward migration complete';
end $$;
