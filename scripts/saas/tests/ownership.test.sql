-- Company-ownership tests for the SECURITY DEFINER paths of the invoice release (M3 payment triggers, M4 invoice_save_atomic).
-- Run on a DISPOSABLE database that has the release migrations M1-M4 and the company foundation (+ ownership + counters when
-- testing the fixed behaviour):  psql -d <db> -v ON_ERROR_STOP=1 -f ownership.test.sql
-- Output: PASS: / FAIL: lines and a final "N passed, M failed". Nothing here touches production; every id is synthetic.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

create schema if not exists zz;
-- Runs one statement as ROLE with the x-company-id header COMPANY (null = no header), in its own transaction scope.
-- Returns 'ok' or 'ERR:<sqlstate>:<message>|<detail>'. Errors roll the statement back (sub-transaction).
create or replace function zz.try(p_role text, p_company text, p_sql text) returns text
language plpgsql as $f$
declare m text; d text; st text; n bigint;
begin
  begin
    execute format('set local role %I', p_role);
    perform set_config('request.headers', case when p_company is null then '{}' else json_build_object('x-company-id', p_company)::text end, true);
    execute p_sql;
    get diagnostics n = row_count;
    reset role;
    return 'ok:' || n;
  exception when others then
    get stacked diagnostics m = message_text, d = pg_exception_detail, st = returned_sqlstate;
    reset role;
    return 'ERR:' || st || ':' || coalesce(m, '') || '|' || coalesce(d, '');
  end;
end $f$;

create table if not exists zz.results (name text, ok boolean, detail text);
truncate zz.results;
create or replace function zz.check(p_name text, p_ok boolean, p_detail text default '') returns void
language plpgsql as $f$ begin insert into zz.results values (p_name, coalesce(p_ok, false), p_detail); end $f$;

-- ------------------------------------------------------------------ fixtures (postgres, bypasses everything)
insert into companies (id, slug, name, status) values ('co_a', 'co-a', 'Company A', 'active'), ('co_b', 'co-b', 'Company B', 'active')
  on conflict (id) do nothing;
delete from invoice_payments where id like 'zz-%';
delete from invoice_items where id like 'zz-%';
delete from invoices where id like 'zz-%';
delete from customers where id like 'zz-%';
insert into customers (id, name, email, company_id) values ('zz-cust-a', 'A customer', 'a@example.test', 'co_a'), ('zz-cust-b', 'B customer', 'b@example.test', 'co_b');
insert into invoices (id, invoice_number, customer_name, subtotal, grand_total, balance_due, company_id, customer_id)
  values ('zz-inv-a', 'ZZ-A-0001', 'A customer', 1000, 1000, 1000, 'co_a', 'zz-cust-a'),
         ('zz-inv-b', 'ZZ-B-0001', 'B customer', 5000, 5000, 5000, 'co_b', 'zz-cust-b');
insert into invoices (id, invoice_number, customer_name, subtotal, grand_total, balance_due, company_id)
  values ('zz-inv-s', 'ZZ-S-0001', 'Founding company customer', 700, 700, 700, 'sunchaser');
insert into invoice_items (id, invoice_id, sort_order, description, item_name, qty, rate, line_total, company_id)
  values ('zz-item-a1', 'zz-inv-a', 1, 'A panel', 'A panel', 1, 1000, 1000, 'co_a'),
         ('zz-item-b1', 'zz-inv-b', 1, 'B panel', 'B panel', 1, 5000, 5000, 'co_b');
-- a payment of B's, recorded the legitimate way (through the tenant role with B's header)
select zz.try('crm_tenant', 'co_b', $$insert into invoice_payments (id, invoice_id, amount, payment_method) values ('zz-pay-b1', 'zz-inv-b', 2000, 'Cash')$$) as seed_b_payment \gset
select (:'seed_b_payment' = 'ok:1') as seed_ok \gset
select zz.check('fixture: company B can record a payment on its own invoice', :'seed_ok'::boolean, :'seed_b_payment');
select zz.check('fixture: B header synced from the ledger (paid 2000, balance 3000)',
  (select paid_amount = 2000 and balance_due = 3000 from invoices where id = 'zz-inv-b'));

create temp table snap as
  select 'A' k, md5(string_agg(t::text, '|' order by id)) h from (select * from invoices where id = 'zz-inv-a') t
  union all select 'Ai', md5(string_agg(t::text, '|' order by id)) from (select * from invoice_items where invoice_id = 'zz-inv-a') t
  union all select 'Ap', coalesce(md5(string_agg(t::text, '|' order by id)), 'none') from (select * from invoice_payments where invoice_id = 'zz-inv-a') t;
create or replace function zz.unchanged_a() returns boolean language sql as $$
  select (select string_agg(h, ',' order by k) from snap) = (
    select string_agg(h, ',' order by k) from (
      select 'A' k, md5(string_agg(t::text, '|' order by id)) h from (select * from invoices where id = 'zz-inv-a') t
      union all select 'Ai', md5(string_agg(t::text, '|' order by id)) from (select * from invoice_items where invoice_id = 'zz-inv-a') t
      union all select 'Ap', coalesce(md5(string_agg(t::text, '|' order by id)), 'none') from (select * from invoice_payments where invoice_id = 'zz-inv-a') t) s) $$;
grant all on schema zz to public; grant all on all tables in schema zz to public; grant execute on all functions in schema zz to public;
grant select on snap to public;

-- ------------------------------------------------------------------ 1. payment trigger paths (M3)
select zz.try('crm_tenant', 'co_b', $$insert into invoice_payments (id, invoice_id, amount, payment_method) values ('zz-x1', 'zz-inv-a', 99999, 'Cash')$$) as foreign_pay \gset
select zz.try('crm_tenant', 'co_b', $$insert into invoice_payments (id, invoice_id, amount, payment_method) values ('zz-x2', 'zz-inv-missing', 99999, 'Cash')$$) as missing_pay \gset
select zz.check('B paying A''s invoice is refused', :'foreign_pay' like 'ERR:%', :'foreign_pay');
select zz.check('the refusal leaks no figure of A''s invoice (no total, balance or paid amount in the message)',
  :'foreign_pay' !~ '(1000|invoice total|balance due|already paid|exceeds)', :'foreign_pay');
select zz.check('the refusal for A''s invoice is the same error as for an invoice that does not exist',
  regexp_replace(:'foreign_pay', 'zz-inv-a|zz-x1', 'ID', 'g') = regexp_replace(:'missing_pay', 'zz-inv-missing|zz-x2', 'ID', 'g'),
  :'foreign_pay' || '  vs  ' || :'missing_pay');
select zz.check('A''s invoice, items and payments are unchanged after those attempts', zz.unchanged_a());
select zz.try('service_role', 'co_b', $$insert into invoice_payments (id, invoice_id, amount, payment_method) values ('zz-x4', 'zz-inv-a', 99999, 'Cash')$$) as sr_foreign \gset
select zz.try('service_role', 'co_b', $$insert into invoice_payments (id, invoice_id, amount, payment_method) values ('zz-x5', 'zz-inv-missing', 99999, 'Cash')$$) as sr_missing \gset
select zz.check('the service role acting for B gets the same error for A''s invoice as for a missing one, and no figure',
  regexp_replace(:'sr_foreign', 'zz-inv-a', 'ID', 'g') = regexp_replace(:'sr_missing', 'zz-inv-missing', 'ID', 'g') and :'sr_foreign' !~ '(1000|exceeds|balance due)', :'sr_foreign' || '  vs  ' || :'sr_missing');

select zz.try('crm_tenant', 'co_b', $$update invoice_payments set invoice_id = 'zz-inv-a' where id = 'zz-pay-b1'$$) as moved \gset
select zz.check('B cannot move its own payment onto A''s invoice', :'moved' like 'ERR:%' and :'moved' !~ '(1000|exceeds|balance due)', :'moved');
select zz.check('A''s invoice unchanged after the move attempt', zz.unchanged_a());

-- Lock side channel: while A's invoice row is locked by someone else, B's attempt must not queue behind it (it would wait for the lock,
-- then report "busy": that proves the invoice exists). Measured with lock_timeout so the test cannot hang.
create or replace function zz.lock_probe() returns text language plpgsql as $f$
declare t0 timestamptz; r text;
begin
  perform dblink_connect('zz_locker', current_setting('zz.conn'));
  perform dblink_exec('zz_locker', 'begin');
  perform * from dblink('zz_locker', $$select 1 from public.invoices where id = 'zz-inv-a' for update$$) as t(x int);
  t0 := clock_timestamp();
  r := zz.try('crm_tenant', 'co_b', $$insert into invoice_payments (id, invoice_id, amount, payment_method) values ('zz-x3', 'zz-inv-a', 10, 'Cash')$$);
  r := r || ' [' || round(extract(epoch from clock_timestamp() - t0)::numeric, 1) || 's]';
  perform dblink_exec('zz_locker', 'rollback');
  perform dblink_disconnect('zz_locker');
  return r;
end $f$;
create extension if not exists dblink;
select set_config('zz.conn', format('dbname=%s host=%s port=%s user=postgres', current_database(), coalesce(nullif(current_setting('unix_socket_directories'), ''), '/tmp'), current_setting('port')), false);
select zz.lock_probe() as lock_result \gset
select zz.check('B''s attempt on A''s invoice does not wait for or report A''s row lock (answers within 2 s, no "busy")',
  :'lock_result' !~ 'invoice_busy' and (regexp_match(:'lock_result', '\[([0-9.]+)s\]'))[1]::numeric < 2, :'lock_result');

-- B's own legitimate flows still behave as released: overpayment on its own invoice is refused with its own figures
select zz.try('crm_tenant', 'co_b', $$insert into invoice_payments (id, invoice_id, amount, payment_method) values ('zz-b-over', 'zz-inv-b', 99999, 'Cash')$$) as own_over \gset
select zz.check('B over-paying B''s own invoice is still refused with the released message', :'own_over' like '%invoice_overpayment%', :'own_over');
select zz.try('crm_tenant', 'co_a', $$insert into invoice_payments (id, invoice_id, amount, payment_method) values ('zz-pay-a1', 'zz-inv-a', 400, 'Cash')$$) as a_pay \gset
select zz.check('A can pay A''s invoice; the header follows the ledger', :'a_pay' = 'ok:1' and (select paid_amount = 400 and balance_due = 600 from invoices where id = 'zz-inv-a'), :'a_pay');
-- refresh the snapshot: A's own legitimate payment changed A's rows
delete from snap; insert into snap
  select 'A', md5(string_agg(t::text, '|' order by id)) from (select * from invoices where id = 'zz-inv-a') t
  union all select 'Ai', md5(string_agg(t::text, '|' order by id)) from (select * from invoice_items where invoice_id = 'zz-inv-a') t
  union all select 'Ap', coalesce(md5(string_agg(t::text, '|' order by id)), 'none') from (select * from invoice_payments where invoice_id = 'zz-inv-a') t;

-- ------------------------------------------------------------------ 2. invoice_save_atomic (M4) and its privileged callers
select zz.try('crm_tenant', 'co_b', $$select public.invoice_save_atomic('zz-inv-a', null, '{"notes":"pwned by B","customer_name":"B was here"}'::jsonb, null)$$) as b_on_a \gset
select zz.try('crm_tenant', 'co_b', $$select public.invoice_save_atomic('zz-inv-missing', null, '{"notes":"x"}'::jsonb, null)$$) as b_on_missing \gset
select zz.check('B cannot edit A''s invoice through the atomic function', :'b_on_a' like 'ERR:%', :'b_on_a');
select zz.check('B''s edit of A''s invoice gets the same answer as an edit of an invoice that does not exist',
  regexp_replace(:'b_on_a', 'zz-inv-a', 'ID', 'g') = regexp_replace(:'b_on_missing', 'zz-inv-missing', 'ID', 'g'), :'b_on_a' || '  vs  ' || :'b_on_missing');
select zz.check('A''s invoice unchanged after B''s edit attempt', zz.unchanged_a());

select zz.try('crm_tenant', 'co_a', $$select public.invoice_save_atomic('zz-inv-a', null, '{"notes":"edited by A","customer_name":"A customer"}'::jsonb, null)$$) as a_on_a \gset
select zz.check('A can edit A''s invoice through the atomic function (tenant role, header co_a)', :'a_on_a' = 'ok:1', :'a_on_a');
select zz.check('the edit was applied', (select notes = 'edited by A' from invoices where id = 'zz-inv-a'));

select zz.try('crm_tenant', 'co_a', $$select public.invoice_save_atomic('zz-inv-a', null, '{"company_id":"co_b","notes":"moving to B"}'::jsonb, null)$$) as steal \gset
select zz.check('a company_id in the patch is ignored: the invoice stays with A', (select company_id = 'co_a' from invoices where id = 'zz-inv-a'), :'steal');
select zz.try('crm_tenant', 'co_a', $$select public.invoice_save_atomic('zz-inv-a', null, '{"customer_id":"zz-cust-b"}'::jsonb, null)$$) as xref \gset
select zz.check('A cannot attach A''s invoice to B''s customer', :'xref' like 'ERR:%' and (select customer_id = 'zz-cust-a' from invoices where id = 'zz-inv-a'), :'xref');

select zz.try('crm_tenant', 'co_a', $$select public.invoice_save_atomic('zz-inv-a', null,
   '{"subtotal":1500,"grand_total":1500}'::jsonb,
   '[{"id":"zz-item-a1","item_name":"A panel","description":"A panel","qty":1,"rate":1000,"line_total":1000},
     {"id":"zz-item-a2","item_name":"A cable","description":"A cable","qty":1,"rate":500,"line_total":500,"company_id":"co_b"}]'::jsonb)$$) as a_items \gset
select zz.check('A can replace A''s lines', :'a_items' = 'ok:1', :'a_items');
select zz.check('every line of A''s invoice belongs to A, even one that claimed company_id co_b',
  (select count(*) = 2 and bool_and(company_id = 'co_a') from invoice_items where invoice_id = 'zz-inv-a'));

select zz.try('crm_tenant', 'co_a', $$select public.invoice_save_atomic('zz-inv-a', null, '{"subtotal":6500,"grand_total":6500}'::jsonb,
   '[{"id":"zz-item-b1","item_name":"x","description":"x","qty":1,"rate":6500,"line_total":6500}]'::jsonb)$$) as take_line \gset
select zz.check('A cannot take over a line id that belongs to B''s invoice', :'take_line' like 'ERR:%' and exists (select 1 from invoice_items where id = 'zz-item-b1' and invoice_id = 'zz-inv-b' and company_id = 'co_b'), :'take_line');
select zz.try('crm_tenant', 'co_a', $$select public.invoice_save_atomic('zz-inv-a', null, '{"subtotal":6500,"grand_total":6500}'::jsonb,
   '[{"id":"zz-item-a1","item_name":"x","description":"x","qty":1,"rate":6500,"line_total":6500}]'::jsonb)$$) as _own \gset
select zz.check('B''s invoice and its line are untouched by all of A''s attempts',
  (select grand_total = 5000 and paid_amount = 2000 from invoices where id = 'zz-inv-b') and (select count(*) = 1 and bool_and(rate = 5000) from invoice_items where invoice_id = 'zz-inv-b'));

-- privileged and unusual callers
select zz.try('anon', null, $$select public.invoice_save_atomic('zz-inv-a', null, '{"notes":"x"}'::jsonb, null)$$) as anon_call \gset
select zz.try('authenticated', 'co_a', $$select public.invoice_save_atomic('zz-inv-a', null, '{"notes":"x"}'::jsonb, null)$$) as auth_call \gset
select zz.check('anon cannot execute the atomic function', :'anon_call' like 'ERR:42501%', :'anon_call');
select zz.check('authenticated cannot execute the atomic function', :'auth_call' like 'ERR:42501%', :'auth_call');
select zz.try('crm_tenant', null, $$select public.invoice_save_atomic('zz-inv-s', null, '{"notes":"no header"}'::jsonb, null)$$) as nohdr \gset
select zz.check('the tenant role without a company header is refused (it is NOT treated as the founding company)',
  :'nohdr' like '%company_context_required%' and (select notes is distinct from 'no header' from invoices where id = 'zz-inv-s'), :'nohdr');
select zz.try('service_role', 'co_b', $$select public.invoice_save_atomic('zz-inv-a', null, '{"notes":"service role as B"}'::jsonb, null)$$) as sr_b \gset
select zz.check('the service role acting for company B cannot edit A''s invoice', :'sr_b' like 'ERR:%' and (select notes is distinct from 'service role as B' from invoices where id = 'zz-inv-a'), :'sr_b');
select zz.try('service_role', 'co_a', $$select public.invoice_save_atomic('zz-inv-a', null, '{"notes":"service role as A"}'::jsonb, null)$$) as sr_a \gset
select zz.check('the service role acting for company A can edit A''s invoice', :'sr_a' = 'ok:1', :'sr_a');
select zz.try('service_role', null, $$select public.invoice_save_atomic('zz-inv-b', null, '{"notes":"service role no header"}'::jsonb, null)$$) as sr_none \gset
select zz.check('the service role without a header (legacy single-company mode) cannot edit B''s invoice: it acts as the founding company only',
  :'sr_none' like 'ERR:%' and (select notes is distinct from 'service role no header' from invoices where id = 'zz-inv-b'), :'sr_none');
update app.config set value = 'on' where key = 'strict_company';
select zz.try('service_role', null, $$select public.invoice_save_atomic('zz-inv-a', null, '{"notes":"strict"}'::jsonb, null)$$) as sr_strict \gset
update app.config set value = 'off' where key = 'strict_company';
select zz.check('with strict_company on, the service role without a header is refused', :'sr_strict' like 'ERR:%' and (select notes is distinct from 'strict' from invoices where id = 'zz-inv-a'), :'sr_strict');

-- helper and trigger functions must not be callable by any API role
select zz.try('crm_tenant', 'co_a', $$select public.invoice_sync_header('zz-inv-b')$$) as sync_t \gset
select zz.try('service_role', 'co_a', $$select public.invoice_sync_header('zz-inv-b')$$) as sync_s \gset
select zz.check('invoice_sync_header is not callable by the tenant role or the service role', :'sync_t' like 'ERR:42501%' and :'sync_s' like 'ERR:42501%', :'sync_t' || ' / ' || :'sync_s');

-- direct table access: RLS hides the other company
select zz.try('crm_tenant', 'co_a', $$update invoices set notes = 'direct' where id = 'zz-inv-b'$$) as upd_b \gset
select zz.try('crm_tenant', 'co_a', $$delete from invoices where id = 'zz-inv-b'$$) as del_b \gset
select zz.check('A updates nothing and deletes nothing of B''s invoice by direct table access', :'upd_b' = 'ok:0' and :'del_b' = 'ok:0', :'upd_b' || ' / ' || :'del_b');

-- ------------------------------------------------------------------ result
\o
\set QUIET off
\pset tuples_only on
\pset format unaligned
select case when ok then 'PASS: ' else 'FAIL: ' end || name || case when ok then '' else '   [' || left(detail, 300) || ']' end from zz.results order by ok, name;
select (select count(*) from zz.results where ok) || ' passed, ' || (select count(*) from zz.results where not ok) || ' failed';
