-- Invoice status — exclude duplicate/test/void from party ledger rollups
-- Run in Supabase SQL Editor (idempotent)

alter table public.invoices
  add column if not exists invoice_status text not null default 'active';

alter table public.invoices
  drop constraint if exists invoices_invoice_status_check;

alter table public.invoices
  add constraint invoices_invoice_status_check check (
    invoice_status in ('active', 'paid', 'partial', 'overdue', 'void', 'duplicate', 'test')
  );

create index if not exists invoices_invoice_status_idx on public.invoices(invoice_status);

-- Confirmed duplicate of INV-2026-0007 (same customer, Rs 1,270,000 / Rs 5,000 paid)
update public.invoices
  set invoice_status = 'duplicate',
      updated_at = timezone('utc'::text, now())
where invoice_number = '3394'
   or id = 'inv-1780610594772';

notify pgrst, 'reload schema';
