-- Phase 2g: company-admin support. Additive. Idempotent. Rollback: phase2g-company-admin-rollback.sql (keeps a copy of the history).
-- Needs: plans and subscriptions (phase2e-subscriptions.sql). Not run in production.
--
--  1. saas_plans.max_storage_mb       a plan limit on the bytes a company keeps in file storage (NULL = unlimited). Enforced by the
--                                     application where files are written (the bytes live in the object store, not in a table, so a
--                                     trigger cannot count them). A per-company override uses limit_overrides->>'max_storage_mb'.
--  2. company_settings_audit          who changed which company setting, when, and what it was before and after. Written by the
--                                     application with the service role; the tenant role has no privilege on it. Append-only: an UPDATE
--                                     or DELETE is always refused (a company restore does not touch it either: restoring a company to an
--                                     earlier state must not erase the record of who changed what).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('public.saas_plans') is null or to_regclass('public.companies') is null then
    raise exception 'apply scripts/saas/phase2e-subscriptions.sql first';
  end if;
end $$;

alter table public.saas_plans add column if not exists max_storage_mb integer;
alter table public.saas_plans drop constraint if exists saas_plans_max_storage_mb_check;
alter table public.saas_plans add constraint saas_plans_max_storage_mb_check check (max_storage_mb is null or max_storage_mb >= 0);
-- The placeholder plan only (its limits are placeholders too); a plan the operator created is left alone.
update public.saas_plans set max_storage_mb = 2048 where id = 'pilot' and max_storage_mb is null;

create table if not exists public.company_settings_audit (
  id text primary key,
  company_id text not null references public.companies(id),
  section text not null check (section in ('branding', 'bank_accounts', 'terms', 'prices')),
  actor_user_id text,
  actor_username text not null,
  actor_role text,
  summary text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now());
create index if not exists company_settings_audit_company_idx on public.company_settings_audit (company_id, created_at desc);
comment on table public.company_settings_audit is
  'History of changes to a company''s settings (branding, bank accounts, terms, prices). Append-only. The tenant role has no privilege on it; the application reads it for the company''s administrators only.';
alter table public.company_settings_audit enable row level security;
revoke all on public.company_settings_audit from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.company_settings_audit from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.company_settings_audit from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'crm_tenant') then revoke all on public.company_settings_audit from crm_tenant; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant select, insert on public.company_settings_audit to service_role; end if;
end $$;

-- A previous rollback kept the history: bring it back.
do $$ begin
  if to_regclass('app_rollback_backup.company_settings_audit') is not null then
    insert into public.company_settings_audit (id, company_id, section, actor_user_id, actor_username, actor_role, summary, before_value, after_value, created_at)
      select b.id, b.company_id, b.section, b.actor_user_id, b.actor_username, b.actor_role, b.summary, b.before_value, b.after_value, b.created_at
        from app_rollback_backup.company_settings_audit b
       where exists (select 1 from public.companies c where c.id = b.company_id)
    on conflict (id) do nothing;
  end if;
end $$;

create or replace function public.company_settings_audit_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'company_settings_audit is append-only' using errcode = '23514';
end $$;
drop trigger if exists company_settings_audit_guard on public.company_settings_audit;
create trigger company_settings_audit_guard before update or delete on public.company_settings_audit
  for each row execute function public.company_settings_audit_guard();

commit;
