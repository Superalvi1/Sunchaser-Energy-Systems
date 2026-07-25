-- WhatsApp Web contact sync + 7-day history backfill (SYNC-1)
-- Additive, manual apply in Supabase SQL Editor only.
-- Do NOT auto-apply from the application.

-- Contact bookkeeping for WhatsApp Web sync
alter table public.whatsapp_contacts
  add column if not exists wa_jid text;

alter table public.whatsapp_contacts
  add column if not exists name_source text;

alter table public.whatsapp_contacts
  add column if not exists is_business_contact boolean not null default false;

alter table public.whatsapp_contacts
  add column if not exists last_synced_at timestamptz;

comment on column public.whatsapp_contacts.name_source is
  'manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone — never downgrade.';

comment on column public.whatsapp_contacts.wa_jid is
  'WhatsApp JID for the contact (user @s.whatsapp.net).';

-- Explicit backfill marker — historical imports must never drive live automation.
alter table public.whatsapp_messages
  add column if not exists is_backfill boolean not null default false;

create index if not exists whatsapp_messages_is_backfill_idx
  on public.whatsapp_messages (company_id, conversation_id)
  where is_backfill = true;

-- Provider message id uniqueness already exists in whatsapp-transport-schema.sql.

create index if not exists whatsapp_contacts_wa_jid_idx
  on public.whatsapp_contacts (company_id, wa_jid)
  where wa_jid is not null;

comment on column public.whatsapp_messages.is_backfill is
  'true for history sync imports; excluded from unread and live AI/outbound triggers.';
