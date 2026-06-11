-- Phase 22 — Internal Costing Sheet + Investor Inventory Ledger
-- Super Admin only module. Run against Supabase when upgrading.

create table if not exists public.internal_costing_sheets (
  id text primary key,
  client_name text not null default '',
  lead_id text,
  customer_id text,
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
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_internal_costing_sheets_lead on public.internal_costing_sheets (lead_id);
create index if not exists idx_internal_costing_sheets_customer on public.internal_costing_sheets (customer_id);

create table if not exists public.investors (
  id text primary key,
  name text not null,
  amount_received numeric not null default 0,
  date_received date,
  purpose text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_purchases_investor on public.inventory_purchases (investor_id);
create index if not exists idx_inventory_purchases_item on public.inventory_purchases (inventory_item_id);

NOTIFY pgrst, 'reload schema';
