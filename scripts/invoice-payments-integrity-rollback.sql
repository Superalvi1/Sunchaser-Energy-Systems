-- Rollback for invoice-payments-integrity.sql (revision 2 and the earlier revision). Removes the triggers and functions
-- only; NO row is touched, so payments, invoices and the headers written while the guard was active all stay as they are.
-- Idempotent. Safe to run when the migration was never applied.
begin;
-- Do not queue behind a long transaction (DROP TRIGGER needs a table lock that blocks every later writer while it waits).
set local lock_timeout = '5s';
drop trigger if exists invoice_payments_before_insert_guard on public.invoice_payments;
drop trigger if exists invoice_payments_after_change_sync   on public.invoice_payments;
drop trigger if exists invoice_payments_before_update_guard on public.invoice_payments;
drop trigger if exists invoices_before_update_ledger_guard  on public.invoices;
drop trigger if exists invoices_before_delete_payment_guard on public.invoices;
drop function if exists public.invoice_payments_before_insert();
drop function if exists public.invoice_payments_after_change();
drop function if exists public.invoice_payments_before_update();
drop function if exists public.invoices_before_update_ledger();
drop function if exists public.invoices_before_delete_guard();
drop function if exists public.invoice_sync_header(text);
drop function if exists public.invoice_guard_skipped();
drop function if exists public.invoice_ledger_status(numeric, numeric, date);
commit;
