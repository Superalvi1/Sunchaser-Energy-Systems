-- Invoice archive columns — hide from active lists / portal without deleting
-- Run in Supabase SQL Editor (idempotent)

alter table public.invoices
  add column if not exists archived_at timestamptz;

alter table public.invoices
  add column if not exists archived_by text;

alter table public.invoices
  drop constraint if exists invoices_invoice_status_check;

alter table public.invoices
  add constraint invoices_invoice_status_check check (
    invoice_status in ('active', 'paid', 'partial', 'overdue', 'void', 'duplicate', 'test', 'archived')
  );

create index if not exists invoices_archived_at_idx on public.invoices(archived_at);

notify pgrst, 'reload schema';
