-- Party Ledger Phase 2A — additive, idempotent
-- Run in Supabase SQL Editor BEFORE scripts/backfill-invoice-payments.sql

-- Cheque / bank reference on payment receipts (Vyapar-style)
alter table public.invoice_payments
  add column if not exists reference_number text;

create index if not exists invoice_payments_reference_idx
  on public.invoice_payments(reference_number)
  where reference_number is not null;

-- Allow historical backfill rows with unknown payment method
alter table public.invoice_payments
  drop constraint if exists invoice_payments_payment_method_check;

alter table public.invoice_payments
  add constraint invoice_payments_payment_method_check check (
    payment_method in ('Cash', 'Bank transfer', 'Cheque', 'Online', 'Unknown')
  );

notify pgrst, 'reload schema';
