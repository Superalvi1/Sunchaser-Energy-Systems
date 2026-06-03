-- Phase 3: Support & Service Center (additive only)

alter table public.support_tickets add column if not exists customer_id text references public.customers(id) on delete set null;
alter table public.support_tickets add column if not exists category text;
alter table public.support_tickets add column if not exists fault_code text;
alter table public.support_tickets add column if not exists photo_url text;
alter table public.support_tickets add column if not exists preferred_visit_date date;
alter table public.support_tickets add column if not exists scheduled_visit_date date;
alter table public.support_tickets add column if not exists customer_visible_notes text;
alter table public.support_tickets add column if not exists resolution_summary text;
alter table public.support_tickets add column if not exists updated_at timestamp with time zone default timezone('utc'::text, now());

create index if not exists support_tickets_customer_id_idx on public.support_tickets(customer_id);
create index if not exists support_tickets_status_idx on public.support_tickets(status);
create index if not exists support_tickets_category_idx on public.support_tickets(category);

create table if not exists public.support_ticket_updates (
  id text primary key,
  ticket_id text not null references public.support_tickets(id) on delete cascade,
  status text,
  note text,
  visibility text not null default 'system' check (visibility in ('customer', 'internal', 'system')),
  created_by text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists support_ticket_updates_ticket_id_idx on public.support_ticket_updates(ticket_id);

alter table public.support_ticket_updates enable row level security;
create policy "Enable full access for authenticated backend" on public.support_ticket_updates for all using (true);
