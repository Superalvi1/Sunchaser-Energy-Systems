-- Rollback of phase2f-invoice-issuance-snapshot.sql: removes the guard and the column. Invoices keep every other value; those that had a
-- snapshot go back to printing from the company's current settings (the behaviour before this release).
begin;
set local lock_timeout = '5s';
drop trigger if exists invoices_issuance_snapshot_guard on public.invoices;
drop function if exists public.invoices_issuance_snapshot_guard();
alter table if exists public.invoices drop constraint if exists invoices_issuance_snapshot_shape;
alter table if exists public.invoices drop column if exists issuance_snapshot;
commit;
