-- Phase 2f: invoice issuance snapshot. Additive. Idempotent. Rollback: phase2f-invoice-issuance-snapshot-rollback.sql. Not run in production.
--
-- Why: an invoice shows the company's bank accounts and terms. Until now both were read from the company's CURRENT settings every time the
-- invoice was printed, so changing a bank account later silently changed every invoice already sent. From this release a NEW invoice keeps,
-- in `issuance_snapshot`, the bank accounts and the company terms that applied when it was created, and reprints show those.
--
-- Invoices created before this migration have NULL here and stay NULL. They are NOT back-filled: filling them with today's settings would
-- state something the company never issued. They keep printing from the current settings, and the application labels them "legacy".
--
-- The column is written once, at insert. Any later UPDATE that changes it (set, replace or clear) is refused, so a reprint cannot drift.
-- (An operator who deliberately wants to fill a legacy invoice has to disable the trigger in a reviewed change; there is no path for that
-- in the application.)
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('public.invoices') is null then
    raise exception 'public.invoices does not exist';
  end if;
end $$;

alter table public.invoices add column if not exists issuance_snapshot jsonb;

alter table public.invoices drop constraint if exists invoices_issuance_snapshot_shape;
alter table public.invoices add constraint invoices_issuance_snapshot_shape
  check (issuance_snapshot is null or (
    jsonb_typeof(issuance_snapshot) = 'object'
    and issuance_snapshot ? 'version'
    and issuance_snapshot ? 'capturedAt'
    and jsonb_typeof(issuance_snapshot -> 'bankAccounts') = 'array'
    and jsonb_typeof(issuance_snapshot -> 'companyTerms') = 'string'
  )) not valid;
alter table public.invoices validate constraint invoices_issuance_snapshot_shape;

create or replace function public.invoices_issuance_snapshot_guard() returns trigger
language plpgsql as $$
begin
  if new.issuance_snapshot is distinct from old.issuance_snapshot then
    raise exception 'invoices.issuance_snapshot is written once, when the invoice is created, and cannot be changed' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists invoices_issuance_snapshot_guard on public.invoices;
create trigger invoices_issuance_snapshot_guard before update on public.invoices
  for each row execute function public.invoices_issuance_snapshot_guard();

commit;
