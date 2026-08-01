-- =============================================================================
-- Marketplace CEO Auto-Import — automatic catalogue + lowest listed price
--
-- MANUAL APPLICATION ONLY on reviewed environments after WS0–WS4 + WS-MAP-0.
-- DO NOT AUTO-APPLY from CI without explicit release approval.
--
-- Preserves WS-MAP-0: does NOT restore mp_admin_upsert_supplier_mapping.
-- Creates/updates public catalogue products/variants and sets website_price to
-- the selected public supplier listed price (no CEO purchasing discount).
-- =============================================================================

create table if not exists public.mp_auto_import_listings (
  identity_key text primary key,
  product_id text not null references public.mp_products(id),
  variant_id text not null references public.mp_product_variants(id),
  title text not null,
  brand_name text not null,
  category_name text not null,
  selected_supplier text not null
    check (selected_supplier in ('kamal', 'alladin')),
  website_price numeric(14,2) not null check (website_price > 0),
  availability text not null default 'unknown'
    check (availability in ('in_stock','sold_out','backorder','unknown')),
  source_urls jsonb not null default '[]'::jsonb,
  match_reason text not null,
  price_reason text not null,
  offers jsonb not null default '[]'::jsonb,
  last_synced_at timestamptz not null default timezone('utc', now()),
  last_valid_price numeric(14,2) not null,
  last_valid_supplier text not null
    check (last_valid_supplier in ('kamal', 'alladin')),
  last_valid_observation_at timestamptz not null default timezone('utc', now()),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists mp_auto_import_listings_variant_idx
  on public.mp_auto_import_listings (variant_id);

create table if not exists public.mp_auto_import_sync_runs (
  id text primary key,
  status text not null check (status in ('succeeded','failed','partial')),
  health jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.mp_ceo_auto_import_upsert_listing(
  p_actor_scope text,
  p_identity_key text,
  p_title text,
  p_brand_name text,
  p_category_name text,
  p_website_price numeric,
  p_availability text,
  p_selected_supplier text,
  p_source_urls jsonb,
  p_match_reason text,
  p_price_reason text,
  p_offers jsonb,
  p_fetched_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id text;
  v_category_id text;
  v_product_id text;
  v_variant_id text;
  v_slug text;
  v_sku text;
  v_existing public.mp_auto_import_listings%rowtype;
  v_created boolean := false;
  v_brand_slug text;
  v_cat_slug text;
  v_price numeric(14,2);
  v_avail text;
begin
  if p_actor_scope not like 'admin:super%' and p_actor_scope not like 'system:%' then
    raise exception 'VALIDATION_ERROR: CEO auto-import requires Super-Admin or system'
      using errcode = 'check_violation';
  end if;

  if p_identity_key is null or length(trim(p_identity_key)) = 0 then
    raise exception 'VALIDATION_ERROR: identity_key required'
      using errcode = 'check_violation';
  end if;

  v_price := p_website_price;
  if v_price is null or v_price <= 0 then
    raise exception 'VALIDATION_ERROR: website_price must be positive'
      using errcode = 'check_violation';
  end if;

  if p_selected_supplier not in ('kamal', 'alladin') then
    raise exception 'VALIDATION_ERROR: invalid supplier'
      using errcode = 'check_violation';
  end if;

  v_avail := coalesce(nullif(trim(p_availability), ''), 'unknown');
  if v_avail not in ('in_stock','sold_out','backorder','unknown') then
    v_avail := 'unknown';
  end if;

  select * into v_existing
  from public.mp_auto_import_listings
  where identity_key = trim(p_identity_key)
  for update;

  v_brand_slug := left(regexp_replace(lower(trim(p_brand_name)), '[^a-z0-9]+', '-', 'g'), 48);
  if v_brand_slug is null or length(v_brand_slug) = 0 then
    v_brand_slug := 'supplier';
  end if;
  select id into v_brand_id from public.mp_brands where slug = v_brand_slug;
  if v_brand_id is null then
    v_brand_id := public.mp_new_id('mpbrand');
    insert into public.mp_brands (id, name, slug, active)
    values (v_brand_id, left(trim(p_brand_name), 120), v_brand_slug, true);
  end if;

  v_cat_slug := left(regexp_replace(lower(trim(p_category_name)), '[^a-z0-9]+', '-', 'g'), 48);
  if v_cat_slug is null or length(v_cat_slug) = 0 then
    v_cat_slug := 'solar';
  end if;
  select id into v_category_id from public.mp_categories where slug = v_cat_slug;
  if v_category_id is null then
    v_category_id := public.mp_new_id('mpcat');
    insert into public.mp_categories (id, name, slug, active, sort_order)
    values (v_category_id, left(trim(p_category_name), 120), v_cat_slug, true, 100);
  end if;

  if v_existing.identity_key is null then
    v_created := true;
    v_product_id := public.mp_new_id('mpprod');
    v_variant_id := public.mp_new_id('mpvar');
    v_slug := left(regexp_replace(lower(trim(p_title)), '[^a-z0-9]+', '-', 'g'), 60)
      || '-' || right(md5(trim(p_identity_key)), 8);
    v_sku := 'SC-AUTO-' || upper(right(md5(trim(p_identity_key)), 10));

    insert into public.mp_products (
      id, brand_id, category_id, title, slug, description, tags, active, featured
    ) values (
      v_product_id, v_brand_id, v_category_id, left(trim(p_title), 240), v_slug,
      'Auto-imported from public supplier catalogues (CEO-authorized).',
      array['auto-import', p_selected_supplier]::text[],
      true, false
    );

    insert into public.mp_product_variants (
      id, product_id, sku, title, is_default, is_priceable, active, stock_status
    ) values (
      v_variant_id, v_product_id, v_sku, 'Default', true, true, true, v_avail
    );

    insert into public.mp_auto_import_listings (
      identity_key, product_id, variant_id, title, brand_name, category_name,
      selected_supplier, website_price, availability, source_urls, match_reason,
      price_reason, offers, last_synced_at, last_valid_price, last_valid_supplier,
      last_valid_observation_at, active
    ) values (
      trim(p_identity_key), v_product_id, v_variant_id, left(trim(p_title), 240),
      left(trim(p_brand_name), 120), left(trim(p_category_name), 120),
      p_selected_supplier, v_price, v_avail, coalesce(p_source_urls, '[]'::jsonb),
      coalesce(p_match_reason, 'exact_identity'), coalesce(p_price_reason, 'auto'),
      coalesce(p_offers, '[]'::jsonb), coalesce(p_fetched_at, timezone('utc', now())),
      v_price, p_selected_supplier, coalesce(p_fetched_at, timezone('utc', now())),
      v_avail <> 'sold_out'
    );
  else
    v_product_id := v_existing.product_id;
    v_variant_id := v_existing.variant_id;
    update public.mp_products
    set title = left(trim(p_title), 240),
        brand_id = v_brand_id,
        category_id = v_category_id,
        active = true,
        updated_at = timezone('utc', now())
    where id = v_product_id;

    update public.mp_auto_import_listings
    set title = left(trim(p_title), 240),
        brand_name = left(trim(p_brand_name), 120),
        category_name = left(trim(p_category_name), 120),
        selected_supplier = p_selected_supplier,
        website_price = v_price,
        availability = v_avail,
        source_urls = coalesce(p_source_urls, source_urls),
        match_reason = coalesce(p_match_reason, match_reason),
        price_reason = coalesce(p_price_reason, price_reason),
        offers = coalesce(p_offers, offers),
        last_synced_at = coalesce(p_fetched_at, timezone('utc', now())),
        last_valid_price = case
          when p_price_reason like 'rollback_%' then last_valid_price
          else v_price
        end,
        last_valid_supplier = case
          when p_price_reason like 'rollback_%' then last_valid_supplier
          else p_selected_supplier
        end,
        last_valid_observation_at = case
          when p_price_reason like 'rollback_%' then last_valid_observation_at
          else coalesce(p_fetched_at, timezone('utc', now()))
        end,
        active = v_avail <> 'sold_out',
        updated_at = timezone('utc', now())
    where identity_key = trim(p_identity_key);

    if p_price_reason like 'rollback_%' then
      v_price := v_existing.last_valid_price;
    end if;
  end if;

  -- Sole commercial write path for this workstream (RPC-guarded columns).
  perform set_config('mp.allow_price_write', 'on', true);
  update public.mp_product_variants
  set website_price = v_price,
      website_price_state = 'priced_auto',
      website_price_source = p_selected_supplier,
      stock_status = v_avail,
      active = v_avail <> 'sold_out',
      updated_at = timezone('utc', now())
  where id = v_variant_id;
  perform set_config('mp.allow_price_write', 'off', true);

  perform public.mp_write_audit(
    p_actor_scope,
    case when v_created then 'auto_import.listing_created' else 'auto_import.listing_updated' end,
    'mp_auto_import_listings',
    trim(p_identity_key),
    false,
    jsonb_build_object(
      'productId', v_product_id,
      'variantId', v_variant_id,
      'websitePrice', v_price,
      'selectedSupplier', p_selected_supplier,
      'matchReason', p_match_reason,
      'priceReason', p_price_reason,
      'sourceUrls', p_source_urls,
      'ceoDiscountApplied', false
    )
  );

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'productId', v_product_id,
    'variantId', v_variant_id,
    'websitePrice', v_price
  );
end;
$$;

revoke all on function public.mp_ceo_auto_import_upsert_listing(
  text, text, text, text, text, numeric, text, text, jsonb, text, text, jsonb, timestamptz
) from public;

do $ceo_ai_grants$
begin
  -- Legacy per-item upsert is retained for reference/migration only.
  -- EXECUTE is denied to PostgREST roles; durable writes use commit_batch via
  -- the dedicated direct-Postgres runtime role (see atomic SQL).
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute $sql$revoke all on function public.mp_ceo_auto_import_upsert_listing(
      text, text, text, text, text, numeric, text, text, jsonb, text, text, jsonb, timestamptz
    ) from anon$sql$;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute $sql$revoke all on function public.mp_ceo_auto_import_upsert_listing(
      text, text, text, text, text, numeric, text, text, jsonb, text, text, jsonb, timestamptz
    ) from authenticated$sql$;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute $sql$revoke all on function public.mp_ceo_auto_import_upsert_listing(
      text, text, text, text, text, numeric, text, text, jsonb, text, text, jsonb, timestamptz
    ) from service_role$sql$;
  end if;
end
$ceo_ai_grants$;

notify pgrst, 'reload schema';
