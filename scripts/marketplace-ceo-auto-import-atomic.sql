-- =============================================================================
-- Marketplace CEO Auto-Import — atomic batch + read-only preflight
--
-- MANUAL APPLICATION ONLY after review. DO NOT AUTO-APPLY from CI/deploy.
-- Extends scripts/marketplace-ceo-auto-import.sql.
--
-- Adds:
--   1) mp_ceo_auto_import_preflight() — STRICTLY READ-ONLY object presence check
--   2) mp_ceo_auto_import_commit_batch(...) — one transactional batch write
--
-- TIMEOUT ENFORCEMENT (required — do not skip):
--   In-function set_config('statement_timeout', ...) and CREATE FUNCTION
--   ... SET statement_timeout do NOT reliably cancel the outer client statement
--   on PostgreSQL 16. Proven working pattern used by the application:
--
--     BEGIN;
--     SET LOCAL statement_timeout = '45000';  -- own client command
--     SELECT public.mp_ceo_auto_import_commit_batch(...);
--     COMMIT;
--
--   Durable persist MUST use a direct Postgres connection that applies SET LOCAL
--   before the batch (DATABASE_URL / SUPABASE_DB_URL). PostgREST-only RPC without
--   a prior session timeout is NOT sufficient cancellation protection.
--
-- Does NOT restore mp_admin_upsert_supplier_mapping (WS-MAP-0 preserved).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Read-only preflight (no inserts/updates/deletes; catalog metadata only)
-- ---------------------------------------------------------------------------
create or replace function public.mp_ceo_auto_import_preflight()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listings boolean := false;
  v_sync_runs boolean := false;
  v_upsert boolean := false;
  v_batch boolean := false;
begin
  -- Intentionally no DML / no SELECT from business tables.
  select exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'mp_auto_import_listings'
      and c.relkind = 'r'
  ) into v_listings;

  select exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'mp_auto_import_sync_runs'
      and c.relkind = 'r'
  ) into v_sync_runs;

  select exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'mp_ceo_auto_import_upsert_listing'
  ) into v_upsert;

  select exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'mp_ceo_auto_import_commit_batch'
  ) into v_batch;

  return jsonb_build_object(
    'ok', true,
    'readOnly', true,
    'tables', jsonb_build_object(
      'mp_auto_import_listings', case when v_listings then 'present' else 'absent' end,
      'mp_auto_import_sync_runs', case when v_sync_runs then 'present' else 'absent' end
    ),
    'functions', jsonb_build_object(
      'mp_ceo_auto_import_upsert_listing', case when v_upsert then 'present' else 'absent' end,
      'mp_ceo_auto_import_commit_batch', case when v_batch then 'present' else 'absent' end,
      'mp_ceo_auto_import_preflight', 'present'
    ),
    -- Honest: this RPC cannot enforce statement_timeout on its own caller.
    'timeoutEnforcement', jsonb_build_object(
      'inFunctionSetConfig', 'ineffective',
      'functionLevelSet', 'ineffective_on_pg16',
      'requiredCallerPattern',
        'BEGIN; SET LOCAL statement_timeout = ''<ms>''; SELECT mp_ceo_auto_import_commit_batch(...); COMMIT;',
      'applicationMustProvide', 'direct_postgres_with_set_local'
    )
  );
end;
$$;

revoke all on function public.mp_ceo_auto_import_preflight() from public;

-- ---------------------------------------------------------------------------
-- Atomic batch commit: validate all → write all → save health, or roll back
-- Timeout MUST be applied by the caller via SET LOCAL before this SELECT.
-- ---------------------------------------------------------------------------
drop function if exists public.mp_ceo_auto_import_commit_batch(text, text, jsonb, jsonb, integer);

create or replace function public.mp_ceo_auto_import_commit_batch(
  p_actor_scope text,
  p_run_id text,
  p_listings jsonb,
  p_health jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_idx integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_identity text;
  v_title text;
  v_brand text;
  v_category text;
  v_price numeric;
  v_avail text;
  v_supplier text;
  v_urls jsonb;
  v_match text;
  v_price_reason text;
  v_offers jsonb;
  v_fetched timestamptz;
  v_brand_id text;
  v_category_id text;
  v_product_id text;
  v_variant_id text;
  v_slug text;
  v_sku text;
  v_existing public.mp_auto_import_listings%rowtype;
  v_is_created boolean;
  v_brand_slug text;
  v_cat_slug text;
  v_status text;
begin
  -- Do NOT call set_config('statement_timeout', ...) here — it does not cancel
  -- this outer client statement on PostgreSQL 16. Callers must SET LOCAL first.

  if p_actor_scope not like 'admin:super%' and p_actor_scope not like 'system:%' then
    raise exception 'VALIDATION_ERROR: CEO auto-import requires Super-Admin or system'
      using errcode = 'check_violation';
  end if;

  if p_run_id is null or length(trim(p_run_id)) = 0 then
    raise exception 'VALIDATION_ERROR: run_id required'
      using errcode = 'check_violation';
  end if;

  if p_listings is null or jsonb_typeof(p_listings) <> 'array' then
    raise exception 'VALIDATION_ERROR: listings must be a jsonb array'
      using errcode = 'check_violation';
  end if;

  -- Phase 1: validate every item before any durable write.
  for v_item in select * from jsonb_array_elements(p_listings)
  loop
    v_idx := v_idx + 1;
    v_identity := nullif(trim(coalesce(v_item->>'identityKey', '')), '');
    v_title := nullif(trim(coalesce(v_item->>'title', '')), '');
    v_brand := nullif(trim(coalesce(v_item->>'brandName', '')), '');
    v_category := nullif(trim(coalesce(v_item->>'categoryName', '')), '');
    v_price := nullif(v_item->>'websitePricePkr', '')::numeric;
    v_avail := coalesce(nullif(trim(coalesce(v_item->>'availability', '')), ''), 'unknown');
    v_supplier := nullif(trim(coalesce(v_item->>'selectedSupplier', '')), '');
    if v_identity is null then
      raise exception 'VALIDATION_ERROR: listings[%].identityKey required', v_idx
        using errcode = 'check_violation';
    end if;
    if v_title is null or v_brand is null or v_category is null then
      raise exception 'VALIDATION_ERROR: listings[%] missing title/brand/category', v_idx
        using errcode = 'check_violation';
    end if;
    if v_price is null or v_price <= 0 then
      raise exception 'VALIDATION_ERROR: listings[%].websitePricePkr must be positive', v_idx
        using errcode = 'check_violation';
    end if;
    if v_supplier not in ('kamal', 'alladin') then
      raise exception 'VALIDATION_ERROR: listings[%].selectedSupplier invalid', v_idx
        using errcode = 'check_violation';
    end if;
    if v_avail not in ('in_stock','sold_out','backorder','unknown') then
      raise exception 'VALIDATION_ERROR: listings[%].availability invalid', v_idx
        using errcode = 'check_violation';
    end if;
  end loop;

  -- Phase 2: write all items (same transaction — any failure rolls everything back).
  for v_item in select * from jsonb_array_elements(p_listings)
  loop
    v_identity := trim(v_item->>'identityKey');
    v_title := left(trim(v_item->>'title'), 240);
    v_brand := left(trim(v_item->>'brandName'), 120);
    v_category := left(trim(v_item->>'categoryName'), 120);
    v_price := (v_item->>'websitePricePkr')::numeric;
    v_avail := coalesce(nullif(trim(v_item->>'availability'), ''), 'unknown');
    v_supplier := trim(v_item->>'selectedSupplier');
    v_urls := coalesce(v_item->'sourceUrls', '[]'::jsonb);
    v_match := coalesce(nullif(trim(v_item->>'matchReason'), ''), 'exact_identity');
    v_price_reason := coalesce(nullif(trim(v_item->>'priceReason'), ''), 'auto');
    v_offers := coalesce(v_item->'offers', '[]'::jsonb);
    v_fetched := coalesce((v_item->>'fetchedAt')::timestamptz, timezone('utc', now()));

    select * into v_existing
    from public.mp_auto_import_listings
    where identity_key = v_identity
    for update;

    v_brand_slug := left(regexp_replace(lower(v_brand), '[^a-z0-9]+', '-', 'g'), 48);
    if v_brand_slug is null or length(v_brand_slug) = 0 then
      v_brand_slug := 'supplier';
    end if;
    select id into v_brand_id from public.mp_brands where slug = v_brand_slug;
    if v_brand_id is null then
      v_brand_id := public.mp_new_id('mpbrand');
      insert into public.mp_brands (id, name, slug, active)
      values (v_brand_id, v_brand, v_brand_slug, true);
    end if;

    v_cat_slug := left(regexp_replace(lower(v_category), '[^a-z0-9]+', '-', 'g'), 48);
    if v_cat_slug is null or length(v_cat_slug) = 0 then
      v_cat_slug := 'solar';
    end if;
    select id into v_category_id from public.mp_categories where slug = v_cat_slug;
    if v_category_id is null then
      v_category_id := public.mp_new_id('mpcat');
      insert into public.mp_categories (id, name, slug, active, sort_order)
      values (v_category_id, v_category, v_cat_slug, true, 100);
    end if;

    v_is_created := v_existing.identity_key is null;
    if v_is_created then
      v_created := v_created + 1;
      v_product_id := public.mp_new_id('mpprod');
      v_variant_id := public.mp_new_id('mpvar');
      v_slug := left(regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'), 60)
        || '-' || right(md5(v_identity), 8);
      v_sku := 'SC-AUTO-' || upper(right(md5(v_identity), 10));

      insert into public.mp_products (
        id, brand_id, category_id, title, slug, description, tags, active, featured
      ) values (
        v_product_id, v_brand_id, v_category_id, v_title, v_slug,
        'Auto-imported from public supplier catalogues (CEO-authorized).',
        array['auto-import', v_supplier]::text[],
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
        v_identity, v_product_id, v_variant_id, v_title, v_brand, v_category,
        v_supplier, v_price, v_avail, v_urls, v_match, v_price_reason, v_offers,
        v_fetched, v_price, v_supplier, v_fetched, v_avail <> 'sold_out'
      );
    else
      v_updated := v_updated + 1;
      v_product_id := v_existing.product_id;
      v_variant_id := v_existing.variant_id;
      update public.mp_products
      set title = v_title,
          brand_id = v_brand_id,
          category_id = v_category_id,
          active = true,
          updated_at = timezone('utc', now())
      where id = v_product_id;

      update public.mp_auto_import_listings
      set title = v_title,
          brand_name = v_brand,
          category_name = v_category,
          selected_supplier = v_supplier,
          website_price = v_price,
          availability = v_avail,
          source_urls = coalesce(v_urls, source_urls),
          match_reason = v_match,
          price_reason = v_price_reason,
          offers = coalesce(v_offers, offers),
          last_synced_at = v_fetched,
          last_valid_price = case
            when v_price_reason like 'rollback_%' then last_valid_price
            else v_price
          end,
          last_valid_supplier = case
            when v_price_reason like 'rollback_%' then last_valid_supplier
            else v_supplier
          end,
          last_valid_observation_at = case
            when v_price_reason like 'rollback_%' then last_valid_observation_at
            else v_fetched
          end,
          active = v_avail <> 'sold_out',
          updated_at = timezone('utc', now())
      where identity_key = v_identity;

      if v_price_reason like 'rollback_%' then
        v_price := v_existing.last_valid_price;
      end if;
    end if;

    perform set_config('mp.allow_price_write', 'on', true);
    update public.mp_product_variants
    set website_price = v_price,
        website_price_state = 'priced_auto',
        website_price_source = v_supplier,
        stock_status = v_avail,
        active = v_avail <> 'sold_out',
        updated_at = timezone('utc', now())
    where id = v_variant_id;
    perform set_config('mp.allow_price_write', 'off', true);

    perform public.mp_write_audit(
      p_actor_scope,
      case when v_is_created then 'auto_import.listing_created' else 'auto_import.listing_updated' end,
      'mp_auto_import_listings',
      v_identity,
      false,
      jsonb_build_object(
        'productId', v_product_id,
        'variantId', v_variant_id,
        'websitePrice', v_price,
        'selectedSupplier', v_supplier,
        'matchReason', v_match,
        'priceReason', v_price_reason,
        'sourceUrls', v_urls,
        'ceoDiscountApplied', false,
        'runId', trim(p_run_id)
      )
    );

    v_one := jsonb_build_object(
      'identityKey', v_identity,
      'created', v_is_created,
      'productId', v_product_id,
      'variantId', v_variant_id,
      'websitePrice', v_price
    );
    v_results := v_results || jsonb_build_array(v_one);
  end loop;

  v_status := coalesce(nullif(trim(p_health->>'lastSyncStatus'), ''), 'succeeded');
  if v_status not in ('succeeded','failed','partial') then
    v_status := 'succeeded';
  end if;

  insert into public.mp_auto_import_sync_runs (id, status, health)
  values (trim(p_run_id), v_status, coalesce(p_health, '{}'::jsonb))
  on conflict (id) do update
  set status = excluded.status,
      health = excluded.health;

  return jsonb_build_object(
    'ok', true,
    'runId', trim(p_run_id),
    'productsCreated', v_created,
    'productsUpdated', v_updated,
    'results', v_results
  );
end;
$$;

revoke all on function public.mp_ceo_auto_import_commit_batch(
  text, text, jsonb, jsonb
) from public;

do $ceo_ai_atomic_grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute $sql$revoke all on function public.mp_ceo_auto_import_preflight() from anon$sql$;
    execute $sql$revoke all on function public.mp_ceo_auto_import_commit_batch(text, text, jsonb, jsonb) from anon$sql$;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute $sql$revoke all on function public.mp_ceo_auto_import_preflight() from authenticated$sql$;
    execute $sql$revoke all on function public.mp_ceo_auto_import_commit_batch(text, text, jsonb, jsonb) from authenticated$sql$;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute $sql$grant execute on function public.mp_ceo_auto_import_preflight() to service_role$sql$;
    execute $sql$grant execute on function public.mp_ceo_auto_import_commit_batch(text, text, jsonb, jsonb) to service_role$sql$;
  end if;
end
$ceo_ai_atomic_grants$;

notify pgrst, 'reload schema';
