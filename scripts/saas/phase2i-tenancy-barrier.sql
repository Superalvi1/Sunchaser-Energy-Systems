-- Phase 2i (migration id t1b-tenancy-barrier): a PERSISTENT tenancy marker and a database-enforced barrier. Additive. Idempotent. Rollback: phase2i-tenancy-barrier-rollback.sql.
-- Needs: the company foundation (phase2). Not run in production.
--
-- The problem it closes: once a second company exists, every process that talks to the database with the service key and does not filter by company is a leak
-- (an older backend, a script, a flag-off process of the new build). Code in the new build can pause itself (tenantIsolationGuard), but code that does not contain
-- the guard cannot. So the DATABASE refuses them:
--
--   1. A marker, stored in the database (app.config 'tenancy.mode' = 'multi'), says "this database holds, or is about to hold, more than one company". It is set
--      explicitly by the operator BEFORE the first pilot company, and it is cleared only by app.tenancy_disable(), which refuses while any other company or any
--      other company's tenant row exists. Deleting a companies row clears nothing.
--   2. A PostgREST pre-request function (configured here with the role setting pgrst.db_pre_request) runs on every API request. While the marker is 'multi' it
--      refuses every service-role request that does not declare, in the header x-isolation-mode, that the process knows about companies:
--        multi        the new build with the multi-company flag on (it binds every query to a company, row-level security does the rest)
--        global-only  a job that touches only tables no pilot company has data in (marketplace and learning tables); allowed for those paths only
--        anything else, or no header: refused with HTTP 503. This covers older backends, scripts and flag-off processes of this build, with no polling window:
--        the refusal starts in the same transaction that sets the marker.
--      The tenant role and the anonymous roles are not touched (they are bound by row-level security and grants).
--   3. A company other than the founding one cannot be inserted unless the marker is 'multi' AND an operator has recorded that the barrier was verified over
--      HTTP (app.tenancy_confirm_barrier(), run by scripts/saas/verify-barrier.mjs after it has seen the refusals).
--
-- Limits (stated): the barrier is in PostgREST. A client that connects to PostgreSQL directly (psql, a pg connection string) is not stopped by it; such paths are
-- inventoried in docs/ops/DATABASE_WRITERS_INVENTORY.md and restricted there. The header is an assertion, not a credential: it stops code that does not know about
-- companies, not code written to lie.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('public.companies') is null then raise exception 'apply scripts/saas/phase2-company-foundation.sql first'; end if;
end $$;

create schema if not exists app;
create table if not exists app.config (key text primary key, value text not null);

create or replace function app.tenancy_multi() returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select coalesce((select value from app.config where key = 'tenancy.mode'), 'single') = 'multi'
$$;
create or replace function app.tenancy_barrier_verified() returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select exists (select 1 from app.config where key = 'tenancy.barrier_verified_at')
$$;

-- Does any tenant business table hold a row of a company other than the founding one? Platform tables that merely RECORD pilot companies (memberships, audit trail,
-- payment ledger, subscriptions, storage bookkeeping) are not business data and are append-only or operator-owned, so they do not count.
create or replace function app.tenant_rows_present() returns boolean language plpgsql stable security definer set search_path = pg_catalog as $$
declare t record; found boolean;
begin
  for t in
    select c.table_name from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'company_id'
       and c.table_name <> all (array['company_memberships','company_settings_audit','saas_audit','saas_payments','saas_subscriptions','saas_storage_reservations'])
     order by 1
  loop
    execute format('select exists (select 1 from public.%I where company_id is not null and company_id <> %L)', t.table_name, 'sunchaser') into found;
    if found then return true; end if;
  end loop;
  return false;
end $$;

-- What the application asks: the marker, how many other companies exist, and (deep) whether any tenant row of another company exists.
create or replace function public.saas_isolation_status(p_deep boolean default false) returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare res jsonb;
begin
  res := jsonb_build_object(
    'mode', case when app.tenancy_multi() then 'multi' else 'single' end,
    'barrier_verified', app.tenancy_barrier_verified(),
    'other_companies', (select count(*) from public.companies where id <> 'sunchaser'));
  if p_deep then res := res || jsonb_build_object('foreign_rows', app.tenant_rows_present()); end if;
  return res;
end $$;

-- Operator functions (owner only: not granted to any API role).
create or replace function app.tenancy_enable() returns text language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into app.config (key, value) values ('tenancy.mode', 'multi') on conflict (key) do update set value = 'multi';
  return 'multi';
end $$;
create or replace function app.tenancy_confirm_barrier() returns text language plpgsql security definer set search_path = pg_catalog as $$
begin
  if not app.tenancy_multi() then raise exception 'enable the marker first: select app.tenancy_enable()'; end if;
  insert into app.config (key, value) values ('tenancy.barrier_verified_at', now()::text) on conflict (key) do update set value = excluded.value;
  return 'verified';
end $$;
create or replace function app.tenancy_disable() returns text language plpgsql security definer set search_path = pg_catalog as $$
begin
  if exists (select 1 from public.companies where id <> 'sunchaser') then
    raise exception 'tenancy_disable refused: companies other than sunchaser exist. Export and remove every pilot company first.';
  end if;
  if app.tenant_rows_present() then
    raise exception 'tenancy_disable refused: tables still hold rows of a company other than sunchaser. Remove that data first.';
  end if;
  delete from app.config where key in ('tenancy.mode', 'tenancy.barrier_verified_at');
  return 'single';
end $$;

-- The barrier itself. Runs as the request role, on every PostgREST request; must stay tiny and must never fail for a reason other than the refusal.
create or replace function app.saas_pre_request() returns void language plpgsql stable as $$
declare hdr jsonb; claims jsonb; mode text; path text;
begin
  if not app.tenancy_multi() then return; end if;
  claims := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  if claims ->> 'role' is distinct from 'service_role' then return; end if;     -- tenant and anonymous roles are bound by row-level security and grants
  path := coalesce(current_setting('request.path', true), '');
  if path = '/rpc/saas_isolation_status' then return; end if;                    -- the status question itself, which every process must be able to ask
  hdr := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  mode := hdr ->> 'x-isolation-mode';
  if mode = 'multi' then return; end if;
  if mode = 'global-only' and path ~ '^/(rpc/)?(mp_|learning_)' then return; end if;
  raise exception 'tenant isolation barrier: this database holds more than one company and this process has not declared that it keeps them apart (x-isolation-mode: %). Refused.', coalesce(mode, '(none)')
    using errcode = 'PT503', hint = 'Run the application with MULTI_COMPANY_ENABLED=true. Older backends and scripts must not use this database.';
end $$;

-- A pilot company cannot be created until the marker is on and the barrier has been verified.
create or replace function app.companies_require_barrier() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.id <> 'sunchaser' and not (app.tenancy_multi() and app.tenancy_barrier_verified()) then
    raise exception 'company % refused: the tenancy marker is not on or the barrier is not verified (select app.tenancy_enable(); node scripts/saas/verify-barrier.mjs)', new.id using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists companies_require_barrier on public.companies;
create trigger companies_require_barrier before insert on public.companies for each row execute function app.companies_require_barrier();

-- Grants. Operator functions: nobody but the owner. Status: the service role. Pre-request: every API role (it runs as the request role).
grant usage on schema app to public;
revoke all on function app.tenancy_multi() from public;
revoke all on function app.tenancy_barrier_verified() from public;
revoke all on function app.tenant_rows_present() from public;
revoke all on function app.tenancy_enable() from public;
revoke all on function app.tenancy_confirm_barrier() from public;
revoke all on function app.tenancy_disable() from public;
revoke all on function public.saas_isolation_status(boolean) from public;
grant execute on function app.saas_pre_request() to public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.saas_isolation_status(boolean) to service_role; end if;
  -- pre-request calls tenancy_multi() as the request role: execute on that one only
  grant execute on function app.tenancy_multi() to public;
end $$;

-- A database that already holds another company gets the marker at once (no state with pilot data and no marker).
do $$ begin
  if exists (select 1 from public.companies where id <> 'sunchaser') then perform app.tenancy_enable(); end if;
end $$;

-- Switch the barrier on in PostgREST from inside the database (per database, so other databases on the cluster are not affected).
do $$ begin
  execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L', current_database(), 'app.saas_pre_request');
exception when undefined_object then
  raise notice 'role authenticator does not exist here: set db-pre-request = "app.saas_pre_request" in the PostgREST configuration instead';
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
