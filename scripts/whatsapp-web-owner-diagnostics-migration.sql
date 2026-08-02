-- WhatsApp Web owner diagnostics (shared, CAS-fenced)
-- Additive, idempotent, manual apply in Supabase SQL Editor only.
-- Do NOT auto-apply from the application.
--
-- Deployment order (controlled; production HOLD until approved):
--   1. Apply scripts/whatsapp-web-session-lease-migration.sql (if not already).
--   2. Apply THIS script in Supabase SQL Editor (service_role / postgres).
--   3. Ensure Render has DATABASE_URL or SUPABASE_DB_URL.
--   4. Keep Render numInstances=1 during verification.
--   5. Deploy application code that reads/writes this table with fencing guards.
--
-- Rollback-safe: DROP TABLE public.whatsapp_web_owner_diagnostics; (data loss only
-- for diagnostics; lease table and Baileys auth are untouched).
--
-- Access model: backend service_role only. No anon/authenticated policies.
--
-- Semantics:
--   - One row per session_key (same key as whatsapp_web_session_lease).
--   - Writes MUST use WHERE session_key + owner_token + fencing_version so an
--     old/non-owner process never overwrites successor diagnostics.
--   - owner_token is never returned to browsers (API hashes/truncates ids only).
--   - Non-PII only: no phones, message text, credentials, QR, or JWTs.

create table if not exists public.whatsapp_web_owner_diagnostics (
  session_key text primary key,
  owner_id text not null,
  owner_token text not null,
  fencing_version bigint not null,
  owner_process_instance_id text not null,
  connection_generation bigint not null default 0,
  lifecycle_state text not null default 'DISCONNECTED',
  socket_open boolean not null default false,
  inbound_listener_attached boolean not null default false,
  inbound_listener_operational boolean not null default false,
  inbound_health text not null default 'INBOUND_SILENT',
  last_connection_at timestamptz null,
  last_heartbeat_at timestamptz null,
  last_raw_upsert_at timestamptz null,
  last_accepted_event_at timestamptz null,
  last_stored_message_at timestamptz null,
  last_failure_code text null,
  build_identity text null,
  updated_at timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint whatsapp_web_owner_diagnostics_fencing_version_check
    check (fencing_version >= 1),
  constraint whatsapp_web_owner_diagnostics_owner_id_check
    check (char_length(owner_id) > 0),
  constraint whatsapp_web_owner_diagnostics_owner_token_check
    check (char_length(owner_token) > 0),
  constraint whatsapp_web_owner_diagnostics_inbound_health_check
    check (
      inbound_health in (
        'CONNECTED_SOCKET',
        'LISTENER_READY',
        'LIVE_INBOUND_CONFIRMED',
        'INBOUND_SILENT',
        'LEASE_NOT_OWNED'
      )
    )
);

comment on table public.whatsapp_web_owner_diagnostics is
  'Shared WhatsApp Web owner diagnostics. Non-PII. CAS-fenced by owner_token + fencing_version. Backend/service_role only.';

create index if not exists whatsapp_web_owner_diagnostics_updated_at_idx
  on public.whatsapp_web_owner_diagnostics (updated_at);

alter table public.whatsapp_web_owner_diagnostics enable row level security;

revoke all on table public.whatsapp_web_owner_diagnostics from public;
revoke all on table public.whatsapp_web_owner_diagnostics from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.whatsapp_web_owner_diagnostics from service_role;
    grant select, insert, update, delete on table public.whatsapp_web_owner_diagnostics to service_role;
  else
    raise notice 'service_role missing — skip table grant (local/non-Supabase)';
  end if;
end $$;
