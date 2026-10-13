-- Rollback of phase2g-company-admin.sql. Keeps a copy of the settings history in schema app_rollback_backup (re-applying restores it),
-- then removes the table and the storage limit column. Plans and subscriptions are otherwise untouched.
begin;
set local lock_timeout = '5s';
create schema if not exists app_rollback_backup;
do $$ begin
  if to_regclass('public.company_settings_audit') is not null then
    drop table if exists app_rollback_backup.company_settings_audit;
    create table app_rollback_backup.company_settings_audit as table public.company_settings_audit;
  end if;
end $$;
drop trigger if exists company_settings_audit_guard on public.company_settings_audit;
drop function if exists public.company_settings_audit_guard();
drop table if exists public.company_settings_audit;
alter table if exists public.saas_plans drop constraint if exists saas_plans_max_storage_mb_check;
alter table if exists public.saas_plans drop column if exists max_storage_mb;
commit;
