-- =============================================================================
-- SYNC-14C-B — durable WhatsApp LID → phone mapping (review / manual apply only)
-- =============================================================================
-- REVIEW / MANUAL APPLY ONLY (Supabase SQL Editor).
-- Do NOT auto-apply from the application.
-- Do NOT backfill production. Do NOT run reconnect/sync/outbound as part of apply.
--
-- Purpose:
--   Persist verified Baileys LID (@lid) → phone (E.164 digits) mappings so
--   process restarts can resolve LID-only inbound events to existing contacts
--   without treating LID numeric user parts as phone numbers.
--
-- Scope keys (existing WhatsApp Web model):
--   company_id              — placeholder tenant scope (same as whatsapp_*)
--   channel_phone_number_id — synthetic channel key (e.g. wa_web_qr_sunchaser)
--   session_key             — session folder key (e.g. sunchaser)
--
-- Stored identifiers (backend-only; never API DTO / UI labels):
--   lid_normalized — normalized user@lid
--   phone_e164     — digits-only phone identity (matches whatsapp_contacts.phone_e164)
--
-- Conflict / remap / stale policy (enforced by app + constraints):
--   1. First verified (company, channel, session, lid) → status=active.
--   2. Identical phone re-verify → touch last_resolved_at (idempotent).
--   3. Same active LID with a different phone → CONFLICT: keep first phone,
--      increment conflict_count; do not overwrite; do not create contacts.
--   4. Remap only when the active row is status=stale: mark superseded, insert
--      a new active row for the new verified phone.
--   5. Stale mappings still resolve until superseded (resolution prefers active,
--      then stale). Superseded rows never resolve.
--
-- Privacy / access:
--   Backend service_role only. RLS enabled with NO anon/authenticated policies.
--   Application must never expose lid_normalized / JIDs via inbox DTOs or logs.
-- =============================================================================

create table if not exists public.whatsapp_lid_phone_mappings (
  id text primary key,
  company_id text not null default 'sunchaser',
  channel_phone_number_id text not null,
  session_key text not null,
  lid_normalized text not null,
  phone_e164 text not null,
  status text not null default 'active',
  verified_at timestamptz not null default timezone('utc'::text, now()),
  last_resolved_at timestamptz not null default timezone('utc'::text, now()),
  conflict_count integer not null default 0,
  superseded_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint whatsapp_lid_phone_mappings_status_check check (
    status in ('active', 'stale', 'superseded')
  ),
  constraint whatsapp_lid_phone_mappings_lid_host_check check (
    lid_normalized ~* '@lid$'
  ),
  constraint whatsapp_lid_phone_mappings_phone_digits_check check (
    phone_e164 ~ '^[0-9]{6,}$'
  ),
  constraint whatsapp_lid_phone_mappings_conflict_count_check check (
    conflict_count >= 0
  ),
  constraint whatsapp_lid_phone_mappings_superseded_at_check check (
    (status = 'superseded' and superseded_at is not null)
    or (status <> 'superseded' and superseded_at is null)
  )
);

comment on table public.whatsapp_lid_phone_mappings is
  'SYNC-14C-B durable LID→phone mappings. Backend/service_role only. Never expose LID/JID in API DTOs or UI.';

comment on column public.whatsapp_lid_phone_mappings.lid_normalized is
  'Normalized Baileys LID JID (user@lid). Never treat digits as phoneE164. Never expose via DTO/UI/logs.';

comment on column public.whatsapp_lid_phone_mappings.phone_e164 is
  'Digits-only phone identity aligned with whatsapp_contacts.phone_e164. Never log full value.';

comment on column public.whatsapp_lid_phone_mappings.channel_phone_number_id is
  'Synthetic/real channel phone_number_id within company (e.g. wa_web_qr_sunchaser).';

comment on column public.whatsapp_lid_phone_mappings.session_key is
  'WhatsApp Web session folder key (e.g. sunchaser). Isolates mappings per session.';

comment on column public.whatsapp_lid_phone_mappings.status is
  'active | stale | superseded — see migration header conflict/remap/stale policy.';

-- One resolvable winner per LID in scope: at most one active OR stale row.
-- Superseded history may retain multiple rows for audit without resolving.
create unique index if not exists whatsapp_lid_phone_mappings_scope_lid_live_uidx
  on public.whatsapp_lid_phone_mappings (
    company_id,
    channel_phone_number_id,
    session_key,
    lid_normalized
  )
  where status in ('active', 'stale');

-- Lookup helpers (company-scoped reads in application always filter company_id).
create index if not exists whatsapp_lid_phone_mappings_resolve_idx
  on public.whatsapp_lid_phone_mappings (
    company_id,
    channel_phone_number_id,
    session_key,
    lid_normalized,
    status
  );

create index if not exists whatsapp_lid_phone_mappings_company_channel_idx
  on public.whatsapp_lid_phone_mappings (company_id, channel_phone_number_id);

alter table public.whatsapp_lid_phone_mappings enable row level security;

-- Intentionally no anon/authenticated policies — service_role bypasses RLS.
revoke all on table public.whatsapp_lid_phone_mappings from public;
revoke all on table public.whatsapp_lid_phone_mappings from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.whatsapp_lid_phone_mappings from service_role;
    grant select, insert, update, delete on table public.whatsapp_lid_phone_mappings to service_role;
  else
    raise notice 'service_role missing — skip table grant (local/non-Supabase)';
  end if;
end $$;
