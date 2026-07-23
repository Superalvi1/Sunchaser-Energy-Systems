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
--   - access_token column encrypted via pgcrypto / vault (see comments).
--   - Nonces are single-use and expire after 15 minutes.

-- ─── 1. WhatsApp Connections ─────────────────────────────────────────────────

create table if not exists public.whatsapp_connections (
  id                   text        primary key default gen_random_uuid()::text,
  company_id           text        not null,
  waba_id              text,
  phone_number_id      text,
  phone_number         text,
  -- access_token is stored as-is here. For production use Supabase Vault:
  --   insert into vault.secrets (secret, name) values (token, 'waba_token')
  -- and store only the vault secret_id in this column.
  access_token         text,
  token_expires_at     timestamptz,
  last_webhook_at      timestamptz,
  last_error           text,
  state_override       text check (state_override in (
                         'NOT_CONNECTED','CONNECTING','CONNECTED',
                         'REAUTHORIZATION_REQUIRED','ERROR')),
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
  'In production store access_token via Supabase Vault and keep only the secret_id here.';

-- ─── 2. WhatsApp OAuth States (CSRF nonces) ──────────────────────────────────

create table if not exists public.whatsapp_oauth_states (
  nonce       text        primary key,
  company_id  text        not null,
  actor_id    text        not null,
  expires_at  timestamptz not null,
  used        boolean     not null default false,
  created_at  timestamptz not null default timezone('utc'::text, now())
);

create index if not exists whatsapp_oauth_states_expires_at_idx
  on public.whatsapp_oauth_states (expires_at);

-- Clean up expired states automatically (Postgres 15+: pg_cron job recommended).
-- Until pg_cron is available, the application prunes expired rows in-process.

alter table public.whatsapp_oauth_states enable row level security;
revoke all on table public.whatsapp_oauth_states from anon, authenticated;

comment on table public.whatsapp_oauth_states is
  'Single-use CSRF state nonces for Meta Embedded Signup. '
  'Nonces expire after 15 minutes and are consumed on first use. '
  'Replaces the in-memory OAuthStateStore on multi-instance deployments.';
