-- Installation completion proof + warranty handover (additive)

alter table public.project_deliveries add column if not exists completion_stage text not null default 'Survey';
alter table public.project_deliveries add column if not exists battery_applicable boolean not null default true;
alter table public.project_deliveries add column if not exists installation_completed_date date;
alter table public.project_deliveries add column if not exists warranty_start_date date;
alter table public.project_deliveries add column if not exists warranty_end_date date;

alter table public.project_deliveries drop constraint if exists project_deliveries_completion_stage_check;
alter table public.project_deliveries add constraint project_deliveries_completion_stage_check check (
  completion_stage in (
    'Survey',
    'Installation Started',
    'Panels Installed',
    'Inverter Installed',
    'Battery Installed',
    'Earthing Completed',
    'QA Inspection',
    'Customer Handover',
    'Completed'
  )
);

create table if not exists public.project_completion_media (
  id text primary key,
  delivery_id text not null references public.project_deliveries(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  media_type text not null,
  file_url text not null,
  storage_path text,
  mime_type text,
  serial_number text,
  notes text,
  uploaded_by text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.project_completion_media drop constraint if exists project_completion_media_type_check;
alter table public.project_completion_media add constraint project_completion_media_type_check check (
  media_type in (
    'panel_site_photo',
    'panel_serial_photo',
    'inverter_installed_photo',
    'inverter_serial_photo',
    'battery_installed_photo',
    'battery_serial_photo',
    'earth_bore_photo',
    'earthing_connection_photo',
    'complete_site_photo',
    'customer_handover_photo'
  )
);

create unique index if not exists project_completion_media_delivery_type_uidx
  on public.project_completion_media(delivery_id, media_type);

create index if not exists project_completion_media_delivery_id_idx on public.project_completion_media(delivery_id);

-- Storage bucket: project-completion-media (public read) — create in Supabase dashboard if needed
