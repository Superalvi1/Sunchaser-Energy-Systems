-- Phase 2e: plans, manual subscriptions, a manual payment ledger, an audit trail, plan LIMITS enforced by the database, and an atomic
-- company-onboarding function. Additive. Idempotent. Rollback: phase2e-subscriptions-rollback.sql (keeps a copy of the data).
-- Needs: the company foundation (phase2-company-foundation.sql). Not run in production.
--
-- Platform tables (saas_*) belong to the operator, not to a company: the tenant role has no privilege on them, only the service role does.
-- Pricing, hosting and legal terms are undecided; the 'pilot' plan below is a PLACEHOLDER with generous limits and price 0 so the limits can be
-- exercised. A company without a subscription row (the founding company, and every database before this migration) has NO limits.
--
-- Limits (plan value, overridable per company in saas_subscriptions.limit_overrides): max_staff (active non-customer memberships),
-- max_leads (leads not deleted), max_documents (customer documents). They are enforced by triggers, so every code path obeys them.
-- A limit error reads  limit_exceeded:<key>:<limit>.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('public.companies') is null or to_regprocedure('app.default_company_id()') is null then
    raise exception 'apply scripts/saas/phase2-company-foundation.sql first';
  end if;
end $$;

create table if not exists public.saas_plans (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  max_staff integer check (max_staff is null or max_staff >= 0),
  max_leads integer check (max_leads is null or max_leads >= 0),
  max_documents integer check (max_documents is null or max_documents >= 0),
  monthly_price_pkr numeric(14,2) not null default 0 check (monthly_price_pkr >= 0),
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
insert into public.saas_plans (id, name, max_staff, max_leads, max_documents, monthly_price_pkr, note)
  values ('pilot', 'Pilot (placeholder)', 10, 2000, 2000, 0, 'Placeholder limits and price: pricing is an owner decision.')
  on conflict (id) do nothing;

create table if not exists public.saas_subscriptions (
  id text primary key,
  company_id text not null unique references public.companies(id),
  plan_id text not null references public.saas_plans(id),
  status text not null default 'trial' check (status in ('trial','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz,
  current_period_start date,
  current_period_end date,
  limit_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(limit_overrides) = 'object'),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

-- A payment recorded by hand. APPEND-ONLY: a mistake is corrected by a reversal row (negative amount, reversal_of), never by editing or deleting.
create table if not exists public.saas_payments (
  id text primary key,
  company_id text not null references public.companies(id),
  subscription_id text references public.saas_subscriptions(id),
  amount_pkr numeric(14,2) not null,
  reversal_of text references public.saas_payments(id),
  method text not null,
  reference text,
  paid_at date not null,
  covers_from date,
  covers_to date,
  note text,
  recorded_by text not null,
  created_at timestamptz not null default now(),
  check ((amount_pkr > 0 and reversal_of is null) or (amount_pkr < 0 and reversal_of is not null)));
create index if not exists saas_payments_company_idx on public.saas_payments (company_id, paid_at);

create table if not exists public.saas_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_user_id text,
  actor_username text,
  action text not null,
  company_id text,
  detail jsonb not null default '{}'::jsonb);
create index if not exists saas_audit_company_idx on public.saas_audit (company_id, at);

create or replace function app.saas_append_only() returns trigger language plpgsql as $f$
begin
  raise exception '% is append-only: record a correction instead of changing or deleting a row', tg_table_name using errcode = 'P0001';
end $f$;
drop trigger if exists saas_payments_append_only on public.saas_payments;
create trigger saas_payments_append_only before update or delete on public.saas_payments for each row execute function app.saas_append_only();
drop trigger if exists saas_audit_append_only on public.saas_audit;
create trigger saas_audit_append_only before update or delete on public.saas_audit for each row execute function app.saas_append_only();

do $$
declare t text;
begin
  foreach t in array array['saas_plans','saas_subscriptions','saas_payments','saas_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'crm_tenant') then execute format('revoke all on public.%I from crm_tenant', t); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on public.saas_plans, public.saas_subscriptions to service_role;
    grant select, insert on public.saas_payments, public.saas_audit to service_role;
    grant usage, select on sequence public.saas_audit_id_seq to service_role;
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------ limits
create or replace function app.company_limit(p_company text, p_key text) returns integer
language sql stable security definer set search_path = public, pg_temp as $f$
  select case when s.id is null then null
    else coalesce(nullif(s.limit_overrides ->> p_key, '')::integer,
                  case p_key when 'max_staff' then p.max_staff when 'max_leads' then p.max_leads when 'max_documents' then p.max_documents end)
  end
  from (select 1) d left join public.saas_subscriptions s on s.company_id = p_company left join public.saas_plans p on p.id = s.plan_id
$f$;

create or replace function app.enforce_company_limit() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $f$
declare k text := tg_argv[0]; lim integer; cur integer; cid text := new.company_id;
begin
  if cid is null then return new; end if;
  lim := app.company_limit(cid, k);
  if lim is null then return new; end if;
  if k = 'max_staff' then
    if new.status is distinct from 'active' or new.role = 'Customer' then return new; end if;
    if tg_op = 'UPDATE' and old.status = 'active' and old.role <> 'Customer' then return new; end if;  -- already counted
  end if;
  perform pg_advisory_xact_lock(hashtext('company-limit:' || cid || ':' || k));
  if k = 'max_leads' then
    select count(*) into cur from public.leads where company_id = cid and deleted_at is null;
  elsif k = 'max_documents' then
    select count(*) into cur from public.customer_documents where company_id = cid;
  elsif k = 'max_staff' then
    select count(*) into cur from public.company_memberships where company_id = cid and status = 'active' and role <> 'Customer' and id is distinct from new.id;
  end if;
  if cur >= lim then
    raise exception 'limit_exceeded:%:%', k, lim using errcode = 'P0001', hint = 'The plan limit of this company is reached.';
  end if;
  return new;
end $f$;
revoke all on function app.company_limit(text, text), app.enforce_company_limit() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function app.company_limit(text, text) to service_role; end if;
end $$;

drop trigger if exists company_limit_leads on public.leads;
create trigger company_limit_leads before insert on public.leads for each row execute function app.enforce_company_limit('max_leads');
drop trigger if exists company_limit_documents on public.customer_documents;
create trigger company_limit_documents before insert on public.customer_documents for each row execute function app.enforce_company_limit('max_documents');
drop trigger if exists company_limit_staff on public.company_memberships;
create trigger company_limit_staff before insert or update on public.company_memberships for each row execute function app.enforce_company_limit('max_staff');

-- ------------------------------------------------------------------------------------------------ usage (one row per company)
create or replace function public.saas_usage() returns table (company_id text, staff integer, leads integer, documents integer)
language sql stable security definer set search_path = public, pg_temp as $f$
  select c.id,
         (select count(*)::integer from public.company_memberships m where m.company_id = c.id and m.status = 'active' and m.role <> 'Customer'),
         (select count(*)::integer from public.leads l where l.company_id = c.id and l.deleted_at is null),
         (select count(*)::integer from public.customer_documents d where d.company_id = c.id)
    from public.companies c order by c.id
$f$;
revoke all on function public.saas_usage() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.saas_usage() from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.saas_usage() from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'crm_tenant') then revoke all on function public.saas_usage() from crm_tenant; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.saas_usage() to service_role; end if;
end $$;

-- ------------------------------------------------------------------------------------------------ atomic onboarding
-- Creates, in ONE transaction: the company, its subscription (trial), its first administrator (a login identity + membership), neutral
-- branding settings and the audit row. Any failure (duplicate company, username or e-mail, unknown plan) leaves nothing behind.
-- p_user: {id, username, name, email, password_hash}; p_actor: {id, username}.
create or replace function public.saas_create_company(p_id text, p_name text, p_plan text, p_trial_days integer, p_user jsonb, p_actor jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $f$
declare sub_id text := 'sub_' || replace(gen_random_uuid()::text, '-', '');
begin
  if p_id !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'invalid company id' using errcode = '22023'; end if;
  if p_id = 'sunchaser' then raise exception 'the founding company id cannot be used' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'company name is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.saas_plans where id = p_plan and active) then raise exception 'unknown or inactive plan %', p_plan using errcode = '22023'; end if;
  insert into public.companies (id, slug, name, status) values (p_id, replace(p_id, '_', '-'), trim(p_name), 'trial');
  insert into public.saas_subscriptions (id, company_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (sub_id, p_id, p_plan, 'trial', now() + make_interval(days => greatest(p_trial_days, 0)), current_date, current_date + greatest(p_trial_days, 0));
  insert into public.users (id, username, password, name, email, role, account_status, email_verified, onboarding_completed, approved_at, approved_by)
    values (p_user ->> 'id', lower(p_user ->> 'username'), p_user ->> 'password_hash', p_user ->> 'name', lower(p_user ->> 'email'), 'Admin', 'Approved', true, false, now(), p_actor ->> 'username');
  insert into public.company_memberships (id, company_id, user_id, role, status)
    values ('mem_' || replace(gen_random_uuid()::text, '-', ''), p_id, p_user ->> 'id', 'Admin', 'active');
  insert into public.settings (key, value, company_id) values (p_id || ':company_branding', jsonb_build_object('companyName', trim(p_name), 'legacyDefaults', false), p_id);
  insert into public.quote_pdf_settings (id, company_name, use_default_company_content, company_id) values (p_id || '_pdf_settings', trim(p_name), false, p_id);
  insert into public.saas_audit (actor_user_id, actor_username, action, company_id, detail)
    values (p_actor ->> 'id', p_actor ->> 'username', 'company.created', p_id, jsonb_build_object('name', trim(p_name), 'plan', p_plan, 'trial_days', p_trial_days, 'owner_username', lower(p_user ->> 'username')));
  return jsonb_build_object('company_id', p_id, 'subscription_id', sub_id, 'owner_user_id', p_user ->> 'id');
end $f$;
revoke all on function public.saas_create_company(text, text, text, integer, jsonb, jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.saas_create_company(text, text, text, integer, jsonb, jsonb) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.saas_create_company(text, text, text, integer, jsonb, jsonb) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'crm_tenant') then revoke all on function public.saas_create_company(text, text, text, integer, jsonb, jsonb) from crm_tenant; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.saas_create_company(text, text, text, integer, jsonb, jsonb) to service_role; end if;
end $$;

-- A previous rollback kept the data in app_rollback_backup: bring it back, so re-applying never loses a payment record.
do $$ begin
  if to_regclass('app_rollback_backup.saas_plans') is not null then
    insert into public.saas_plans select b.* from app_rollback_backup.saas_plans b on conflict (id) do nothing;
  end if;
  if to_regclass('app_rollback_backup.saas_subscriptions') is not null then
    insert into public.saas_subscriptions select b.* from app_rollback_backup.saas_subscriptions b
      where exists (select 1 from public.companies c where c.id = b.company_id) on conflict (id) do nothing;
  end if;
end $$;
do $$ begin
  if to_regclass('app_rollback_backup.saas_payments') is not null then
    insert into public.saas_payments select b.* from app_rollback_backup.saas_payments b on conflict (id) do nothing;
  end if;
  if to_regclass('app_rollback_backup.saas_audit') is not null then
    insert into public.saas_audit (id, at, actor_user_id, actor_username, action, company_id, detail)
      select b.id, b.at, b.actor_user_id, b.actor_username, b.action, b.company_id, b.detail from app_rollback_backup.saas_audit b on conflict (id) do nothing;
  end if;
  -- The restored rows carry their old ids; the table's id sequence is new and starts at 1. Without this the next audit row (every onboarding writes one) collides with a restored
  -- row and the operator cannot create a company ("duplicate"). Found by the rollback journey.
  perform setval(pg_get_serial_sequence('public.saas_audit', 'id'), coalesce((select max(id) from public.saas_audit), 0) + 1, false);
end $$;

commit;
