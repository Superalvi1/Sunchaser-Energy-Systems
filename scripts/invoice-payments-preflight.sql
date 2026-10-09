-- READ-ONLY pre-flight for invoice-payments-integrity.sql. Run against a RESTORED COPY first, never edit data here.
-- 1. Invoices whose header disagrees with the ledger (the first UPDATE after the migration will rewrite the header from the ledger).
select i.id, i.invoice_number, i.grand_total, i.paid_amount as header_paid, coalesce(p.s, 0) as ledger_sum, p.n as ledger_rows
  from public.invoices i
  join (select invoice_id, count(*) n, sum(amount) s from public.invoice_payments group by invoice_id) p on p.invoice_id = i.id
 where round(i.paid_amount, 2) <> round(p.s, 2)
 order by i.invoice_date desc;
-- 2. Ledgers already above the invoice total (legacy overpaid; stay editable, new payments are refused).
select i.id, i.invoice_number, i.grand_total, p.s as ledger_sum
  from public.invoices i
  join (select invoice_id, sum(amount) s from public.invoice_payments group by invoice_id) p on p.invoice_id = i.id
 where p.s > i.grand_total
 order by i.invoice_date desc;
-- 3. Non-positive payment rows (the guard would refuse these today).
select id, invoice_id, amount from public.invoice_payments where amount <= 0;
-- 4. Existing trigger names that this migration would replace, and other triggers on the two tables.
select tgrelid::regclass as tbl, tgname from pg_trigger
 where tgrelid in ('public.invoices'::regclass, 'public.invoice_payments'::regclass) and not tgisinternal;
