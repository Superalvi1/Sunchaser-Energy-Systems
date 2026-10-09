-- POST-APPLY verification for invoice-payments-integrity.sql (revision 2).  psql "$DATABASE_URL" -X -f scripts/invoice-payments-verify.sql
-- Sections 1-3 are read-only. Section 4 is a self-test that runs inside a transaction which is ROLLED BACK: it creates one throw-away
-- invoice, proves the guard refuses an overpayment and accepts the exact balance, and leaves nothing behind (it does take row locks
-- on that one new row only). Skip section 4 by stopping the script after section 3 if the owner prefers strictly read-only.
\echo '=== 1. objects: expect 5 triggers (all enabled = O) and 8 functions ==='
select tgrelid::regclass as tbl, tgname, tgenabled from pg_trigger
 where not tgisinternal and tgrelid in ('public.invoices'::regclass, 'public.invoice_payments'::regclass) order by 1, 2;
select p.proname, p.prosecdef as security_definer, p.proconfig as pinned_settings, p.proacl as acl
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('invoice_guard_skipped', 'invoice_ledger_status', 'invoice_sync_header', 'invoice_payments_before_insert', 'invoice_payments_after_change',
                     'invoices_before_update_ledger', 'invoices_before_delete_guard', 'invoice_payments_before_update') order by 1;

\echo '=== 2. expectations (every row must say ok) ==='
select check_name, case when ok then 'ok' else 'PROBLEM' end as result from (values
  ('5 guard triggers present and enabled', (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('invoice_payments_before_insert_guard', 'invoice_payments_after_change_sync', 'invoice_payments_before_update_guard', 'invoices_before_update_ledger_guard', 'invoices_before_delete_payment_guard')) = 5),
  ('8 guard functions present', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('invoice_guard_skipped', 'invoice_ledger_status', 'invoice_sync_header', 'invoice_payments_before_insert', 'invoice_payments_after_change', 'invoices_before_update_ledger', 'invoices_before_delete_guard', 'invoice_payments_before_update')) = 8),
  ('trigger functions are SECURITY DEFINER with a pinned search_path', (select bool_and(prosecdef and proconfig::text like '%search_path=pg_catalog, public, pg_temp%') from pg_proc where pronamespace = 'public'::regnamespace and proname in ('invoice_sync_header', 'invoice_payments_before_insert', 'invoice_payments_after_change', 'invoices_before_update_ledger', 'invoices_before_delete_guard', 'invoice_payments_before_update'))),
  ('no guard function is executable by PUBLIC or an API role', (select bool_and(not (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('invoice_guard_skipped', 'invoice_ledger_status', 'invoice_sync_header', 'invoice_payments_before_insert', 'invoice_payments_after_change', 'invoices_before_update_ledger', 'invoices_before_delete_guard', 'invoice_payments_before_update'))),
  ('escape-hatch GUC is NOT set at role/database level', (select count(*) from pg_db_role_setting s, unnest(s.setconfig) c where c like 'app.skip_payment_guard%') = 0),
  ('this session does not have the escape hatch on', coalesce(current_setting('app.skip_payment_guard', true), '') <> 'on')
) as t(check_name, ok);

\echo '=== 3. health of the data (legacy dirt is expected until repaired; NEW dirt must be 0) ==='
\echo 'invoices whose header disagrees with the ledger, by last-updated day (a count that keeps growing after the apply means a writer bypasses the guard):'
select date_trunc('day', i.updated_at)::date as day, count(*) as disagreeing_headers
  from public.invoices i join (select invoice_id, sum(amount) s from public.invoice_payments group by invoice_id) p on p.invoice_id = i.id
 where round(i.paid_amount, 2) <> round(p.s, 2) group by 1 order by 1 desc limit 14;
\echo 'balance_due must equal max(0, total - paid) and paid must not be negative on every invoice that has ledger rows (expect 0):'
select count(*) as broken from public.invoices i where exists (select 1 from public.invoice_payments p where p.invoice_id = i.id)
   and (i.balance_due <> greatest(0, round(i.grand_total - i.paid_amount, 2)) or i.paid_amount < 0);
\echo 'ledgers above the invoice total (legacy ones are listed by the preflight; compare with that count, it must not grow):'
select count(*) as overpaid_ledgers from public.invoices i join (select invoice_id, sum(amount) s from public.invoice_payments group by invoice_id) p on p.invoice_id = i.id where round(p.s, 2) > round(i.grand_total, 2);

\echo '=== 4. self-test in a rolled-back transaction ==='
begin;
\set ON_ERROR_STOP off
insert into public.invoices(id, invoice_number, customer_name, subtotal, grand_total, balance_due) values ('verify-guard-probe', 'VERIFY-PROBE', 'verify probe', 100, 100, 100);
\echo 'expect ERROR invoice_overpayment (PT422):'
savepoint s1;
insert into public.invoice_payments(id, invoice_id, amount, payment_method) values ('verify-guard-p1', 'verify-guard-probe', 100.01, 'Cash');
rollback to savepoint s1;
\echo 'expect INSERT 0 1:'
insert into public.invoice_payments(id, invoice_id, amount, payment_method) values ('verify-guard-p2', 'verify-guard-probe', 100, 'Cash');
\echo 'expect paid 100 / balance 0 / Paid:'
select paid_amount, balance_due, payment_status from public.invoices where id = 'verify-guard-probe';
\echo 'expect ERROR invoice_has_payments (PT409):'
savepoint s2;
delete from public.invoices where id = 'verify-guard-probe';
rollback to savepoint s2;
rollback;
