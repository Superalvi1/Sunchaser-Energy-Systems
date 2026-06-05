-- Historical invoice payment backfill — idempotent
-- Prerequisites: scripts/party-ledger-phase2-schema.sql (adds Unknown payment_method)
-- Do NOT run automatically from the application.

-- ─── Report: invoices missing payment rows ───
select
  i.id,
  i.invoice_number,
  i.customer_name,
  i.paid_amount,
  i.invoice_date,
  i.created_by
from public.invoices i
where coalesce(i.paid_amount, 0) > 0
  and not exists (
    select 1 from public.invoice_payments p where p.invoice_id = i.id
  )
order by i.invoice_date desc;

-- ─── Count before backfill ───
select count(*) as invoices_needing_backfill
from public.invoices i
where coalesce(i.paid_amount, 0) > 0
  and not exists (
    select 1 from public.invoice_payments p where p.invoice_id = i.id
  );

-- ─── Insert one payment row per orphan paid invoice ───
insert into public.invoice_payments (
  id,
  invoice_id,
  amount,
  payment_method,
  payment_date,
  receipt_url,
  receipt_storage_path,
  notes,
  recorded_by,
  created_at
)
select
  'pay-backfill-' || i.id,
  i.id,
  i.paid_amount,
  'Unknown',
  coalesce(i.invoice_date, current_date),
  null,
  null,
  'Historical payment backfill',
  'system',
  timezone('utc'::text, now())
from public.invoices i
where coalesce(i.paid_amount, 0) > 0
  and not exists (
    select 1 from public.invoice_payments p where p.invoice_id = i.id
  )
on conflict (id) do nothing;

-- ─── Report: rows created (re-run count; expect 0 remaining) ───
select count(*) as invoices_still_missing_payments
from public.invoices i
where coalesce(i.paid_amount, 0) > 0
  and not exists (
    select 1 from public.invoice_payments p where p.invoice_id = i.id
  );

select count(*) as backfill_payment_rows
from public.invoice_payments
where notes = 'Historical payment backfill';
