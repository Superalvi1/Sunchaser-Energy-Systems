-- Phase 5: Solar Savings Dashboard (additive only)

create table if not exists public.customer_savings_profiles (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  system_size_kw numeric,
  unit_rate numeric default 55,
  manual_today_generation numeric,
  manual_month_generation numeric,
  lifetime_generation numeric,
  performance_status text check (performance_status in (
    'Excellent',
    'Normal',
    'Low Generation',
    'Needs Attention'
  )),
  notes text,
  updated_by text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists customer_savings_profiles_customer_id_uidx
  on public.customer_savings_profiles(customer_id);

create index if not exists customer_savings_profiles_project_id_idx
  on public.customer_savings_profiles(project_id);

alter table public.customer_savings_profiles enable row level security;
create policy "Enable full access for authenticated backend" on public.customer_savings_profiles for all using (true);
