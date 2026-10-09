-- Synthetic "dirty legacy" invoice data for the payment-guard review. DISPOSABLE DATABASES ONLY.
-- Every row is invented (ids start with dirty-). Loaded BEFORE invoice-payments-integrity.sql is applied.
-- Each invoice carries one line item equal to its total unless the case says otherwise, so it can be viewed/printed.
\set ON_ERROR_STOP on
begin;
set session_replication_role = replica;  -- lets us create states the application would never create (orphans, drift)

create temp table _case(id text, num text, total numeric, hdr_paid numeric, hdr_bal numeric, pstatus text, istatus text,
                        due date, archived boolean, descr text);
insert into _case values
 ('dirty-d01','D01',100000,120000,0,'Paid','active',null,false,'overpaid legacy: ledger 70k+50k on a 100k invoice'),
 ('dirty-d02','D02',100000,80000,20000,'Partial','active',null,false,'header paid 80k but ledger only 30k'),
 ('dirty-d03','D03',100000,0,100000,'Unpaid','active',null,false,'header paid 0 but ledger 40k'),
 ('dirty-d05','D05',100000,50000,50000,'Partial','active',null,false,'legacy opening balance: header paid 50k, no ledger rows'),
 ('dirty-d06','D06',100000,60000,40000,'Partial','void',null,false,'void invoice that holds 60k of payments'),
 ('dirty-d07','D07',100000,100000,0,'Paid','duplicate',null,false,'duplicate-status invoice with payments'),
 ('dirty-d08','D08',100000,30000,70000,'Partial','archived',null,true,'archived invoice with payments'),
 ('dirty-d09','D09',100000,100000,0,'Paid','test',null,false,'test-status invoice paid in full'),
 ('dirty-d10','D10',100000,80000,20000,'Partial','active',null,false,'ledger has a negative (refund) row: +100k, -20k'),
 ('dirty-d11','D11',100000,60000,40000,'Partial','active',null,false,'two identical 30k rows with different ids (duplicate or legitimate)'),
 ('dirty-d12','D12',100000,50000,50000,'Partial','active',null,false,'ledger has a zero-amount row next to a 50k row'),
 ('dirty-d13','D13',0,5000,0,'Unpaid','active',null,false,'grand total 0 with a 5k payment'),
 ('dirty-d14','D14',100000,25000,75000,'Overdue','active','2026-01-15',false,'overdue partial'),
 ('dirty-d15','D15',100000,100000,0,'Overdue','active',null,false,'paid in full but status manually forced to Overdue'),
 ('dirty-d16','D16',100000,50000,50000,'Partial','active',null,false,'line items (80k) disagree with the total (100k)'),
 ('dirty-d17','D17',100000,100000,0,'Paid','active',null,false,'clean control: paid exactly in full'),
 ('dirty-d18','D18',100000,40000,60000,'Partial','active',null,false,'clean control: partial'),
 ('dirty-d19','D19',100000,150000,0,'Paid','active',null,false,'legacy header-only overpayment: header 150k, no ledger rows'),
 ('dirty-d20','D20',100000,0,100000,'Unpaid','active',null,false,'clean control: untouched');

insert into public.invoices(id, invoice_number, invoice_date, due_date, customer_name, customer_phone, subtotal, grand_total, paid_amount, balance_due,
                            payment_status, invoice_status, archived_at, created_by, notes)
select id, num, date '2026-01-10', due, 'Synthetic Dirty ' || num, '03000000' || right(num, 2), total, total, hdr_paid, hdr_bal, pstatus, istatus,
       case when archived then now() end, 'seed', descr
  from _case;

insert into public.invoice_items(id, invoice_id, sort_order, description, qty, unit, rate, line_total)
select 'item-' || id, id, 0, 'Synthetic line ' || num, 1, 'job', case when id = 'dirty-d16' then 80000 else total end, case when id = 'dirty-d16' then 80000 else total end
  from _case;

insert into public.invoice_payments(id, invoice_id, amount, payment_method, payment_date, reference_number, notes, recorded_by) values
 ('dp-d01-a','dirty-d01',70000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d01-b','dirty-d01',50000,'Cash','2026-01-12',null,'seed','seed'),
 ('dp-d02-a','dirty-d02',30000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d03-a','dirty-d03',40000,'Online','2026-01-11',null,'seed','seed'),
 ('dp-d06-a','dirty-d06',60000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d07-a','dirty-d07',100000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d08-a','dirty-d08',30000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d09-a','dirty-d09',100000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d10-a','dirty-d10',100000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d10-b','dirty-d10',-20000,'Cash','2026-01-13',null,'refund','seed'),
 ('dp-d11-a','dirty-d11',30000,'Cash','2026-01-11','R-1','seed','seed'),
 ('dp-d11-b','dirty-d11',30000,'Cash','2026-01-11','R-1','seed','seed'),
 ('dp-d12-a','dirty-d12',0,'Cash','2026-01-11',null,'zero','seed'),
 ('dp-d12-b','dirty-d12',50000,'Cash','2026-01-12',null,'seed','seed'),
 ('dp-d13-a','dirty-d13',5000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d14-a','dirty-d14',25000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d15-a','dirty-d15',100000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d16-a','dirty-d16',50000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d17-a','dirty-d17',100000,'Cash','2026-01-11',null,'seed','seed'),
 ('dp-d18-a','dirty-d18',40000,'Cash','2026-01-11',null,'seed','seed'),
 -- orphan payments: the invoice does not exist (only possible when the foreign key is absent or was bypassed)
 ('dp-orphan-a','dirty-missing',12345,'Cash','2026-01-11',null,'orphan','seed');

-- NULL amounts cannot exist (NOT NULL columns); the closest dirt is a sub-paisa payment dated far in the future.
insert into public.invoice_payments(id, invoice_id, amount, payment_method, payment_date, notes, recorded_by)
values ('dp-d18-future','dirty-d18',0.004,'Cash','2099-01-01','sub-paisa amount','seed');
commit;
