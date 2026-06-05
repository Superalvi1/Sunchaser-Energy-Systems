-- Vyapar-style invoice fields — additive, idempotent

alter table public.invoices add column if not exists po_number text;
alter table public.invoices add column if not exists po_date date;
alter table public.invoices add column if not exists invoice_time text;
alter table public.invoices add column if not exists payment_terms text;
alter table public.invoices add column if not exists payment_mode text;
alter table public.invoices add column if not exists amount_in_words text;
alter table public.invoices add column if not exists previous_balance numeric not null default 0;

alter table public.invoice_items add column if not exists item_name text;

-- Invoice PDF: only accounts explicitly marked visible appear on bank page
alter table public.bank_accounts add column if not exists show_on_invoice boolean not null default false;

-- Default: Sunchaser-titled accounts only; Super Admin enables others via Admin settings
update public.bank_accounts
  set show_on_invoice = true
  where account_title ilike '%sunchaser%'
    and coalesce(is_active, true) = true
    and coalesce(bank_name, '') <> ''
    and coalesce(account_number, '') <> ''
    and coalesce(iban, '') <> ''
    and upper(trim(iban)) <> 'N/A';

create index if not exists invoices_customer_name_idx on public.invoices(customer_name);
create index if not exists bank_accounts_show_on_invoice_idx on public.bank_accounts(show_on_invoice);
