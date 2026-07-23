-- Marketplace WS0 — database foundation (additive, manual apply only)
-- Contract: sunchaser-marketplace-architecture-contract.md Revision 5.1
-- Do NOT auto-apply. Do NOT apply to production from this workstream without owner approval.
--
-- Forward-only, idempotent where practical (IF NOT EXISTS / DROP IF EXISTS + recreate).
-- Access: backend service_role only. RLS enabled + forced; anon/authenticated revoked.
-- SECURITY DEFINER RPCs use SET search_path = '' and schema-qualified names.

-- =============================================================================
-- 0a. Extensions
-- =============================================================================
create extension if not exists pgcrypto;

-- =============================================================================
-- 0. Helpers
-- =============================================================================
create or replace function public.mp_new_id(p_prefix text)
returns text
language sql
volatile
set search_path = ''
as $$
  select p_prefix || '_' || replace(gen_random_uuid()::text, '-', '');
$$;

revoke all on function public.mp_new_id(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mp_new_id(text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.mp_new_id(text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mp_new_id(text) to service_role;
  end if;
end $$;

-- =============================================================================
-- 1. Catalogue tables
-- =============================================================================
create table if not exists public.mp_brands (
  id text primary key,
  name text not null unique,
  slug text not null unique,
  logo_media_id text,
  website_url text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mp_categories (
  id text primary key,
  name text not null unique,
  slug text not null unique,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mp_products (
  id text primary key,
  brand_id text not null references public.mp_brands(id),
  category_id text not null references public.mp_categories(id),
  title text not null,
  slug text not null unique,
  description text not null default '',
  tags text[] not null default '{}',
  active boolean not null default true,
  featured boolean not null default false,
  display_from_price numeric(14,2),
  display_price_state text not null default 'confirm_price'
    check (display_price_state in ('priced_auto','priced_override','confirm_price','hidden')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists mp_products_slug_uidx on public.mp_products (slug);
create index if not exists mp_products_category_idx on public.mp_products (category_id);
create index if not exists mp_products_brand_idx on public.mp_products (brand_id);
create index if not exists mp_products_active_featured_idx
  on public.mp_products (active, featured) where active;

create table if not exists public.mp_product_variants (
  id text primary key,
  product_id text not null references public.mp_products(id) on delete cascade,
  sku text not null unique,
  title text not null,
  is_default boolean not null default false,
  is_priceable boolean not null default true,
  stock_status text not null default 'unknown'
    check (stock_status in ('in_stock','sold_out','backorder','unknown')),
  website_price numeric(14,2) check (website_price is null or website_price > 0),
  website_price_state text not null default 'confirm_price'
    check (website_price_state in ('priced_auto','priced_override','confirm_price')),
  website_price_source text
    check (website_price_source is null or website_price_source in
      ('kamal','alladin','seed','override','last_approved')),
  price_published_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, product_id)
);

create unique index if not exists mp_variants_one_default_uidx
  on public.mp_product_variants (product_id)
  where is_default and active;

create table if not exists public.mp_media (
  id text primary key,
  product_id text,
  variant_id text,
  storage_path text not null,
  role text not null default 'gallery'
    check (role in ('gallery','thumbnail','og','receipt')),
  alt text,
  width integer,
  height integer,
  sort_order integer not null default 0,
  source_type text not null default 'unknown'
    check (source_type in
      ('own','licensed','supplier','manufacturer','user_upload','unknown')),
  source_url text,
  rights_status text not null default 'unknown'
    check (rights_status in
      ('own','licensed','supplier_pending','supplier_approved','unknown','rejected')),
  permission_reference text,
  approved_by text,
  approved_at timestamptz,
  published boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint mp_media_scope_ck check (
    (role = 'receipt' and product_id is null and variant_id is null)
    or (role <> 'receipt' and product_id is null and variant_id is null)
    or (role <> 'receipt' and product_id is not null and variant_id is null)
    or (role <> 'receipt' and product_id is not null and variant_id is not null)
  ),
  constraint mp_media_receipt_never_published_ck check (
    role <> 'receipt' or published = false
  )
);

create index if not exists mp_media_product_idx on public.mp_media (product_id);
create index if not exists mp_media_variant_idx on public.mp_media (variant_id);
create index if not exists mp_media_role_idx on public.mp_media (role);
create index if not exists mp_media_published_idx
  on public.mp_media (published) where published;

-- =============================================================================
-- 2. Suppliers / pricing / jobs
-- =============================================================================
create table if not exists public.mp_suppliers (
  id text primary key,
  code text not null unique check (code in ('kamal','alladin')),
  name text not null,
  base_url text,
  active boolean not null default true,
  priority integer not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mp_pricing_config (
  company_id text primary key default 'sunchaser',
  max_increase_pct numeric(6,2) not null,
  max_decrease_pct numeric(6,2) not null,
  staleness_hours integer not null default 36,
  allow_soldout_reference boolean not null default false,
  safety_absolute_floor numeric(14,2),
  safety_absolute_ceiling numeric(14,2),
  min_token_pct numeric(6,2) not null,
  max_token_pct numeric(6,2) not null,
  min_advance_pct numeric(6,2) not null,
  max_advance_pct numeric(6,2) not null,
  cod_max_order_value numeric(14,2) not null,
  updated_by text,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mp_job_runs (
  id text primary key,
  job_name text not null,
  status text not null check (status in ('running','succeeded','failed')),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  error text,
  meta jsonb
);

create unique index if not exists mp_job_runs_running_uidx
  on public.mp_job_runs (job_name) where status = 'running';

create table if not exists public.mp_delivery_zones (
  id text primary key,
  code text not null unique,
  name text not null,
  cod_eligible boolean not null default false,
  active boolean not null default true
);

create table if not exists public.mp_delivery_rates (
  id text primary key,
  zone_id text not null references public.mp_delivery_zones(id),
  min_subtotal numeric(14,2) not null default 0,
  max_subtotal numeric(14,2),
  delivery_charge numeric(14,2) not null check (delivery_charge >= 0),
  active boolean not null default true
);

create table if not exists public.mp_supplier_products (
  id text primary key,
  supplier_id text not null references public.mp_suppliers(id),
  product_id text not null,
  variant_id text not null,
  supplier_product_id text not null,
  supplier_variant_id text,
  supplier_sku text,
  normalized_exact_model text not null,
  phase text,
  topology text,
  capacity text,
  match_evidence jsonb not null default '{}'::jsonb,
  supplier_url text,
  match_confidence text not null check (match_confidence in
    ('exact','likely','uncertain','conflict')),
  match_locked boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (variant_id, product_id)
    references public.mp_product_variants(id, product_id) on delete cascade,
  unique (supplier_id, variant_id)
);

create unique index if not exists mp_supplier_products_native_uidx
  on public.mp_supplier_products (
    supplier_id,
    supplier_product_id,
    coalesce(supplier_variant_id, '')
  );

create table if not exists public.mp_supplier_observations (
  id text primary key,
  supplier_product_id text not null
    references public.mp_supplier_products(id) on delete cascade,
  run_id text references public.mp_job_runs(id),
  observed_at timestamptz not null default timezone('utc', now()),
  supplier_public_price numeric(14,2),
  currency text not null default 'PKR',
  availability text not null default 'unknown'
    check (availability in ('in_stock','sold_out','backorder','unknown')),
  parse_status text not null default 'ok'
    check (parse_status in ('ok','malformed','missing')),
  raw_payload jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mp_price_overrides (
  id text primary key,
  product_id text not null,
  variant_id text not null,
  override_price numeric(14,2) not null check (override_price > 0),
  status text not null default 'active'
    check (status in ('active','superseded','revoked','expired')),
  mode text not null check (mode in ('permanent','time_limited')),
  starts_at timestamptz not null default timezone('utc', now()),
  ends_at timestamptz,
  reason text not null,
  created_by text not null,
  revoked_by text,
  revoked_at timestamptz,
  superseded_by text references public.mp_price_overrides(id),
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (variant_id, product_id)
    references public.mp_product_variants(id, product_id) on delete cascade,
  check (mode = 'permanent' or ends_at is not null)
);

create unique index if not exists mp_overrides_one_active_uidx
  on public.mp_price_overrides (variant_id) where status = 'active';

create table if not exists public.mp_price_history (
  id text primary key,
  product_id text not null references public.mp_products(id) on delete cascade,
  variant_id text not null,
  old_price numeric(14,2),
  new_price numeric(14,2),
  old_state text,
  new_state text,
  source text not null check (source in
    ('kamal','alladin','seed','override','last_approved')),
  changed_by text not null,
  reason text,
  override_id text,
  run_id text references public.mp_job_runs(id),
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (variant_id, product_id)
    references public.mp_product_variants(id, product_id) on delete cascade
);

create index if not exists mp_price_history_variant_idx
  on public.mp_price_history (variant_id, created_at desc);

create table if not exists public.mp_product_costs (
  id text primary key,
  product_id text not null,
  variant_id text not null,
  actual_purchase_cost numeric(14,2) not null check (actual_purchase_cost >= 0),
  currency text not null default 'PKR',
  effective_from timestamptz not null default timezone('utc', now()),
  effective_to timestamptz,
  set_by text not null,
  reason text,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (variant_id, product_id)
    references public.mp_product_variants(id, product_id) on delete cascade
);

-- =============================================================================
-- 3. Cart / orders / payments
-- =============================================================================
create table if not exists public.mp_carts (
  id text primary key,
  public_ref text not null unique,
  customer_id text,
  guest_token_hash text,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    (customer_id is not null and guest_token_hash is null)
    or (customer_id is null and guest_token_hash is not null)
  )
);

create table if not exists public.mp_cart_items (
  id text primary key,
  cart_id text not null references public.mp_carts(id) on delete cascade,
  product_id text not null,
  variant_id text not null,
  quantity integer not null check (quantity > 0),
  unit_price_snap numeric(14,2) not null check (unit_price_snap > 0),
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (variant_id, product_id)
    references public.mp_product_variants(id, product_id),
  unique (cart_id, variant_id)
);

create table if not exists public.mp_orders (
  id text primary key,
  public_ref text not null unique,
  order_number text not null unique,
  customer_id text,
  guest_token_hash text,
  status text not null default 'pending_payment'
    check (status in (
      'pending_payment','awaiting_verification','confirmed','processing',
      'dispatched','delivered','cancelled','refunded')),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  tax numeric(14,2) not null default 0 check (tax >= 0),
  grand_total numeric(14,2) not null check (grand_total >= 0),
  currency text not null default 'PKR',
  delivery_zone_id text references public.mp_delivery_zones(id),
  checkout_locked boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mp_orders_total_ck check (grand_total = subtotal + delivery_fee + tax),
  unique (id, grand_total)
);

create table if not exists public.mp_order_items (
  id text primary key,
  order_id text not null references public.mp_orders(id) on delete restrict,
  product_id text not null,
  variant_id text not null,
  title_snap text not null,
  sku_snap text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price > 0),
  line_total numeric(14,2) not null check (line_total = unit_price * quantity),
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (variant_id, product_id)
    references public.mp_product_variants(id, product_id)
);

create table if not exists public.mp_payment_plans (
  id text primary key,
  order_id text not null unique,
  plan_type text not null check (plan_type in
    ('full','partial_advance','token','token_plus_balance_cod','cod_eligible')),
  grand_total numeric(14,2) not null check (grand_total >= 0),
  upfront_amount numeric(14,2) not null default 0 check (upfront_amount >= 0),
  balance_due numeric(14,2) not null default 0 check (balance_due >= 0),
  balance_on_delivery boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint mp_plan_sum_ck check (upfront_amount + balance_due = grand_total),
  unique (id, order_id),
  foreign key (order_id, grand_total)
    references public.mp_orders(id, grand_total)
    on update cascade
    on delete restrict
);

create table if not exists public.mp_payments (
  id text primary key,
  order_id text not null references public.mp_orders(id) on delete restrict,
  payment_plan_id text not null,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('bank_transfer','cash_on_delivery')),
  status text not null default 'pending' check (status in
    ('pending','submitted','verified','collected','rejected','refunded')),
  reverses_payment_id text references public.mp_payments(id) on delete restrict,
  verified_by text,
  verified_at timestamptz,
  rejection_reason text,
  recorded_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (payment_plan_id, order_id)
    references public.mp_payment_plans(id, order_id)
    on delete restrict,
  constraint mp_payments_refund_shape_ck check (
    (status = 'refunded' and reverses_payment_id is not null)
    or (status <> 'refunded' and reverses_payment_id is null)
  )
);

create index if not exists mp_payments_order_idx on public.mp_payments (order_id);
create index if not exists mp_payments_status_idx on public.mp_payments (status);
create index if not exists mp_payments_reverses_idx
  on public.mp_payments (reverses_payment_id) where reverses_payment_id is not null;
create index if not exists mp_payments_refunds_by_original_idx
  on public.mp_payments (reverses_payment_id) where status = 'refunded';

-- =============================================================================
-- 4. Idempotency / upload intents / receipts
-- =============================================================================
create table if not exists public.mp_idempotency_keys (
  idempotency_key text not null,
  operation_type text not null,
  actor_scope text not null,
  ref text,
  request_hash text not null,
  state text not null default 'processing'
    check (state in ('processing','completed','failed_known')),
  result_ref text,
  result_payload jsonb,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  primary key (idempotency_key, operation_type, actor_scope),
  unique (idempotency_key, operation_type, actor_scope, request_hash)
);

create index if not exists mp_idempotency_processing_idx
  on public.mp_idempotency_keys (created_at) where state = 'processing';

create table if not exists public.mp_upload_intents (
  id text primary key,
  operation_type text not null,
  actor_scope text not null,
  order_id text not null references public.mp_orders(id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  storage_path text not null unique,
  status text not null default 'claimed'
    check (status in (
      'claimed','uploaded','attached','cleanup_pending','deleted','abandoned')),
  byte_size bigint,
  sha256 text,
  media_id text,
  payment_id text references public.mp_payments(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  uploaded_at timestamptz,
  attached_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (idempotency_key, operation_type, actor_scope),
  foreign key (idempotency_key, operation_type, actor_scope, request_hash)
    references public.mp_idempotency_keys
      (idempotency_key, operation_type, actor_scope, request_hash)
    on delete restrict,
  constraint mp_upload_intents_path_ck check (
    char_length(storage_path) between 2 and 200
    and storage_path ~ '^[a-z0-9][a-z0-9/_-]{1,180}$'
  )
);

create table if not exists public.mp_receipt_objects (
  id text primary key,
  media_id text not null unique references public.mp_media(id) on delete restrict,
  storage_path text not null unique,
  sha256 text not null,
  byte_size bigint not null check (byte_size > 0),
  upload_intent_id text not null unique
    references public.mp_upload_intents(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mp_receipts (
  id text primary key,
  media_id text not null unique references public.mp_media(id) on delete restrict,
  object_id text not null unique references public.mp_receipt_objects(id) on delete restrict,
  order_id text not null references public.mp_orders(id) on delete restrict,
  payment_id text not null unique references public.mp_payments(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now())
);

-- media_id FK on upload_intents (after mp_media exists; table already created)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mp_upload_intents_media_fk'
  ) then
    alter table public.mp_upload_intents
      add constraint mp_upload_intents_media_fk
      foreign key (media_id) references public.mp_media(id) on delete restrict;
  end if;
end $$;

create table if not exists public.mp_storage_cleanup_outbox (
  id text primary key,
  storage_path text not null,
  upload_intent_id text references public.mp_upload_intents(id),
  reason text not null,
  related_order_id text,
  related_idempotency_key text,
  status text not null default 'pending'
    check (status in ('pending','deleted','failed','abandoned')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_attempted_at timestamptz
);

create index if not exists mp_storage_cleanup_outbox_pending_idx
  on public.mp_storage_cleanup_outbox (created_at) where status = 'pending';

create table if not exists public.mp_price_alerts (
  id text primary key,
  run_id text references public.mp_job_runs(id),
  product_id text not null,
  variant_id text not null,
  alert_type text not null check (alert_type in
    ('stale','malformed','conflict','safety_breach','no_safe_price',
     'soldout','backorder','unknown_stock','supplier_evidence_gap')),
  severity text not null check (severity in ('info','warning','critical')),
  message text,
  resolved boolean not null default false,
  resolved_by text,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (variant_id, product_id)
    references public.mp_product_variants(id, product_id) on delete cascade
);

create table if not exists public.mp_audit_events (
  id text primary key,
  actor_scope text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  is_financial boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

-- =============================================================================
-- 5. Deferred FK attachments (§2.1 step 29)
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mp_price_history_override_fk'
  ) then
    alter table public.mp_price_history
      add constraint mp_price_history_override_fk
      foreign key (override_id) references public.mp_price_overrides(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'mp_media_product_fk'
  ) then
    alter table public.mp_media
      add constraint mp_media_product_fk
      foreign key (product_id) references public.mp_products(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'mp_media_variant_product_fk'
  ) then
    alter table public.mp_media
      add constraint mp_media_variant_product_fk
      foreign key (variant_id, product_id)
      references public.mp_product_variants(id, product_id)
      on delete cascade
      deferrable initially deferred;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'mp_brands_logo_media_fk'
  ) then
    alter table public.mp_brands
      add constraint mp_brands_logo_media_fk
      foreign key (logo_media_id) references public.mp_media(id) on delete set null;
  end if;
end $$;

-- =============================================================================
-- 6. Foundation seeds (suppliers + pricing config only — not 30 products)
-- =============================================================================
insert into public.mp_suppliers (id, code, name, priority, active)
values
  ('mpsup_kamal', 'kamal', 'Kamal', 1, true),
  ('mpsup_alladin', 'alladin', 'Alladin', 2, true)
on conflict (id) do nothing;

insert into public.mp_pricing_config (
  company_id, max_increase_pct, max_decrease_pct, staleness_hours,
  allow_soldout_reference, min_token_pct, max_token_pct,
  min_advance_pct, max_advance_pct, cod_max_order_value
) values (
  'sunchaser', 15, 25, 36, false, 10, 40, 20, 70, 250000
)
on conflict (company_id) do nothing;

-- =============================================================================
-- 7. Trigger functions
-- =============================================================================
create or replace function public.mp_reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'mp_reject_mutation: % is append-only (no %)', tg_table_name, tg_op
    using errcode = 'check_violation';
end;
$$;

create or replace function public.mp_media_publish_gate_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'receipt' and new.published = true then
    raise exception 'receipt media cannot be published' using errcode = 'check_violation';
  end if;
  if new.published = true then
    if new.rights_status not in ('own', 'licensed', 'supplier_approved') then
      raise exception 'media publish requires confirmed rights_status' using errcode = 'check_violation';
    end if;
    if new.approved_by is null or new.approved_at is null then
      raise exception 'media publish requires approved_by/approved_at' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.mp_media_receipt_immutable_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'receipt'
     or exists (select 1 from public.mp_receipts r where r.media_id = old.id)
     or exists (select 1 from public.mp_receipt_objects o where o.media_id = old.id)
  then
    if new.role is distinct from old.role
       or new.published is distinct from old.published
       or new.product_id is distinct from old.product_id
       or new.variant_id is distinct from old.variant_id
       or new.storage_path is distinct from old.storage_path
    then
      raise exception 'receipt media bindings are immutable' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.mp_media_receipt_nodelete_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.mp_receipts r where r.media_id = old.id)
     or exists (select 1 from public.mp_receipt_objects o where o.media_id = old.id)
  then
    raise exception 'cannot delete receipt-bound media' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create or replace function public.mp_receipts_append_only_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'mp_receipts is append-only (UPDATE blocked)' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.mp_payments p where p.id = old.payment_id) then
      raise exception 'cannot delete receipt while payment exists' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  return null;
end;
$$;

create or replace function public.mp_receipts_integrity_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_media public.mp_media%rowtype;
  v_object public.mp_receipt_objects%rowtype;
  v_payment public.mp_payments%rowtype;
  v_intent public.mp_upload_intents%rowtype;
begin
  select * into v_media from public.mp_media where id = new.media_id;
  if not found then
    raise exception 'receipt media not found' using errcode = 'foreign_key_violation';
  end if;
  if v_media.role <> 'receipt'
     or v_media.published = true
     or v_media.product_id is not null
     or v_media.variant_id is not null
  then
    raise exception 'receipt media scope invalid' using errcode = 'check_violation';
  end if;

  select * into v_object from public.mp_receipt_objects where id = new.object_id;
  if not found then
    raise exception 'receipt object not found' using errcode = 'foreign_key_violation';
  end if;
  if v_object.media_id is distinct from new.media_id then
    raise exception 'receipt_object.media_id must equal receipt.media_id'
      using errcode = 'check_violation';
  end if;
  if v_object.storage_path is distinct from v_media.storage_path then
    raise exception 'receipt_object.storage_path must equal media.storage_path'
      using errcode = 'check_violation';
  end if;

  select * into v_payment from public.mp_payments where id = new.payment_id;
  if not found then
    raise exception 'receipt payment not found' using errcode = 'foreign_key_violation';
  end if;
  if v_payment.order_id is distinct from new.order_id then
    raise exception 'payment.order_id must equal receipt.order_id'
      using errcode = 'check_violation';
  end if;

  select * into v_intent from public.mp_upload_intents where id = v_object.upload_intent_id;
  if not found then
    raise exception 'upload intent not found for receipt object'
      using errcode = 'foreign_key_violation';
  end if;
  if v_intent.storage_path is distinct from v_media.storage_path then
    raise exception 'upload intent storage_path must equal media.storage_path'
      using errcode = 'check_violation';
  end if;
  if v_intent.order_id is distinct from new.order_id then
    raise exception 'upload intent order_id mismatch' using errcode = 'check_violation';
  end if;
  if v_intent.operation_type <> 'bank_transfer_receipt' then
    raise exception 'upload intent operation_type must be bank_transfer_receipt'
      using errcode = 'check_violation';
  end if;
  if v_intent.status <> 'attached' or v_intent.payment_id is distinct from new.payment_id then
    raise exception 'upload intent must be attached to this payment before receipt insert'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.mp_payment_plans_grand_total_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order_total numeric(14,2);
begin
  select grand_total into v_order_total
  from public.mp_orders
  where id = new.order_id;
  if v_order_total is distinct from new.grand_total then
    raise exception 'payment plan grand_total must equal order grand_total'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.mp_orders_totals_immutable_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.checkout_locked
     and (
       new.subtotal is distinct from old.subtotal
       or new.delivery_fee is distinct from old.delivery_fee
       or new.tax is distinct from old.tax
       or new.grand_total is distinct from old.grand_total
     )
     and coalesce(current_setting('mp.allow_order_total_correction', true), '') <> 'on'
  then
    raise exception 'order totals are immutable after checkout_locked'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.mp_variants_price_guard_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (
       new.website_price is distinct from old.website_price
       or new.website_price_state is distinct from old.website_price_state
       or new.website_price_source is distinct from old.website_price_source
       or new.price_published_at is distinct from old.price_published_at
     )
     and coalesce(current_setting('mp.allow_price_write', true), '') <> 'on'
  then
    raise exception 'variant website_price columns are RPC-guarded'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.mp_payments_refund_cap_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_original public.mp_payments%rowtype;
  v_refunded numeric(14,2);
begin
  if new.status <> 'refunded' then
    return new;
  end if;
  select * into v_original
  from public.mp_payments
  where id = new.reverses_payment_id
  for update;
  if not found then
    raise exception 'refund original payment not found' using errcode = 'foreign_key_violation';
  end if;
  if v_original.order_id is distinct from new.order_id then
    raise exception 'refund must be same order' using errcode = 'check_violation';
  end if;
  if v_original.status not in ('verified', 'collected') then
    raise exception 'refund original must be verified or collected'
      using errcode = 'check_violation';
  end if;
  if v_original.status = 'refunded' or v_original.reverses_payment_id is not null then
    raise exception 'cannot refund a refund' using errcode = 'check_violation';
  end if;
  select coalesce(sum(amount), 0) into v_refunded
  from public.mp_payments
  where reverses_payment_id = new.reverses_payment_id
    and status = 'refunded';
  if v_refunded + new.amount > v_original.amount then
    raise exception 'refund cumulative cap exceeded' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.mp_upload_intents_claim_fk_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.mp_idempotency_keys k
    where k.idempotency_key = new.idempotency_key
      and k.operation_type = new.operation_type
      and k.actor_scope = new.actor_scope
      and k.request_hash = new.request_hash
  ) then
    raise exception 'upload intent must match idempotency claim'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

-- Drop/recreate triggers (idempotent)
drop trigger if exists mp_audit_events_reject_mutation on public.mp_audit_events;
create trigger mp_audit_events_reject_mutation
  before update or delete on public.mp_audit_events
  for each row execute function public.mp_reject_mutation();

drop trigger if exists mp_price_history_reject_mutation on public.mp_price_history;
create trigger mp_price_history_reject_mutation
  before update or delete on public.mp_price_history
  for each row execute function public.mp_reject_mutation();

drop trigger if exists mp_supplier_observations_reject_mutation on public.mp_supplier_observations;
create trigger mp_supplier_observations_reject_mutation
  before update or delete on public.mp_supplier_observations
  for each row execute function public.mp_reject_mutation();

drop trigger if exists mp_order_items_reject_mutation on public.mp_order_items;
create trigger mp_order_items_reject_mutation
  before update or delete on public.mp_order_items
  for each row execute function public.mp_reject_mutation();

drop trigger if exists mp_receipt_objects_reject_mutation on public.mp_receipt_objects;
create trigger mp_receipt_objects_reject_mutation
  before update or delete on public.mp_receipt_objects
  for each row execute function public.mp_reject_mutation();

drop trigger if exists mp_media_publish_gate_trg on public.mp_media;
create trigger mp_media_publish_gate_trg
  before insert or update on public.mp_media
  for each row execute function public.mp_media_publish_gate_fn();

drop trigger if exists mp_media_receipt_immutable_trg on public.mp_media;
create trigger mp_media_receipt_immutable_trg
  before update on public.mp_media
  for each row execute function public.mp_media_receipt_immutable_fn();

drop trigger if exists mp_media_receipt_nodelete_trg on public.mp_media;
create trigger mp_media_receipt_nodelete_trg
  before delete on public.mp_media
  for each row execute function public.mp_media_receipt_nodelete_fn();

drop trigger if exists mp_receipts_append_only_trg on public.mp_receipts;
create trigger mp_receipts_append_only_trg
  before update or delete on public.mp_receipts
  for each row execute function public.mp_receipts_append_only_fn();

drop trigger if exists mp_receipts_integrity_trg on public.mp_receipts;
create trigger mp_receipts_integrity_trg
  before insert on public.mp_receipts
  for each row execute function public.mp_receipts_integrity_fn();

drop trigger if exists mp_payment_plans_grand_total_trg on public.mp_payment_plans;
create trigger mp_payment_plans_grand_total_trg
  before insert or update on public.mp_payment_plans
  for each row execute function public.mp_payment_plans_grand_total_fn();

drop trigger if exists mp_orders_totals_immutable_trg on public.mp_orders;
create trigger mp_orders_totals_immutable_trg
  before update on public.mp_orders
  for each row execute function public.mp_orders_totals_immutable_fn();

drop trigger if exists mp_variants_price_guard_trg on public.mp_product_variants;
create trigger mp_variants_price_guard_trg
  before update on public.mp_product_variants
  for each row execute function public.mp_variants_price_guard_fn();

drop trigger if exists mp_payments_refund_cap_trg on public.mp_payments;
create trigger mp_payments_refund_cap_trg
  before insert on public.mp_payments
  for each row execute function public.mp_payments_refund_cap_fn();

drop trigger if exists mp_upload_intents_claim_fk_trg on public.mp_upload_intents;
create trigger mp_upload_intents_claim_fk_trg
  before insert or update on public.mp_upload_intents
  for each row execute function public.mp_upload_intents_claim_fk_fn();

-- =============================================================================
-- 8. SECURITY DEFINER RPCs (foundations)
-- =============================================================================

create or replace function public.mp_write_audit(
  p_actor_scope text,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_is_financial boolean,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if p_actor_scope is null or length(trim(p_actor_scope)) = 0 then
    raise exception 'actor_scope required' using errcode = 'check_violation';
  end if;
  if p_is_financial and (p_payload is null) then
    raise exception 'financial audit payload required' using errcode = 'check_violation';
  end if;
  v_id := public.mp_new_id('mpaud');
  insert into public.mp_audit_events (
    id, actor_scope, action, entity_type, entity_id, is_financial, payload
  ) values (
    v_id, p_actor_scope, p_action, p_entity_type, p_entity_id,
    coalesce(p_is_financial, false), coalesce(p_payload, '{}'::jsonb)
  );
  return v_id;
end;
$$;

create or replace function public.mp_idempotency_preflight(
  p_idempotency_key text,
  p_operation_type text,
  p_actor_scope text,
  p_request_hash text,
  p_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.mp_idempotency_keys%rowtype;
  v_inserted public.mp_idempotency_keys%rowtype;
  v_stale_seconds integer := 300;
  v_env text;
  v_claimed boolean := false;
begin
  if p_idempotency_key is null or p_operation_type is null
     or p_actor_scope is null or p_request_hash is null then
    raise exception 'idempotency preflight requires key/type/scope/hash'
      using errcode = 'check_violation';
  end if;
  if position('client:' in p_actor_scope) = 1 then
    raise exception 'client-supplied actor_scope rejected' using errcode = 'check_violation';
  end if;
  if p_actor_scope not like 'customer:%' and p_actor_scope not like 'guest:%'
     and p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'actor_scope must be server-derived prefix' using errcode = 'check_violation';
  end if;

  begin
    v_env := current_setting('mp.idempotency_stale_seconds', true);
    if v_env is not null and v_env <> '' then
      v_stale_seconds := greatest(30, v_env::integer);
    end if;
  exception when others then
    v_stale_seconds := 300;
  end;

  -- Atomic first claim. Swallow unique_violation from PK or hash unique index
  -- so concurrent identical callers never see a raw constraint error.
  begin
    insert into public.mp_idempotency_keys (
      idempotency_key, operation_type, actor_scope, ref, request_hash, state
    ) values (
      p_idempotency_key, p_operation_type, p_actor_scope, p_ref, p_request_hash, 'processing'
    )
    returning * into v_inserted;
    v_claimed := true;
  exception
    when unique_violation then
      v_claimed := false;
  end;

  if v_claimed then
    return jsonb_build_object('status', 'NEW_REQUEST', 'reclaimed', false);
  end if;

  select * into v_row
  from public.mp_idempotency_keys
  where idempotency_key = p_idempotency_key
    and operation_type = p_operation_type
    and actor_scope = p_actor_scope
  for update;

  if not found then
    begin
      insert into public.mp_idempotency_keys (
        idempotency_key, operation_type, actor_scope, ref, request_hash, state
      ) values (
        p_idempotency_key, p_operation_type, p_actor_scope, p_ref, p_request_hash, 'processing'
      )
      returning * into v_inserted;
      return jsonb_build_object('status', 'NEW_REQUEST', 'reclaimed', false);
    exception
      when unique_violation then
        select * into v_row
        from public.mp_idempotency_keys
        where idempotency_key = p_idempotency_key
          and operation_type = p_operation_type
          and actor_scope = p_actor_scope
        for update;
    end;
  end if;

  if v_row.request_hash is distinct from p_request_hash then
    return jsonb_build_object(
      'status', 'REQUEST_HASH_CONFLICT',
      'result_payload', v_row.result_payload
    );
  end if;
  if v_row.state = 'completed' then
    return jsonb_build_object(
      'status', 'COMPLETED_REPLAY',
      'result_ref', v_row.result_ref,
      'result_payload', v_row.result_payload
    );
  end if;
  if v_row.state = 'failed_known' then
    return jsonb_build_object(
      'status', 'FAILED_KNOWN_REPLAY',
      'result_ref', v_row.result_ref,
      'result_payload', v_row.result_payload,
      'last_error_code', v_row.last_error_code,
      'last_error_message', v_row.last_error_message
    );
  end if;
  if v_row.state = 'processing'
     and v_row.created_at > timezone('utc', now()) - make_interval(secs => v_stale_seconds)
  then
    return jsonb_build_object('status', 'IN_PROGRESS');
  end if;

  update public.mp_idempotency_keys
  set ref = p_ref,
      state = 'processing',
      result_ref = null,
      result_payload = null,
      last_error_code = null,
      last_error_message = null,
      completed_at = null,
      created_at = timezone('utc', now())
  where idempotency_key = p_idempotency_key
    and operation_type = p_operation_type
    and actor_scope = p_actor_scope;
  return jsonb_build_object('status', 'NEW_REQUEST', 'reclaimed', true);
end;
$$;

create or replace function public.mp_create_upload_intent(
  p_order_id text,
  p_operation_type text,
  p_actor_scope text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.mp_orders%rowtype;
  v_claim public.mp_idempotency_keys%rowtype;
  v_existing public.mp_upload_intents%rowtype;
  v_id text;
  v_path text;
  v_order_hash text;
begin
  if p_operation_type is distinct from 'bank_transfer_receipt' then
    raise exception 'unsupported upload operation_type' using errcode = 'check_violation';
  end if;
  if p_actor_scope not like 'customer:%' and p_actor_scope not like 'guest:%'
     and p_actor_scope not like 'admin:%' then
    raise exception 'actor_scope must be server-derived' using errcode = 'check_violation';
  end if;

  select * into v_order from public.mp_orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'no_data_found';
  end if;

  select * into v_claim
  from public.mp_idempotency_keys
  where idempotency_key = p_idempotency_key
    and operation_type = p_operation_type
    and actor_scope = p_actor_scope
    and request_hash = p_request_hash
  for update;
  if not found or v_claim.state <> 'processing' then
    raise exception 'upload intent requires matching processing idempotency claim'
      using errcode = 'check_violation';
  end if;

  select * into v_existing
  from public.mp_upload_intents
  where idempotency_key = p_idempotency_key
    and operation_type = p_operation_type
    and actor_scope = p_actor_scope;
  if found then
    return jsonb_build_object(
      'ok', true,
      'upload_intent_id', v_existing.id,
      'storage_path', v_existing.storage_path,
      'status', v_existing.status,
      'replay', true
    );
  end if;

  v_id := public.mp_new_id('mpui');
  v_order_hash := substr(
    encode(public.digest(convert_to(p_order_id, 'UTF8'), 'sha256'), 'hex'),
    1,
    12
  );
  v_path := 'mp-receipts/' || v_order_hash || '/' || v_id;

  insert into public.mp_upload_intents (
    id, operation_type, actor_scope, order_id,
    idempotency_key, request_hash, storage_path, status
  ) values (
    v_id, p_operation_type, p_actor_scope, p_order_id,
    p_idempotency_key, p_request_hash, v_path, 'claimed'
  );

  return jsonb_build_object(
    'ok', true,
    'upload_intent_id', v_id,
    'storage_path', v_path,
    'status', 'claimed',
    'replay', false
  );
end;
$$;

create or replace function public.mp_checkout(
  p_actor_scope text,
  p_public_ref text,
  p_order_number text,
  p_customer_id text,
  p_guest_token_hash text,
  p_subtotal numeric,
  p_delivery_fee numeric,
  p_tax numeric,
  p_delivery_zone_id text,
  p_plan_type text,
  p_upfront_amount numeric,
  p_balance_due numeric,
  p_balance_on_delivery boolean,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id text;
  v_plan_id text;
  v_variant public.mp_product_variants%rowtype;
  v_zone public.mp_delivery_zones%rowtype;
  v_cfg public.mp_pricing_config%rowtype;
  v_calc_subtotal numeric(14,2) := 0;
  v_grand numeric(14,2);
  v_payment_id text;
  v_line record;
begin
  if p_actor_scope is null or length(trim(p_actor_scope)) = 0 then
    raise exception 'actor_scope required' using errcode = 'check_violation';
  end if;
  if p_actor_scope like 'client:%' then
    raise exception 'client-supplied actor_scope rejected' using errcode = 'check_violation';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'checkout requires items' using errcode = 'check_violation';
  end if;
  if coalesce(p_delivery_fee, 0) < 0 or coalesce(p_tax, 0) < 0 then
    raise exception 'delivery_fee and tax must be non-negative' using errcode = 'check_violation';
  end if;

  -- Deterministically combine duplicate variants; validate positive integer quantities.
  for v_line in
    select
      e.item->>'product_id' as product_id,
      e.item->>'variant_id' as variant_id,
      sum((e.item->>'quantity')::numeric) as quantity
    from jsonb_array_elements(p_items) with ordinality as e(item, ord)
    group by e.item->>'product_id', e.item->>'variant_id'
    order by min(e.ord)
  loop
    if v_line.variant_id is null or v_line.product_id is null then
      raise exception 'checkout item missing product/variant' using errcode = 'check_violation';
    end if;
    if v_line.quantity is null
       or v_line.quantity <= 0
       or v_line.quantity <> trunc(v_line.quantity)
    then
      raise exception 'checkout quantity must be a positive integer'
        using errcode = 'check_violation';
    end if;

    select * into v_variant
    from public.mp_product_variants
    where id = v_line.variant_id
      and product_id = v_line.product_id
    for update;
    if not found then
      raise exception 'checkout item variant/product mismatch' using errcode = 'check_violation';
    end if;
    if not v_variant.active
       or not v_variant.is_priceable
       or v_variant.stock_status <> 'in_stock'
       or v_variant.website_price is null
       or v_variant.website_price_state = 'confirm_price'
    then
      raise exception 'variant not purchasable' using errcode = 'check_violation';
    end if;

    v_calc_subtotal := v_calc_subtotal
      + (v_variant.website_price * v_line.quantity::integer);
  end loop;

  if p_subtotal is distinct from v_calc_subtotal then
    raise exception 'checkout subtotal mismatch: proposed % calculated %',
      p_subtotal, v_calc_subtotal
      using errcode = 'check_violation';
  end if;

  v_grand := v_calc_subtotal + coalesce(p_delivery_fee, 0) + coalesce(p_tax, 0);
  if coalesce(p_upfront_amount, 0) + coalesce(p_balance_due, 0) <> v_grand then
    raise exception 'plan amounts must sum to grand_total' using errcode = 'check_violation';
  end if;

  if p_plan_type in ('cod_eligible', 'token_plus_balance_cod') then
    if p_delivery_zone_id is null then
      raise exception 'COD requires delivery_zone_id' using errcode = 'check_violation';
    end if;
    select * into v_zone
    from public.mp_delivery_zones
    where id = p_delivery_zone_id
    for update;
    if not found or not v_zone.active or not v_zone.cod_eligible then
      raise exception 'delivery zone not COD-eligible' using errcode = 'check_violation';
    end if;
    select * into v_cfg from public.mp_pricing_config where company_id = 'sunchaser';
    if v_cfg.cod_max_order_value is not null and v_grand > v_cfg.cod_max_order_value then
      raise exception 'order exceeds COD max order value' using errcode = 'check_violation';
    end if;
  end if;

  v_order_id := public.mp_new_id('mpord');
  insert into public.mp_orders (
    id, public_ref, order_number, customer_id, guest_token_hash, status,
    subtotal, delivery_fee, tax, grand_total, delivery_zone_id, checkout_locked
  ) values (
    v_order_id, p_public_ref, p_order_number, p_customer_id, p_guest_token_hash,
    'pending_payment',
    v_calc_subtotal, coalesce(p_delivery_fee, 0), coalesce(p_tax, 0), v_grand,
    p_delivery_zone_id, true
  );

  for v_line in
    select
      e.item->>'product_id' as product_id,
      e.item->>'variant_id' as variant_id,
      sum((e.item->>'quantity')::numeric)::integer as quantity,
      max(e.item->>'title_snap') as title_snap
    from jsonb_array_elements(p_items) with ordinality as e(item, ord)
    group by e.item->>'product_id', e.item->>'variant_id'
    order by min(e.ord)
  loop
    select * into v_variant
    from public.mp_product_variants
    where id = v_line.variant_id and product_id = v_line.product_id;

    insert into public.mp_order_items (
      id, order_id, product_id, variant_id, title_snap, sku_snap,
      quantity, unit_price, line_total
    ) values (
      public.mp_new_id('mpoi'),
      v_order_id,
      v_variant.product_id,
      v_variant.id,
      coalesce(nullif(v_line.title_snap, ''), v_variant.title),
      v_variant.sku,
      v_line.quantity,
      v_variant.website_price,
      v_variant.website_price * v_line.quantity
    );
  end loop;

  v_plan_id := public.mp_new_id('mpplan');
  insert into public.mp_payment_plans (
    id, order_id, plan_type, grand_total, upfront_amount, balance_due, balance_on_delivery
  ) values (
    v_plan_id, v_order_id, p_plan_type, v_grand,
    coalesce(p_upfront_amount, 0), coalesce(p_balance_due, 0),
    coalesce(p_balance_on_delivery, false)
  );

  if p_plan_type in ('cod_eligible', 'token_plus_balance_cod') and coalesce(p_balance_due, 0) > 0 then
    v_payment_id := public.mp_new_id('mppay');
    insert into public.mp_payments (
      id, order_id, payment_plan_id, amount, method, status, recorded_by
    ) values (
      v_payment_id, v_order_id, v_plan_id, p_balance_due, 'cash_on_delivery',
      'pending', p_actor_scope
    );
  end if;

  perform public.mp_write_audit(
    p_actor_scope, 'checkout', 'mp_orders', v_order_id, true,
    jsonb_build_object(
      'plan_id', v_plan_id,
      'grand_total', v_grand,
      'plan_type', p_plan_type,
      'subtotal', v_calc_subtotal,
      'delivery_fee', coalesce(p_delivery_fee, 0)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'payment_plan_id', v_plan_id,
    'public_ref', p_public_ref,
    'grand_total', v_grand,
    'subtotal', v_calc_subtotal
  );
end;
$$;

create or replace function public.mp_record_payment(
  p_actor_scope text,
  p_order_id text,
  p_upload_intent_id text,
  p_amount numeric,
  p_sha256 text,
  p_byte_size bigint,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.mp_orders%rowtype;
  v_plan public.mp_payment_plans%rowtype;
  v_intent public.mp_upload_intents%rowtype;
  v_payment_id text;
  v_media_id text;
  v_object_id text;
  v_receipt_id text;
  v_net numeric(14,2);
  v_sha text;
begin
  if p_actor_scope like 'client:%' then
    raise exception 'client-supplied actor_scope rejected' using errcode = 'check_violation';
  end if;

  v_sha := lower(trim(coalesce(p_sha256, '')));

  select * into v_order from public.mp_orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'no_data_found';
  end if;

  select * into v_intent
  from public.mp_upload_intents
  where id = p_upload_intent_id
  for update;
  if not found or v_intent.order_id is distinct from p_order_id then
    raise exception 'upload intent/order mismatch' using errcode = 'check_violation';
  end if;
  if v_intent.operation_type is distinct from 'bank_transfer_receipt' then
    raise exception 'upload intent operation_type must be bank_transfer_receipt'
      using errcode = 'check_violation';
  end if;
  if v_intent.status is distinct from 'uploaded' then
    raise exception 'upload intent must be in uploaded status (got %)', v_intent.status
      using errcode = 'check_violation';
  end if;
  if v_intent.idempotency_key is distinct from p_idempotency_key
     or v_intent.request_hash is distinct from p_request_hash
     or v_intent.actor_scope is distinct from p_actor_scope
  then
    raise exception 'upload intent idempotency mismatch' using errcode = 'check_violation';
  end if;
  if v_intent.sha256 is null or v_intent.byte_size is null then
    raise exception 'upload intent missing uploaded evidence' using errcode = 'check_violation';
  end if;
  if v_sha is distinct from lower(trim(v_intent.sha256))
     or p_byte_size is distinct from v_intent.byte_size
  then
    raise exception 'upload evidence mismatch vs marked upload'
      using errcode = 'check_violation';
  end if;

  if v_order.status <> 'pending_payment' then
    update public.mp_idempotency_keys
    set state = 'failed_known',
        last_error_code = 'ORDER_STATUS',
        last_error_message = 'order not pending_payment',
        completed_at = timezone('utc', now()),
        result_payload = jsonb_build_object('ok', false, 'error', 'ORDER_STATUS')
    where idempotency_key = p_idempotency_key
      and operation_type = 'bank_transfer_receipt'
      and actor_scope = p_actor_scope
      and request_hash = p_request_hash;
    update public.mp_upload_intents
    set status = 'cleanup_pending', updated_at = timezone('utc', now())
    where id = p_upload_intent_id and status = 'uploaded';
    insert into public.mp_storage_cleanup_outbox (
      id, storage_path, upload_intent_id, reason, related_order_id, related_idempotency_key
    )
    select public.mp_new_id('mpclo'), storage_path, id, 'failed_known_unattached',
           order_id, idempotency_key
    from public.mp_upload_intents where id = p_upload_intent_id;
    return jsonb_build_object('ok', false, 'error', 'ORDER_STATUS');
  end if;

  select * into v_plan from public.mp_payment_plans where order_id = p_order_id;
  perform 1 from public.mp_payments where order_id = p_order_id for update;

  select coalesce(sum(case when status in ('verified','collected') then amount else 0 end), 0)
       - coalesce(sum(case when status = 'refunded' then amount else 0 end), 0)
    into v_net
  from public.mp_payments where order_id = p_order_id;
  if v_net + p_amount > v_order.grand_total then
    update public.mp_idempotency_keys
    set state = 'failed_known',
        last_error_code = 'OVERPAY',
        last_error_message = 'amount exceeds outstanding',
        completed_at = timezone('utc', now()),
        result_payload = jsonb_build_object('ok', false, 'error', 'OVERPAY')
    where idempotency_key = p_idempotency_key
      and operation_type = 'bank_transfer_receipt'
      and actor_scope = p_actor_scope;
    return jsonb_build_object('ok', false, 'error', 'OVERPAY');
  end if;

  v_payment_id := public.mp_new_id('mppay');
  insert into public.mp_payments (
    id, order_id, payment_plan_id, amount, method, status, recorded_by
  ) values (
    v_payment_id, p_order_id, v_plan.id, p_amount, 'bank_transfer', 'submitted', p_actor_scope
  );

  v_media_id := public.mp_new_id('mpmed');
  insert into public.mp_media (
    id, product_id, variant_id, storage_path, role, source_type, rights_status, published
  ) values (
    v_media_id, null, null, v_intent.storage_path, 'receipt', 'user_upload', 'unknown', false
  );

  -- Receipt-object metadata from locked upload-intent evidence (not caller overwrite).
  v_object_id := v_media_id;
  insert into public.mp_receipt_objects (
    id, media_id, storage_path, sha256, byte_size, upload_intent_id
  ) values (
    v_object_id,
    v_media_id,
    v_intent.storage_path,
    lower(trim(v_intent.sha256)),
    v_intent.byte_size,
    p_upload_intent_id
  );

  update public.mp_upload_intents
  set status = 'attached',
      media_id = v_media_id,
      payment_id = v_payment_id,
      attached_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_upload_intent_id
    and status = 'uploaded';
  -- Preserve sha256/byte_size/uploaded_at exactly as marked.

  v_receipt_id := public.mp_new_id('mprct');
  insert into public.mp_receipts (id, media_id, object_id, order_id, payment_id)
  values (v_receipt_id, v_media_id, v_object_id, p_order_id, v_payment_id);

  update public.mp_orders
  set status = 'awaiting_verification', updated_at = timezone('utc', now())
  where id = p_order_id;

  update public.mp_idempotency_keys
  set state = 'completed',
      result_ref = v_payment_id,
      result_payload = jsonb_build_object(
        'ok', true, 'payment_id', v_payment_id, 'receipt_id', v_receipt_id
      ),
      completed_at = timezone('utc', now())
  where idempotency_key = p_idempotency_key
    and operation_type = 'bank_transfer_receipt'
    and actor_scope = p_actor_scope;

  perform public.mp_write_audit(
    p_actor_scope, 'record_payment', 'mp_payments', v_payment_id, true,
    jsonb_build_object(
      'order_id', p_order_id, 'amount', p_amount, 'receipt_id', v_receipt_id,
      'upload_intent_id', p_upload_intent_id,
      'sha256', lower(trim(v_intent.sha256)),
      'byte_size', v_intent.byte_size
    )
  );

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'receipt_id', v_receipt_id,
    'media_id', v_media_id
  );
end;
$$;

create or replace function public.mp_verify_payment(
  p_actor_scope text,
  p_payment_id text,
  p_verified_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.mp_payments%rowtype;
  v_order public.mp_orders%rowtype;
  v_net numeric(14,2);
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'verify requires admin/system actor_scope' using errcode = 'check_violation';
  end if;
  select * into v_payment from public.mp_payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment not found' using errcode = 'no_data_found';
  end if;
  if v_payment.method <> 'bank_transfer' or v_payment.status <> 'submitted' then
    raise exception 'payment not verifiable' using errcode = 'check_violation';
  end if;
  select * into v_order from public.mp_orders where id = v_payment.order_id for update;

  update public.mp_payments
  set status = 'verified',
      verified_by = p_verified_by,
      verified_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_payment_id;

  select coalesce(sum(case when status in ('verified','collected') then amount else 0 end), 0)
       - coalesce(sum(case when status = 'refunded' then amount else 0 end), 0)
    into v_net
  from public.mp_payments where order_id = v_order.id;
  if v_net > v_order.grand_total then
    raise exception 'net paid exceeds grand_total' using errcode = 'check_violation';
  end if;

  update public.mp_orders
  set status = 'confirmed', updated_at = timezone('utc', now())
  where id = v_order.id;

  perform public.mp_write_audit(
    p_actor_scope, 'verify_payment', 'mp_payments', p_payment_id, true,
    jsonb_build_object('order_id', v_order.id, 'verified_by', p_verified_by)
  );
  return jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'order_status', 'confirmed');
end;
$$;

create or replace function public.mp_collect_cod_payment(
  p_actor_scope text,
  p_payment_id text,
  p_collected_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.mp_payments%rowtype;
  v_order public.mp_orders%rowtype;
  v_net numeric(14,2);
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'collect requires admin/system actor_scope' using errcode = 'check_violation';
  end if;

  select * into v_payment
  from public.mp_payments
  where id = p_payment_id
  for update;
  if not found or v_payment.method <> 'cash_on_delivery' or v_payment.status <> 'pending' then
    raise exception 'COD payment not collectable' using errcode = 'check_violation';
  end if;

  select * into v_order
  from public.mp_orders
  where id = v_payment.order_id
  for update;
  if not found then
    raise exception 'order not found' using errcode = 'no_data_found';
  end if;

  -- Serialize concurrent payment mutations on this order.
  perform 1 from public.mp_payments where order_id = v_order.id for update;

  select coalesce(sum(case when status in ('verified','collected') then amount else 0 end), 0)
       - coalesce(sum(case when status = 'refunded' then amount else 0 end), 0)
    into v_net
  from public.mp_payments
  where order_id = v_order.id;

  if v_net + v_payment.amount > v_order.grand_total then
    raise exception 'COD collection would exceed order grand_total'
      using errcode = 'check_violation';
  end if;

  update public.mp_payments
  set status = 'collected',
      verified_by = p_collected_by,
      verified_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_payment_id
    and status = 'pending';
  if not found then
    raise exception 'COD payment not collectable' using errcode = 'check_violation';
  end if;

  update public.mp_orders
  set status = 'delivered', updated_at = timezone('utc', now())
  where id = v_order.id;

  perform public.mp_write_audit(
    p_actor_scope, 'collect_cod', 'mp_payments', p_payment_id, true,
    jsonb_build_object(
      'order_id', v_order.id,
      'collected_by', p_collected_by,
      'amount', v_payment.amount,
      'net_paid_before', v_net
    )
  );
  return jsonb_build_object('ok', true, 'payment_id', p_payment_id);
end;
$$;

create or replace function public.mp_cancel_cod_payment(
  p_actor_scope text,
  p_payment_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.mp_payments%rowtype;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'cancel COD requires admin/system actor_scope' using errcode = 'check_violation';
  end if;
  select * into v_payment from public.mp_payments where id = p_payment_id for update;
  if not found or v_payment.method <> 'cash_on_delivery' or v_payment.status <> 'pending' then
    raise exception 'COD payment not cancellable' using errcode = 'check_violation';
  end if;
  update public.mp_payments
  set status = 'rejected', rejection_reason = p_reason, updated_at = timezone('utc', now())
  where id = p_payment_id;
  update public.mp_orders
  set status = 'cancelled', updated_at = timezone('utc', now())
  where id = v_payment.order_id;
  perform public.mp_write_audit(
    p_actor_scope, 'cancel_cod', 'mp_payments', p_payment_id, true,
    jsonb_build_object('order_id', v_payment.order_id, 'reason', p_reason)
  );
  return jsonb_build_object('ok', true, 'payment_id', p_payment_id);
end;
$$;

create or replace function public.mp_refund_payment(
  p_actor_scope text,
  p_original_payment_id text,
  p_amount numeric,
  p_recorded_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.mp_payments%rowtype;
  v_order public.mp_orders%rowtype;
  v_refund_id text;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'refund requires admin/system actor_scope' using errcode = 'check_violation';
  end if;
  select * into v_original from public.mp_payments where id = p_original_payment_id for update;
  if not found then
    raise exception 'original payment not found' using errcode = 'no_data_found';
  end if;
  select * into v_order from public.mp_orders where id = v_original.order_id for update;

  v_refund_id := public.mp_new_id('mppay');
  insert into public.mp_payments (
    id, order_id, payment_plan_id, amount, method, status,
    reverses_payment_id, recorded_by
  ) values (
    v_refund_id, v_original.order_id, v_original.payment_plan_id, p_amount,
    v_original.method, 'refunded', p_original_payment_id, p_recorded_by
  );

  perform public.mp_write_audit(
    p_actor_scope, 'refund_payment', 'mp_payments', v_refund_id, true,
    jsonb_build_object(
      'original_payment_id', p_original_payment_id,
      'amount', p_amount,
      'order_id', v_original.order_id
    )
  );
  return jsonb_build_object('ok', true, 'refund_payment_id', v_refund_id);
end;
$$;

create or replace function public.mp_set_cost(
  p_actor_scope text,
  p_product_id text,
  p_variant_id text,
  p_actual_purchase_cost numeric,
  p_set_by text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if p_actor_scope not like 'admin:super:%' and p_actor_scope <> 'admin:super' then
    raise exception 'set_cost is Super-Admin only' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.mp_product_variants
    where id = p_variant_id and product_id = p_product_id
  ) then
    raise exception 'variant/product mismatch' using errcode = 'check_violation';
  end if;
  update public.mp_product_costs
  set effective_to = timezone('utc', now())
  where variant_id = p_variant_id and effective_to is null;

  v_id := public.mp_new_id('mpcost');
  insert into public.mp_product_costs (
    id, product_id, variant_id, actual_purchase_cost, set_by, reason
  ) values (
    v_id, p_product_id, p_variant_id, p_actual_purchase_cost, p_set_by, p_reason
  );
  perform public.mp_write_audit(
    p_actor_scope, 'set_cost', 'mp_product_costs', v_id, true,
    jsonb_build_object('variant_id', p_variant_id, 'cost', p_actual_purchase_cost)
  );
  return jsonb_build_object('ok', true, 'cost_id', v_id);
end;
$$;

create or replace function public.mp_apply_override(
  p_actor_scope text,
  p_product_id text,
  p_variant_id text,
  p_override_price numeric,
  p_mode text,
  p_ends_at timestamptz,
  p_reason text,
  p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_prior_id text;
  v_old_price numeric(14,2);
  v_old_state text;
begin
  if p_actor_scope not like 'admin:super%' then
    raise exception 'overrides are Super-Admin only' using errcode = 'check_violation';
  end if;
  if p_mode = 'time_limited' and p_ends_at is null then
    raise exception 'time_limited override requires ends_at' using errcode = 'check_violation';
  end if;

  select website_price, website_price_state into v_old_price, v_old_state
  from public.mp_product_variants
  where id = p_variant_id and product_id = p_product_id
  for update;
  if not found then
    raise exception 'variant not found' using errcode = 'no_data_found';
  end if;

  -- Expire timed-out active rows so they cannot block replacement.
  update public.mp_price_overrides
  set status = 'expired'
  where variant_id = p_variant_id
    and status = 'active'
    and mode = 'time_limited'
    and ends_at is not null
    and ends_at <= timezone('utc', now());

  -- Lock any remaining active override.
  select id into v_prior_id
  from public.mp_price_overrides
  where variant_id = p_variant_id
    and status = 'active'
  for update;

  v_id := public.mp_new_id('mpovr');

  -- Free the partial unique index before inserting the new active row.
  if v_prior_id is not null then
    update public.mp_price_overrides
    set status = 'superseded'
    where id = v_prior_id
      and status = 'active';
  end if;

  insert into public.mp_price_overrides (
    id, product_id, variant_id, override_price, status, mode, ends_at, reason, created_by
  ) values (
    v_id, p_product_id, p_variant_id, p_override_price, 'active', p_mode, p_ends_at, p_reason, p_created_by
  );

  if v_prior_id is not null then
    update public.mp_price_overrides
    set superseded_by = v_id
    where id = v_prior_id
      and status = 'superseded';
  end if;

  -- Never reactivate superseded/revoked/expired rows.
  perform set_config('mp.allow_price_write', 'on', true);
  update public.mp_product_variants
  set website_price = p_override_price,
      website_price_state = 'priced_override',
      website_price_source = 'override',
      price_published_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_variant_id;

  insert into public.mp_price_history (
    id, product_id, variant_id, old_price, new_price, old_state, new_state,
    source, changed_by, reason, override_id
  ) values (
    public.mp_new_id('mphist'), p_product_id, p_variant_id, v_old_price, p_override_price,
    v_old_state, 'priced_override', 'override', p_created_by, p_reason, v_id
  );

  perform public.mp_write_audit(
    p_actor_scope, 'apply_override', 'mp_price_overrides', v_id, true,
    jsonb_build_object(
      'variant_id', p_variant_id,
      'price', p_override_price,
      'superseded_override_id', v_prior_id
    )
  );
  return jsonb_build_object('ok', true, 'override_id', v_id, 'superseded_override_id', v_prior_id);
end;
$$;

create or replace function public.mp_revoke_override(
  p_actor_scope text,
  p_override_id text,
  p_revoked_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ovr public.mp_price_overrides%rowtype;
begin
  if p_actor_scope not like 'admin:super%' then
    raise exception 'revoke override is Super-Admin only' using errcode = 'check_violation';
  end if;
  select * into v_ovr from public.mp_price_overrides where id = p_override_id for update;
  if not found or v_ovr.status <> 'active' then
    raise exception 'active override not found' using errcode = 'no_data_found';
  end if;
  update public.mp_price_overrides
  set status = 'revoked', revoked_by = p_revoked_by, revoked_at = timezone('utc', now())
  where id = p_override_id;

  perform set_config('mp.allow_price_write', 'on', true);
  update public.mp_product_variants
  set website_price_state = 'confirm_price',
      website_price_source = null,
      updated_at = timezone('utc', now())
  where id = v_ovr.variant_id;

  insert into public.mp_price_history (
    id, product_id, variant_id, old_price, new_price, old_state, new_state,
    source, changed_by, reason, override_id
  ) values (
    public.mp_new_id('mphist'), v_ovr.product_id, v_ovr.variant_id, v_ovr.override_price, null,
    'priced_override', 'confirm_price', 'override', p_revoked_by, 'revoked', p_override_id
  );

  perform public.mp_write_audit(
    p_actor_scope, 'revoke_override', 'mp_price_overrides', p_override_id, true,
    jsonb_build_object('variant_id', v_ovr.variant_id)
  );
  return jsonb_build_object('ok', true, 'override_id', p_override_id);
end;
$$;

create or replace function public.mp_publish_price(
  p_actor_scope text,
  p_variant_id text,
  p_changed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant public.mp_product_variants%rowtype;
  v_cfg public.mp_pricing_config%rowtype;
  v_candidate record;
  v_last record;
  v_new_price numeric(14,2);
  v_source text;
  v_state text := 'confirm_price';
begin
  if p_actor_scope not like 'admin:super%' and p_actor_scope not like 'system:%' then
    raise exception 'publish_price requires Super-Admin or system' using errcode = 'check_violation';
  end if;

  select * into v_variant from public.mp_product_variants where id = p_variant_id for update;
  if not found then
    raise exception 'variant not found' using errcode = 'no_data_found';
  end if;
  select * into v_cfg from public.mp_pricing_config where company_id = 'sunchaser';

  -- 1) active override
  select override_price into v_new_price
  from public.mp_price_overrides
  where variant_id = p_variant_id
    and status = 'active'
    and (mode = 'permanent' or ends_at > timezone('utc', now()))
  limit 1;
  if found then
    v_source := 'override';
    v_state := 'priced_override';
  else
    -- 2/3) exact Kamal then Alladin, fresh parse-ok in_stock only
    select o.supplier_public_price, s.code
      into v_new_price, v_source
    from public.mp_supplier_products sp
    join public.mp_suppliers s on s.id = sp.supplier_id
    join lateral (
      select obs.*
      from public.mp_supplier_observations obs
      where obs.supplier_product_id = sp.id
      order by obs.observed_at desc
      limit 1
    ) o on true
    where sp.variant_id = p_variant_id
      and sp.active
      and not sp.match_locked
      and sp.match_confidence = 'exact'
      and s.active
      and o.availability = 'in_stock'
      and o.parse_status = 'ok'
      and o.supplier_public_price > 0
      and o.observed_at >= timezone('utc', now()) - make_interval(hours => v_cfg.staleness_hours)
    order by s.priority asc
    limit 1;
    if found then
      v_state := 'priced_auto';
    else
      -- 4) last-approved (non-override history)
      select new_price, source into v_new_price, v_source
      from public.mp_price_history
      where variant_id = p_variant_id
        and source <> 'override'
        and new_price is not null
      order by created_at desc
      limit 1;
      if found then
        v_state := 'priced_auto';
        v_source := 'last_approved';
      else
        v_new_price := null;
        v_source := null;
        v_state := 'confirm_price';
      end if;
    end if;
  end if;

  -- never publish from sold_out/backorder/unknown — already filtered
  if v_cfg.allow_soldout_reference then
    null; -- analytics only; no candidate path uses sold_out
  end if;

  perform set_config('mp.allow_price_write', 'on', true);
  update public.mp_product_variants
  set website_price = v_new_price,
      website_price_state = v_state,
      website_price_source = v_source,
      price_published_at = case when v_state <> 'confirm_price' then timezone('utc', now()) else price_published_at end,
      updated_at = timezone('utc', now())
  where id = p_variant_id;

  insert into public.mp_price_history (
    id, product_id, variant_id, old_price, new_price, old_state, new_state,
    source, changed_by, reason
  ) values (
    public.mp_new_id('mphist'),
    v_variant.product_id,
    p_variant_id,
    v_variant.website_price,
    v_new_price,
    v_variant.website_price_state,
    v_state,
    coalesce(v_source, 'seed'),
    p_changed_by,
    'mp_publish_price'
  );

  update public.mp_products p
  set display_from_price = (
        select min(website_price)
        from public.mp_product_variants v
        where v.product_id = p.id and v.active and v.website_price is not null
      ),
      display_price_state = case
        when exists (
          select 1 from public.mp_product_variants v
          where v.product_id = p.id and v.website_price_state = 'priced_override'
        ) then 'priced_override'
        when exists (
          select 1 from public.mp_product_variants v
          where v.product_id = p.id and v.website_price_state = 'priced_auto'
        ) then 'priced_auto'
        else 'confirm_price'
      end,
      updated_at = timezone('utc', now())
  where id = v_variant.product_id;

  perform public.mp_write_audit(
    p_actor_scope, 'publish_price', 'mp_product_variants', p_variant_id, true,
    jsonb_build_object('price', v_new_price, 'state', v_state, 'source', v_source)
  );

  return jsonb_build_object(
    'ok', true,
    'variant_id', p_variant_id,
    'website_price', v_new_price,
    'website_price_state', v_state,
    'website_price_source', v_source
  );
end;
$$;

create or replace function public.mp_correct_order_totals(
  p_actor_scope text,
  p_order_id text,
  p_subtotal numeric,
  p_delivery_fee numeric,
  p_tax numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.mp_orders%rowtype;
  v_grand numeric(14,2);
  v_net numeric(14,2);
begin
  if p_actor_scope not like 'admin:%' then
    raise exception 'correct_order_totals requires admin actor_scope'
      using errcode = 'check_violation';
  end if;
  select * into v_order from public.mp_orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'no_data_found';
  end if;
  v_grand := coalesce(p_subtotal, 0) + coalesce(p_delivery_fee, 0) + coalesce(p_tax, 0);
  select coalesce(sum(case when status in ('verified','collected') then amount else 0 end), 0)
       - coalesce(sum(case when status = 'refunded' then amount else 0 end), 0)
    into v_net
  from public.mp_payments where order_id = p_order_id;
  if v_net > v_grand then
    raise exception 'new total below net paid' using errcode = 'check_violation';
  end if;

  perform set_config('mp.allow_order_total_correction', 'on', true);
  update public.mp_orders
  set subtotal = p_subtotal,
      delivery_fee = coalesce(p_delivery_fee, 0),
      tax = coalesce(p_tax, 0),
      grand_total = v_grand,
      updated_at = timezone('utc', now())
  where id = p_order_id;

  update public.mp_payment_plans
  set grand_total = v_grand,
      balance_due = greatest(v_grand - upfront_amount, 0)
  where order_id = p_order_id;

  perform public.mp_write_audit(
    p_actor_scope, 'correct_order_totals', 'mp_orders', p_order_id, true,
    jsonb_build_object('grand_total', v_grand, 'net_paid', v_net)
  );
  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'grand_total', v_grand);
end;
$$;

-- Mark uploaded after storage I/O succeeds (foundation helper for WS6 orchestration)
create or replace function public.mp_mark_upload_intent_uploaded(
  p_upload_intent_id text,
  p_byte_size bigint,
  p_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sha text;
begin
  if p_byte_size is null or p_byte_size <= 0 then
    raise exception 'byte_size must be > 0' using errcode = 'check_violation';
  end if;
  v_sha := lower(trim(coalesce(p_sha256, '')));
  if v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'sha256 must be a 64-character hexadecimal digest'
      using errcode = 'check_violation';
  end if;

  update public.mp_upload_intents
  set status = 'uploaded',
      byte_size = p_byte_size,
      sha256 = v_sha,
      uploaded_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_upload_intent_id
    and status = 'claimed';
  if not found then
    raise exception 'intent not in claimed state' using errcode = 'check_violation';
  end if;
  return jsonb_build_object('ok', true, 'status', 'uploaded', 'sha256', v_sha, 'byte_size', p_byte_size);
end;
$$;

-- Reconcile stale claimed intents when storage presence is known by caller
create or replace function public.mp_reconcile_stale_claimed_intent(
  p_upload_intent_id text,
  p_object_exists boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.mp_upload_intents%rowtype;
begin
  select * into v_intent from public.mp_upload_intents where id = p_upload_intent_id for update;
  if not found or v_intent.status <> 'claimed' then
    raise exception 'intent not claimed' using errcode = 'check_violation';
  end if;
  if p_object_exists then
    update public.mp_upload_intents
    set status = 'cleanup_pending', updated_at = timezone('utc', now())
    where id = p_upload_intent_id;
    insert into public.mp_storage_cleanup_outbox (
      id, storage_path, upload_intent_id, reason, related_order_id, related_idempotency_key
    ) values (
      public.mp_new_id('mpclo'), v_intent.storage_path, v_intent.id,
      'stale_claimed_object_present', v_intent.order_id, v_intent.idempotency_key
    );
    return jsonb_build_object('ok', true, 'status', 'cleanup_pending');
  else
    update public.mp_upload_intents
    set status = 'abandoned', updated_at = timezone('utc', now())
    where id = p_upload_intent_id;
    return jsonb_build_object('ok', true, 'status', 'abandoned');
  end if;
end;
$$;


-- =============================================================================
-- 9. RLS + REVOKE + GRANT (mp_* scoped — never blanket-revoke CRM tables)
-- Contract §3.2 "revoke all on all tables" would break existing CRM grants;
-- WS0 applies the fail-closed intent to marketplace objects only.
-- =============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'mp_brands','mp_categories','mp_products','mp_product_variants','mp_media',
    'mp_suppliers','mp_supplier_products','mp_supplier_observations',
    'mp_price_overrides','mp_price_history','mp_pricing_config','mp_product_costs',
    'mp_delivery_zones','mp_delivery_rates','mp_carts','mp_cart_items',
    'mp_orders','mp_order_items','mp_payment_plans','mp_payments',
    'mp_receipt_objects','mp_receipts','mp_idempotency_keys','mp_upload_intents',
    'mp_storage_cleanup_outbox','mp_job_runs','mp_price_alerts','mp_audit_events'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format(
        'grant select, insert, update, delete on table public.%I to service_role',
        t
      );
    end if;
  end loop;
end $$;

-- Revoke/grant RPC execute
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'mp_%'
  loop
    execute format('revoke all on function %s from public', fn.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', fn.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', fn.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn.sig);
    end if;
  end loop;
end $$;

-- Explicit grants listed in contract §3.3 (idempotent reaffirm when role exists)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise notice 'service_role missing — skip explicit RPC grants (local/non-Supabase)';
    return;
  end if;
  grant execute on function public.mp_idempotency_preflight(text,text,text,text,text) to service_role;
  grant execute on function public.mp_create_upload_intent(text,text,text,text,text) to service_role;
  grant execute on function public.mp_checkout(text,text,text,text,text,numeric,numeric,numeric,text,text,numeric,numeric,boolean,jsonb) to service_role;
  grant execute on function public.mp_record_payment(text,text,text,numeric,text,bigint,text,text) to service_role;
  grant execute on function public.mp_verify_payment(text,text,text) to service_role;
  grant execute on function public.mp_collect_cod_payment(text,text,text) to service_role;
  grant execute on function public.mp_cancel_cod_payment(text,text,text) to service_role;
  grant execute on function public.mp_refund_payment(text,text,numeric,text) to service_role;
  grant execute on function public.mp_publish_price(text,text,text) to service_role;
  grant execute on function public.mp_apply_override(text,text,text,numeric,text,timestamptz,text,text) to service_role;
  grant execute on function public.mp_revoke_override(text,text,text) to service_role;
  grant execute on function public.mp_set_cost(text,text,text,numeric,text,text) to service_role;
  grant execute on function public.mp_correct_order_totals(text,text,numeric,numeric,numeric) to service_role;
end $$;

-- =============================================================================
-- 10. PostgREST schema reload
-- =============================================================================
notify pgrst, 'reload schema';

