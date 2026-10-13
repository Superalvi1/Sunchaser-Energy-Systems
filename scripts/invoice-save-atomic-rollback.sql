-- Rollback for scripts/invoice-save-atomic.sql. Drops the function only; no table or row is touched.
-- The application falls back to its previous (non-atomic) save path as soon as the function is gone.
begin;
set local lock_timeout = '5s';
drop function if exists public.invoice_save_atomic(text, timestamptz, jsonb, jsonb);
commit;
notify pgrst, 'reload schema';
