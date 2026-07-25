-- WhatsApp Web contact sync + 7-day history backfill (SYNC-1 / SYNC-1A)
-- Additive, idempotent, manual apply in Supabase SQL Editor only.
-- Do NOT auto-apply from the application.
--
-- Access model: backend service_role only for new RPCs.
-- RLS on base tables is preserved; this migration does not weaken policies.

-- ---------------------------------------------------------------------------
-- Contact bookkeeping for WhatsApp Web sync
-- ---------------------------------------------------------------------------
alter table public.whatsapp_contacts
  add column if not exists wa_jid text;

alter table public.whatsapp_contacts
  add column if not exists name_source text;

alter table public.whatsapp_contacts
  add column if not exists is_business_contact boolean not null default false;

alter table public.whatsapp_contacts
  add column if not exists last_synced_at timestamptz;

comment on column public.whatsapp_contacts.name_source is
  'manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone — never downgrade. Legacy non-null profile_name with null name_source is treated as manual by the app.';

comment on column public.whatsapp_contacts.wa_jid is
  'WhatsApp user JID (@s.whatsapp.net only). LID/unknown hosts are never stored as phone identities.';

-- Allowed name_source values (null remains allowed for legacy rows).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_contacts_name_source_check'
      and conrelid = 'public.whatsapp_contacts'::regclass
  ) then
    alter table public.whatsapp_contacts
      add constraint whatsapp_contacts_name_source_check
      check (
        name_source is null
        or name_source in (
          'manual',
          'whatsapp_saved',
          'whatsapp_push',
          'whatsapp_short',
          'phone'
        )
      );
  end if;
end $$;

-- Decision: unique (company_id, wa_jid) where wa_jid is not null.
-- Safe because the application only persists @s.whatsapp.net user JIDs as wa_jid.
-- LID / group / broadcast / newsletter identifiers are never written to wa_jid,
-- so they cannot create false unique conflicts with phone JIDs.
create unique index if not exists whatsapp_contacts_company_wa_jid_uidx
  on public.whatsapp_contacts (company_id, wa_jid)
  where wa_jid is not null;

-- ---------------------------------------------------------------------------
-- Explicit backfill marker — historical imports must never drive live automation.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_messages
  add column if not exists is_backfill boolean not null default false;

create index if not exists whatsapp_messages_is_backfill_idx
  on public.whatsapp_messages (company_id, conversation_id)
  where is_backfill = true;

-- Provider message id uniqueness already exists in whatsapp-transport-schema.sql.

comment on column public.whatsapp_messages.is_backfill is
  'true for history sync imports; excluded from unread and live AI/outbound triggers.';

-- ---------------------------------------------------------------------------
-- Atomic last_message_at maximum (never reduces; race-safe vs live + backfill)
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_advance_conversation_last_message_at(
  p_company_id text,
  p_conversation_id text,
  p_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  if p_company_id is null
     or length(trim(p_company_id)) = 0
     or p_conversation_id is null
     or length(trim(p_conversation_id)) = 0
     or p_at is null then
    return false;
  end if;

  update public.whatsapp_conversations as c
  set
    last_message_at = p_at,
    updated_at = timezone('utc'::text, now())
  where c.company_id = p_company_id
    and c.id = p_conversation_id
    and (c.last_message_at is null or c.last_message_at < p_at);

  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

revoke all on function public.whatsapp_advance_conversation_last_message_at(
  text, text, timestamptz
) from public;

revoke all on function public.whatsapp_advance_conversation_last_message_at(
  text, text, timestamptz
) from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.whatsapp_advance_conversation_last_message_at(
      text, text, timestamptz
    ) to service_role;
  else
    raise notice 'service_role missing — skip RPC grant (local/non-Supabase)';
  end if;
end $$;

comment on function public.whatsapp_advance_conversation_last_message_at is
  'Atomic GREATEST-style advance of last_message_at scoped by company_id + conversation_id. Never reduces. Backend/service_role only.';
