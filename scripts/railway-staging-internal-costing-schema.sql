-- Railway staging repair — internal costing / investor ledger
-- Additive and idempotent. This file is for the Railway staging database used by
-- sunchaser-crm-private-smoke. It must not be auto-applied to Supabase or any
-- production database as part of the Railway migration.
--
-- Why this exists:
-- The current CRM runtime expects these Phase 22/23 tables, but the verified
-- 142-table source Supabase schema did not contain them. The runtime also writes
-- created_by_user_id for durable finance ownership, while the older Phase 22 SQL
-- did not define that column.
--
-- Access model follows the hardened marketplace schema:
--   * RLS enabled + forced
--   * PUBLIC / anon / authenticated have no table privileges
--   * backend service_role receives CRUD privileges
--   * application-level staff/ownership authorization remains authoritative

begin;

create table if not exists public.internal_costing_sheets (
  id text primary key,
  title text default '',
  client_name text not null default '',
  lead_id text,
  customer_id text,
  project_id text,
  quotation_id text,
  invoice_id text,
  quotation_value numeric not null default 0,
  amount_received numeric not null default 0,
  items jsonb not null default '[]'::jsonb,
  total_purchase_cost numeric not null default 0,
  total_sale_value numeric not null default 0,
  gross_profit numeric not null default 0,
  profit_percent numeric not null default 0,
  amount_paid_to_suppliers numeric not null default 0,
  net_cash_remaining numeric not null default 0,
  notes text default '',
  auto_created boolean not null default false,
  consume_inventory boolean not null default false,
  stock_reserved boolean not null default false,
  reserved_stock_value numeric not null default 0,
  consumed_stock_value numeric not null default 0,
  created_by text,
  created_by_user_id text,
  updated_by text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- Repair a database that previously received the older Phase 22 script.
alter table public.internal_costing_sheets
  add column if not exists title text default '',
  add column if not exists project_id text,
  add column if not exists auto_created boolean not null default false,
  add column if not exists consume_inventory boolean not null default false,
  add column if not exists stock_reserved boolean not null default false,
  add column if not exists reserved_stock_value numeric not null default 0,
  add column if not exists consumed_stock_value numeric not null default 0,
  add column if not exists created_by_user_id text;

create index if not exists idx_internal_costing_sheets_lead
  on public.internal_costing_sheets (lead_id);
create index if not exists idx_internal_costing_sheets_customer
  on public.internal_costing_sheets (customer_id);
create unique index if not exists idx_internal_costing_sheets_project
  on public.internal_costing_sheets (project_id)
  where project_id is not null;
create index if not exists idx_internal_costing_sheets_created_by_user
  on public.internal_costing_sheets (created_by_user_id)
  where created_by_user_id is not null;

create table if not exists public.investors (
  id text primary key,
  name text not null,
  amount_received numeric not null default 0,
  date_received date,
  purpose text default '',
  notes text default '',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.inventory_purchases (
  id text primary key,
  supplier_name text not null default '',
  product_name text not null default '',
  inventory_item_id text,
  quantity numeric not null default 0,
  purchase_rate numeric not null default 0,
  total_cost numeric not null default 0,
  investor_id text references public.investors (id),
  payment_method text default '',
  payment_status text not null default 'Unpaid',
  bill_url text,
  notes text default '',
  created_by text,
  created_by_user_id text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.inventory_purchases
  add column if not exists created_by_user_id text;

create index if not exists idx_inventory_purchases_investor
  on public.inventory_purchases (investor_id);
create index if not exists idx_inventory_purchases_item
  on public.inventory_purchases (inventory_item_id);
create index if not exists idx_inventory_purchases_created_by_user
  on public.inventory_purchases (created_by_user_id)
  where created_by_user_id is not null;

alter table public.internal_costing_sheets enable row level security;
alter table public.internal_costing_sheets force row level security;
alter table public.investors enable row level security;
alter table public.investors force row level security;
alter table public.inventory_purchases enable row level security;
alter table public.inventory_purchases force row level security;

revoke all on table public.internal_costing_sheets from public;
revoke all on table public.investors from public;
revoke all on table public.inventory_purchases from public;

do $railway_costing_security$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.internal_costing_sheets from anon;
    revoke all on table public.investors from anon;
    revoke all on table public.inventory_purchases from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.internal_costing_sheets from authenticated;
    revoke all on table public.investors from authenticated;
    revoke all on table public.inventory_purchases from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.internal_costing_sheets to service_role;
    grant select, insert, update, delete on table public.investors to service_role;
    grant select, insert, update, delete on table public.inventory_purchases to service_role;
  else
    raise exception 'Required PostgREST database role service_role is missing';
  end if;
end
$railway_costing_security$;

notify pgrst, 'reload schema';

commit;
