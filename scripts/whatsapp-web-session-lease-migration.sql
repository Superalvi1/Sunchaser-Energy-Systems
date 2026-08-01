-- WhatsApp Web exclusive session lease (process ownership)
-- Additive, idempotent, manual apply in Supabase SQL Editor only.
-- Do NOT auto-apply from the application.
--
-- Controlled deployment prerequisite:
--   1. Apply this script in Supabase SQL Editor (service_role / postgres).
--   2. Ensure the Render web service has DATABASE_URL or SUPABASE_DB_URL.
--   3. Keep Render numInstances=1 until this lease is verified in production.
--   4. Deploy application code that uses conditional UPDATE/DELETE fencing.
--
-- Access model: backend service_role only.
-- No anon / authenticated browser policies.
--
-- Semantics:
--   - One row per stable session_key.
--   - owner_token is a random fencing token per acquisition.
--   - fencing_version increases monotonically on every successful takeover.
--   - expires_at is set with database server time (clock_timestamp()).
--   - Heartbeat/release must use WHERE session_key + owner_token + fencing_version
--     so an older fencing version can never mutate a replacement owner's row.

create table if not exists public.whatsapp_web_session_lease (
  session_key text primary key,
  owner_id text not null,
  owner_token text not null,
  fencing_version bigint not null,
  expires_at timestamptz not null,
  acquired_at timestamptz not null,
  heartbeat_at timestamptz not null,
  pid integer not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint whatsapp_web_session_lease_fencing_version_check check (fencing_version >= 1),
  constraint whatsapp_web_session_lease_owner_id_check check (char_length(owner_id) > 0),
  constraint whatsapp_web_session_lease_owner_token_check check (char_length(owner_token) > 0)
);

comment on table public.whatsapp_web_session_lease is
  'Exclusive WhatsApp Web Baileys session ownership lease. Non-PII. Backend/service_role only.';

create index if not exists whatsapp_web_session_lease_expires_at_idx
  on public.whatsapp_web_session_lease (expires_at);

alter table public.whatsapp_web_session_lease enable row level security;

-- Intentionally no anon/authenticated policies — service_role bypasses RLS.

revoke all on table public.whatsapp_web_session_lease from public;
revoke all on table public.whatsapp_web_session_lease from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.whatsapp_web_session_lease from service_role;
    grant select, insert, update, delete on table public.whatsapp_web_session_lease to service_role;
  else
    raise notice 'service_role missing — skip table grant (local/non-Supabase)';
  end if;
end $$;
