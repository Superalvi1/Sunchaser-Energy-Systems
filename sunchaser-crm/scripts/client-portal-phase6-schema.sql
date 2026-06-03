-- Phase 6: Smart Care Subscription Engine (additive only)

create table if not exists public.subscription_plans (
  id text primary key,
  plan_code text not null unique,
  name text not null,
  monthly_price numeric not null,
  features jsonb not null default '[]'::jsonb,
  service_credits_per_month integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.customer_subscriptions (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  plan_id text not null references public.subscription_plans(id),
  status text not null default 'Active' check (status in ('Active', 'Expired', 'Cancelled', 'Pending')),
  start_date date not null,
  renewal_date date not null,
  service_credits_used integer not null default 0,
  service_credits_limit integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists customer_subscriptions_customer_id_idx on public.customer_subscriptions(customer_id);
create index if not exists customer_subscriptions_status_idx on public.customer_subscriptions(status);
create index if not exists customer_subscriptions_renewal_date_idx on public.customer_subscriptions(renewal_date);

create table if not exists public.subscription_payments (
  id text primary key,
  subscription_id text not null references public.customer_subscriptions(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  amount numeric not null,
  status text not null default 'Paid' check (status in ('Paid', 'Pending', 'Failed', 'Refunded')),
  paid_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists subscription_payments_subscription_id_idx on public.subscription_payments(subscription_id);

create table if not exists public.service_visit_reports (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  subscription_id text references public.customer_subscriptions(id) on delete set null,
  service_request_id text references public.service_requests(id) on delete set null,
  technician text,
  visit_date date,
  performance_improvement_notes text,
  before_photo_url text,
  after_photo_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists service_visit_reports_customer_id_idx on public.service_visit_reports(customer_id);

create table if not exists public.service_visit_photos (
  id text primary key,
  report_id text not null references public.service_visit_reports(id) on delete cascade,
  photo_type text not null check (photo_type in ('before', 'after')),
  photo_url text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists service_visit_photos_report_id_idx on public.service_visit_photos(report_id);

alter table public.subscription_plans enable row level security;
alter table public.customer_subscriptions enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.service_visit_reports enable row level security;
alter table public.service_visit_photos enable row level security;

create policy "Enable full access for authenticated backend" on public.subscription_plans for all using (true);
create policy "Enable full access for authenticated backend" on public.customer_subscriptions for all using (true);
create policy "Enable full access for authenticated backend" on public.subscription_payments for all using (true);
create policy "Enable full access for authenticated backend" on public.service_visit_reports for all using (true);
create policy "Enable full access for authenticated backend" on public.service_visit_photos for all using (true);

insert into public.subscription_plans (id, plan_code, name, monthly_price, features, service_credits_per_month, sort_order)
values
  (
    'plan-care-basic',
    'care_basic',
    'Care Basic',
    4999,
    '["Quarterly panel cleaning","Email support","Annual performance review","1 service credit per month"]'::jsonb,
    1,
    1
  ),
  (
    'plan-care-premium',
    'care_premium',
    'Care Premium',
    8999,
    '["Bi-monthly cleaning visit","Priority support","Inverter health monitoring","2 service credits per month","Physical inspection annually"]'::jsonb,
    2,
    2
  ),
  (
    'plan-total-peace',
    'total_peace',
    'Total Peace Of Mind',
    14999,
    '["Monthly cleaning visit","24/7 priority support","Full warranty coordination","4 service credits per month","Battery health checks","Before/after visit reports"]'::jsonb,
    4,
    3
  )
on conflict (plan_code) do update set
  name = excluded.name,
  monthly_price = excluded.monthly_price,
  features = excluded.features,
  service_credits_per_month = excluded.service_credits_per_month,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc'::text, now());
