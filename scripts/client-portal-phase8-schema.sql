-- Phase 8: Real Inverter Integration / Energy Monitor (additive only)

create table if not exists public.customer_energy_devices (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  brand text not null check (brand in ('GoodWe', 'Solis', 'Growatt', 'Itel Hybrid')),
  device_serial text not null,
  plant_id text,
  api_provider text not null,
  status text not null default 'Offline' check (status in ('Online', 'Offline', 'Syncing', 'Error')),
  last_sync timestamp with time zone,
  unit_rate_pkr numeric default 55,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists customer_energy_devices_customer_id_idx on public.customer_energy_devices(customer_id);
create index if not exists customer_energy_devices_status_idx on public.customer_energy_devices(status);
create unique index if not exists customer_energy_devices_serial_idx on public.customer_energy_devices(device_serial);

create table if not exists public.energy_alerts (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  device_id text references public.customer_energy_devices(id) on delete set null,
  alert_type text not null check (
    alert_type in (
      'low_production',
      'battery_offline',
      'inverter_offline',
      'no_generation_sunlight'
    )
  ),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  message text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists energy_alerts_customer_id_idx on public.energy_alerts(customer_id);
create index if not exists energy_alerts_status_idx on public.energy_alerts(status);
create index if not exists energy_alerts_created_at_idx on public.energy_alerts(created_at desc);
