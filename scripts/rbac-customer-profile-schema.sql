-- RBAC dynamic roles + customer system profile + document extensions (idempotent)

-- -----------------------------------------------------------------------------
-- Dynamic roles (Super Admin managed)
-- -----------------------------------------------------------------------------
create table if not exists public.roles (
  id text primary key,
  name text not null,
  slug text not null unique,
  is_system boolean not null default false,
  cloned_from text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists roles_name_lower_uidx on public.roles(lower(name));

create table if not exists public.role_permissions (
  role_id text not null references public.roles(id) on delete cascade,
  permission_key text not null,
  enabled boolean not null default true,
  primary key (role_id, permission_key)
);

create index if not exists role_permissions_role_id_idx on public.role_permissions(role_id);

-- Allow custom role names on users (app validates against roles table)
alter table public.users drop constraint if exists users_role_check;

-- -----------------------------------------------------------------------------
-- Customer installed system profile
-- -----------------------------------------------------------------------------
create table if not exists public.customer_systems (
  customer_id text primary key references public.customers(id) on delete cascade,
  system_size_kw numeric,
  system_type text check (system_type is null or system_type in ('On-grid', 'Hybrid', 'Off-grid')),
  panel_brand text,
  panel_wattage numeric,
  panel_quantity integer,
  inverter_brand text,
  inverter_size_kw numeric,
  battery_brand text,
  battery_capacity_kwh numeric,
  structure_type text,
  installation_date date,
  warranty_start date,
  warranty_end date,
  net_metering_status text,
  meter_number text,
  consumer_number text,
  sanctioned_load_kw numeric,
  site_address text,
  notes text,
  updated_at timestamptz not null default timezone('utc'::text, now()),
  updated_by text
);

-- -----------------------------------------------------------------------------
-- Customer documents — extend types + visibility + storage path
-- -----------------------------------------------------------------------------
alter table public.customer_documents add column if not exists visible_to_customer boolean not null default true;
alter table public.customer_documents add column if not exists internal_only boolean not null default false;
alter table public.customer_documents add column if not exists storage_path text;
alter table public.customer_documents add column if not exists mime_type text;
alter table public.customer_documents add column if not exists notes text;
alter table public.customer_documents add column if not exists file_name text;

alter table public.customer_documents drop constraint if exists customer_documents_document_type_check;
alter table public.customer_documents add constraint customer_documents_document_type_check check (
  document_type in (
    'quotation_pdf',
    'agreement',
    'agreement_word',
    'agreement_excel',
    'invoice',
    'warranty_certificate',
    'net_metering_documents',
    'completion_certificate',
    'product_datasheet',
    'boq_excel',
    'site_survey_report',
    'cnic_copy',
    'electricity_bill',
    'other'
  )
);

-- Storage bucket (create in Supabase dashboard or via API): customer-documents, public read
