-- WhatsApp Hardening RC-1.2.4 Migration
-- Apply in Supabase SQL Editor. Do NOT auto-apply.
--
-- Adds:
--   1. whatsapp_connections — persistent, company-scoped credential storage.
--      Replaces in-memory singleton store on multi-instance deployments.
--   2. whatsapp_oauth_states — CSRF state nonce table for Embedded Signup.
--      Replaces in-memory nonce store on multi-instance deployments.
--
-- Security:
--   - Tables are backend-only (service role only).
--   - RLS enabled with no permissive policies.
--   - access_token is AES-256-GCM application-encrypted (v1:iv:tag:ciphertext),
--     not vault-only storage.
--   - nonce column stores SHA-256 hash of the raw nonce returned to the client.
--   - Nonces are single-use and expire after 15 minutes.

-- ─── 1. WhatsApp Connections ─────────────────────────────────────────────────

create table if not exists public.whatsapp_connections (
  id                   text        primary key default gen_random_uuid()::text,
  company_id           text        not null,
  waba_id              text,
  phone_number_id      text,
  phone_number         text,
  -- access_token: AES-256-GCM application-encrypted blob (v1:iv:tag:ciphertext).
  -- Encrypted/decrypted by the Node service via WHATSAPP_TOKEN_ENCRYPTION_KEY.
  access_token         text,
  token_expires_at     timestamptz,
  last_webhook_at      timestamptz,
  last_error           text,
  state_override       text check (state_override in (
                         'DISCONNECTED','CONNECTING','CONNECTED',
                         'ERROR','TOKEN_EXPIRED','WEBHOOK_PENDING',
                         'NOT_CONNECTED','REAUTHORIZATION_REQUIRED')),
  created_at           timestamptz not null default timezone('utc'::text, now()),
  updated_at           timestamptz not null default timezone('utc'::text, now()),
  constraint whatsapp_connections_company_unique unique (company_id)
);

-- Only one active connection per company is supported.
create unique index if not exists whatsapp_connections_company_idx
  on public.whatsapp_connections (company_id);

-- No direct browser/PostgREST access.
alter table public.whatsapp_connections enable row level security;
revoke all on table public.whatsapp_connections from anon, authenticated;

comment on table public.whatsapp_connections is
  'Persistent WhatsApp Business Platform connection credentials, one row per company. '
  'access_token is AES-256-GCM application-encrypted (v1:iv:tag:ciphertext) before storage.';

comment on column public.whatsapp_connections.access_token is
  'AES-256-GCM application-encrypted access token (v1:iv:tag:ciphertext). '
  'Decrypted only by the backend service; never exposed via PostgREST.';

-- ─── 2. WhatsApp OAuth States (CSRF nonces) ──────────────────────────────────

create table if not exists public.whatsapp_oauth_states (
  nonce       text        primary key,
  company_id  text        not null,
  actor_id    text        not null,
  expires_at  timestamptz not null,
  used        boolean     not null default false,
  created_at  timestamptz not null default timezone('utc'::text, now())
);

comment on column public.whatsapp_oauth_states.nonce is
  'SHA-256 hash (hex) of the raw nonce returned to the Embedded Signup client.';

create index if not exists whatsapp_oauth_states_expires_at_idx
  on public.whatsapp_oauth_states (expires_at);

create index if not exists whatsapp_oauth_states_used_expires_at_idx
  on public.whatsapp_oauth_states (used, expires_at);

-- Clean up expired states automatically (Postgres 15+: pg_cron job recommended).
-- Until pg_cron is available, the application prunes expired rows in-process.

alter table public.whatsapp_oauth_states enable row level security;
revoke all on table public.whatsapp_oauth_states from anon, authenticated;

comment on table public.whatsapp_oauth_states is
  'Single-use CSRF state nonces for Meta Embedded Signup. '
  'Nonces expire after 15 minutes and are consumed on first use. '
  'The nonce column stores SHA-256(hex) of the raw client nonce.';

-- ─── 3. Atomic OAuth state consume RPC ───────────────────────────────────────

create or replace function public.whatsapp_oauth_consume_state(
  p_nonce_hash text,
  p_company_id text,
  p_actor_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated public.whatsapp_oauth_states%rowtype;
begin
  update public.whatsapp_oauth_states
  set used = true
  where nonce = p_nonce_hash
    and company_id = p_company_id
    and (p_actor_id is null or actor_id = p_actor_id)
    and used = false
    and expires_at > timezone('utc'::text, now())
  returning * into v_updated;

  if found then
    return jsonb_build_object('ok', true);
  end if;

  if exists (
    select 1 from public.whatsapp_oauth_states
    where nonce = p_nonce_hash and used = true
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'State nonce already consumed (replay detected)'
    );
  end if;

  if exists (
    select 1 from public.whatsapp_oauth_states
    where nonce = p_nonce_hash and company_id is distinct from p_company_id
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'State nonce company mismatch'
    );
  end if;

  if p_actor_id is not null and exists (
    select 1 from public.whatsapp_oauth_states
    where nonce = p_nonce_hash and actor_id is distinct from p_actor_id
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'State nonce actor mismatch'
    );
  end if;

  if exists (
    select 1 from public.whatsapp_oauth_states
    where nonce = p_nonce_hash
      and expires_at <= timezone('utc'::text, now())
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'State nonce expired'
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'reason', 'State nonce not found or already expired'
  );
end;
$$;

revoke all on function public.whatsapp_oauth_consume_state(text, text, text) from public;
grant execute on function public.whatsapp_oauth_consume_state(text, text, text) to service_role;
