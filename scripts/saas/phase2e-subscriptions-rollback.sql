-- Rollback of phase2e-subscriptions.sql. Keeps a copy of the platform data (plans, subscriptions, payments, audit) in schema app_rollback_backup
-- first, so a rollback never destroys a payment record; re-applying phase2e restores payments and audit rows from that copy.
begin;
set local lock_timeout = '5s';
create schema if not exists app_rollback_backup;
do $$
declare t text;
begin
  foreach t in array array['saas_plans','saas_subscriptions','saas_payments','saas_audit'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop table if exists app_rollback_backup.%I', t);
      execute format('create table app_rollback_backup.%I as table public.%I', t, t);
    end if;
  end loop;
end $$;
drop trigger if exists company_limit_leads on public.leads;
drop trigger if exists company_limit_documents on public.customer_documents;
drop trigger if exists company_limit_staff on public.company_memberships;
drop function if exists public.saas_create_company(text, text, text, integer, jsonb, jsonb);
drop function if exists public.saas_usage();
drop function if exists app.enforce_company_limit();
drop function if exists app.company_limit(text, text);
drop trigger if exists saas_payments_append_only on public.saas_payments;
drop trigger if exists saas_audit_append_only on public.saas_audit;
drop table if exists public.saas_payments;
drop table if exists public.saas_audit;
drop table if exists public.saas_subscriptions;
drop table if exists public.saas_plans;
drop function if exists app.saas_append_only();
commit;
