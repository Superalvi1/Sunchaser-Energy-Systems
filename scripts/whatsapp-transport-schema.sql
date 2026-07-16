-- WhatsApp Conversations — PR 1 transport foundation (additive, manual apply only)
-- Do NOT auto-apply. Run in Supabase SQL Editor when ready.
--
-- Persistence is Supabase-only (no database.json fallback).
-- company_id defaults to 'sunchaser' as a placeholder scope.
-- This is NOT an active multi-tenant isolation boundary yet.
-- Backend uses the service-role key (bypasses RLS); RLS enabled for defense in depth.

-- -----------------------------------------------------------------------------
-- 1. Channels
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_channels (
  id text primary key,
  company_id text not null default 'sunchaser',
  phone_number_id text not null,
  display_phone_number text,
  waba_id text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint whatsapp_channels_phone_number_id_unique unique (phone_number_id)
);

create index if not exists whatsapp_channels_company_id_idx
  on public.whatsapp_channels (company_id);

-- -----------------------------------------------------------------------------
-- 2. Contacts
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_contacts (
  id text primary key,
  company_id text not null default 'sunchaser',
  phone_e164 text not null,
  profile_name text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint whatsapp_contacts_company_phone_unique unique (company_id, phone_e164)
);

create index if not exists whatsapp_contacts_phone_e164_idx
  on public.whatsapp_contacts (phone_e164);

-- -----------------------------------------------------------------------------
-- 3. Conversations
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_conversations (
  id text primary key,
  company_id text not null default 'sunchaser',
  channel_id text not null references public.whatsapp_channels (id),
  contact_id text not null references public.whatsapp_contacts (id),
  status text not null default 'open',
  last_message_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint whatsapp_conversations_company_channel_contact_unique
    unique (company_id, channel_id, contact_id)
);

create index if not exists whatsapp_conversations_channel_id_idx
  on public.whatsapp_conversations (channel_id);

create index if not exists whatsapp_conversations_contact_id_idx
  on public.whatsapp_conversations (contact_id);

create index if not exists whatsapp_conversations_last_message_at_idx
  on public.whatsapp_conversations (last_message_at desc nulls last);

-- -----------------------------------------------------------------------------
-- 4. Messages
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_messages (
  id text primary key,
  company_id text not null default 'sunchaser',
  conversation_id text not null references public.whatsapp_conversations (id),
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null,
  text_body text,
  wa_message_id text,
  provider_error text,
  occurred_at timestamptz,
  sent_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists whatsapp_messages_conversation_id_idx
  on public.whatsapp_messages (conversation_id, created_at desc);

create unique index if not exists whatsapp_messages_company_wa_message_id_uidx
  on public.whatsapp_messages (company_id, wa_message_id)
  where wa_message_id is not null;

-- -----------------------------------------------------------------------------
-- 5. Status events
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_message_status_events (
  id text primary key,
  company_id text not null default 'sunchaser',
  wa_message_id text not null,
  status text not null,
  status_timestamp timestamptz not null,
  recipient_wa_id text,
  raw_payload jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint whatsapp_message_status_events_unique
    unique (company_id, wa_message_id, status, status_timestamp)
);

create index if not exists whatsapp_message_status_events_wa_message_id_idx
  on public.whatsapp_message_status_events (wa_message_id);

-- -----------------------------------------------------------------------------
-- 6. Webhook events (envelope idempotency)
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_webhook_events (
  id text primary key,
  company_id text not null default 'sunchaser',
  payload_hash text not null,
  processed boolean not null default false,
  error text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint whatsapp_webhook_events_payload_hash_unique unique (payload_hash)
);

create index if not exists whatsapp_webhook_events_processed_idx
  on public.whatsapp_webhook_events (processed, created_at desc);

-- -----------------------------------------------------------------------------
-- 7. Audit events
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_audit_events (
  id text primary key,
  company_id text not null default 'sunchaser',
  event_type text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists whatsapp_audit_events_event_type_idx
  on public.whatsapp_audit_events (event_type, created_at desc);

create index if not exists whatsapp_audit_events_entity_idx
  on public.whatsapp_audit_events (entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- RLS (backend service-role pattern)
-- NOTE: fixed company_id is NOT yet an active isolation boundary.
-- -----------------------------------------------------------------------------
alter table public.whatsapp_channels enable row level security;
alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_message_status_events enable row level security;
alter table public.whatsapp_webhook_events enable row level security;
alter table public.whatsapp_audit_events enable row level security;

drop policy if exists "Enable full access for authenticated backend" on public.whatsapp_channels;
create policy "Enable full access for authenticated backend" on public.whatsapp_channels for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.whatsapp_contacts;
create policy "Enable full access for authenticated backend" on public.whatsapp_contacts for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.whatsapp_conversations;
create policy "Enable full access for authenticated backend" on public.whatsapp_conversations for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.whatsapp_messages;
create policy "Enable full access for authenticated backend" on public.whatsapp_messages for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.whatsapp_message_status_events;
create policy "Enable full access for authenticated backend" on public.whatsapp_message_status_events for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.whatsapp_webhook_events;
create policy "Enable full access for authenticated backend" on public.whatsapp_webhook_events for all using (true);

drop policy if exists "Enable full access for authenticated backend" on public.whatsapp_audit_events;
create policy "Enable full access for authenticated backend" on public.whatsapp_audit_events for all using (true);

comment on table public.whatsapp_channels is
  'WhatsApp Cloud API channels. company_id is a placeholder scope, not tenant isolation.';
comment on table public.whatsapp_webhook_events is
  'Envelope idempotency via SHA-256 of exact raw webhook bytes.';
comment on table public.whatsapp_audit_events is
  'Durable transport audit events. Avoid storing full message body contents here.';

notify pgrst, 'reload schema';
