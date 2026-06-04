-- Phase 10: Project Delivery & Equipment Registry (additive only)

create table if not exists public.project_deliveries (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  lead_id text,
  quotation_id text,
  project_title text not null,
  system_type text not null check (system_type in ('On-grid', 'Hybrid', 'Off-grid', 'EV Charger')),
  project_type text not null check (project_type in ('Residential', 'Commercial', 'Industrial')),
  system_size_kw numeric,
  assigned_technician_user_id text,
  installation_address text,
  expected_installation_date date,
  delivery_status text not null default 'Order Confirmed' check (delivery_status in (
    'Order Confirmed',
    'Material Ordered',
    'Material Delivered',
    'Installation Scheduled',
    'Installation In Progress',
    'Installation Completed',
    'Handover Completed'
  )),
  safety_checklist jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists project_deliveries_customer_id_idx on public.project_deliveries(customer_id);
create index if not exists project_deliveries_technician_idx on public.project_deliveries(assigned_technician_user_id);
create index if not exists project_deliveries_status_idx on public.project_deliveries(delivery_status);

create table if not exists public.project_delivery_items (
  id text primary key,
  delivery_id text not null references public.project_deliveries(id) on delete cascade,
  item_category text not null,
  brand text,
  model text,
  quantity numeric default 1,
  wattage text,
  capacity text,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists project_delivery_items_delivery_id_idx on public.project_delivery_items(delivery_id);

create table if not exists public.project_installed_equipment (
  id text primary key,
  delivery_id text not null references public.project_deliveries(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  equipment_type text not null,
  brand text,
  model text,
  serial_number text,
  capacity text,
  quantity numeric default 1,
  warranty_start_date date,
  warranty_end_date date,
  photo_url text,
  notes text,
  synced_equipment_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists project_installed_equipment_delivery_idx on public.project_installed_equipment(delivery_id);
create index if not exists project_installed_equipment_customer_idx on public.project_installed_equipment(customer_id);

create table if not exists public.project_installation_photos (
  id text primary key,
  delivery_id text not null references public.project_deliveries(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  photo_category text not null,
  photo_url text not null,
  caption text,
  uploaded_by text,
  synced_photo_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists project_installation_photos_delivery_idx on public.project_installation_photos(delivery_id);

create table if not exists public.project_delivery_updates (
  id text primary key,
  delivery_id text not null references public.project_deliveries(id) on delete cascade,
  previous_status text,
  new_status text not null,
  updated_by_user_id text,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists project_delivery_updates_delivery_idx on public.project_delivery_updates(delivery_id);
