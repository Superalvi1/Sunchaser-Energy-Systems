-- Phase 11: Super Admin project finance + WhatsApp message logs (additive only)

create table if not exists public.project_finance_records (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  project_delivery_id text references public.project_deliveries(id) on delete set null,
  lead_id text,
  quotation_id text,
  sale_value numeric not null default 0,
  advance_received numeric not null default 0,
  balance_remaining numeric not null default 0,
  supplier_cost numeric not null default 0,
  installation_cost numeric not null default 0,
  transport_cost numeric not null default 0,
  misc_expense numeric not null default 0,
  total_expense numeric not null default 0,
  gross_profit numeric not null default 0,
  profit_margin_percent numeric not null default 0,
  payment_status text not null default 'Unpaid' check (payment_status in (
    'Unpaid',
    'Advance Received',
    'Partially Paid',
    'Fully Paid',
    'Overdue'
  )),
  notes text,
  created_by text,
  updated_by text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists project_finance_records_customer_id_idx on public.project_finance_records(customer_id);
create index if not exists project_finance_records_delivery_id_idx on public.project_finance_records(project_delivery_id);
create index if not exists project_finance_records_payment_status_idx on public.project_finance_records(payment_status);

create table if not exists public.whatsapp_message_logs (
  id text primary key,
  customer_id text references public.customers(id) on delete set null,
  lead_id text,
  project_delivery_id text references public.project_deliveries(id) on delete set null,
  phone text not null,
  message_type text not null,
  message_body text not null,
  sent_by text,
  sent_at timestamp with time zone default timezone('utc'::text, now()) not null,
  status text not null default 'Opened' check (status in (
    'Drafted',
    'Opened',
    'Sent Manually',
    'Failed'
  ))
);

create index if not exists whatsapp_message_logs_customer_id_idx on public.whatsapp_message_logs(customer_id);
create index if not exists whatsapp_message_logs_lead_id_idx on public.whatsapp_message_logs(lead_id);
create index if not exists whatsapp_message_logs_sent_at_idx on public.whatsapp_message_logs(sent_at desc);
