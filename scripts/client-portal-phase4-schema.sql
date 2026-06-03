-- Phase 4: Service Scheduler & Maintenance Engine (additive only)

create table if not exists public.service_requests (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  service_type text not null check (service_type in (
    'Cleaning',
    'Inspection',
    'Warranty Visit',
    'Emergency Visit',
    'Battery Health Check'
  )),
  status text not null default 'Submitted' check (status in (
    'Submitted',
    'Assigned',
    'Scheduled',
    'En Route',
    'Completed',
    'Cancelled'
  )),
  preferred_date date,
  preferred_time text,
  notes text,
  assigned_technician text,
  scheduled_visit_date date,
  before_photo_url text,
  after_photo_url text,
  completion_notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists service_requests_customer_id_idx on public.service_requests(customer_id);
create index if not exists service_requests_project_id_idx on public.service_requests(project_id);
create index if not exists service_requests_status_idx on public.service_requests(status);
create index if not exists service_requests_service_type_idx on public.service_requests(service_type);

alter table public.service_requests enable row level security;
create policy "Enable full access for authenticated backend" on public.service_requests for all using (true);
