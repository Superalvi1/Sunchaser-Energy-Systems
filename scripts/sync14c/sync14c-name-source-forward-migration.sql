-- =============================================================================
-- SYNC-14C-A / R4 — forward migration: expand whatsapp_contacts.name_source
-- =============================================================================
-- REVIEW / MANUAL APPLY ONLY (Supabase SQL Editor).
-- Do NOT auto-apply from the application. Do NOT run until preflight PASSes.
--
-- Purpose:
--   Allow exactly:
--     NULL | manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy
--          | whatsapp_push | whatsapp_short | phone
--
-- Safety (R4):
--   - Prove complete CHECK predicate via pg_constraint.conbin against an
--     ephemeral exact reference constraint created in this DO block.
--   - If *_check_ref_fwd OR *_check_ref_rb already exists ⇒ STOP
--     (never drop unknown pre-existing reference-name occupants).
--   - Only drop the reference oid created by this successful execution.
--   - Canonical/temporary names occupied by non-CHECK constraints ⇒ STOP.
--   - Unproven canonical ⇒ rebuild; mismatched temporary ⇒ STOP.
--   - Final state requires convalidated=true. No row rewrites / RLS changes.
-- =============================================================================

do $$
declare
  table_oid oid;
  canonical_name constant text := 'whatsapp_contacts_name_source_check';
  temp_name constant text := 'whatsapp_contacts_name_source_check_v14c';
  ref_name constant text := 'whatsapp_contacts_name_source_check_ref_fwd';
  rollback_ref_name constant text := 'whatsapp_contacts_name_source_check_ref_rb';
  canonical_oid oid;
  canonical_contype "char";
  temp_oid oid;
  temp_contype "char";
  canonical_validated boolean;
  temp_validated boolean;
  canonical_proven boolean := false;
  temp_proven boolean := false;
  action text;
  proof boolean;
  session_ref_oid oid := null;
begin
  -- -------------------------------------------------------------------------
  -- Schema guard
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
    select 1 from pg_attribute a
    where a.attrelid = table_oid
      and a.attname = 'name_source'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    raise exception 'STOP: whatsapp_contacts.name_source column missing — apply history-sync migration first';
  end if;

  if exists (
    select 1 from public.whatsapp_contacts
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
  -- Name collision guards (fail-closed; never silently drop unknowns)
  -- Either pack reference name blocks forward (cross-mode R4).
  -- -------------------------------------------------------------------------
  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = ref_name
  ) then
    raise exception
      'STOP: reference constraint name % already exists (unknown pre-existing object; will not drop)',
      ref_name;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = rollback_ref_name
  ) then
    raise exception
      'STOP: reference constraint name % already exists (unknown pre-existing object; will not drop)',
      rollback_ref_name;
  end if;

  select con.oid, con.contype, con.convalidated
  into canonical_oid, canonical_contype, canonical_validated
  from pg_constraint con
  where con.conrelid = table_oid
    and con.conname = canonical_name;

  if canonical_oid is not null and canonical_contype is distinct from 'c' then
    raise exception
      'STOP: canonical name % is occupied by a non-CHECK constraint (contype=%); will not replace',
      canonical_name,
      canonical_contype;
  end if;

  select con.oid, con.contype, con.convalidated
  into temp_oid, temp_contype, temp_validated
  from pg_constraint con
  where con.conrelid = table_oid
    and con.conname = temp_name;

  if temp_oid is not null and temp_contype is distinct from 'c' then
    raise exception
      'STOP: temporary name % is occupied by a non-CHECK constraint (contype=%); will not validate/promote',
      temp_name,
      temp_contype;
  end if;

  -- -------------------------------------------------------------------------
  -- Install session reference + conbin proof
  -- -------------------------------------------------------------------------
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
    raise exception 'STOP: failed to create session reference constraint %', ref_name;
  end if;

  if canonical_oid is not null then
    select (c.conbin is not null and c.conbin = r.conbin), c.convalidated
    into canonical_proven, canonical_validated
    from pg_constraint r
    join pg_constraint c
      on c.oid = canonical_oid
     and c.contype = 'c'
    where r.oid = session_ref_oid;
    canonical_proven := coalesce(canonical_proven, false);
  end if;

  if temp_oid is not null then
    select (c.conbin is not null and c.conbin = r.conbin), c.convalidated
    into temp_proven, temp_validated
    from pg_constraint r
    join pg_constraint c
      on c.oid = temp_oid
     and c.contype = 'c'
    where r.oid = session_ref_oid;
    temp_proven := coalesce(temp_proven, false);
  end if;

  -- Drop only the reference created in this execution
  if exists (
    select 1 from pg_constraint
    where oid = session_ref_oid and conname = ref_name
  ) then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_ref_fwd;
  end if;
  session_ref_oid := null;

  if temp_oid is not null and not temp_proven then
    raise exception
      'STOP: temporary constraint % exists but conbin does not equal the exact SYNC-14C-A forward reference predicate (fail-closed; will not validate/promote)',
      temp_name;
  end if;

  if coalesce(canonical_proven, false)
     and coalesce(canonical_validated, false)
     and temp_oid is null then
    action := 'NOOP';
  elsif coalesce(canonical_proven, false)
        and coalesce(canonical_validated, false)
        and temp_proven then
    action := 'CLEANUP_TEMP';
  elsif coalesce(canonical_proven, false)
        and not coalesce(canonical_validated, false)
        and temp_oid is null then
    action := 'VALIDATE_CANONICAL';
  elsif temp_proven then
    action := 'PROMOTE_TEMP';
  else
    action := 'REBUILD';
  end if;

  raise notice
    'SYNC-14C-A forward: action=% canonical_proven=% canonical_validated=% temp_present=% temp_proven=%',
    action,
    canonical_proven,
    coalesce(canonical_validated, false),
    temp_oid is not null,
    temp_proven;

  if action = 'NOOP' then
    comment on column public.whatsapp_contacts.name_source is
      'manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy | whatsapp_push | whatsapp_short | phone — upgrade-only. Legacy nonempty profile_name with null name_source is treated as whatsapp_legacy by the app (not as manual). phone is deprecated and must not be newly written as profile_name.';
    raise notice 'PASS: SYNC-14C-A forward migration complete (idempotent no-op; conbin-proven validated allow-list)';
    return;
  end if;

  if action = 'CLEANUP_TEMP' then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_v14c;
    comment on column public.whatsapp_contacts.name_source is
      'manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy | whatsapp_push | whatsapp_short | phone — upgrade-only. Legacy nonempty profile_name with null name_source is treated as whatsapp_legacy by the app (not as manual). phone is deprecated and must not be newly written as profile_name.';
    raise notice 'PASS: SYNC-14C-A forward migration complete (canonical conbin-proven; dropped leftover proven temporary)';
    return;
  end if;

  if action = 'VALIDATE_CANONICAL' then
    alter table public.whatsapp_contacts
      validate constraint whatsapp_contacts_name_source_check;

    if exists (
      select 1 from pg_constraint
      where conrelid = table_oid and conname = ref_name
    ) then
      raise exception
        'STOP: reference constraint name % already exists (unknown pre-existing object; will not drop)',
        ref_name;
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

    select con.oid into session_ref_oid
    from pg_constraint con
    where con.conrelid = table_oid and con.conname = ref_name and con.contype = 'c';

    select (c.conbin = r.conbin), c.convalidated
    into proof, canonical_validated
    from pg_constraint r
    join pg_constraint c
      on c.conrelid = r.conrelid
     and c.conname = canonical_name
     and c.contype = 'c'
    where r.oid = session_ref_oid;

    if exists (
      select 1 from pg_constraint
      where oid = session_ref_oid and conname = ref_name
    ) then
      alter table public.whatsapp_contacts
        drop constraint whatsapp_contacts_name_source_check_ref_fwd;
    end if;
    session_ref_oid := null;

    if not coalesce(proof, false) or not coalesce(canonical_validated, false) then
      raise exception 'STOP: canonical constraint failed conbin proof and/or validation after VALIDATE';
    end if;

    comment on column public.whatsapp_contacts.name_source is
      'manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy | whatsapp_push | whatsapp_short | phone — upgrade-only. Legacy nonempty profile_name with null name_source is treated as whatsapp_legacy by the app (not as manual). phone is deprecated and must not be newly written as profile_name.';
    raise notice 'PASS: SYNC-14C-A forward migration complete (validated conbin-proven canonical)';
    return;
  end if;

  -- PROMOTE_TEMP or REBUILD
  if action = 'REBUILD' then
    if temp_oid is not null then
      raise exception 'STOP: unexpected temporary constraint state during rebuild';
    end if;

    -- Replace only an existing CHECK canonical (non-CHECK already STOPped)
    if canonical_oid is not null then
      if canonical_contype is distinct from 'c' then
        raise exception
          'STOP: canonical name % is occupied by a non-CHECK constraint (contype=%); will not replace',
          canonical_name,
          canonical_contype;
      end if;
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

  alter table public.whatsapp_contacts
    validate constraint whatsapp_contacts_name_source_check_v14c;
  raise notice 'SYNC-14C-A forward: validated %', temp_name;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = ref_name
  ) then
    raise exception
      'STOP: reference constraint name % already exists (unknown pre-existing object; will not drop)',
      ref_name;
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

  select con.oid into session_ref_oid
  from pg_constraint con
  where con.conrelid = table_oid and con.conname = ref_name and con.contype = 'c';

  select (c.conbin = r.conbin), c.convalidated
  into proof, temp_validated
  from pg_constraint r
  join pg_constraint c
    on c.conrelid = r.conrelid
   and c.conname = temp_name
   and c.contype = 'c'
  where r.oid = session_ref_oid;

  if exists (
    select 1 from pg_constraint
    where oid = session_ref_oid and conname = ref_name
  ) then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_ref_fwd;
  end if;
  session_ref_oid := null;

  if not coalesce(proof, false) or not coalesce(temp_validated, false) then
    raise exception
      'STOP: temporary constraint failed conbin proof + validated check before promotion';
  end if;

  if canonical_oid is not null then
    select con.contype into canonical_contype
    from pg_constraint con
    where con.oid = canonical_oid;

    if canonical_contype is distinct from 'c' then
      raise exception
        'STOP: canonical name % is occupied by a non-CHECK constraint (contype=%); will not replace',
        canonical_name,
        canonical_contype;
    end if;

    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check;
  elsif exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = canonical_name
  ) then
    -- Name appeared after initial probe: still require CHECK
    select con.contype into canonical_contype
    from pg_constraint con
    where con.conrelid = table_oid and con.conname = canonical_name;

    if canonical_contype is distinct from 'c' then
      raise exception
        'STOP: canonical name % is occupied by a non-CHECK constraint (contype=%); will not replace',
        canonical_name,
        canonical_contype;
    end if;

    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check;
  end if;

  alter table public.whatsapp_contacts
    rename constraint whatsapp_contacts_name_source_check_v14c
    to whatsapp_contacts_name_source_check;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and conname = ref_name
  ) then
    raise exception
      'STOP: reference constraint name % already exists (unknown pre-existing object; will not drop)',
      ref_name;
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

  select con.oid into session_ref_oid
  from pg_constraint con
  where con.conrelid = table_oid and con.conname = ref_name and con.contype = 'c';

  select (c.conbin = r.conbin), c.convalidated
  into proof, canonical_validated
  from pg_constraint r
  join pg_constraint c
    on c.conrelid = r.conrelid
   and c.conname = canonical_name
   and c.contype = 'c'
  where r.oid = session_ref_oid;

  if exists (
    select 1 from pg_constraint
    where oid = session_ref_oid and conname = ref_name
  ) then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check_ref_fwd;
  end if;
  session_ref_oid := null;

  if not coalesce(proof, false) or not coalesce(canonical_validated, false) then
    raise exception
      'STOP: forward migration did not leave conbin-proven validated expanded canonical constraint';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid
      and conname in (temp_name, ref_name, rollback_ref_name)
  ) then
    raise exception 'STOP: temporary/reference constraint still present after forward migration';
  end if;

  comment on column public.whatsapp_contacts.name_source is
    'manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy | whatsapp_push | whatsapp_short | phone — upgrade-only. Legacy nonempty profile_name with null name_source is treated as whatsapp_legacy by the app (not as manual). phone is deprecated and must not be newly written as profile_name.';

  raise notice 'PASS: SYNC-14C-A forward migration complete';
end $$;
