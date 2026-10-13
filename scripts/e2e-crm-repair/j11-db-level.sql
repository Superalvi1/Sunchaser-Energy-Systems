-- J11: database-level unit checks of invoice-payments-integrity.sql (revision 2). DISPOSABLE DATABASES ONLY.
-- Everything runs in one transaction that is rolled back, so it leaves nothing behind.
--   psql <disposable db> -X -v ON_ERROR_STOP=1 -f scripts/e2e-crm-repair/j11-db-level.sql
-- Prints one NOTICE line per check and fails loudly (exception) on the first broken expectation.
begin;
set local client_min_messages = notice;
create temp table _n(c int);
create or replace function pg_temp.t(label text, ok boolean, detail text default '') returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: % %', label, detail; end if;
  raise notice 'PASS: % %', label, detail;
end $$;
-- run a statement and return its SQLSTATE ('00000' when it succeeds)
create or replace function pg_temp.state(stmt text) returns text language plpgsql as $$
begin execute stmt; return '00000'; exception when others then return sqlstate; end $$;
create or replace function pg_temp.inv(i text, total numeric, paid numeric default 0, istatus text default 'active') returns void language plpgsql as $$
begin
  insert into public.invoices(id, invoice_number, customer_name, subtotal, grand_total, paid_amount, balance_due, payment_status, invoice_status)
  values (i, 'N-' || i, 'db level ' || i, total, total, paid, greatest(0, total - paid), case when paid >= total and total > 0 then 'Paid' when paid > 0 then 'Partial' else 'Unpaid' end, istatus);
end $$;
create or replace function pg_temp.pay(pid text, i text, amt numeric) returns text language plpgsql as $$
begin return pg_temp.state(format('insert into public.invoice_payments(id,invoice_id,amount,payment_method) values (%L,%L,%s,''Cash'')', pid, i, amt)); end $$;
create or replace function pg_temp.hdr(i text) returns text language sql as $$ select paid_amount::numeric(14,2) || '/' || balance_due::numeric(14,2) || '/' || payment_status from public.invoices where id = i $$;

-- ---- insert guard
select pg_temp.inv('a1', 100000);
select pg_temp.t('first payment inside the balance is accepted, header synced in the same statement', pg_temp.pay('a1-p1', 'a1', 30000) = '00000' and pg_temp.hdr('a1') = '30000.00/70000.00/Partial', pg_temp.hdr('a1'));
select pg_temp.t('payment above the balance is refused with PT422', pg_temp.pay('a1-p2', 'a1', 70000.01) = 'PT422');
select pg_temp.t('payment of exactly the balance is accepted (paid == total) and marks Paid', pg_temp.pay('a1-p3', 'a1', 70000) = '00000' and pg_temp.hdr('a1') = '100000.00/0.00/Paid', pg_temp.hdr('a1'));
select pg_temp.t('one paisa more is refused', pg_temp.pay('a1-p4', 'a1', 0.01) = 'PT422');
select pg_temp.t('zero, negative and NULL amounts are refused with PT400 (NULL before the NOT NULL check)', pg_temp.pay('a1-z', 'a1', 0) = 'PT400' and pg_temp.pay('a1-n', 'a1', -5) = 'PT400' and pg_temp.state('insert into public.invoice_payments(id,invoice_id,amount,payment_method) values (''a1-null'',''a1'',null,''Cash'')') = 'PT400');
select pg_temp.t('re-sending an existing payment id reaches the primary key (23505), not the balance rule', pg_temp.pay('a1-p1', 'a1', 30000) = '23505');
select pg_temp.t('a missing invoice is reported by the foreign key (23503), not by the guard', pg_temp.pay('ghost-p', 'no-such-invoice', 10) = '23503');
select pg_temp.inv('a2', 100000);
select pg_temp.t('identical values with different ids are all accepted (no duplicate detection in the database)', pg_temp.pay('a2-1', 'a2', 25000) = '00000' and pg_temp.pay('a2-2', 'a2', 25000) = '00000' and pg_temp.pay('a2-3', 'a2', 25000) = '00000' and pg_temp.hdr('a2') = '75000.00/25000.00/Partial', pg_temp.hdr('a2'));
select pg_temp.t('sub-paisa amounts compare at paisa precision (100.004 into a 100.00 balance is accepted, 100.006 is not)', (select pg_temp.pay('a3-ok', 'a3', 100.004) from (select pg_temp.inv('a3', 100)) x) = '00000' and (select pg_temp.pay('a3-no', 'a3', 0.006) from (select 1) y) = 'PT422', pg_temp.hdr('a3'));
select pg_temp.inv('a4', 100000, 0, 'void'); select pg_temp.inv('a5', 100000, 0, 'duplicate'); select pg_temp.inv('a6', 100000, 0, 'test'); select pg_temp.inv('a7', 100000, 0, 'archived');
select pg_temp.t('void / duplicate / test invoices refuse payments (PT409); archived stays collectible', pg_temp.pay('a4-p', 'a4', 1) = 'PT409' and pg_temp.pay('a5-p', 'a5', 1) = 'PT409' and pg_temp.pay('a6-p', 'a6', 1) = 'PT409' and pg_temp.pay('a7-p', 'a7', 1) = '00000');
select pg_temp.inv('a8', 100000);
select pg_temp.t('multi-row insert of 2 x 40,000 + 1 x 40,000 into 100,000 is refused as a whole', pg_temp.state('insert into public.invoice_payments(id,invoice_id,amount,payment_method) select ''m-'' || g, ''a8'', 40000, ''Cash'' from generate_series(1,3) g') = 'PT422' and (select count(*) from public.invoice_payments where invoice_id = 'a8') = 0);

-- ---- legacy opening balance
select pg_temp.inv('b1', 100000, 50000);
select pg_temp.t('legacy invoice (paid 50,000, no ledger rows): a normal first payment is refused until the opening row exists', pg_temp.pay('b1-p', 'b1', 10000) = 'PT409');
select pg_temp.t('the app''s opening row (pay-init-<id>) is accepted as the first row, header unchanged', pg_temp.pay('pay-init-b1', 'b1', 50000) = '00000' and pg_temp.hdr('b1') = '50000.00/50000.00/Partial', pg_temp.hdr('b1'));
select pg_temp.t('a second opening row is refused once the ledger has rows (PT409)', pg_temp.pay('pay-backfill-b1', 'b1', 5) = 'PT409');
select pg_temp.t('after the opening row, a payment up to the balance works', pg_temp.pay('b1-p', 'b1', 50000) = '00000' and pg_temp.hdr('b1') = '100000.00/0.00/Paid', pg_temp.hdr('b1'));
select pg_temp.inv('b2', 100000, 150000, 'active');
select pg_temp.t('legacy header-only OVERPAYMENT (150,000 of 100,000): the opening row is still accepted (no lock-out), nothing can be added', pg_temp.pay('pay-backfill-b2', 'b2', 150000) = '00000' and pg_temp.pay('b2-p', 'b2', 1) = 'PT422' and pg_temp.hdr('b2') = '150000.00/0.00/Paid', pg_temp.hdr('b2'));
select pg_temp.inv('b3', 100000, 40000, 'void');
select pg_temp.t('an opening row is accepted on a void invoice (history), a normal payment is not', pg_temp.pay('pay-init-b3', 'b3', 40000) = '00000' and pg_temp.pay('b3-p', 'b3', 1) = 'PT409');

-- ---- invoice update guard
select pg_temp.inv('c1', 100000); select pg_temp.pay('c1-p', 'c1', 60000);
select pg_temp.t('lowering the total below the ledger is refused (PT422)', pg_temp.state('update public.invoices set grand_total = 50000 where id = ''c1''') = 'PT422');
select pg_temp.t('lowering the total to exactly the ledger is accepted and the header follows (Paid)', pg_temp.state('update public.invoices set grand_total = 60000 where id = ''c1''') = '00000' and pg_temp.hdr('c1') = '60000.00/0.00/Paid', pg_temp.hdr('c1'));
select pg_temp.t('a stale writer that sets paid_amount back to 0 cannot win: the header is recomputed from the ledger', pg_temp.state('update public.invoices set paid_amount = 0, balance_due = 60000, payment_status = ''Unpaid'' where id = ''c1''') = '00000' and pg_temp.hdr('c1') = '60000.00/0.00/Paid', pg_temp.hdr('c1'));
select pg_temp.t('raising the total re-opens the balance', pg_temp.state('update public.invoices set grand_total = 90000 where id = ''c1''') = '00000' and pg_temp.hdr('c1') = '60000.00/30000.00/Partial', pg_temp.hdr('c1'));
select pg_temp.inv('c3', 100000, 80000, 'active');
select pg_temp.state('set local session_replication_role = replica');
insert into public.invoice_payments(id, invoice_id, amount, payment_method) values ('c3-p', 'c3', 30000, 'Cash');
select pg_temp.state('set local session_replication_role = origin');
select pg_temp.t('c3 drift fixture is in place (header 80,000 vs ledger 30,000)', pg_temp.hdr('c3') = '80000.00/20000.00/Partial', pg_temp.hdr('c3'));
update public.invoices set invoice_status = 'archived', archived_at = now(), customer_phone = '0300', notes = 'n', pdf_url = 'u', customer_id = null where id = 'c3';
select pg_temp.t('archive / rename / PDF / customer-unlink on a drifted legacy invoice does NOT rewrite the money columns', pg_temp.hdr('c3') = '80000.00/20000.00/Partial', pg_temp.hdr('c3'));
update public.invoices set due_date = current_date + 5 where id = 'c3';
select pg_temp.t('changing the due date is a money-column write: the header is recomputed from the ledger', pg_temp.hdr('c3') = '30000.00/70000.00/Partial', pg_temp.hdr('c3'));
select pg_temp.inv('c4', 100000, 100000, 'active');
select pg_temp.state('set local session_replication_role = replica');
insert into public.invoice_payments(id, invoice_id, amount, payment_method) values ('c4-a', 'c4', 70000, 'Cash'), ('c4-b', 'c4', 50000, 'Cash');
select pg_temp.state('set local session_replication_role = origin');
select pg_temp.t('legacy overpaid (ledger 120,000 of 100,000): total edits that do not lower it stay possible; raising it to the ledger fixes the invoice', pg_temp.state('update public.invoices set grand_total = 120000 where id = ''c4''') = '00000' and pg_temp.hdr('c4') = '120000.00/0.00/Paid', pg_temp.hdr('c4'));
select pg_temp.inv('c5', 100000);
select pg_temp.state('set local session_replication_role = replica');
insert into public.invoice_payments(id, invoice_id, amount, payment_method) values ('c5-a', 'c5', 70000, 'Cash'), ('c5-b', 'c5', 50000, 'Cash');
select pg_temp.state('set local session_replication_role = origin');
select pg_temp.t('legacy overpaid: lowering the total further is refused, an unchanged total with another money field edited is accepted', pg_temp.state('update public.invoices set grand_total = 90000 where id = ''c5''') = 'PT422' and pg_temp.state('update public.invoices set due_date = current_date + 1 where id = ''c5''') = '00000', pg_temp.hdr('c5'));
select pg_temp.inv('c6', 100000);
select pg_temp.state('set local session_replication_role = replica');
insert into public.invoice_payments(id, invoice_id, amount, payment_method) values ('c6-a', 'c6', 40000.004, 'Cash');
select pg_temp.state('set local session_replication_role = origin');
select pg_temp.t('a sub-paisa difference (ledger 40000.004) does not block lowering the total to 40000.00', pg_temp.state('update public.invoices set grand_total = 40000 where id = ''c6''') = '00000' and pg_temp.hdr('c6') = '40000.00/0.00/Paid', pg_temp.hdr('c6'));

-- ---- payment delete / update
select pg_temp.inv('d1', 100000); select pg_temp.pay('d1-a', 'd1', 30000); select pg_temp.pay('d1-b', 'd1', 20000);
delete from public.invoice_payments where id = 'd1-b';
select pg_temp.t('deleting a payment row re-syncs the header', pg_temp.hdr('d1') = '30000.00/70000.00/Partial', pg_temp.hdr('d1'));
delete from public.invoice_payments where id = 'd1-a';
select pg_temp.t('deleting the last payment row sets the header back to unpaid', pg_temp.hdr('d1') = '0.00/100000.00/Unpaid', pg_temp.hdr('d1'));
select pg_temp.inv('d2', 100000); select pg_temp.pay('d2-a', 'd2', 30000);
select pg_temp.t('raising a payment amount above the balance is refused (PT422); lowering it or editing text is free', pg_temp.state('update public.invoice_payments set amount = 100001 where id = ''d2-a''') = 'PT422' and pg_temp.state('update public.invoice_payments set amount = 20000 where id = ''d2-a''') = '00000' and pg_temp.state('update public.invoice_payments set notes = ''x'' where id = ''d2-a''') = '00000' and pg_temp.hdr('d2') = '20000.00/80000.00/Partial', pg_temp.hdr('d2'));
select pg_temp.t('setting a payment amount to zero / negative is refused (PT400)', pg_temp.state('update public.invoice_payments set amount = 0 where id = ''d2-a''') = 'PT400' and pg_temp.state('update public.invoice_payments set amount = -1 where id = ''d2-a''') = 'PT400');
select pg_temp.inv('d3', 10000); select pg_temp.t('moving a payment to an invoice it does not fit is refused; to one it fits is accepted and both headers follow', pg_temp.state('update public.invoice_payments set invoice_id = ''d3'' where id = ''d2-a''') = 'PT422' and pg_temp.state('update public.invoice_payments set amount = 9000, invoice_id = ''d3'' where id = ''d2-a''') = '00000' and pg_temp.hdr('d3') = '9000.00/1000.00/Partial' and pg_temp.hdr('d2') = '0.00/100000.00/Unpaid', pg_temp.hdr('d3') || ' ' || pg_temp.hdr('d2'));

-- ---- invoice delete
select pg_temp.inv('e1', 100000); select pg_temp.pay('e1-a', 'e1', 1000);
select pg_temp.t('an invoice with payments cannot be deleted (PT409); without payments it can', pg_temp.state('delete from public.invoices where id = ''e1''') = 'PT409' and pg_temp.state('delete from public.invoices where id = ''a7''') = 'PT409' and (select pg_temp.state('delete from public.invoices where id = ''x-empty''') from (select pg_temp.inv('x-empty', 5)) q) = '00000');
select pg_temp.t('delete payments first, then the invoice (the production cleanup order) works', pg_temp.state('delete from public.invoice_payments where invoice_id = ''e1''') = '00000' and pg_temp.state('delete from public.invoices where id = ''e1''') = '00000');

-- ---- escape hatch (this session is the superuser that owns the test database)
select pg_temp.inv('f1', 100000);
select pg_temp.state('set local app.skip_payment_guard = ''on''');
select pg_temp.t('operator escape hatch: overpayment, delete of a paid invoice and header edits are allowed when the GUC is on', pg_temp.pay('f1-a', 'f1', 500000) = '00000' and pg_temp.state('update public.invoices set paid_amount = 1 where id = ''f1''') = '00000' and pg_temp.state('delete from public.invoices where id = ''f1''') = '00000');
select pg_temp.state('set local app.skip_payment_guard = ''off''');
select pg_temp.inv('f2', 100000);
select pg_temp.t('with the GUC off (or unset) the guard is back', pg_temp.pay('f2-a', 'f2', 500000) = 'PT422');
select pg_temp.t('lock-timeout wiring: the insert and payment-update guards carry lock_timeout = 10s', (select count(*) from pg_proc where proname in ('invoice_payments_before_insert', 'invoice_payments_before_update') and proconfig::text like '%lock_timeout=10s%') = 2);
rollback;
