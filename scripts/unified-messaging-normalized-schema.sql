-- Unified Messaging — normalized persistence core (Task 3)
-- Additive, manual apply only. Do NOT auto-apply.
--
-- Coexists with official Meta WhatsApp tables (whatsapp_*). This script must
-- NOT drop, rename, or alter any whatsapp_* objects.
--
-- Tenant column: organization_id text (maps to the same placeholder scope as
-- company_id='sunchaser' used by WhatsApp transport). This is NOT yet an
-- active multi-tenant membership RLS boundary.
--
-- SECURITY / RLS (matches existing WhatsApp messaging convention):
-- Tables are backend-only. Browser clients (anon / authenticated) must NOT
-- receive direct table grants. Access only through authenticated Sunchaser API
-- routes. The Node backend uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- RLS is enabled with NO permissive policies so PostgREST roles cannot
-- read/write these tables directly.
--
-- There is no organization-membership SQL helper in this repository. Do not
-- invent permissive authenticated membership policies here.
--
-- CHECK constraints (not PostgreSQL ENUM types) — repository convention.
-- Idempotent: safe to re-run (IF NOT EXISTS / drop+re-add named checks).

-- -----------------------------------------------------------------------------
-- 1. messaging_contacts
-- -----------------------------------------------------------------------------
create table if not exists public.messaging_contacts (
  id text primary key,
  organization_id text not null default 'sunchaser',
  display_name text,
  primary_phone_normalized text,
  city text,
  area text,
  customer_type text,
  consent_status text not null default 'unknown',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint messaging_contacts_org_id_unique unique (organization_id, id)
);

alter table public.messaging_contacts
  drop constraint if exists messaging_contacts_consent_check;

alter table public.messaging_contacts
  add constraint messaging_contacts_consent_check
  check (consent_status in ('unknown', 'opted_in', 'opted_out', 'pending')) not valid;

alter table public.messaging_contacts
  validate constraint messaging_contacts_consent_check;

create index if not exists messaging_contacts_org_phone_idx
  on public.messaging_contacts (organization_id, primary_phone_normalized)
  where primary_phone_normalized is not null;

-- -----------------------------------------------------------------------------
-- 2. messaging_contact_identities
-- -----------------------------------------------------------------------------
create table if not exists public.messaging_contact_identities (
  id text primary key,
  organization_id text not null default 'sunchaser',
  contact_id text not null,
  transport_type text not null,
  connection_id text not null,
  external_user_id text not null,
  normalized_address text,
  display_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint messaging_contact_identities_org_id_unique unique (organization_id, id),
  constraint messaging_contact_identities_contact_fk
    foreign key (organization_id, contact_id)
    references public.messaging_contacts (organization_id, id)
    on delete restrict
);

alter table public.messaging_contact_identities
  drop constraint if exists messaging_contact_identities_transport_check;

alter table public.messaging_contact_identities
  add constraint messaging_contact_identities_transport_check
  check (transport_type in (
    'meta_whatsapp_cloud',
    'whatsapp_web_qr',
    'website_chat',
    'instagram',
    'messenger'
  )) not valid;

alter table public.messaging_contact_identities
  validate constraint messaging_contact_identities_transport_check;

-- One provider identity per connection within an organization.
create unique index if not exists messaging_contact_identities_provider_uidx
  on public.messaging_contact_identities (
    organization_id,
    connection_id,
    transport_type,
    external_user_id
  );

create index if not exists messaging_contact_identities_contact_idx
  on public.messaging_contact_identities (organization_id, contact_id);

-- -----------------------------------------------------------------------------
-- 3. messaging_conversations
-- -----------------------------------------------------------------------------
create table if not exists public.messaging_conversations (
  id text primary key,
  organization_id text not null default 'sunchaser',
  contact_id text not null,
  connection_id text not null,
  transport_type text not null,
  status text not null default 'open',
  assigned_user_id text,
  automation_mode text not null default 'disabled',
  last_message_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint messaging_conversations_org_id_unique unique (organization_id, id),
  constraint messaging_conversations_contact_fk
    foreign key (organization_id, contact_id)
    references public.messaging_contacts (organization_id, id)
    on delete restrict
);

-- connection_id is an opaque transport connection reference (e.g. whatsapp_connections.id).
-- Intentionally NO foreign key to whatsapp_connections: disabling/deleting a connection
-- must not cascade-erase normalized conversation/message history.

alter table public.messaging_conversations
  drop constraint if exists messaging_conversations_transport_check;

alter table public.messaging_conversations
  add constraint messaging_conversations_transport_check
  check (transport_type in (
    'meta_whatsapp_cloud',
    'whatsapp_web_qr',
    'website_chat',
    'instagram',
    'messenger'
  )) not valid;

alter table public.messaging_conversations
  validate constraint messaging_conversations_transport_check;

alter table public.messaging_conversations
  drop constraint if exists messaging_conversations_status_check;

alter table public.messaging_conversations
  add constraint messaging_conversations_status_check
  check (status in ('open', 'pending', 'resolved', 'archived')) not valid;

alter table public.messaging_conversations
  validate constraint messaging_conversations_status_check;

alter table public.messaging_conversations
  drop constraint if exists messaging_conversations_automation_check;

alter table public.messaging_conversations
  add constraint messaging_conversations_automation_check
  check (automation_mode in (
    'bot_active',
    'ai_active',
    'human_handling',
    'paused',
    'disabled'
  )) not valid;

alter table public.messaging_conversations
  validate constraint messaging_conversations_automation_check;

create unique index if not exists messaging_conversations_contact_connection_uidx
  on public.messaging_conversations (
    organization_id,
    contact_id,
    connection_id,
    transport_type
  );

create index if not exists messaging_conversations_activity_idx
  on public.messaging_conversations (
    organization_id,
    (coalesce(last_message_at, created_at)) desc,
    id
  );

create index if not exists messaging_conversations_assigned_idx
  on public.messaging_conversations (organization_id, assigned_user_id)
  where assigned_user_id is not null;

-- -----------------------------------------------------------------------------
-- 4. messaging_messages
-- -----------------------------------------------------------------------------
create table if not exists public.messaging_messages (
  id text primary key,
  organization_id text not null default 'sunchaser',
  conversation_id text not null,
  connection_id text not null,
  transport_type text not null,
  external_message_id text,
  direction text not null,
  sender_identity_id text,
  recipient_identity_id text,
  message_type text not null,
  normalized_text text,
  structured_content jsonb not null default '{"kind":"none"}'::jsonb,
  reply_to_message_id text,
  client_idempotency_key text,
  provider_timestamp timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  processing_status text not null default 'pending',
  delivery_status text not null default 'queued',
  origin text not null,
  ai_run_id text,
  provider_metadata jsonb not null default '{}'::jsonb,
  constraint messaging_messages_org_id_unique unique (organization_id, id),
  constraint messaging_messages_conversation_fk
    foreign key (organization_id, conversation_id)
    references public.messaging_conversations (organization_id, id)
    on delete restrict,
  constraint messaging_messages_sender_identity_fk
    foreign key (organization_id, sender_identity_id)
    references public.messaging_contact_identities (organization_id, id)
    on delete set null,
  constraint messaging_messages_recipient_identity_fk
    foreign key (organization_id, recipient_identity_id)
    references public.messaging_contact_identities (organization_id, id)
    on delete set null,
  constraint messaging_messages_reply_to_fk
    foreign key (organization_id, reply_to_message_id)
    references public.messaging_messages (organization_id, id)
    on delete set null
);

alter table public.messaging_messages
  drop constraint if exists messaging_messages_transport_check;

alter table public.messaging_messages
  add constraint messaging_messages_transport_check
  check (transport_type in (
    'meta_whatsapp_cloud',
    'whatsapp_web_qr',
    'website_chat',
    'instagram',
    'messenger'
  )) not valid;

alter table public.messaging_messages
  validate constraint messaging_messages_transport_check;

alter table public.messaging_messages
  drop constraint if exists messaging_messages_direction_check;

alter table public.messaging_messages
  add constraint messaging_messages_direction_check
  check (direction in ('inbound', 'outbound')) not valid;

alter table public.messaging_messages
  validate constraint messaging_messages_direction_check;

alter table public.messaging_messages
  drop constraint if exists messaging_messages_type_check;

alter table public.messaging_messages
  add constraint messaging_messages_type_check
  check (message_type in (
    'text',
    'image',
    'audio',
    'video',
    'document',
    'interactive',
    'template',
    'location',
    'reaction',
    'system'
  )) not valid;

alter table public.messaging_messages
  validate constraint messaging_messages_type_check;

alter table public.messaging_messages
  drop constraint if exists messaging_messages_origin_check;

alter table public.messaging_messages
  add constraint messaging_messages_origin_check
  check (origin in (
    'customer',
    'human',
    'ai',
    'bot_flow',
    'system',
    'broadcast'
  )) not valid;

alter table public.messaging_messages
  validate constraint messaging_messages_origin_check;

alter table public.messaging_messages
  drop constraint if exists messaging_messages_processing_check;

alter table public.messaging_messages
  add constraint messaging_messages_processing_check
  check (processing_status in (
    'pending',
    'processing',
    'processed',
    'duplicate',
    'rejected',
    'failed'
  )) not valid;

alter table public.messaging_messages
  validate constraint messaging_messages_processing_check;

alter table public.messaging_messages
  drop constraint if exists messaging_messages_delivery_check;

alter table public.messaging_messages
  add constraint messaging_messages_delivery_check
  check (delivery_status in (
    'queued',
    'sending',
    'sent',
    'delivered',
    'read',
    'failed',
    'received'
  )) not valid;

alter table public.messaging_messages
  validate constraint messaging_messages_delivery_check;

-- Inbound provider idempotency: uniqueness only when external_message_id is present.
create unique index if not exists messaging_messages_inbound_external_uidx
  on public.messaging_messages (
    organization_id,
    connection_id,
    transport_type,
    external_message_id
  )
  where external_message_id is not null;

-- Outbound client idempotency: uniqueness only when client_idempotency_key is present.
create unique index if not exists messaging_messages_outbound_idempotency_uidx
  on public.messaging_messages (
    organization_id,
    connection_id,
    client_idempotency_key
  )
  where client_idempotency_key is not null;

create index if not exists messaging_messages_conversation_created_idx
  on public.messaging_messages (organization_id, conversation_id, created_at desc, id desc);

create index if not exists messaging_messages_connection_idx
  on public.messaging_messages (organization_id, connection_id);

-- -----------------------------------------------------------------------------
-- 5. messaging_attachments
-- Private object references only — never permanent public URLs or binary blobs.
-- -----------------------------------------------------------------------------
create table if not exists public.messaging_attachments (
  id text primary key,
  organization_id text not null default 'sunchaser',
  message_id text not null,
  object_key text not null,
  media_type text not null,
  original_filename_safe text,
  size_bytes bigint not null default 0,
  sha256 text not null,
  scan_status text not null default 'pending',
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint messaging_attachments_org_id_unique unique (organization_id, id),
  constraint messaging_attachments_message_fk
    foreign key (organization_id, message_id)
    references public.messaging_messages (organization_id, id)
    on delete restrict,
  constraint messaging_attachments_size_nonneg check (size_bytes >= 0),
  constraint messaging_attachments_object_key_private check (
    object_key !~* '^https?://'
    and object_key !~* '^//'
  )
);

alter table public.messaging_attachments
  drop constraint if exists messaging_attachments_scan_check;

alter table public.messaging_attachments
  add constraint messaging_attachments_scan_check
  check (scan_status in (
    'pending',
    'clean',
    'infected',
    'failed',
    'skipped'
  )) not valid;

alter table public.messaging_attachments
  validate constraint messaging_attachments_scan_check;

create index if not exists messaging_attachments_message_idx
  on public.messaging_attachments (organization_id, message_id);

create unique index if not exists messaging_attachments_sha_object_uidx
  on public.messaging_attachments (organization_id, message_id, sha256, object_key);

-- -----------------------------------------------------------------------------
-- 6. messaging_status_events
-- -----------------------------------------------------------------------------
create table if not exists public.messaging_status_events (
  id text primary key,
  organization_id text not null default 'sunchaser',
  message_id text not null,
  status text not null,
  external_status_id text,
  occurred_at timestamptz not null,
  error_category text,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint messaging_status_events_message_fk
    foreign key (organization_id, message_id)
    references public.messaging_messages (organization_id, id)
    on delete restrict
);

alter table public.messaging_status_events
  drop constraint if exists messaging_status_events_status_check;

alter table public.messaging_status_events
  add constraint messaging_status_events_status_check
  check (status in ('queued', 'sent', 'delivered', 'read', 'failed')) not valid;

alter table public.messaging_status_events
  validate constraint messaging_status_events_status_check;

-- Prevent duplicate provider status events when a stable external identity exists.
create unique index if not exists messaging_status_events_external_uidx
  on public.messaging_status_events (
    organization_id,
    message_id,
    external_status_id
  )
  where external_status_id is not null;

create index if not exists messaging_status_events_message_idx
  on public.messaging_status_events (organization_id, message_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- 7. messaging_conversation_assignments (append-only history)
-- -----------------------------------------------------------------------------
create table if not exists public.messaging_conversation_assignments (
  id text primary key,
  organization_id text not null default 'sunchaser',
  conversation_id text not null,
  assigned_to text not null,
  assigned_by text not null,
  reason text,
  started_at timestamptz not null default timezone('utc'::text, now()),
  ended_at timestamptz,
  constraint messaging_conversation_assignments_conversation_fk
    foreign key (organization_id, conversation_id)
    references public.messaging_conversations (organization_id, id)
    on delete restrict,
  constraint messaging_conversation_assignments_ended_after_started check (
    ended_at is null or ended_at >= started_at
  )
);

create index if not exists messaging_conversation_assignments_conv_idx
  on public.messaging_conversation_assignments (
    organization_id,
    conversation_id,
    started_at desc
  );

create index if not exists messaging_conversation_assignments_open_idx
  on public.messaging_conversation_assignments (organization_id, conversation_id)
  where ended_at is null;

-- -----------------------------------------------------------------------------
-- 8. messaging_outbox (DB-to-worker; no worker in this task)
-- -----------------------------------------------------------------------------
create table if not exists public.messaging_outbox (
  id text primary key,
  organization_id text not null default 'sunchaser',
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default timezone('utc'::text, now()),
  locked_at timestamptz,
  locked_by text,
  last_error_category text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  processed_at timestamptz,
  constraint messaging_outbox_attempt_nonneg check (attempt_count >= 0)
);

alter table public.messaging_outbox
  drop constraint if exists messaging_outbox_status_check;

alter table public.messaging_outbox
  add constraint messaging_outbox_status_check
  check (status in (
    'pending',
    'processing',
    'completed',
    'failed',
    'dead_lettered'
  )) not valid;

alter table public.messaging_outbox
  validate constraint messaging_outbox_status_check;

create unique index if not exists messaging_outbox_idempotency_uidx
  on public.messaging_outbox (organization_id, idempotency_key);

create index if not exists messaging_outbox_claim_idx
  on public.messaging_outbox (status, available_at, created_at)
  where status = 'pending';

create index if not exists messaging_outbox_org_status_idx
  on public.messaging_outbox (organization_id, status, available_at);

-- -----------------------------------------------------------------------------
-- 9. messaging_audit_logs (immutable for normal application roles)
-- -----------------------------------------------------------------------------
create table if not exists public.messaging_audit_logs (
  id text primary key,
  organization_id text not null default 'sunchaser',
  actor_type text not null,
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.messaging_audit_logs
  drop constraint if exists messaging_audit_logs_actor_type_check;

alter table public.messaging_audit_logs
  add constraint messaging_audit_logs_actor_type_check
  check (actor_type in ('system', 'user', 'service', 'transport')) not valid;

alter table public.messaging_audit_logs
  validate constraint messaging_audit_logs_actor_type_check;

create index if not exists messaging_audit_logs_org_occurred_idx
  on public.messaging_audit_logs (organization_id, occurred_at desc);

create index if not exists messaging_audit_logs_target_idx
  on public.messaging_audit_logs (organization_id, target_type, target_id);

-- -----------------------------------------------------------------------------
-- RLS lockdown (backend service-role bypass only)
-- Enable RLS. Do NOT create permissive always-true policies.
-- Do NOT grant anon/authenticated select/insert/update/delete.
-- Audit: no update/delete grants for application roles (revoke covers this).
-- Outbox: not browser-writable (revoke covers this).
-- -----------------------------------------------------------------------------
alter table public.messaging_contacts enable row level security;
alter table public.messaging_contact_identities enable row level security;
alter table public.messaging_conversations enable row level security;
alter table public.messaging_messages enable row level security;
alter table public.messaging_attachments enable row level security;
alter table public.messaging_status_events enable row level security;
alter table public.messaging_conversation_assignments enable row level security;
alter table public.messaging_outbox enable row level security;
alter table public.messaging_audit_logs enable row level security;

drop policy if exists "Enable full access for authenticated backend" on public.messaging_contacts;
drop policy if exists "Enable full access for authenticated backend" on public.messaging_contact_identities;
drop policy if exists "Enable full access for authenticated backend" on public.messaging_conversations;
drop policy if exists "Enable full access for authenticated backend" on public.messaging_messages;
drop policy if exists "Enable full access for authenticated backend" on public.messaging_attachments;
drop policy if exists "Enable full access for authenticated backend" on public.messaging_status_events;
drop policy if exists "Enable full access for authenticated backend" on public.messaging_conversation_assignments;
drop policy if exists "Enable full access for authenticated backend" on public.messaging_outbox;
drop policy if exists "Enable full access for authenticated backend" on public.messaging_audit_logs;

revoke all on table public.messaging_contacts from anon, authenticated;
revoke all on table public.messaging_contact_identities from anon, authenticated;
revoke all on table public.messaging_conversations from anon, authenticated;
revoke all on table public.messaging_messages from anon, authenticated;
revoke all on table public.messaging_attachments from anon, authenticated;
revoke all on table public.messaging_status_events from anon, authenticated;
revoke all on table public.messaging_conversation_assignments from anon, authenticated;
revoke all on table public.messaging_outbox from anon, authenticated;
revoke all on table public.messaging_audit_logs from anon, authenticated;

comment on table public.messaging_contacts is
  'Normalized messaging contacts. Backend-only via service role. organization_id is a placeholder scope until membership RLS exists.';
comment on table public.messaging_contact_identities is
  'Transport identity mappings to canonical contacts. Backend-only. No credentials.';
comment on table public.messaging_conversations is
  'Normalized conversations. Backend-only. Survives transport connection disablement.';
comment on table public.messaging_messages is
  'Normalized messages. Controlled structured_content + redacted provider_metadata only. Backend-only.';
comment on table public.messaging_attachments is
  'Private object_key references for media. No public permanent URLs. Backend-only.';
comment on table public.messaging_status_events is
  'Delivery status history. Backend-only.';
comment on table public.messaging_conversation_assignments is
  'Append-only assignment history. Backend-only.';
comment on table public.messaging_outbox is
  'Reliable DB-to-worker outbox. Not browser-writable. Worker not implemented in Task 3.';
comment on table public.messaging_audit_logs is
  'Immutable audit trail for normal application roles (no update/delete grants). Backend-only.';

-- Compatibility marker: existing WhatsApp tables must remain untouched by this script.
-- (Static validators assert absence of DROP/ALTER on whatsapp_* objects.)

notify pgrst, 'reload schema';
