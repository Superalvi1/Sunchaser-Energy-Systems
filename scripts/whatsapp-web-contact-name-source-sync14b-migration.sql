-- SYNC-14B — extend whatsapp_contacts.name_source allowed values (REVIEW ONLY)
-- Additive, idempotent, manual apply in Supabase SQL Editor only.
-- Do NOT auto-apply from the application. Do NOT run against production in SYNC-14B.
--
-- Why required:
--   Application now persists distinct provenance:
--     whatsapp_verified  (Baileys Contact.verifiedName)
--   and ranks legacy nonempty profile_name + null name_source as whatsapp_legacy
--   in application logic (whatsapp_legacy is not written by SYNC-14B code paths,
--   but is allowed so optional future backfill / tooling can store it safely).
--   Existing check constraint only allows:
--     manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone
--
-- Access model unchanged: service_role backend only; RLS not weakened.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_contacts_name_source_check'
      and conrelid = 'public.whatsapp_contacts'::regclass
  ) then
    alter table public.whatsapp_contacts
      drop constraint whatsapp_contacts_name_source_check;
  end if;

  alter table public.whatsapp_contacts
    add constraint whatsapp_contacts_name_source_check
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
    );
end $$;

comment on column public.whatsapp_contacts.name_source is
  'manual | whatsapp_verified | whatsapp_saved | whatsapp_legacy | whatsapp_push | whatsapp_short | phone — upgrade-only. Legacy nonempty profile_name with null name_source is treated as whatsapp_legacy by the app (not as manual). phone is deprecated and must not be newly written as profile_name.';
