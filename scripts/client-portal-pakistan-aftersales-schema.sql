-- Pakistan Solar After-Sales (additive only)

create table if not exists public.customer_portal_profiles (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  tracker_type text not null default 'residential' check (tracker_type in ('residential', 'industrial')),
  free_service_start_date date,
  free_service_end_date date,
  free_service_months integer default 6,
  free_service_status text default 'Active' check (free_service_status in ('Active', 'Expired', 'Not Started')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists customer_portal_profiles_customer_uidx
  on public.customer_portal_profiles(customer_id);

create table if not exists public.customer_equipment (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  equipment_type text not null check (equipment_type in (
    'solar_panels', 'inverter', 'battery', 'db_box', 'breakers', 'spd',
    'changeover', 'earthing', 'cables', 'structure'
  )),
  brand text,
  model text,
  serial_number text,
  quantity numeric default 1,
  installation_date date,
  warranty_start date,
  warranty_end date,
  photo_url text,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists customer_equipment_customer_id_idx on public.customer_equipment(customer_id);

create table if not exists public.installation_photos (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  photo_category text not null check (photo_category in (
    'panels', 'inverter', 'battery', 'db', 'breakers', 'earthing',
    'cable_routing', 'structure', 'final_site'
  )),
  photo_url text not null,
  caption text,
  uploaded_by text,
  voice_note_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists installation_photos_customer_id_idx on public.installation_photos(customer_id);

create table if not exists public.after_sales_service_logs (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  service_type text not null,
  component_changed text,
  old_component_details text,
  new_component_details text,
  quantity numeric default 1,
  reason text,
  technician_name text,
  service_date date not null,
  under_free_service boolean not null default false,
  charge_amount numeric default 0,
  before_photo_url text,
  after_photo_url text,
  customer_visible_notes text,
  internal_notes text,
  voice_note_url text,
  created_by text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists after_sales_service_logs_customer_id_idx on public.after_sales_service_logs(customer_id);
create index if not exists after_sales_service_logs_service_date_idx on public.after_sales_service_logs(service_date);

alter table public.warranty_claims add column if not exists video_url text;
alter table public.warranty_claims add column if not exists voice_note_url text;
alter table public.warranty_claims add column if not exists equipment_id text references public.customer_equipment(id) on delete set null;
alter table public.warranty_claims add column if not exists equipment_type text;

alter table public.customer_portal_profiles enable row level security;
alter table public.customer_equipment enable row level security;
alter table public.installation_photos enable row level security;
alter table public.after_sales_service_logs enable row level security;

create policy "Enable full access for authenticated backend" on public.customer_portal_profiles for all using (true);
create policy "Enable full access for authenticated backend" on public.customer_equipment for all using (true);
create policy "Enable full access for authenticated backend" on public.installation_photos for all using (true);
create policy "Enable full access for authenticated backend" on public.after_sales_service_logs for all using (true);
