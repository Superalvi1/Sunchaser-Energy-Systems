-- Rollback of phase2f-invoice-issuance-snapshot.sql: removes the guard and the column. Invoices keep every other value; those that had a
-- snapshot go back to printing from the company's current settings (the behaviour before this release). The snapshots themselves are KEPT in
-- app_rollback_backup.invoice_issuance_snapshot and put back when the migration is applied again (they are the record of what each invoice was issued with).
begin;
set local lock_timeout = '5s';
create schema if not exists app_rollback_backup;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'issuance_snapshot') then
    drop table if exists app_rollback_backup.invoice_issuance_snapshot;
    create table app_rollback_backup.invoice_issuance_snapshot as select id, issuance_snapshot from public.invoices where issuance_snapshot is not null;
  end if;
end $$;
drop trigger if exists invoices_issuance_snapshot_guard on public.invoices;
drop function if exists public.invoices_issuance_snapshot_guard();
alter table if exists public.invoices drop constraint if exists invoices_issuance_snapshot_shape;
alter table if exists public.invoices drop column if exists issuance_snapshot;
commit;
