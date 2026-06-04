-- Phase 9: Technical Staff Portal + Welcome Wizard (additive only)

alter table public.users
  add column if not exists onboarding_completed boolean not null default false;

alter table public.users
  add column if not exists onboarding_completed_at timestamp with time zone;

create table if not exists public.technical_job_updates (
  id text primary key,
  job_id text not null,
  job_type text not null,
  customer_id text,
  project_id text,
  assigned_user_id text,
  status text not null default 'Assigned',
  technician_notes text,
  before_photo_url text,
  after_photo_url text,
  inverter_photo_url text,
  db_photo_url text,
  replaced_component_details text,
  customer_signature_url text,
  safety_checklist jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists technical_job_updates_job_id_idx on public.technical_job_updates(job_id);
create index if not exists technical_job_updates_assigned_user_id_idx on public.technical_job_updates(assigned_user_id);
create index if not exists technical_job_updates_status_idx on public.technical_job_updates(status);
