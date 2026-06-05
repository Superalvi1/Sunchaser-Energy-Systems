-- Vyapar-style invoice fields — additive, idempotent

alter table public.invoices add column if not exists po_number text;
alter table public.invoices add column if not exists po_date date;
alter table public.invoices add column if not exists invoice_time text;
alter table public.invoices add column if not exists payment_terms text;
alter table public.invoices add column if not exists payment_mode text;
alter table public.invoices add column if not exists amount_in_words text;
alter table public.invoices add column if not exists previous_balance numeric not null default 0;

alter table public.invoice_items add column if not exists item_name text;

create index if not exists invoices_customer_name_idx on public.invoices(customer_name);
