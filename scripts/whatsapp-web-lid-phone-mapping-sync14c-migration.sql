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
-- Conflict / remap / stale policy (enforced by atomic RPC + constraints):
--   1. First verified (company, channel, session, lid) → status=active.
--   2. Identical phone re-verify → touch last_resolved_at (idempotent).
--   3. Same active LID with a different phone → CONFLICT: keep first phone,
--      increment conflict_count atomically; do not overwrite; do not create contacts.
--   4. Remap only when the live row is status=stale: mark superseded AND insert
--      a new active row in ONE transaction (FOR UPDATE on the live row).
--      If the insert fails, the transaction rolls back — the stale mapping stays
--      resolvable. Never leave a LID with no live mapping after a failed remap.
--   5. Stale mappings still resolve until superseded (resolution prefers active,
--      then stale). Superseded rows never resolve.
--
-- Atomic write path:
--   public.whatsapp_upsert_verified_lid_phone_mapping(...) — single DB decision
--   for created / unchanged / conflict / remapped. Application must call this
--   RPC (not select-then-update) for verified upserts.
--
-- Privacy / access:
--   Backend service_role only. RLS enabled with NO anon/authenticated policies.
--   RPC execute is service_role-only with fixed search_path = public.
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

-- -----------------------------------------------------------------------------
-- Atomic verified upsert (created / unchanged / conflict / remapped)
-- Locks the scoped live row; remaps supersede+insert in one transaction.
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_upsert_verified_lid_phone_mapping(
  p_company_id text,
  p_channel_phone_number_id text,
  p_session_key text,
  p_lid_normalized text,
  p_phone_e164 text,
  p_mapping_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc'::text, now());
  v_live public.whatsapp_lid_phone_mappings%rowtype;
  v_created public.whatsapp_lid_phone_mappings%rowtype;
  v_id text;
  v_company_id text := nullif(trim(coalesce(p_company_id, '')), '');
  v_channel text := nullif(trim(coalesce(p_channel_phone_number_id, '')), '');
  v_session text := nullif(trim(coalesce(p_session_key, '')), '');
  v_lid text := nullif(trim(coalesce(p_lid_normalized, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone_e164, '')), '');
begin
  if v_company_id is null or v_channel is null or v_session is null then
    return jsonb_build_object(
      'kind', 'rejected',
      'reason', 'invalid_scope',
      'mapping', null
    );
  end if;

  if v_lid is null or v_lid !~* '@lid$' then
    return jsonb_build_object(
      'kind', 'rejected',
      'reason', 'invalid_lid',
      'mapping', null
    );
  end if;

  -- Digits-only phone identity; never strip/normalize alphanumeric junk here.
  if v_phone is null or v_phone !~ '^[0-9]{6,}$' then
    return jsonb_build_object(
      'kind', 'rejected',
      'reason', 'invalid_phone',
      'mapping', null
    );
  end if;

  -- Serialize decisions for this scoped LID (covers create races with no live row).
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_company_id || chr(0) || v_channel || chr(0) || v_session || chr(0) || v_lid,
      0
    )
  );

  select *
  into v_live
  from public.whatsapp_lid_phone_mappings as m
  where m.company_id = v_company_id
    and m.channel_phone_number_id = v_channel
    and m.session_key = v_session
    and m.lid_normalized = v_lid
    and m.status in ('active', 'stale')
  for update;

  if not found then
    v_id := coalesce(
      nullif(trim(coalesce(p_mapping_id, '')), ''),
      'wlid_' || gen_random_uuid()::text
    );
    insert into public.whatsapp_lid_phone_mappings (
      id,
      company_id,
      channel_phone_number_id,
      session_key,
      lid_normalized,
      phone_e164,
      status,
      verified_at,
      last_resolved_at,
      conflict_count,
      superseded_at,
      created_at,
      updated_at
    ) values (
      v_id,
      v_company_id,
      v_channel,
      v_session,
      v_lid,
      v_phone,
      'active',
      v_now,
      v_now,
      0,
      null,
      v_now,
      v_now
    )
    returning * into v_created;

    return jsonb_build_object(
      'kind', 'created',
      'mapping', to_jsonb(v_created)
    );
  end if;

  if v_live.phone_e164 = v_phone then
    update public.whatsapp_lid_phone_mappings as m
    set
      status = case when m.status = 'stale' then 'active' else m.status end,
      last_resolved_at = v_now,
      updated_at = v_now,
      superseded_at = null
    where m.company_id = v_company_id
      and m.id = v_live.id
    returning * into v_created;

    return jsonb_build_object(
      'kind', 'unchanged',
      'mapping', to_jsonb(v_created)
    );
  end if;

  if v_live.status = 'stale' then
    -- Atomic remap: supersede + insert. Any failure rolls back; stale stays live.
    update public.whatsapp_lid_phone_mappings as m
    set
      status = 'superseded',
      superseded_at = v_now,
      updated_at = v_now
    where m.company_id = v_company_id
      and m.id = v_live.id
      and m.status = 'stale';

    if not found then
      return jsonb_build_object(
        'kind', 'error',
        'error_code', 'remap_cas_failed',
        'mapping', null
      );
    end if;

    v_id := coalesce(
      nullif(trim(coalesce(p_mapping_id, '')), ''),
      'wlid_' || gen_random_uuid()::text
    );

    insert into public.whatsapp_lid_phone_mappings (
      id,
      company_id,
      channel_phone_number_id,
      session_key,
      lid_normalized,
      phone_e164,
      status,
      verified_at,
      last_resolved_at,
      conflict_count,
      superseded_at,
      created_at,
      updated_at
    ) values (
      v_id,
      v_company_id,
      v_channel,
      v_session,
      v_lid,
      v_phone,
      'active',
      v_now,
      v_now,
      0,
      null,
      v_now,
      v_now
    )
    returning * into v_created;

    return jsonb_build_object(
      'kind', 'remapped',
      'mapping', to_jsonb(v_created)
    );
  end if;

  -- Active + different phone → conflict; atomic increment (no lost updates).
  update public.whatsapp_lid_phone_mappings as m
  set
    conflict_count = m.conflict_count + 1,
    updated_at = v_now
  where m.company_id = v_company_id
    and m.id = v_live.id
    and m.status = 'active'
  returning * into v_created;

  if not found then
    return jsonb_build_object(
      'kind', 'error',
      'error_code', 'conflict_cas_failed',
      'mapping', null
    );
  end if;

  return jsonb_build_object(
    'kind', 'conflict',
    'mapping', to_jsonb(v_created)
  );
end;
$$;

revoke all on function public.whatsapp_upsert_verified_lid_phone_mapping(
  text, text, text, text, text, text
) from public;

revoke all on function public.whatsapp_upsert_verified_lid_phone_mapping(
  text, text, text, text, text, text
) from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.whatsapp_upsert_verified_lid_phone_mapping(
      text, text, text, text, text, text
    ) to service_role;
  else
    raise notice 'service_role missing — skip LID mapping RPC grant (local/non-Supabase)';
  end if;
end $$;

comment on function public.whatsapp_upsert_verified_lid_phone_mapping is
  'SYNC-14C-B-R1 atomic LID→phone upsert (created/unchanged/conflict/remapped). Locks scoped live row; failed remap preserves stale. Backend/service_role only.';
