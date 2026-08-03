-- =============================================================================
-- Marketplace Catalogue Manager — core additive schema
-- =============================================================================
-- DO NOT APPLY in automation. Prepare for CTO-approved SQL apply only.
--
-- Additive / backward-compatible:
--   - mp_categories.parent_id (hierarchy)
--   - mp_products content/SEO/visibility/sync timestamps
--   - mp_product_variants.compare_at_price
--   - mp_field_overrides + helpers (NO website_price — use mp_price_overrides)
--   - mp_import_reject_ledger + mp_record_import_reject
--   - mp_catalogue_reconciliation_counts()
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Category hierarchy
-- -----------------------------------------------------------------------------
alter table public.mp_categories
  add column if not exists parent_id text references public.mp_categories(id);

create index if not exists mp_categories_parent_idx
  on public.mp_categories (parent_id)
  where parent_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Product catalogue fields
-- -----------------------------------------------------------------------------
alter table public.mp_products
  add column if not exists short_description text;

alter table public.mp_products
  add column if not exists model text;

alter table public.mp_products
  add column if not exists seo_title text;

alter table public.mp_products
  add column if not exists seo_description text;

alter table public.mp_products
  add column if not exists datasheet_url text;

alter table public.mp_products
  add column if not exists public_visible boolean not null default true;

alter table public.mp_products
  add column if not exists last_supplier_sync_at timestamptz;

alter table public.mp_products
  add column if not exists last_manual_edit_at timestamptz;

-- Legacy rows: ensure public_visible is true when column newly added.
update public.mp_products
set public_visible = true
where public_visible is null;

create index if not exists mp_products_public_visible_idx
  on public.mp_products (public_visible)
  where public_visible;

-- -----------------------------------------------------------------------------
-- 3. Variant compare-at
-- -----------------------------------------------------------------------------
alter table public.mp_product_variants
  add column if not exists compare_at_price numeric(14,2)
  check (compare_at_price is null or compare_at_price > 0);

-- -----------------------------------------------------------------------------
-- 4. Field overrides (content/media/visibility — not website price)
-- -----------------------------------------------------------------------------
create table if not exists public.mp_field_overrides (
  id text primary key,
  product_id text not null references public.mp_products(id) on delete cascade,
  field_name text not null,
  override_value jsonb not null,
  active boolean not null default true,
  actor_id text not null,
  actor_username text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  cleared_at timestamptz,
  constraint mp_field_overrides_field_ck check (
    field_name in (
      'title',
      'description',
      'short_description',
      'brand_id',
      'category_id',
      'model',
      'specifications',
      'warranty',
      'datasheet_url',
      'seo_title',
      'seo_description',
      'stock_status',
      'primary_image',
      'gallery_images',
      'public_visible',
      'featured'
    )
  ),
  constraint mp_field_overrides_cleared_ck check (
    (active = true and cleared_at is null)
    or (active = false and cleared_at is not null)
  )
);

create unique index if not exists mp_field_overrides_active_uidx
  on public.mp_field_overrides (product_id, field_name)
  where active;

create index if not exists mp_field_overrides_product_idx
  on public.mp_field_overrides (product_id);

create or replace function public.mp_has_active_field_override(
  p_product_id text,
  p_field_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mp_field_overrides o
    where o.product_id = p_product_id
      and o.field_name = p_field_name
      and o.active = true
  );
$$;

create or replace function public.mp_set_field_override(
  p_product_id text,
  p_field_name text,
  p_override_value jsonb,
  p_actor_id text,
  p_actor_username text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if p_product_id is null or length(trim(p_product_id)) = 0 then
    raise exception 'VALIDATION_ERROR: product_id required'
      using errcode = 'check_violation';
  end if;
  if p_field_name is null or length(trim(p_field_name)) = 0 then
    raise exception 'VALIDATION_ERROR: field_name required'
      using errcode = 'check_violation';
  end if;
  if p_field_name = 'website_price' then
    raise exception 'VALIDATION_ERROR: website_price uses mp_price_overrides'
      using errcode = 'check_violation';
  end if;
  if p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'VALIDATION_ERROR: actor_id required'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.mp_products where id = p_product_id) then
    raise exception 'PRODUCT_NOT_FOUND: product not found'
      using errcode = 'no_data_found';
  end if;

  update public.mp_field_overrides
  set active = false,
      cleared_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where product_id = p_product_id
    and field_name = p_field_name
    and active = true;

  v_id := public.mp_new_id('mpfovr');
  insert into public.mp_field_overrides (
    id, product_id, field_name, override_value, active,
    actor_id, actor_username, created_at, updated_at, cleared_at
  ) values (
    v_id, p_product_id, p_field_name, coalesce(p_override_value, 'null'::jsonb), true,
    trim(p_actor_id), nullif(trim(coalesce(p_actor_username, '')), ''),
    timezone('utc', now()), timezone('utc', now()), null
  );

  update public.mp_products
  set last_manual_edit_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_product_id;

  perform public.mp_write_audit(
    'admin:super:' || trim(p_actor_id),
    'field_override.set',
    'mp_field_overrides',
    v_id,
    false,
    jsonb_build_object(
      'productId', p_product_id,
      'fieldName', p_field_name,
      'actorUsername', p_actor_username
    )
  );

  return v_id;
end;
$$;

create or replace function public.mp_clear_field_override(
  p_product_id text,
  p_field_name text,
  p_actor_id text,
  p_actor_username text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if p_product_id is null or length(trim(p_product_id)) = 0 then
    raise exception 'VALIDATION_ERROR: product_id required'
      using errcode = 'check_violation';
  end if;
  if p_field_name is null or length(trim(p_field_name)) = 0 then
    raise exception 'VALIDATION_ERROR: field_name required'
      using errcode = 'check_violation';
  end if;
  if p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'VALIDATION_ERROR: actor_id required'
      using errcode = 'check_violation';
  end if;

  select id into v_id
  from public.mp_field_overrides
  where product_id = p_product_id
    and field_name = p_field_name
    and active = true
  for update;

  if v_id is null then
    return false;
  end if;

  update public.mp_field_overrides
  set active = false,
      cleared_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_id;

  update public.mp_products
  set last_manual_edit_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_product_id;

  perform public.mp_write_audit(
    'admin:super:' || trim(p_actor_id),
    'field_override.clear',
    'mp_field_overrides',
    v_id,
    false,
    jsonb_build_object(
      'productId', p_product_id,
      'fieldName', p_field_name,
      'actorUsername', p_actor_username
    )
  );

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Import reject ledger
-- -----------------------------------------------------------------------------
create table if not exists public.mp_import_reject_ledger (
  id text primary key,
  run_id text not null,
  supplier text not null check (supplier in ('kamal', 'alladin')),
  reason text not null,
  source_key text,
  supplier_product_id text,
  canonical_url text,
  title text,
  identity_key text,
  stage text not null check (stage in ('normalize', 'import', 'commit')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists mp_import_reject_ledger_run_idx
  on public.mp_import_reject_ledger (run_id);

create index if not exists mp_import_reject_ledger_reason_idx
  on public.mp_import_reject_ledger (reason);

create index if not exists mp_import_reject_ledger_supplier_idx
  on public.mp_import_reject_ledger (supplier);

create or replace function public.mp_record_import_reject(
  p_run_id text,
  p_supplier text,
  p_reason text,
  p_source_key text default null,
  p_supplier_product_id text default null,
  p_canonical_url text default null,
  p_title text default null,
  p_identity_key text default null,
  p_stage text default 'import',
  p_detail jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if p_run_id is null or length(trim(p_run_id)) = 0 then
    raise exception 'VALIDATION_ERROR: run_id required'
      using errcode = 'check_violation';
  end if;
  if p_supplier not in ('kamal', 'alladin') then
    raise exception 'VALIDATION_ERROR: supplier invalid'
      using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'VALIDATION_ERROR: reason required'
      using errcode = 'check_violation';
  end if;
  if p_stage is null or p_stage not in ('normalize', 'import', 'commit') then
    raise exception 'VALIDATION_ERROR: stage invalid'
      using errcode = 'check_violation';
  end if;

  v_id := public.mp_new_id('mpirej');
  insert into public.mp_import_reject_ledger (
    id, run_id, supplier, reason, source_key, supplier_product_id,
    canonical_url, title, identity_key, stage, detail, created_at
  ) values (
    v_id,
    trim(p_run_id),
    p_supplier,
    trim(p_reason),
    nullif(trim(coalesce(p_source_key, '')), ''),
    nullif(trim(coalesce(p_supplier_product_id, '')), ''),
    nullif(trim(coalesce(p_canonical_url, '')), ''),
    nullif(trim(coalesce(p_title, '')), ''),
    nullif(trim(coalesce(p_identity_key, '')), ''),
    p_stage,
    coalesce(p_detail, '{}'::jsonb),
    timezone('utc', now())
  );
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Reconciliation counts (read-only accountability)
-- -----------------------------------------------------------------------------
create or replace function public.mp_catalogue_reconciliation_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_crm integer;
  v_with_media integer;
  v_rejects integer;
  v_legacy integer;
begin
  select count(*)::integer into v_crm from public.mp_products;

  select count(distinct m.product_id)::integer into v_with_media
  from public.mp_media m
  where m.product_id is not null
    and m.published = true
    and m.role <> 'receipt';

  select count(*)::integer into v_rejects
  from public.mp_import_reject_ledger;

  select count(*)::integer into v_legacy
  from public.mp_products p
  where p.last_supplier_sync_at is null;

  return jsonb_build_object(
    'crmProducts', v_crm,
    'productsWithMedia', v_with_media,
    'productsWithoutMedia', greatest(0, v_crm - v_with_media),
    'rejectLedgerRows', v_rejects,
    'legacyUnreconciledProducts', v_legacy,
    'metricNotes', jsonb_build_object(
      'crmProducts', 'Unique rows in mp_products (not variant observations).',
      'productsWithMedia', 'Distinct product_id with at least one published non-receipt media row.',
      'rejectLedgerRows', 'Rows in mp_import_reject_ledger (may include multiple stages per source).',
      'legacyUnreconciledProducts', 'mp_products with null last_supplier_sync_at.'
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Privileges / RLS
-- -----------------------------------------------------------------------------
alter table public.mp_field_overrides enable row level security;
alter table public.mp_field_overrides force row level security;
alter table public.mp_import_reject_ledger enable row level security;
alter table public.mp_import_reject_ledger force row level security;

revoke all on table public.mp_field_overrides from public;
revoke all on table public.mp_import_reject_ledger from public;

do $cm_priv$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.mp_field_overrides from anon;
    revoke all on table public.mp_import_reject_ledger from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.mp_field_overrides from authenticated;
    revoke all on table public.mp_import_reject_ledger from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.mp_field_overrides to service_role;
    grant select, insert, update, delete on table public.mp_import_reject_ledger to service_role;
  end if;
end $cm_priv$;

revoke all on function public.mp_has_active_field_override(text, text) from public;
revoke all on function public.mp_set_field_override(text, text, jsonb, text, text) from public;
revoke all on function public.mp_clear_field_override(text, text, text, text) from public;
revoke all on function public.mp_record_import_reject(text, text, text, text, text, text, text, text, text, jsonb) from public;
revoke all on function public.mp_catalogue_reconciliation_counts() from public;

do $cm_fn$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mp_has_active_field_override(text, text) from anon;
    revoke all on function public.mp_set_field_override(text, text, jsonb, text, text) from anon;
    revoke all on function public.mp_clear_field_override(text, text, text, text) from anon;
    revoke all on function public.mp_record_import_reject(text, text, text, text, text, text, text, text, text, jsonb) from anon;
    revoke all on function public.mp_catalogue_reconciliation_counts() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.mp_has_active_field_override(text, text) from authenticated;
    revoke all on function public.mp_set_field_override(text, text, jsonb, text, text) from authenticated;
    revoke all on function public.mp_clear_field_override(text, text, text, text) from authenticated;
    revoke all on function public.mp_record_import_reject(text, text, text, text, text, text, text, text, text, jsonb) from authenticated;
    revoke all on function public.mp_catalogue_reconciliation_counts() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mp_has_active_field_override(text, text) to service_role;
    grant execute on function public.mp_set_field_override(text, text, jsonb, text, text) to service_role;
    grant execute on function public.mp_clear_field_override(text, text, text, text) to service_role;
    grant execute on function public.mp_record_import_reject(text, text, text, text, text, text, text, text, text, jsonb) to service_role;
    grant execute on function public.mp_catalogue_reconciliation_counts() to service_role;
  end if;
end $cm_fn$;
