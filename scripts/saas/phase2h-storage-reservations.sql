-- Phase 2h: atomic storage reservations ACROSS server processes. Additive. Idempotent. Rollback: phase2h-storage-reservations-rollback.sql.
-- Needs: plans and subscriptions (phase2e), the plan storage limit (phase2g). Not run in production.
--
-- Why: the plan storage limit is checked in the application where files are written. Until now the decision was serialised only inside ONE server
-- process; with several processes serving the same company, uploads in different processes could all pass on the same measurement and overshoot.
-- The decision now happens here, in one short transaction per company, under an advisory lock that every process takes, so it is atomic across
-- processes and across application restarts.
--
-- How it counts (the object store, not a table, holds the bytes; the application lists it and passes the figure in):
--   used = measured bytes                      what the application's last listing found, taken at "mark" M (a number from saas_storage_seq)
--        + pending reservations                accepted uploads that have not finished (or whose process died: they expire, see below)
--        + finished reservations after M       uploads that finished AFTER that listing began, so the listing cannot contain them
--   Any upload that finished before M is already in the listing and is not counted twice. An upload that finished before the listing but whose
--   "done" note arrives after it is counted twice for a moment: the figure errs on the side of refusing, never of letting a write through.
--
-- A reservation: pending (accepted, the write is under way) -> done (the write succeeded; kept for a while so processes with an older listing
-- still count it) or deleted (the write failed: the bytes are given back at once). A pending reservation whose process died simply expires
-- (pending_ttl_seconds, default 180 s, longer than the object-store timeout) and stops counting; a done one is purged after retain_seconds
-- (default 900 s, longer than the longest time a listing is trusted). Expired rows are purged by the next reservation of that company.
--
-- Platform table: the tenant role has no privilege; the application reaches it only through these functions, with the service role.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('public.saas_plans') is null or to_regclass('public.companies') is null then
    raise exception 'apply scripts/saas/phase2e-subscriptions.sql first';
  end if;
end $$;

create sequence if not exists public.saas_storage_seq;

create table if not exists public.saas_storage_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  bytes bigint not null check (bytes > 0),
  state text not null default 'pending' check (state in ('pending', 'done')),
  created_at timestamptz not null default clock_timestamp(),
  done_seq bigint,
  expires_at timestamptz not null,
  retain_seconds integer not null default 900 check (retain_seconds >= 0),
  check ((state = 'pending' and done_seq is null) or (state = 'done' and done_seq is not null)));
create index if not exists saas_storage_reservations_company_idx on public.saas_storage_reservations (company_id, state);
comment on table public.saas_storage_reservations is
  'In-flight and recently finished file-storage reservations of the pilot companies (see phase2h-storage-reservations.sql). Platform table: no tenant privilege; reached only through saas_storage_* functions.';
alter table public.saas_storage_reservations enable row level security;
revoke all on public.saas_storage_reservations from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.saas_storage_reservations from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.saas_storage_reservations from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'crm_tenant') then revoke all on public.saas_storage_reservations from crm_tenant; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant select on public.saas_storage_reservations to service_role; end if;
end $$;
revoke all on sequence public.saas_storage_seq from public;

-- A mark: a number taken BEFORE the application lists the object store. Everything that finished before it is in the listing.
create or replace function public.saas_storage_mark() returns bigint
language sql volatile security definer set search_path = pg_catalog, public as $$ select nextval('public.saas_storage_seq') $$;

-- Reserve p_bytes for p_company, or refuse. Returns {"ok":true,"id":...,"used":N} or {"ok":false,"used":N,"in_flight":M}.
create or replace function public.saas_storage_reserve(
  p_company text, p_bytes bigint, p_limit_bytes bigint, p_measured_bytes bigint, p_measured_seq bigint,
  p_pending_ttl_seconds integer default 180, p_retain_seconds integer default 900)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_pending bigint; v_after bigint; v_used bigint; v_id uuid;
begin
  if p_company is null or p_bytes is null or p_bytes <= 0 or p_limit_bytes is null or p_limit_bytes < 0
     or p_measured_bytes is null or p_measured_bytes < 0 or p_measured_seq is null
     or p_pending_ttl_seconds is null or p_pending_ttl_seconds < 1 or p_retain_seconds is null or p_retain_seconds < 0 then
    raise exception 'saas_storage_reserve: invalid arguments' using errcode = '22023';
  end if;
  -- one decision at a time per company, whichever process asks (released at the end of this transaction)
  perform pg_advisory_xact_lock(hashtextextended('saas_storage:' || p_company, 0));
  delete from public.saas_storage_reservations where company_id = p_company and expires_at < clock_timestamp();
  select coalesce(sum(bytes), 0) into v_pending from public.saas_storage_reservations where company_id = p_company and state = 'pending';
  select coalesce(sum(bytes), 0) into v_after from public.saas_storage_reservations where company_id = p_company and state = 'done' and done_seq > p_measured_seq;
  v_used := p_measured_bytes + v_pending + v_after;
  if v_used + p_bytes > p_limit_bytes then
    return jsonb_build_object('ok', false, 'used', v_used, 'in_flight', v_pending + v_after);
  end if;
  insert into public.saas_storage_reservations (company_id, bytes, state, expires_at, retain_seconds)
    values (p_company, p_bytes, 'pending', clock_timestamp() + make_interval(secs => p_pending_ttl_seconds), p_retain_seconds)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'used', v_used);
end $$;

-- Settle a reservation: 'commit' (the write succeeded: keep it counted for the retain period) or 'release' (the write failed: give the bytes back).
-- Idempotent; an unknown or already purged id is not an error.
create or replace function public.saas_storage_settle(p_id uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
begin
  if p_outcome = 'release' then
    delete from public.saas_storage_reservations where id = p_id;
  elsif p_outcome = 'commit' then
    update public.saas_storage_reservations
       set state = 'done', done_seq = nextval('public.saas_storage_seq'), expires_at = clock_timestamp() + make_interval(secs => retain_seconds)
     where id = p_id and state = 'pending';
  else
    raise exception 'saas_storage_settle: outcome must be commit or release' using errcode = '22023';
  end if;
end $$;

-- Only the service role (the application's system client) may call these; the tenant role and the public roles may not.
revoke all on function public.saas_storage_mark() from public;
revoke all on function public.saas_storage_reserve(text, bigint, bigint, bigint, bigint, integer, integer) from public;
revoke all on function public.saas_storage_settle(uuid, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.saas_storage_mark() to service_role;
    grant execute on function public.saas_storage_reserve(text, bigint, bigint, bigint, bigint, integer, integer) to service_role;
    grant execute on function public.saas_storage_settle(uuid, text) to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'crm_tenant') then
    revoke all on function public.saas_storage_mark() from crm_tenant;
    revoke all on function public.saas_storage_reserve(text, bigint, bigint, bigint, bigint, integer, integer) from crm_tenant;
    revoke all on function public.saas_storage_settle(uuid, text) from crm_tenant;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.saas_storage_mark() from anon;
    revoke all on function public.saas_storage_reserve(text, bigint, bigint, bigint, bigint, integer, integer) from anon;
    revoke all on function public.saas_storage_settle(uuid, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.saas_storage_mark() from authenticated;
    revoke all on function public.saas_storage_reserve(text, bigint, bigint, bigint, bigint, integer, integer) from authenticated;
    revoke all on function public.saas_storage_settle(uuid, text) from authenticated;
  end if;
end $$;

commit;
