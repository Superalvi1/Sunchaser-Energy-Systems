-- =============================================================================
-- SYNC-14C-A / R1 — rollback: restore pre-SYNC-14B name_source allow-list
-- =============================================================================
-- REVIEW / MANUAL APPLY ONLY. Do NOT auto-apply.
--
-- Restores exactly:
--   NULL | manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone
--
-- LIMITATIONS (read carefully):
-- 1. Rollback FAILS CLOSED if any row already stores:
--      whatsapp_verified OR whatsapp_legacy
--    Those values are valid only after the forward expansion. Removing them from
--    the check while rows exist is impossible without data mutation.
-- 2. This script does NOT delete, rewrite, or null-out profile_name / name_source.
-- 3. If SYNC-14B application code is already deployed and writing
--    whatsapp_verified, rolling back the constraint will cause those writes to
--    fail until code is rolled back first.
-- 4. Recommended order for abort: stop deploy → roll back app → then this SQL.
-- 5. Soft/no-op only when the canonical constraint is an exact validated match
--    to the pre-expansion allow-list (not partial ILIKE substring checks).
-- 6. Temporary constraints are never trusted by name alone; mismatched/unknown
--    temporary definitions STOP fail-closed.
-- =============================================================================

do $$
declare
  table_oid oid;
  canonical_name text := 'whatsapp_contacts_name_source_check';
  temp_name text := 'whatsapp_contacts_name_source_check_rollback';
  forward_temp_name text := 'whatsapp_contacts_name_source_check_v14c';
  expected text[] := array[
    'manual',
    'phone',
    'whatsapp_push',
    'whatsapp_saved',
    'whatsapp_short'
  ];
  forward_expected text[] := array[
    'manual',
    'phone',
    'whatsapp_legacy',
    'whatsapp_push',
    'whatsapp_saved',
    'whatsapp_short',
    'whatsapp_verified'
  ];
  blocking_count bigint;
  canonical_oid oid;
  temp_oid oid;
  forward_temp_oid oid;
  canonical_def text;
  temp_def text;
  forward_temp_def text;
  canonical_validated boolean;
  temp_validated boolean;
  forward_temp_validated boolean;
  canonical_exact boolean;
  canonical_exact_validated boolean;
  temp_exact boolean;
  forward_temp_exact_expanded boolean;
  parsed text[];
  def_norm text;
  action text;
  comment_text text :=
    'manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone — upgrade-only allow-list after SQL rollback. Application policy (SYNC-14B+): nonempty profile_name with null name_source is treated as whatsapp_legacy (not manual). phone is deprecated and must not be newly written as profile_name.';
begin
  -- -------------------------------------------------------------------------
  -- Schema guard (before any direct table references)
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
    raise exception 'STOP: whatsapp_contacts.name_source column missing';
  end if;

  select count(*) into blocking_count
  from public.whatsapp_contacts
  where name_source in ('whatsapp_verified', 'whatsapp_legacy');

  if blocking_count > 0 then
    raise exception
      'STOP: cannot rollback name_source check — % row(s) use whatsapp_verified/whatsapp_legacy. Roll back application writers first and clear/rewrite those values under a separate approved data plan (not provided here).',
      blocking_count;
  end if;

  select con.oid, pg_get_constraintdef(con.oid, true), con.convalidated
  into canonical_oid, canonical_def, canonical_validated
  from pg_constraint con
  where con.conrelid = table_oid
    and con.conname = canonical_name
    and con.contype = 'c';

  select con.oid, pg_get_constraintdef(con.oid, true), con.convalidated
  into temp_oid, temp_def, temp_validated
  from pg_constraint con
  where con.conrelid = table_oid
    and con.conname = temp_name
    and con.contype = 'c';

  select con.oid, pg_get_constraintdef(con.oid, true), con.convalidated
  into forward_temp_oid, forward_temp_def, forward_temp_validated
  from pg_constraint con
  where con.conrelid = table_oid
    and con.conname = forward_temp_name
    and con.contype = 'c';

  -- Exact match helper for rollback allow-list
  canonical_exact := false;
  if canonical_def is not null then
    def_norm := lower(canonical_def);
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

  -- Temporary rollback constraint: never trust by name alone
  temp_exact := false;
  if temp_def is not null then
    def_norm := lower(temp_def);
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
        'STOP: temporary constraint % exists but definition is not exactly the pre-expansion allow-list (fail-closed). def=%',
        temp_name,
        coalesce(temp_def, '<null>');
    end if;
  end if;

  -- Leftover forward temporary: only allow drop when proven exact expanded
  forward_temp_exact_expanded := false;
  if forward_temp_def is not null then
    def_norm := lower(forward_temp_def);
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
        from regexp_matches(forward_temp_def, '''([^'']+)''', 'g') as m
      ) s;
      forward_temp_exact_expanded := parsed is not distinct from forward_expected;
    end if;

    if not forward_temp_exact_expanded then
      raise exception
        'STOP: temporary constraint % exists with unknown/mismatched definition (fail-closed; will not drop/promote). def=%',
        forward_temp_name,
        coalesce(forward_temp_def, '<null>');
    end if;
  end if;

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

  raise notice 'SYNC-14C-A rollback: action=% canonical_exact=% canonical_validated=% temp_exact=%',
    action,
    canonical_exact,
    coalesce(canonical_validated, false),
    temp_exact;

  if action = 'NOOP' then
    if forward_temp_oid is not null then
      alter table public.whatsapp_contacts
        drop constraint whatsapp_contacts_name_source_check_v14c;
    end if;
    comment on column public.whatsapp_contacts.name_source is comment_text;
    raise notice 'PASS: SYNC-14C-A rollback — exact validated pre-expansion allow-list already present (idempotent no-op)';
    return;
  end if;

  if action = 'CLEANUP_TEMP' then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_rollback;
    if forward_temp_oid is not null then
      alter table public.whatsapp_contacts
        drop constraint whatsapp_contacts_name_source_check_v14c;
    end if;
    comment on column public.whatsapp_contacts.name_source is comment_text;
    raise notice 'PASS: SYNC-14C-A rollback — canonical exact; dropped leftover proven temporary';
    return;
  end if;

  if action = 'VALIDATE_CANONICAL' then
    alter table public.whatsapp_contacts
      validate constraint whatsapp_contacts_name_source_check;
    if forward_temp_oid is not null then
      alter table public.whatsapp_contacts
        drop constraint whatsapp_contacts_name_source_check_v14c;
    end if;
    comment on column public.whatsapp_contacts.name_source is comment_text;

    select con.convalidated into canonical_validated
    from pg_constraint con
    where con.conrelid = table_oid and con.conname = canonical_name;

    if not coalesce(canonical_validated, false) then
      raise exception 'STOP: canonical rollback constraint failed validation';
    end if;

    raise notice 'PASS: SYNC-14C-A rollback — validated existing exact pre-expansion canonical';
    return;
  end if;

  if action = 'REBUILD' then
    if temp_oid is not null then
      raise exception 'STOP: unexpected temporary rollback constraint state during rebuild';
    end if;

    alter table public.whatsapp_contacts
      add constraint whatsapp_contacts_name_source_check_rollback
      check (
        name_source is null
        or name_source in (
          'manual',
          'whatsapp_saved',
          'whatsapp_push',
          'whatsapp_short',
          'phone'
        )
      ) not valid;
    raise notice 'SYNC-14C-A rollback: added % NOT VALID', temp_name;
  end if;

  alter table public.whatsapp_contacts
    validate constraint whatsapp_contacts_name_source_check_rollback;
  raise notice 'SYNC-14C-A rollback: validated %', temp_name;

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
      'STOP: temporary rollback constraint failed exact+validated proof before promotion; def=%',
      coalesce(temp_def, '<null>');
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = canonical_name
  ) then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check;
  end if;

  -- Drop proven forward temporary only (mismatched already STOPped earlier)
  if forward_temp_oid is not null then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_v14c;
  end if;

  alter table public.whatsapp_contacts
    rename constraint whatsapp_contacts_name_source_check_rollback
    to whatsapp_contacts_name_source_check;

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
      'STOP: rollback did not leave exact validated pre-expansion canonical constraint; def=%',
      coalesce(canonical_def, '<null>');
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid
      and conname in (temp_name, forward_temp_name)
  ) then
    raise exception 'STOP: temporary name_source constraint(s) still present after rollback';
  end if;

  comment on column public.whatsapp_contacts.name_source is comment_text;

  raise notice 'PASS: SYNC-14C-A rollback — restored exact pre-expansion name_source check';
end $$;
