-- =============================================================================
-- SYNC-14C-A — forward migration: expand whatsapp_contacts.name_source allow-list
-- =============================================================================
-- REVIEW / MANUAL APPLY ONLY (Supabase SQL Editor).
-- Do NOT auto-apply from the application. Do NOT run until preflight PASSes.
--
-- Purpose:
--   Allow application provenance values introduced by SYNC-14B:
--     whatsapp_verified  — Baileys Contact.verifiedName
--     whatsapp_legacy    — optional stored form of legacy nonempty+null rows
--   Preserve all previously allowed values:
--     manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone | NULL
--
-- Safety:
--   - Additive allow-list expansion only (no data rewrites).
--   - Idempotent: no-ops when constraint already includes the new values.
--   - Uses add-NOT VALID → VALIDATE → drop-old → rename so there is no window
--     without a check constraint, and VALIDATE uses a lighter lock than a
--     single ACCESS EXCLUSIVE rewrite where practical.
--   - Does not alter RLS, policies, grants, indexes, or tenant columns.
--
-- Supersedes for apply purposes:
--   scripts/whatsapp-web-contact-name-source-sync14b-migration.sql (PR #12 review-only)
-- =============================================================================

do $$
declare
  table_oid regclass := 'public.whatsapp_contacts'::regclass;
  old_name text := 'whatsapp_contacts_name_source_check';
  new_name text := 'whatsapp_contacts_name_source_check_v14c';
  old_def text;
  new_def text;
  old_exists boolean;
  new_exists boolean;
  already_ok boolean := false;
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
    raise exception 'STOP: whatsapp_contacts.name_source column missing — apply history-sync migration first';
  end if;

  select exists (
    select 1 from pg_constraint
    where conname = old_name and conrelid = table_oid
  ) into old_exists;

  select exists (
    select 1 from pg_constraint
    where conname = new_name and conrelid = table_oid
  ) into new_exists;

  if old_exists then
    select pg_get_constraintdef(oid, true)
    into old_def
    from pg_constraint
    where conname = old_name and conrelid = table_oid;
  end if;

  if old_def is not null
     and old_def ilike '%whatsapp_verified%'
     and old_def ilike '%whatsapp_legacy%'
     and old_def ilike '%manual%'
     and old_def ilike '%whatsapp_saved%' then
    already_ok := true;
  end if;

  if already_ok and not new_exists then
    raise notice 'SYNC-14C-A forward: constraint already expanded — no-op';
    return;
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

  -- 1) Add expanded constraint as NOT VALID (allows concurrent writes under old check).
  if not new_exists then
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
    raise notice 'SYNC-14C-A forward: added % NOT VALID', new_name;
  else
    raise notice 'SYNC-14C-A forward: % already present', new_name;
  end if;

  -- 2) Validate (SHARE UPDATE EXCLUSIVE — concurrent reads/writes generally continue).
  alter table public.whatsapp_contacts
    validate constraint whatsapp_contacts_name_source_check_v14c;
  raise notice 'SYNC-14C-A forward: validated %', new_name;

  -- 3) Drop legacy constraint name if it still exists and is distinct.
  if old_exists then
    select pg_get_constraintdef(oid, true)
    into old_def
    from pg_constraint
    where conname = old_name and conrelid = table_oid;

    -- If old_name somehow already points at the expanded def, just drop the temp name.
    if old_def is not null
       and old_def ilike '%whatsapp_verified%'
       and old_def ilike '%whatsapp_legacy%' then
      alter table public.whatsapp_contacts
        drop constraint if exists whatsapp_contacts_name_source_check_v14c;
      raise notice 'SYNC-14C-A forward: canonical name already expanded; dropped temp constraint';
    else
      alter table public.whatsapp_contacts
        drop constraint whatsapp_contacts_name_source_check;
      alter table public.whatsapp_contacts
        rename constraint whatsapp_contacts_name_source_check_v14c
        to whatsapp_contacts_name_source_check;
      raise notice 'SYNC-14C-A forward: replaced constraint name to %', old_name;
    end if;
  else
    -- No prior constraint: promote temp name to canonical.
    if exists (
      select 1 from pg_constraint
      where conname = new_name and conrelid = table_oid
    ) then
      alter table public.whatsapp_contacts
        rename constraint whatsapp_contacts_name_source_check_v14c
        to whatsapp_contacts_name_source_check;
      raise notice 'SYNC-14C-A forward: installed canonical constraint (no prior check)';
    end if;
  end if;

  select pg_get_constraintdef(oid, true)
  into new_def
  from pg_constraint
  where conname = old_name and conrelid = table_oid;

  if new_def is null
     or new_def not ilike '%whatsapp_verified%'
     or new_def not ilike '%whatsapp_legacy%' then
    raise exception 'STOP: forward migration did not leave expanded canonical constraint';
  end if;

  comment on column public.whatsapp_contacts.name_source is
    'manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy | whatsapp_push | whatsapp_short | phone — upgrade-only. Legacy nonempty profile_name with null name_source is treated as whatsapp_legacy by the app (not as manual). phone is deprecated and must not be newly written as profile_name.';

  raise notice 'PASS: SYNC-14C-A forward migration complete';
end $$;
