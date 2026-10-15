-- Rollback of phase2i (t1b-tenancy-barrier). REFUSED while the marker is on or any other company or tenant row exists: removing the barrier then would let older
-- backends and scripts read pilot data. Export and remove the pilot companies, then select app.tenancy_disable(), then roll back.
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regprocedure('app.tenancy_multi()') is not null and app.tenancy_multi() then
    raise exception 'Rollback refused: the tenancy marker is on. Export or remove the pilot companies, then run select app.tenancy_disable().';
  end if;
  if to_regclass('public.companies') is not null and exists (select 1 from public.companies where id <> 'sunchaser') then
    raise exception 'Rollback refused: companies other than sunchaser exist. Export or remove their data first.';
  end if;
  if to_regprocedure('app.tenant_rows_present()') is not null and app.tenant_rows_present() then
    raise exception 'Rollback refused: tables still hold rows of a company other than sunchaser.';
  end if;
end $$;
do $$ begin
  execute format('alter role authenticator in database %I reset pgrst.db_pre_request', current_database());
exception when undefined_object then null;
end $$;
drop trigger if exists companies_require_barrier on public.companies;
drop function if exists app.companies_require_barrier();
drop function if exists app.saas_pre_request();
drop function if exists public.saas_isolation_status(boolean);
drop function if exists app.tenancy_disable();
drop function if exists app.tenancy_confirm_barrier();
drop function if exists app.tenancy_enable();
drop function if exists app.tenant_rows_present();
drop function if exists app.tenancy_barrier_verified();
drop function if exists app.tenancy_multi();
delete from app.config where key in ('tenancy.mode', 'tenancy.barrier_verified_at');
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
