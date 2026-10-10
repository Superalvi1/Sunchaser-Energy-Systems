-- FROZEN COPY of the revision 1 rollback (d6a4261); see j11-rev1-integrity.sql.
-- Rollback for invoice-payments-integrity.sql. Removes the triggers and functions only; no data is touched.
-- Idempotent. Safe to run when the migration was never applied.
begin;
drop trigger if exists invoice_payments_before_insert_guard on public.invoice_payments;
drop trigger if exists invoice_payments_after_change_sync   on public.invoice_payments;
drop trigger if exists invoices_before_update_ledger_guard  on public.invoices;
drop trigger if exists invoices_before_delete_payment_guard on public.invoices;
drop function if exists public.invoice_payments_before_insert();
drop function if exists public.invoice_payments_after_change();
drop function if exists public.invoices_before_update_ledger();
drop function if exists public.invoices_before_delete_guard();
drop function if exists public.invoice_ledger_status(numeric, numeric, date);
commit;
