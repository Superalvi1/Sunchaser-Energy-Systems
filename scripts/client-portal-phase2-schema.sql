-- Phase 2: Document Wallet + Warranty Center (additive only)

create table if not exists public.customer_documents (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  document_type text not null check (document_type in (
    'quotation_pdf',
    'agreement',
    'invoice',
    'warranty_certificate',
    'net_metering_documents',
    'completion_certificate',
    'product_datasheet'
  )),
  title text not null,
  file_url text not null,
  uploaded_by text not null,
  uploaded_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists customer_documents_customer_id_idx on public.customer_documents(customer_id);
create index if not exists customer_documents_project_id_idx on public.customer_documents(project_id);
create index if not exists customer_documents_type_idx on public.customer_documents(document_type);

create table if not exists public.customer_warranties (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  component_type text not null check (component_type in (
    'solar_panels',
    'inverter',
    'battery',
    'installation_workmanship'
  )),
  brand text,
  model text,
  serial_number text,
  start_date date,
  end_date date,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists customer_warranties_customer_component_uidx
  on public.customer_warranties(customer_id, component_type);

create table if not exists public.warranty_claims (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  ticket_id text references public.support_tickets(id) on delete set null,
  component text not null,
  issue_description text not null,
  photo_url text,
  status text not null default 'New' check (status in (
    'New',
    'In Review',
    'Technician Assigned',
    'Resolved',
    'Rejected'
  )),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists warranty_claims_customer_id_idx on public.warranty_claims(customer_id);
create index if not exists warranty_claims_status_idx on public.warranty_claims(status);

alter table public.customer_documents enable row level security;
alter table public.customer_warranties enable row level security;
alter table public.warranty_claims enable row level security;

create policy "Enable full access for authenticated backend" on public.customer_documents for all using (true);
create policy "Enable full access for authenticated backend" on public.customer_warranties for all using (true);
create policy "Enable full access for authenticated backend" on public.warranty_claims for all using (true);
