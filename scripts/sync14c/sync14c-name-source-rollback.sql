-- =============================================================================
-- SYNC-14C-A — rollback: restore pre-SYNC-14B name_source allow-list
-- =============================================================================
-- REVIEW / MANUAL APPLY ONLY. Do NOT auto-apply.
--
-- Restores the SYNC-1 / history-sync allow-list:
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
-- 5. Soft/no-op when the constraint already matches the pre-expansion set.
-- =============================================================================

do $$
declare
  table_oid regclass := 'public.whatsapp_contacts'::regclass;
  blocking_count bigint;
  def text;
  already_old boolean := false;
begin
  if to_regclass('public.whatsapp_contacts') is null then
    raise exception 'STOP: public.whatsapp_contacts does not exist';
  end if;

  select count(*) into blocking_count
  from public.whatsapp_contacts
  where name_source in ('whatsapp_verified', 'whatsapp_legacy');

  if blocking_count > 0 then
    raise exception
      'STOP: cannot rollback name_source check — % row(s) use whatsapp_verified/whatsapp_legacy. Roll back application writers first and clear/rewrite those values under a separate approved data plan (not provided here).',
      blocking_count;
  end if;

  select pg_get_constraintdef(oid, true)
  into def
  from pg_constraint
  where conname = 'whatsapp_contacts_name_source_check'
    and conrelid = table_oid;

  if def is not null
     and def ilike '%manual%'
     and def ilike '%whatsapp_saved%'
     and def not ilike '%whatsapp_verified%'
     and def not ilike '%whatsapp_legacy%' then
    already_old := true;
  end if;

  if already_old then
    alter table public.whatsapp_contacts
      drop constraint if exists whatsapp_contacts_name_source_check_v14c;
    comment on column public.whatsapp_contacts.name_source is
      'manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone — never downgrade. Legacy non-null profile_name with null name_source is treated as manual by the app.';
    raise notice 'PASS: SYNC-14C-A rollback — constraint already on pre-expansion allow-list (no-op)';
    return;
  end if;

  -- Keep a constraint in place: add old allow-list NOT VALID, validate, drop expanded.
  alter table public.whatsapp_contacts
    drop constraint if exists whatsapp_contacts_name_source_check_rollback;

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

  alter table public.whatsapp_contacts
    validate constraint whatsapp_contacts_name_source_check_rollback;

  alter table public.whatsapp_contacts
    drop constraint if exists whatsapp_contacts_name_source_check;

  alter table public.whatsapp_contacts
    drop constraint if exists whatsapp_contacts_name_source_check_v14c;

  alter table public.whatsapp_contacts
    rename constraint whatsapp_contacts_name_source_check_rollback
    to whatsapp_contacts_name_source_check;

  comment on column public.whatsapp_contacts.name_source is
    'manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone — never downgrade. Legacy non-null profile_name with null name_source is treated as manual by the app.';

  raise notice 'PASS: SYNC-14C-A rollback — restored pre-expansion name_source check';
end $$;
