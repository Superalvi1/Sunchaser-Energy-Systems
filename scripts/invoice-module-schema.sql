-- Invoice module (Vyapar-style) — additive, idempotent

create table if not exists public.invoices (
  id text primary key,
  invoice_number text not null unique,
  invoice_date date not null default current_date,
  due_date date,
  customer_id text references public.customers(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  customer_address text,
  cnic_ntn text,
  lead_id text,
  quotation_id text,
  project_id text,
  subtotal numeric not null default 0,
  discount_amount numeric not null default 0,
  tax_amount numeric not null default 0,
  grand_total numeric not null default 0,
  paid_amount numeric not null default 0,
  balance_due numeric not null default 0,
  payment_status text not null default 'Unpaid' check (
    payment_status in ('Unpaid', 'Partial', 'Paid', 'Overdue')
  ),
  notes text,
  terms text,
  pdf_url text,
  storage_path text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists invoices_customer_id_idx on public.invoices(customer_id);
create index if not exists invoices_invoice_date_idx on public.invoices(invoice_date desc);
create index if not exists invoices_payment_status_idx on public.invoices(payment_status);

create table if not exists public.invoice_items (
  id text primary key,
  invoice_id text not null references public.invoices(id) on delete cascade,
  sort_order integer not null default 0,
  description text not null,
  qty numeric not null default 1,
  unit text default 'pcs',
  rate numeric not null default 0,
  tax_percent numeric not null default 0,
  discount_amount numeric not null default 0,
  line_total numeric not null default 0,
  product_id text,
  notes text
);

create index if not exists invoice_items_invoice_id_idx on public.invoice_items(invoice_id);

create table if not exists public.invoice_payments (
  id text primary key,
  invoice_id text not null references public.invoices(id) on delete cascade,
  amount numeric not null,
  payment_method text not null check (
    payment_method in ('Cash', 'Bank transfer', 'Cheque', 'Online')
  ),
  payment_date date not null default current_date,
  receipt_url text,
  receipt_storage_path text,
  notes text,
  recorded_by text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists invoice_payments_invoice_id_idx on public.invoice_payments(invoice_id);

-- Branding blob stored in settings.key = 'company_branding' (JSON), managed via API
