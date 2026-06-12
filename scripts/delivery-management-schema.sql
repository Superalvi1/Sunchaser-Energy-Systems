-- Phase 24 — Invoice-Linked Partial Delivery Management
-- Run against Supabase when upgrading.

create table if not exists public.delivery_challans (
  id text primary key,
  challan_number text not null,
  invoice_id text not null,
  project_id text,
  customer_id text,
  lead_id text,
  quotation_id text,
  status text not null default 'draft',
  delivery_title text default '',
  delivery_date date,
  vehicle_number text default '',
  driver_name text default '',
  installer_name text default '',
  receiver_name text default '',
  receiver_phone text default '',
  receiver_cnic text default '',
  receiver_relation text default '',
  otp_code text,
  otp_sent_at timestamptz,
  otp_verified_at timestamptz,
  verified_by_phone text,
  gps_lat numeric,
  gps_lng numeric,
  gps_address text default '',
  signed_at timestamptz,
  signature_image_url text,
  verification_checklist jsonb default '{}'::jsonb,
  dispute_reason text,
  notes text default '',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_challan_items (
  id text primary key,
  challan_id text not null references public.delivery_challans (id) on delete cascade,
  invoice_item_id text,
  inventory_item_id text,
  item_name text not null default '',
  category text default '',
  invoice_qty numeric not null default 0,
  previously_delivered_qty numeric not null default 0,
  deliver_now_qty numeric not null default 0,
  remaining_qty_after numeric not null default 0,
  serial_number text default '',
  condition_notes text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_challan_photos (
  id text primary key,
  challan_id text not null references public.delivery_challans (id) on delete cascade,
  photo_url text not null,
  photo_type text not null default 'material',
  caption text default '',
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_delivery_challans_invoice on public.delivery_challans (invoice_id);
create index if not exists idx_delivery_challans_customer on public.delivery_challans (customer_id);
create index if not exists idx_delivery_challans_status on public.delivery_challans (status);
create index if not exists idx_delivery_challans_delivery_date on public.delivery_challans (delivery_date);
create index if not exists idx_delivery_challan_items_challan on public.delivery_challan_items (challan_id);
create index if not exists idx_delivery_challan_items_invoice_item on public.delivery_challan_items (invoice_item_id);
create index if not exists idx_delivery_challan_photos_challan on public.delivery_challan_photos (challan_id);

NOTIFY pgrst, 'reload schema';
