-- Marketplace WS1 — catalogue seed (manual apply only)
-- Contract: sunchaser-marketplace-architecture-contract.md Revision 5.1
--
-- *****************************************************************************
-- DO NOT AUTO-APPLY TO PRODUCTION.
-- DO NOT apply to staging without separate owner authorization.
-- *****************************************************************************
--
-- Seeds:
--   15 brands, 6 categories, 30 products, 30 default variants
-- Frozen SKUs from approved WS1 preflight.
-- Deterministic IDs: mpbrand_ws1_*, mpcat_ws1_*, mpprod_ws1_*, mpvar_ws1_*
--
-- Safety:
--   - Bidirectional ownership guards (slug/SKU ↔ deterministic ID, plus
--     product taxonomy owners and variant product_id) abort the whole
--     transaction on mismatch — no partial writes, no price mutation.
--   - ID prefix alone is never treated as proof of seed ownership.
--   - Does not overwrite non-seed / foreign-owned records.
--   - Does not overwrite operational price changes (website_price_source <> 'seed').
--   - Does not seed costs, media, or delivery charges.
--   - Repeatable for correctly owned WS1 rows without duplicating products/variants.
--
-- Prerequisites: WS0 foundation + WS1 additive schema applied.

begin;

-- Allow seed upserts to refresh seed-owned price columns inside this transaction only.
-- Operational prices (website_price_source <> 'seed') are still preserved by CASE guards below.
select set_config('mp.allow_price_write', 'on', true);

-- -----------------------------------------------------------------------------
-- Bidirectional ownership guards (abort entire transaction on mismatch)
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_conflict text;
  v_found_slug text;
  v_found_sku text;
  v_found_product_id text;
  v_found_brand_id text;
  v_found_category_id text;
begin

  -- brand canadian-solar
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'canadian-solar' and id <> 'mpbrand_ws1_canadian_solar' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'canadian-solar', v_conflict, 'mpbrand_ws1_canadian_solar';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_canadian_solar';
  if v_found_slug is not null and v_found_slug <> 'canadian-solar' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_canadian_solar', v_found_slug, 'canadian-solar';
  end if;

  -- brand fronus
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'fronus' and id <> 'mpbrand_ws1_fronus' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'fronus', v_conflict, 'mpbrand_ws1_fronus';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_fronus';
  if v_found_slug is not null and v_found_slug <> 'fronus' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_fronus', v_found_slug, 'fronus';
  end if;

  -- brand generic
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'generic' and id <> 'mpbrand_ws1_generic' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'generic', v_conflict, 'mpbrand_ws1_generic';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_generic';
  if v_found_slug is not null and v_found_slug <> 'generic' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_generic', v_found_slug, 'generic';
  end if;

  -- brand growatt
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'growatt' and id <> 'mpbrand_ws1_growatt' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'growatt', v_conflict, 'mpbrand_ws1_growatt';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_growatt';
  if v_found_slug is not null and v_found_slug <> 'growatt' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_growatt', v_found_slug, 'growatt';
  end if;

  -- brand huawei
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'huawei' and id <> 'mpbrand_ws1_huawei' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'huawei', v_conflict, 'mpbrand_ws1_huawei';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_huawei';
  if v_found_slug is not null and v_found_slug <> 'huawei' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_huawei', v_found_slug, 'huawei';
  end if;

  -- brand inverex
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'inverex' and id <> 'mpbrand_ws1_inverex' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'inverex', v_conflict, 'mpbrand_ws1_inverex';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_inverex';
  if v_found_slug is not null and v_found_slug <> 'inverex' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_inverex', v_found_slug, 'inverex';
  end if;

  -- brand ja-solar
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'ja-solar' and id <> 'mpbrand_ws1_ja_solar' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'ja-solar', v_conflict, 'mpbrand_ws1_ja_solar';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_ja_solar';
  if v_found_slug is not null and v_found_slug <> 'ja-solar' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_ja_solar', v_found_slug, 'ja-solar';
  end if;

  -- brand jinko
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'jinko' and id <> 'mpbrand_ws1_jinko' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'jinko', v_conflict, 'mpbrand_ws1_jinko';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_jinko';
  if v_found_slug is not null and v_found_slug <> 'jinko' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_jinko', v_found_slug, 'jinko';
  end if;

  -- brand knox
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'knox' and id <> 'mpbrand_ws1_knox' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'knox', v_conflict, 'mpbrand_ws1_knox';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_knox';
  if v_found_slug is not null and v_found_slug <> 'knox' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_knox', v_found_slug, 'knox';
  end if;

  -- brand longi
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'longi' and id <> 'mpbrand_ws1_longi' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'longi', v_conflict, 'mpbrand_ws1_longi';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_longi';
  if v_found_slug is not null and v_found_slug <> 'longi' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_longi', v_found_slug, 'longi';
  end if;

  -- brand maxpower
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'maxpower' and id <> 'mpbrand_ws1_maxpower' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'maxpower', v_conflict, 'mpbrand_ws1_maxpower';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_maxpower';
  if v_found_slug is not null and v_found_slug <> 'maxpower' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_maxpower', v_found_slug, 'maxpower';
  end if;

  -- brand narada
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'narada' and id <> 'mpbrand_ws1_narada' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'narada', v_conflict, 'mpbrand_ws1_narada';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_narada';
  if v_found_slug is not null and v_found_slug <> 'narada' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_narada', v_found_slug, 'narada';
  end if;

  -- brand pylontech
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'pylontech' and id <> 'mpbrand_ws1_pylontech' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'pylontech', v_conflict, 'mpbrand_ws1_pylontech';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_pylontech';
  if v_found_slug is not null and v_found_slug <> 'pylontech' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_pylontech', v_found_slug, 'pylontech';
  end if;

  -- brand solis
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'solis' and id <> 'mpbrand_ws1_solis' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'solis', v_conflict, 'mpbrand_ws1_solis';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_solis';
  if v_found_slug is not null and v_found_slug <> 'solis' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_solis', v_found_slug, 'solis';
  end if;

  -- brand sunchaser
  v_conflict := null;
  select id into v_conflict from public.mp_brands
    where slug = 'sunchaser' and id <> 'mpbrand_ws1_sunchaser' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed brand slug ownership conflict: slug % owned by % (expected %)',
      'sunchaser', v_conflict, 'mpbrand_ws1_sunchaser';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_brands where id = 'mpbrand_ws1_sunchaser';
  if v_found_slug is not null and v_found_slug <> 'sunchaser' then
    raise exception 'WS1 seed brand ID ownership conflict: id % has slug % (expected %)',
      'mpbrand_ws1_sunchaser', v_found_slug, 'sunchaser';
  end if;

  -- category solar-inverters
  v_conflict := null;
  select id into v_conflict from public.mp_categories
    where slug = 'solar-inverters' and id <> 'mpcat_ws1_solar_inverters' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed category slug ownership conflict: slug % owned by % (expected %)',
      'solar-inverters', v_conflict, 'mpcat_ws1_solar_inverters';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_categories where id = 'mpcat_ws1_solar_inverters';
  if v_found_slug is not null and v_found_slug <> 'solar-inverters' then
    raise exception 'WS1 seed category ID ownership conflict: id % has slug % (expected %)',
      'mpcat_ws1_solar_inverters', v_found_slug, 'solar-inverters';
  end if;

  -- category solar-panels
  v_conflict := null;
  select id into v_conflict from public.mp_categories
    where slug = 'solar-panels' and id <> 'mpcat_ws1_solar_panels' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed category slug ownership conflict: slug % owned by % (expected %)',
      'solar-panels', v_conflict, 'mpcat_ws1_solar_panels';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_categories where id = 'mpcat_ws1_solar_panels';
  if v_found_slug is not null and v_found_slug <> 'solar-panels' then
    raise exception 'WS1 seed category ID ownership conflict: id % has slug % (expected %)',
      'mpcat_ws1_solar_panels', v_found_slug, 'solar-panels';
  end if;

  -- category lithium-batteries
  v_conflict := null;
  select id into v_conflict from public.mp_categories
    where slug = 'lithium-batteries' and id <> 'mpcat_ws1_lithium_batteries' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed category slug ownership conflict: slug % owned by % (expected %)',
      'lithium-batteries', v_conflict, 'mpcat_ws1_lithium_batteries';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_categories where id = 'mpcat_ws1_lithium_batteries';
  if v_found_slug is not null and v_found_slug <> 'lithium-batteries' then
    raise exception 'WS1 seed category ID ownership conflict: id % has slug % (expected %)',
      'mpcat_ws1_lithium_batteries', v_found_slug, 'lithium-batteries';
  end if;

  -- category hybrid-systems
  v_conflict := null;
  select id into v_conflict from public.mp_categories
    where slug = 'hybrid-systems' and id <> 'mpcat_ws1_hybrid_systems' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed category slug ownership conflict: slug % owned by % (expected %)',
      'hybrid-systems', v_conflict, 'mpcat_ws1_hybrid_systems';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_categories where id = 'mpcat_ws1_hybrid_systems';
  if v_found_slug is not null and v_found_slug <> 'hybrid-systems' then
    raise exception 'WS1 seed category ID ownership conflict: id % has slug % (expected %)',
      'mpcat_ws1_hybrid_systems', v_found_slug, 'hybrid-systems';
  end if;

  -- category accessories
  v_conflict := null;
  select id into v_conflict from public.mp_categories
    where slug = 'accessories' and id <> 'mpcat_ws1_accessories' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed category slug ownership conflict: slug % owned by % (expected %)',
      'accessories', v_conflict, 'mpcat_ws1_accessories';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_categories where id = 'mpcat_ws1_accessories';
  if v_found_slug is not null and v_found_slug <> 'accessories' then
    raise exception 'WS1 seed category ID ownership conflict: id % has slug % (expected %)',
      'mpcat_ws1_accessories', v_found_slug, 'accessories';
  end if;

  -- category on-grid-inverters
  v_conflict := null;
  select id into v_conflict from public.mp_categories
    where slug = 'on-grid-inverters' and id <> 'mpcat_ws1_on_grid_inverters' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed category slug ownership conflict: slug % owned by % (expected %)',
      'on-grid-inverters', v_conflict, 'mpcat_ws1_on_grid_inverters';
  end if;
  v_found_slug := null;
  select slug into v_found_slug from public.mp_categories where id = 'mpcat_ws1_on_grid_inverters';
  if v_found_slug is not null and v_found_slug <> 'on-grid-inverters' then
    raise exception 'WS1 seed category ID ownership conflict: id % has slug % (expected %)',
      'mpcat_ws1_on_grid_inverters', v_found_slug, 'on-grid-inverters';
  end if;

  -- product knox-krypton-eco-6-2kw-hybrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'knox-krypton-eco-6-2kw-hybrid' and id <> 'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'knox-krypton-eco-6-2kw-hybrid', v_conflict, 'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid';
  if v_found_slug is not null then
    if v_found_slug <> 'knox-krypton-eco-6-2kw-hybrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid', v_found_slug, 'knox-krypton-eco-6-2kw-hybrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_knox' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid', v_found_brand_id, 'mpbrand_ws1_knox';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid', v_found_category_id, 'mpcat_ws1_solar_inverters';
    end if;
  end if;

  -- variant SC-KNOX_KRYPTON_ECO_6_2KW_HYBRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-KNOX_KRYPTON_ECO_6_2KW_HYBRID' and id <> 'mpvar_ws1_knox_krypton_eco_6_2kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-KNOX_KRYPTON_ECO_6_2KW_HYBRID', v_conflict, 'mpvar_ws1_knox_krypton_eco_6_2kw_hybrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_knox_krypton_eco_6_2kw_hybrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-KNOX_KRYPTON_ECO_6_2KW_HYBRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_knox_krypton_eco_6_2kw_hybrid', v_found_sku, 'SC-KNOX_KRYPTON_ECO_6_2KW_HYBRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_knox_krypton_eco_6_2kw_hybrid', v_found_product_id, 'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid';
    end if;
  end if;

  -- product knox-krypton-6-5kw-pv9055-hybrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'knox-krypton-6-5kw-pv9055-hybrid' and id <> 'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'knox-krypton-6-5kw-pv9055-hybrid', v_conflict, 'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid';
  if v_found_slug is not null then
    if v_found_slug <> 'knox-krypton-6-5kw-pv9055-hybrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid', v_found_slug, 'knox-krypton-6-5kw-pv9055-hybrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_knox' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid', v_found_brand_id, 'mpbrand_ws1_knox';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid', v_found_category_id, 'mpcat_ws1_solar_inverters';
    end if;
  end if;

  -- variant SC-KNOX_KRYPTON_6_5KW_PV9055_HYBRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-KNOX_KRYPTON_6_5KW_PV9055_HYBRID' and id <> 'mpvar_ws1_knox_krypton_6_5kw_pv9055_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-KNOX_KRYPTON_6_5KW_PV9055_HYBRID', v_conflict, 'mpvar_ws1_knox_krypton_6_5kw_pv9055_hybrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_knox_krypton_6_5kw_pv9055_hybrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-KNOX_KRYPTON_6_5KW_PV9055_HYBRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_knox_krypton_6_5kw_pv9055_hybrid', v_found_sku, 'SC-KNOX_KRYPTON_6_5KW_PV9055_HYBRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_knox_krypton_6_5kw_pv9055_hybrid', v_found_product_id, 'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid';
    end if;
  end if;

  -- product growatt-min-6000tl-xh-6kw-hybrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'growatt-min-6000tl-xh-6kw-hybrid' and id <> 'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'growatt-min-6000tl-xh-6kw-hybrid', v_conflict, 'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid';
  if v_found_slug is not null then
    if v_found_slug <> 'growatt-min-6000tl-xh-6kw-hybrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid', v_found_slug, 'growatt-min-6000tl-xh-6kw-hybrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_growatt' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid', v_found_brand_id, 'mpbrand_ws1_growatt';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid', v_found_category_id, 'mpcat_ws1_solar_inverters';
    end if;
  end if;

  -- variant SC-GROWATT_MIN_6000TL_XH_6KW_HYBRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-GROWATT_MIN_6000TL_XH_6KW_HYBRID' and id <> 'mpvar_ws1_growatt_min_6000tl_xh_6kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-GROWATT_MIN_6000TL_XH_6KW_HYBRID', v_conflict, 'mpvar_ws1_growatt_min_6000tl_xh_6kw_hybrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_growatt_min_6000tl_xh_6kw_hybrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-GROWATT_MIN_6000TL_XH_6KW_HYBRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_growatt_min_6000tl_xh_6kw_hybrid', v_found_sku, 'SC-GROWATT_MIN_6000TL_XH_6KW_HYBRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_growatt_min_6000tl_xh_6kw_hybrid', v_found_product_id, 'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid';
    end if;
  end if;

  -- product growatt-sph-8000tl3-8kw-hybrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'growatt-sph-8000tl3-8kw-hybrid' and id <> 'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'growatt-sph-8000tl3-8kw-hybrid', v_conflict, 'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid';
  if v_found_slug is not null then
    if v_found_slug <> 'growatt-sph-8000tl3-8kw-hybrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid', v_found_slug, 'growatt-sph-8000tl3-8kw-hybrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_growatt' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid', v_found_brand_id, 'mpbrand_ws1_growatt';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid', v_found_category_id, 'mpcat_ws1_solar_inverters';
    end if;
  end if;

  -- variant SC-GROWATT_SPH_8000TL3_8KW_HYBRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-GROWATT_SPH_8000TL3_8KW_HYBRID' and id <> 'mpvar_ws1_growatt_sph_8000tl3_8kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-GROWATT_SPH_8000TL3_8KW_HYBRID', v_conflict, 'mpvar_ws1_growatt_sph_8000tl3_8kw_hybrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_growatt_sph_8000tl3_8kw_hybrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-GROWATT_SPH_8000TL3_8KW_HYBRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_growatt_sph_8000tl3_8kw_hybrid', v_found_sku, 'SC-GROWATT_SPH_8000TL3_8KW_HYBRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_growatt_sph_8000tl3_8kw_hybrid', v_found_product_id, 'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid';
    end if;
  end if;

  -- product solis-6kw-ip66-l-plus-hybrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'solis-6kw-ip66-l-plus-hybrid' and id <> 'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'solis-6kw-ip66-l-plus-hybrid', v_conflict, 'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid';
  if v_found_slug is not null then
    if v_found_slug <> 'solis-6kw-ip66-l-plus-hybrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid', v_found_slug, 'solis-6kw-ip66-l-plus-hybrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_solis' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid', v_found_brand_id, 'mpbrand_ws1_solis';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid', v_found_category_id, 'mpcat_ws1_solar_inverters';
    end if;
  end if;

  -- variant SC-SOLIS_6KW_IP66_L_PLUS_HYBRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-SOLIS_6KW_IP66_L_PLUS_HYBRID' and id <> 'mpvar_ws1_solis_6kw_ip66_l_plus_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-SOLIS_6KW_IP66_L_PLUS_HYBRID', v_conflict, 'mpvar_ws1_solis_6kw_ip66_l_plus_hybrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_solis_6kw_ip66_l_plus_hybrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-SOLIS_6KW_IP66_L_PLUS_HYBRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_solis_6kw_ip66_l_plus_hybrid', v_found_sku, 'SC-SOLIS_6KW_IP66_L_PLUS_HYBRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_solis_6kw_ip66_l_plus_hybrid', v_found_product_id, 'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid';
    end if;
  end if;

  -- product solis-8kw-ip66-l-plus-hybrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'solis-8kw-ip66-l-plus-hybrid' and id <> 'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'solis-8kw-ip66-l-plus-hybrid', v_conflict, 'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid';
  if v_found_slug is not null then
    if v_found_slug <> 'solis-8kw-ip66-l-plus-hybrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid', v_found_slug, 'solis-8kw-ip66-l-plus-hybrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_solis' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid', v_found_brand_id, 'mpbrand_ws1_solis';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid', v_found_category_id, 'mpcat_ws1_solar_inverters';
    end if;
  end if;

  -- variant SC-SOLIS_8KW_IP66_L_PLUS_HYBRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-SOLIS_8KW_IP66_L_PLUS_HYBRID' and id <> 'mpvar_ws1_solis_8kw_ip66_l_plus_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-SOLIS_8KW_IP66_L_PLUS_HYBRID', v_conflict, 'mpvar_ws1_solis_8kw_ip66_l_plus_hybrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_solis_8kw_ip66_l_plus_hybrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-SOLIS_8KW_IP66_L_PLUS_HYBRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_solis_8kw_ip66_l_plus_hybrid', v_found_sku, 'SC-SOLIS_8KW_IP66_L_PLUS_HYBRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_solis_8kw_ip66_l_plus_hybrid', v_found_product_id, 'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid';
    end if;
  end if;

  -- product huawei-sun2000-5kw-hybrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'huawei-sun2000-5kw-hybrid' and id <> 'mpprod_ws1_huawei_sun2000_5kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'huawei-sun2000-5kw-hybrid', v_conflict, 'mpprod_ws1_huawei_sun2000_5kw_hybrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_huawei_sun2000_5kw_hybrid';
  if v_found_slug is not null then
    if v_found_slug <> 'huawei-sun2000-5kw-hybrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_huawei_sun2000_5kw_hybrid', v_found_slug, 'huawei-sun2000-5kw-hybrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_huawei' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_huawei_sun2000_5kw_hybrid', v_found_brand_id, 'mpbrand_ws1_huawei';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_huawei_sun2000_5kw_hybrid', v_found_category_id, 'mpcat_ws1_solar_inverters';
    end if;
  end if;

  -- variant SC-HUAWEI_SUN2000_5KW_HYBRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-HUAWEI_SUN2000_5KW_HYBRID' and id <> 'mpvar_ws1_huawei_sun2000_5kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-HUAWEI_SUN2000_5KW_HYBRID', v_conflict, 'mpvar_ws1_huawei_sun2000_5kw_hybrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_huawei_sun2000_5kw_hybrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-HUAWEI_SUN2000_5KW_HYBRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_huawei_sun2000_5kw_hybrid', v_found_sku, 'SC-HUAWEI_SUN2000_5KW_HYBRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_huawei_sun2000_5kw_hybrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_huawei_sun2000_5kw_hybrid', v_found_product_id, 'mpprod_ws1_huawei_sun2000_5kw_hybrid';
    end if;
  end if;

  -- product huawei-sun2000-8kw-hybrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'huawei-sun2000-8kw-hybrid' and id <> 'mpprod_ws1_huawei_sun2000_8kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'huawei-sun2000-8kw-hybrid', v_conflict, 'mpprod_ws1_huawei_sun2000_8kw_hybrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_huawei_sun2000_8kw_hybrid';
  if v_found_slug is not null then
    if v_found_slug <> 'huawei-sun2000-8kw-hybrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_huawei_sun2000_8kw_hybrid', v_found_slug, 'huawei-sun2000-8kw-hybrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_huawei' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_huawei_sun2000_8kw_hybrid', v_found_brand_id, 'mpbrand_ws1_huawei';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_huawei_sun2000_8kw_hybrid', v_found_category_id, 'mpcat_ws1_solar_inverters';
    end if;
  end if;

  -- variant SC-HUAWEI_SUN2000_8KW_HYBRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-HUAWEI_SUN2000_8KW_HYBRID' and id <> 'mpvar_ws1_huawei_sun2000_8kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-HUAWEI_SUN2000_8KW_HYBRID', v_conflict, 'mpvar_ws1_huawei_sun2000_8kw_hybrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_huawei_sun2000_8kw_hybrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-HUAWEI_SUN2000_8KW_HYBRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_huawei_sun2000_8kw_hybrid', v_found_sku, 'SC-HUAWEI_SUN2000_8KW_HYBRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_huawei_sun2000_8kw_hybrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_huawei_sun2000_8kw_hybrid', v_found_product_id, 'mpprod_ws1_huawei_sun2000_8kw_hybrid';
    end if;
  end if;

  -- product inverex-nitrox-10kw-hybrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'inverex-nitrox-10kw-hybrid' and id <> 'mpprod_ws1_inverex_nitrox_10kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'inverex-nitrox-10kw-hybrid', v_conflict, 'mpprod_ws1_inverex_nitrox_10kw_hybrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_inverex_nitrox_10kw_hybrid';
  if v_found_slug is not null then
    if v_found_slug <> 'inverex-nitrox-10kw-hybrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_inverex_nitrox_10kw_hybrid', v_found_slug, 'inverex-nitrox-10kw-hybrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_inverex' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_inverex_nitrox_10kw_hybrid', v_found_brand_id, 'mpbrand_ws1_inverex';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_inverex_nitrox_10kw_hybrid', v_found_category_id, 'mpcat_ws1_solar_inverters';
    end if;
  end if;

  -- variant SC-INVEREX_NITROX_10KW_HYBRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-INVEREX_NITROX_10KW_HYBRID' and id <> 'mpvar_ws1_inverex_nitrox_10kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-INVEREX_NITROX_10KW_HYBRID', v_conflict, 'mpvar_ws1_inverex_nitrox_10kw_hybrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_inverex_nitrox_10kw_hybrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-INVEREX_NITROX_10KW_HYBRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_inverex_nitrox_10kw_hybrid', v_found_sku, 'SC-INVEREX_NITROX_10KW_HYBRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_inverex_nitrox_10kw_hybrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_inverex_nitrox_10kw_hybrid', v_found_product_id, 'mpprod_ws1_inverex_nitrox_10kw_hybrid';
    end if;
  end if;

  -- product maxpower-suntronic-6kw-hybrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'maxpower-suntronic-6kw-hybrid' and id <> 'mpprod_ws1_maxpower_suntronic_6kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'maxpower-suntronic-6kw-hybrid', v_conflict, 'mpprod_ws1_maxpower_suntronic_6kw_hybrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_maxpower_suntronic_6kw_hybrid';
  if v_found_slug is not null then
    if v_found_slug <> 'maxpower-suntronic-6kw-hybrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_maxpower_suntronic_6kw_hybrid', v_found_slug, 'maxpower-suntronic-6kw-hybrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_maxpower' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_maxpower_suntronic_6kw_hybrid', v_found_brand_id, 'mpbrand_ws1_maxpower';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_maxpower_suntronic_6kw_hybrid', v_found_category_id, 'mpcat_ws1_solar_inverters';
    end if;
  end if;

  -- variant SC-MAXPOWER_SUNTRONIC_6KW_HYBRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-MAXPOWER_SUNTRONIC_6KW_HYBRID' and id <> 'mpvar_ws1_maxpower_suntronic_6kw_hybrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-MAXPOWER_SUNTRONIC_6KW_HYBRID', v_conflict, 'mpvar_ws1_maxpower_suntronic_6kw_hybrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_maxpower_suntronic_6kw_hybrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-MAXPOWER_SUNTRONIC_6KW_HYBRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_maxpower_suntronic_6kw_hybrid', v_found_sku, 'SC-MAXPOWER_SUNTRONIC_6KW_HYBRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_maxpower_suntronic_6kw_hybrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_maxpower_suntronic_6kw_hybrid', v_found_product_id, 'mpprod_ws1_maxpower_suntronic_6kw_hybrid';
    end if;
  end if;

  -- product longi-himo6-580w-mono
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'longi-himo6-580w-mono' and id <> 'mpprod_ws1_longi_himo6_580w_mono' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'longi-himo6-580w-mono', v_conflict, 'mpprod_ws1_longi_himo6_580w_mono';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_longi_himo6_580w_mono';
  if v_found_slug is not null then
    if v_found_slug <> 'longi-himo6-580w-mono' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_longi_himo6_580w_mono', v_found_slug, 'longi-himo6-580w-mono';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_longi' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_longi_himo6_580w_mono', v_found_brand_id, 'mpbrand_ws1_longi';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_panels' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_longi_himo6_580w_mono', v_found_category_id, 'mpcat_ws1_solar_panels';
    end if;
  end if;

  -- variant SC-LONGI_HIMO6_580W_MONO
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-LONGI_HIMO6_580W_MONO' and id <> 'mpvar_ws1_longi_himo6_580w_mono' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-LONGI_HIMO6_580W_MONO', v_conflict, 'mpvar_ws1_longi_himo6_580w_mono';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_longi_himo6_580w_mono';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-LONGI_HIMO6_580W_MONO' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_longi_himo6_580w_mono', v_found_sku, 'SC-LONGI_HIMO6_580W_MONO';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_longi_himo6_580w_mono' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_longi_himo6_580w_mono', v_found_product_id, 'mpprod_ws1_longi_himo6_580w_mono';
    end if;
  end if;

  -- product longi-himo7-600w-ntype
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'longi-himo7-600w-ntype' and id <> 'mpprod_ws1_longi_himo7_600w_ntype' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'longi-himo7-600w-ntype', v_conflict, 'mpprod_ws1_longi_himo7_600w_ntype';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_longi_himo7_600w_ntype';
  if v_found_slug is not null then
    if v_found_slug <> 'longi-himo7-600w-ntype' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_longi_himo7_600w_ntype', v_found_slug, 'longi-himo7-600w-ntype';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_longi' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_longi_himo7_600w_ntype', v_found_brand_id, 'mpbrand_ws1_longi';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_panels' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_longi_himo7_600w_ntype', v_found_category_id, 'mpcat_ws1_solar_panels';
    end if;
  end if;

  -- variant SC-LONGI_HIMO7_600W_NTYPE
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-LONGI_HIMO7_600W_NTYPE' and id <> 'mpvar_ws1_longi_himo7_600w_ntype' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-LONGI_HIMO7_600W_NTYPE', v_conflict, 'mpvar_ws1_longi_himo7_600w_ntype';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_longi_himo7_600w_ntype';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-LONGI_HIMO7_600W_NTYPE' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_longi_himo7_600w_ntype', v_found_sku, 'SC-LONGI_HIMO7_600W_NTYPE';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_longi_himo7_600w_ntype' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_longi_himo7_600w_ntype', v_found_product_id, 'mpprod_ws1_longi_himo7_600w_ntype';
    end if;
  end if;

  -- product canadian-solar-hiku7-580w
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'canadian-solar-hiku7-580w' and id <> 'mpprod_ws1_canadian_solar_hiku7_580w' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'canadian-solar-hiku7-580w', v_conflict, 'mpprod_ws1_canadian_solar_hiku7_580w';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_canadian_solar_hiku7_580w';
  if v_found_slug is not null then
    if v_found_slug <> 'canadian-solar-hiku7-580w' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_canadian_solar_hiku7_580w', v_found_slug, 'canadian-solar-hiku7-580w';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_canadian_solar' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_canadian_solar_hiku7_580w', v_found_brand_id, 'mpbrand_ws1_canadian_solar';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_panels' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_canadian_solar_hiku7_580w', v_found_category_id, 'mpcat_ws1_solar_panels';
    end if;
  end if;

  -- variant SC-CANADIAN_SOLAR_HIKU7_580W
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-CANADIAN_SOLAR_HIKU7_580W' and id <> 'mpvar_ws1_canadian_solar_hiku7_580w' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-CANADIAN_SOLAR_HIKU7_580W', v_conflict, 'mpvar_ws1_canadian_solar_hiku7_580w';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_canadian_solar_hiku7_580w';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-CANADIAN_SOLAR_HIKU7_580W' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_canadian_solar_hiku7_580w', v_found_sku, 'SC-CANADIAN_SOLAR_HIKU7_580W';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_canadian_solar_hiku7_580w' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_canadian_solar_hiku7_580w', v_found_product_id, 'mpprod_ws1_canadian_solar_hiku7_580w';
    end if;
  end if;

  -- product jinko-tiger-neo-580w
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'jinko-tiger-neo-580w' and id <> 'mpprod_ws1_jinko_tiger_neo_580w' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'jinko-tiger-neo-580w', v_conflict, 'mpprod_ws1_jinko_tiger_neo_580w';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_jinko_tiger_neo_580w';
  if v_found_slug is not null then
    if v_found_slug <> 'jinko-tiger-neo-580w' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_jinko_tiger_neo_580w', v_found_slug, 'jinko-tiger-neo-580w';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_jinko' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_jinko_tiger_neo_580w', v_found_brand_id, 'mpbrand_ws1_jinko';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_panels' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_jinko_tiger_neo_580w', v_found_category_id, 'mpcat_ws1_solar_panels';
    end if;
  end if;

  -- variant SC-JINKO_TIGER_NEO_580W
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-JINKO_TIGER_NEO_580W' and id <> 'mpvar_ws1_jinko_tiger_neo_580w' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-JINKO_TIGER_NEO_580W', v_conflict, 'mpvar_ws1_jinko_tiger_neo_580w';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_jinko_tiger_neo_580w';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-JINKO_TIGER_NEO_580W' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_jinko_tiger_neo_580w', v_found_sku, 'SC-JINKO_TIGER_NEO_580W';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_jinko_tiger_neo_580w' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_jinko_tiger_neo_580w', v_found_product_id, 'mpprod_ws1_jinko_tiger_neo_580w';
    end if;
  end if;

  -- product ja-solar-deepblue-580w
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'ja-solar-deepblue-580w' and id <> 'mpprod_ws1_ja_solar_deepblue_580w' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'ja-solar-deepblue-580w', v_conflict, 'mpprod_ws1_ja_solar_deepblue_580w';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_ja_solar_deepblue_580w';
  if v_found_slug is not null then
    if v_found_slug <> 'ja-solar-deepblue-580w' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_ja_solar_deepblue_580w', v_found_slug, 'ja-solar-deepblue-580w';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_ja_solar' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_ja_solar_deepblue_580w', v_found_brand_id, 'mpbrand_ws1_ja_solar';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_solar_panels' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_ja_solar_deepblue_580w', v_found_category_id, 'mpcat_ws1_solar_panels';
    end if;
  end if;

  -- variant SC-JA_SOLAR_DEEPBLUE_580W
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-JA_SOLAR_DEEPBLUE_580W' and id <> 'mpvar_ws1_ja_solar_deepblue_580w' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-JA_SOLAR_DEEPBLUE_580W', v_conflict, 'mpvar_ws1_ja_solar_deepblue_580w';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_ja_solar_deepblue_580w';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-JA_SOLAR_DEEPBLUE_580W' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_ja_solar_deepblue_580w', v_found_sku, 'SC-JA_SOLAR_DEEPBLUE_580W';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_ja_solar_deepblue_580w' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_ja_solar_deepblue_580w', v_found_product_id, 'mpprod_ws1_ja_solar_deepblue_580w';
    end if;
  end if;

  -- product narada-5-12kwh-lithium
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'narada-5-12kwh-lithium' and id <> 'mpprod_ws1_narada_5_12kwh_lithium' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'narada-5-12kwh-lithium', v_conflict, 'mpprod_ws1_narada_5_12kwh_lithium';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_narada_5_12kwh_lithium';
  if v_found_slug is not null then
    if v_found_slug <> 'narada-5-12kwh-lithium' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_narada_5_12kwh_lithium', v_found_slug, 'narada-5-12kwh-lithium';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_narada' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_narada_5_12kwh_lithium', v_found_brand_id, 'mpbrand_ws1_narada';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_lithium_batteries' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_narada_5_12kwh_lithium', v_found_category_id, 'mpcat_ws1_lithium_batteries';
    end if;
  end if;

  -- variant SC-NARADA_5_12KWH_LITHIUM
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-NARADA_5_12KWH_LITHIUM' and id <> 'mpvar_ws1_narada_5_12kwh_lithium' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-NARADA_5_12KWH_LITHIUM', v_conflict, 'mpvar_ws1_narada_5_12kwh_lithium';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_narada_5_12kwh_lithium';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-NARADA_5_12KWH_LITHIUM' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_narada_5_12kwh_lithium', v_found_sku, 'SC-NARADA_5_12KWH_LITHIUM';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_narada_5_12kwh_lithium' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_narada_5_12kwh_lithium', v_found_product_id, 'mpprod_ws1_narada_5_12kwh_lithium';
    end if;
  end if;

  -- product knox-5-12kwh-lithium
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'knox-5-12kwh-lithium' and id <> 'mpprod_ws1_knox_5_12kwh_lithium' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'knox-5-12kwh-lithium', v_conflict, 'mpprod_ws1_knox_5_12kwh_lithium';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_knox_5_12kwh_lithium';
  if v_found_slug is not null then
    if v_found_slug <> 'knox-5-12kwh-lithium' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_knox_5_12kwh_lithium', v_found_slug, 'knox-5-12kwh-lithium';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_knox' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_knox_5_12kwh_lithium', v_found_brand_id, 'mpbrand_ws1_knox';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_lithium_batteries' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_knox_5_12kwh_lithium', v_found_category_id, 'mpcat_ws1_lithium_batteries';
    end if;
  end if;

  -- variant SC-KNOX_5_12KWH_LITHIUM
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-KNOX_5_12KWH_LITHIUM' and id <> 'mpvar_ws1_knox_5_12kwh_lithium' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-KNOX_5_12KWH_LITHIUM', v_conflict, 'mpvar_ws1_knox_5_12kwh_lithium';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_knox_5_12kwh_lithium';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-KNOX_5_12KWH_LITHIUM' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_knox_5_12kwh_lithium', v_found_sku, 'SC-KNOX_5_12KWH_LITHIUM';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_knox_5_12kwh_lithium' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_knox_5_12kwh_lithium', v_found_product_id, 'mpprod_ws1_knox_5_12kwh_lithium';
    end if;
  end if;

  -- product pylontech-us5000-4-8kwh
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'pylontech-us5000-4-8kwh' and id <> 'mpprod_ws1_pylontech_us5000_4_8kwh' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'pylontech-us5000-4-8kwh', v_conflict, 'mpprod_ws1_pylontech_us5000_4_8kwh';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_pylontech_us5000_4_8kwh';
  if v_found_slug is not null then
    if v_found_slug <> 'pylontech-us5000-4-8kwh' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_pylontech_us5000_4_8kwh', v_found_slug, 'pylontech-us5000-4-8kwh';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_pylontech' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_pylontech_us5000_4_8kwh', v_found_brand_id, 'mpbrand_ws1_pylontech';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_lithium_batteries' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_pylontech_us5000_4_8kwh', v_found_category_id, 'mpcat_ws1_lithium_batteries';
    end if;
  end if;

  -- variant SC-PYLONTECH_US5000_4_8KWH
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-PYLONTECH_US5000_4_8KWH' and id <> 'mpvar_ws1_pylontech_us5000_4_8kwh' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-PYLONTECH_US5000_4_8KWH', v_conflict, 'mpvar_ws1_pylontech_us5000_4_8kwh';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_pylontech_us5000_4_8kwh';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-PYLONTECH_US5000_4_8KWH' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_pylontech_us5000_4_8kwh', v_found_sku, 'SC-PYLONTECH_US5000_4_8KWH';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_pylontech_us5000_4_8kwh' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_pylontech_us5000_4_8kwh', v_found_product_id, 'mpprod_ws1_pylontech_us5000_4_8kwh';
    end if;
  end if;

  -- product inverex-lv2-6-lithium
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'inverex-lv2-6-lithium' and id <> 'mpprod_ws1_inverex_lv2_6_lithium' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'inverex-lv2-6-lithium', v_conflict, 'mpprod_ws1_inverex_lv2_6_lithium';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_inverex_lv2_6_lithium';
  if v_found_slug is not null then
    if v_found_slug <> 'inverex-lv2-6-lithium' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_inverex_lv2_6_lithium', v_found_slug, 'inverex-lv2-6-lithium';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_inverex' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_inverex_lv2_6_lithium', v_found_brand_id, 'mpbrand_ws1_inverex';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_lithium_batteries' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_inverex_lv2_6_lithium', v_found_category_id, 'mpcat_ws1_lithium_batteries';
    end if;
  end if;

  -- variant SC-INVEREX_LV2_6_LITHIUM
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-INVEREX_LV2_6_LITHIUM' and id <> 'mpvar_ws1_inverex_lv2_6_lithium' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-INVEREX_LV2_6_LITHIUM', v_conflict, 'mpvar_ws1_inverex_lv2_6_lithium';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_inverex_lv2_6_lithium';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-INVEREX_LV2_6_LITHIUM' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_inverex_lv2_6_lithium', v_found_sku, 'SC-INVEREX_LV2_6_LITHIUM';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_inverex_lv2_6_lithium' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_inverex_lv2_6_lithium', v_found_product_id, 'mpprod_ws1_inverex_lv2_6_lithium';
    end if;
  end if;

  -- product fronus-meta-10kw-ongrid
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'fronus-meta-10kw-ongrid' and id <> 'mpprod_ws1_fronus_meta_10kw_ongrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'fronus-meta-10kw-ongrid', v_conflict, 'mpprod_ws1_fronus_meta_10kw_ongrid';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_fronus_meta_10kw_ongrid';
  if v_found_slug is not null then
    if v_found_slug <> 'fronus-meta-10kw-ongrid' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_fronus_meta_10kw_ongrid', v_found_slug, 'fronus-meta-10kw-ongrid';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_fronus' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_fronus_meta_10kw_ongrid', v_found_brand_id, 'mpbrand_ws1_fronus';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_on_grid_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_fronus_meta_10kw_ongrid', v_found_category_id, 'mpcat_ws1_on_grid_inverters';
    end if;
  end if;

  -- variant SC-FRONUS_META_10KW_ONGRID
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-FRONUS_META_10KW_ONGRID' and id <> 'mpvar_ws1_fronus_meta_10kw_ongrid' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-FRONUS_META_10KW_ONGRID', v_conflict, 'mpvar_ws1_fronus_meta_10kw_ongrid';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_fronus_meta_10kw_ongrid';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-FRONUS_META_10KW_ONGRID' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_fronus_meta_10kw_ongrid', v_found_sku, 'SC-FRONUS_META_10KW_ONGRID';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_fronus_meta_10kw_ongrid' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_fronus_meta_10kw_ongrid', v_found_product_id, 'mpprod_ws1_fronus_meta_10kw_ongrid';
    end if;
  end if;

  -- product solis-6kw-ongrid-string
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'solis-6kw-ongrid-string' and id <> 'mpprod_ws1_solis_6kw_ongrid_string' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'solis-6kw-ongrid-string', v_conflict, 'mpprod_ws1_solis_6kw_ongrid_string';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_solis_6kw_ongrid_string';
  if v_found_slug is not null then
    if v_found_slug <> 'solis-6kw-ongrid-string' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_solis_6kw_ongrid_string', v_found_slug, 'solis-6kw-ongrid-string';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_solis' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_solis_6kw_ongrid_string', v_found_brand_id, 'mpbrand_ws1_solis';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_on_grid_inverters' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_solis_6kw_ongrid_string', v_found_category_id, 'mpcat_ws1_on_grid_inverters';
    end if;
  end if;

  -- variant SC-SOLIS_6KW_ONGRID_STRING
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-SOLIS_6KW_ONGRID_STRING' and id <> 'mpvar_ws1_solis_6kw_ongrid_string' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-SOLIS_6KW_ONGRID_STRING', v_conflict, 'mpvar_ws1_solis_6kw_ongrid_string';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_solis_6kw_ongrid_string';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-SOLIS_6KW_ONGRID_STRING' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_solis_6kw_ongrid_string', v_found_sku, 'SC-SOLIS_6KW_ONGRID_STRING';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_solis_6kw_ongrid_string' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_solis_6kw_ongrid_string', v_found_product_id, 'mpprod_ws1_solis_6kw_ongrid_string';
    end if;
  end if;

  -- product solar-mounting-structure-per-kw
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'solar-mounting-structure-per-kw' and id <> 'mpprod_ws1_solar_mounting_structure_per_kw' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'solar-mounting-structure-per-kw', v_conflict, 'mpprod_ws1_solar_mounting_structure_per_kw';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_solar_mounting_structure_per_kw';
  if v_found_slug is not null then
    if v_found_slug <> 'solar-mounting-structure-per-kw' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_solar_mounting_structure_per_kw', v_found_slug, 'solar-mounting-structure-per-kw';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_sunchaser' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_solar_mounting_structure_per_kw', v_found_brand_id, 'mpbrand_ws1_sunchaser';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_accessories' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_solar_mounting_structure_per_kw', v_found_category_id, 'mpcat_ws1_accessories';
    end if;
  end if;

  -- variant SC-SOLAR_MOUNTING_STRUCTURE_PER_KW
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-SOLAR_MOUNTING_STRUCTURE_PER_KW' and id <> 'mpvar_ws1_solar_mounting_structure_per_kw' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-SOLAR_MOUNTING_STRUCTURE_PER_KW', v_conflict, 'mpvar_ws1_solar_mounting_structure_per_kw';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_solar_mounting_structure_per_kw';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-SOLAR_MOUNTING_STRUCTURE_PER_KW' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_solar_mounting_structure_per_kw', v_found_sku, 'SC-SOLAR_MOUNTING_STRUCTURE_PER_KW';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_solar_mounting_structure_per_kw' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_solar_mounting_structure_per_kw', v_found_product_id, 'mpprod_ws1_solar_mounting_structure_per_kw';
    end if;
  end if;

  -- product dc-solar-cable-6mm-per-meter
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'dc-solar-cable-6mm-per-meter' and id <> 'mpprod_ws1_dc_solar_cable_6mm_per_meter' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'dc-solar-cable-6mm-per-meter', v_conflict, 'mpprod_ws1_dc_solar_cable_6mm_per_meter';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_dc_solar_cable_6mm_per_meter';
  if v_found_slug is not null then
    if v_found_slug <> 'dc-solar-cable-6mm-per-meter' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_dc_solar_cable_6mm_per_meter', v_found_slug, 'dc-solar-cable-6mm-per-meter';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_generic' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_dc_solar_cable_6mm_per_meter', v_found_brand_id, 'mpbrand_ws1_generic';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_accessories' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_dc_solar_cable_6mm_per_meter', v_found_category_id, 'mpcat_ws1_accessories';
    end if;
  end if;

  -- variant SC-DC_SOLAR_CABLE_6MM_PER_METER
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-DC_SOLAR_CABLE_6MM_PER_METER' and id <> 'mpvar_ws1_dc_solar_cable_6mm_per_meter' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-DC_SOLAR_CABLE_6MM_PER_METER', v_conflict, 'mpvar_ws1_dc_solar_cable_6mm_per_meter';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_dc_solar_cable_6mm_per_meter';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-DC_SOLAR_CABLE_6MM_PER_METER' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_dc_solar_cable_6mm_per_meter', v_found_sku, 'SC-DC_SOLAR_CABLE_6MM_PER_METER';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_dc_solar_cable_6mm_per_meter' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_dc_solar_cable_6mm_per_meter', v_found_product_id, 'mpprod_ws1_dc_solar_cable_6mm_per_meter';
    end if;
  end if;

  -- product mc4-solar-connectors-pair
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'mc4-solar-connectors-pair' and id <> 'mpprod_ws1_mc4_solar_connectors_pair' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'mc4-solar-connectors-pair', v_conflict, 'mpprod_ws1_mc4_solar_connectors_pair';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_mc4_solar_connectors_pair';
  if v_found_slug is not null then
    if v_found_slug <> 'mc4-solar-connectors-pair' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_mc4_solar_connectors_pair', v_found_slug, 'mc4-solar-connectors-pair';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_generic' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_mc4_solar_connectors_pair', v_found_brand_id, 'mpbrand_ws1_generic';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_accessories' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_mc4_solar_connectors_pair', v_found_category_id, 'mpcat_ws1_accessories';
    end if;
  end if;

  -- variant SC-MC4_SOLAR_CONNECTORS_PAIR
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-MC4_SOLAR_CONNECTORS_PAIR' and id <> 'mpvar_ws1_mc4_solar_connectors_pair' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-MC4_SOLAR_CONNECTORS_PAIR', v_conflict, 'mpvar_ws1_mc4_solar_connectors_pair';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_mc4_solar_connectors_pair';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-MC4_SOLAR_CONNECTORS_PAIR' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_mc4_solar_connectors_pair', v_found_sku, 'SC-MC4_SOLAR_CONNECTORS_PAIR';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_mc4_solar_connectors_pair' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_mc4_solar_connectors_pair', v_found_product_id, 'mpprod_ws1_mc4_solar_connectors_pair';
    end if;
  end if;

  -- product solar-lightning-arrester-dc
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'solar-lightning-arrester-dc' and id <> 'mpprod_ws1_solar_lightning_arrester_dc' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'solar-lightning-arrester-dc', v_conflict, 'mpprod_ws1_solar_lightning_arrester_dc';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_solar_lightning_arrester_dc';
  if v_found_slug is not null then
    if v_found_slug <> 'solar-lightning-arrester-dc' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_solar_lightning_arrester_dc', v_found_slug, 'solar-lightning-arrester-dc';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_generic' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_solar_lightning_arrester_dc', v_found_brand_id, 'mpbrand_ws1_generic';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_accessories' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_solar_lightning_arrester_dc', v_found_category_id, 'mpcat_ws1_accessories';
    end if;
  end if;

  -- variant SC-SOLAR_LIGHTNING_ARRESTER_DC
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-SOLAR_LIGHTNING_ARRESTER_DC' and id <> 'mpvar_ws1_solar_lightning_arrester_dc' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-SOLAR_LIGHTNING_ARRESTER_DC', v_conflict, 'mpvar_ws1_solar_lightning_arrester_dc';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_solar_lightning_arrester_dc';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-SOLAR_LIGHTNING_ARRESTER_DC' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_solar_lightning_arrester_dc', v_found_sku, 'SC-SOLAR_LIGHTNING_ARRESTER_DC';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_solar_lightning_arrester_dc' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_solar_lightning_arrester_dc', v_found_product_id, 'mpprod_ws1_solar_lightning_arrester_dc';
    end if;
  end if;

  -- product ac-dc-distribution-box
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'ac-dc-distribution-box' and id <> 'mpprod_ws1_ac_dc_distribution_box' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'ac-dc-distribution-box', v_conflict, 'mpprod_ws1_ac_dc_distribution_box';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_ac_dc_distribution_box';
  if v_found_slug is not null then
    if v_found_slug <> 'ac-dc-distribution-box' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_ac_dc_distribution_box', v_found_slug, 'ac-dc-distribution-box';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_sunchaser' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_ac_dc_distribution_box', v_found_brand_id, 'mpbrand_ws1_sunchaser';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_accessories' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_ac_dc_distribution_box', v_found_category_id, 'mpcat_ws1_accessories';
    end if;
  end if;

  -- variant SC-AC_DC_DISTRIBUTION_BOX
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-AC_DC_DISTRIBUTION_BOX' and id <> 'mpvar_ws1_ac_dc_distribution_box' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-AC_DC_DISTRIBUTION_BOX', v_conflict, 'mpvar_ws1_ac_dc_distribution_box';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_ac_dc_distribution_box';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-AC_DC_DISTRIBUTION_BOX' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_ac_dc_distribution_box', v_found_sku, 'SC-AC_DC_DISTRIBUTION_BOX';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_ac_dc_distribution_box' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_ac_dc_distribution_box', v_found_product_id, 'mpprod_ws1_ac_dc_distribution_box';
    end if;
  end if;

  -- product bi-directional-net-meter
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = 'bi-directional-net-meter' and id <> 'mpprod_ws1_bi_directional_net_meter' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      'bi-directional-net-meter', v_conflict, 'mpprod_ws1_bi_directional_net_meter';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_bi_directional_net_meter';
  if v_found_slug is not null then
    if v_found_slug <> 'bi-directional-net-meter' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_bi_directional_net_meter', v_found_slug, 'bi-directional-net-meter';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_generic' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_bi_directional_net_meter', v_found_brand_id, 'mpbrand_ws1_generic';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_accessories' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_bi_directional_net_meter', v_found_category_id, 'mpcat_ws1_accessories';
    end if;
  end if;

  -- variant SC-BI_DIRECTIONAL_NET_METER
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-BI_DIRECTIONAL_NET_METER' and id <> 'mpvar_ws1_bi_directional_net_meter' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-BI_DIRECTIONAL_NET_METER', v_conflict, 'mpvar_ws1_bi_directional_net_meter';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_bi_directional_net_meter';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-BI_DIRECTIONAL_NET_METER' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_bi_directional_net_meter', v_found_sku, 'SC-BI_DIRECTIONAL_NET_METER';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_bi_directional_net_meter' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_bi_directional_net_meter', v_found_product_id, 'mpprod_ws1_bi_directional_net_meter';
    end if;
  end if;

  -- product 6kw-complete-hybrid-system
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = '6kw-complete-hybrid-system' and id <> 'mpprod_ws1_6kw_complete_hybrid_system' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      '6kw-complete-hybrid-system', v_conflict, 'mpprod_ws1_6kw_complete_hybrid_system';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_6kw_complete_hybrid_system';
  if v_found_slug is not null then
    if v_found_slug <> '6kw-complete-hybrid-system' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_6kw_complete_hybrid_system', v_found_slug, '6kw-complete-hybrid-system';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_sunchaser' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_6kw_complete_hybrid_system', v_found_brand_id, 'mpbrand_ws1_sunchaser';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_hybrid_systems' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_6kw_complete_hybrid_system', v_found_category_id, 'mpcat_ws1_hybrid_systems';
    end if;
  end if;

  -- variant SC-6KW_COMPLETE_HYBRID_SYSTEM
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-6KW_COMPLETE_HYBRID_SYSTEM' and id <> 'mpvar_ws1_6kw_complete_hybrid_system' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-6KW_COMPLETE_HYBRID_SYSTEM', v_conflict, 'mpvar_ws1_6kw_complete_hybrid_system';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_6kw_complete_hybrid_system';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-6KW_COMPLETE_HYBRID_SYSTEM' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_6kw_complete_hybrid_system', v_found_sku, 'SC-6KW_COMPLETE_HYBRID_SYSTEM';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_6kw_complete_hybrid_system' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_6kw_complete_hybrid_system', v_found_product_id, 'mpprod_ws1_6kw_complete_hybrid_system';
    end if;
  end if;

  -- product 10kw-complete-hybrid-system
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = '10kw-complete-hybrid-system' and id <> 'mpprod_ws1_10kw_complete_hybrid_system' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      '10kw-complete-hybrid-system', v_conflict, 'mpprod_ws1_10kw_complete_hybrid_system';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_10kw_complete_hybrid_system';
  if v_found_slug is not null then
    if v_found_slug <> '10kw-complete-hybrid-system' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_10kw_complete_hybrid_system', v_found_slug, '10kw-complete-hybrid-system';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_sunchaser' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_10kw_complete_hybrid_system', v_found_brand_id, 'mpbrand_ws1_sunchaser';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_hybrid_systems' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_10kw_complete_hybrid_system', v_found_category_id, 'mpcat_ws1_hybrid_systems';
    end if;
  end if;

  -- variant SC-10KW_COMPLETE_HYBRID_SYSTEM
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-10KW_COMPLETE_HYBRID_SYSTEM' and id <> 'mpvar_ws1_10kw_complete_hybrid_system' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-10KW_COMPLETE_HYBRID_SYSTEM', v_conflict, 'mpvar_ws1_10kw_complete_hybrid_system';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_10kw_complete_hybrid_system';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-10KW_COMPLETE_HYBRID_SYSTEM' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_10kw_complete_hybrid_system', v_found_sku, 'SC-10KW_COMPLETE_HYBRID_SYSTEM';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_10kw_complete_hybrid_system' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_10kw_complete_hybrid_system', v_found_product_id, 'mpprod_ws1_10kw_complete_hybrid_system';
    end if;
  end if;

  -- product 15kw-commercial-solar-system
  v_conflict := null;
  select id into v_conflict from public.mp_products
    where slug = '15kw-commercial-solar-system' and id <> 'mpprod_ws1_15kw_commercial_solar_system' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed product slug ownership conflict: slug % owned by % (expected %)',
      '15kw-commercial-solar-system', v_conflict, 'mpprod_ws1_15kw_commercial_solar_system';
  end if;
  v_found_slug := null;
  v_found_brand_id := null;
  v_found_category_id := null;
  select slug, brand_id, category_id
    into v_found_slug, v_found_brand_id, v_found_category_id
  from public.mp_products where id = 'mpprod_ws1_15kw_commercial_solar_system';
  if v_found_slug is not null then
    if v_found_slug <> '15kw-commercial-solar-system' then
      raise exception 'WS1 seed product ID ownership conflict: id % has slug % (expected %)',
        'mpprod_ws1_15kw_commercial_solar_system', v_found_slug, '15kw-commercial-solar-system';
    end if;
    if v_found_brand_id is distinct from 'mpbrand_ws1_sunchaser' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has brand_id % (expected %)',
        'mpprod_ws1_15kw_commercial_solar_system', v_found_brand_id, 'mpbrand_ws1_sunchaser';
    end if;
    if v_found_category_id is distinct from 'mpcat_ws1_hybrid_systems' then
      raise exception 'WS1 seed product ID taxonomy conflict: id % has category_id % (expected %)',
        'mpprod_ws1_15kw_commercial_solar_system', v_found_category_id, 'mpcat_ws1_hybrid_systems';
    end if;
  end if;

  -- variant SC-15KW_COMMERCIAL_SOLAR_SYSTEM
  v_conflict := null;
  select id into v_conflict from public.mp_product_variants
    where sku = 'SC-15KW_COMMERCIAL_SOLAR_SYSTEM' and id <> 'mpvar_ws1_15kw_commercial_solar_system' limit 1;
  if v_conflict is not null then
    raise exception 'WS1 seed SKU ownership conflict: sku % owned by % (expected %)',
      'SC-15KW_COMMERCIAL_SOLAR_SYSTEM', v_conflict, 'mpvar_ws1_15kw_commercial_solar_system';
  end if;
  v_found_sku := null;
  v_found_product_id := null;
  select sku, product_id into v_found_sku, v_found_product_id
  from public.mp_product_variants where id = 'mpvar_ws1_15kw_commercial_solar_system';
  if v_found_sku is not null then
    if v_found_sku <> 'SC-15KW_COMMERCIAL_SOLAR_SYSTEM' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has sku % (expected %)',
        'mpvar_ws1_15kw_commercial_solar_system', v_found_sku, 'SC-15KW_COMMERCIAL_SOLAR_SYSTEM';
    end if;
    if v_found_product_id is distinct from 'mpprod_ws1_15kw_commercial_solar_system' then
      raise exception 'WS1 seed variant ID ownership conflict: id % has product_id % (expected %)',
        'mpvar_ws1_15kw_commercial_solar_system', v_found_product_id, 'mpprod_ws1_15kw_commercial_solar_system';
    end if;
  end if;

end $guard$;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_canadian_solar', 'Canadian Solar', 'canadian-solar', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_fronus', 'Fronus', 'fronus', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_generic', 'Generic', 'generic', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_growatt', 'Growatt', 'growatt', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_huawei', 'Huawei', 'huawei', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_inverex', 'Inverex', 'inverex', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_ja_solar', 'JA Solar', 'ja-solar', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_jinko', 'Jinko', 'jinko', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_knox', 'Knox', 'knox', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_longi', 'Longi', 'longi', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_maxpower', 'MaxPower', 'maxpower', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_narada', 'Narada', 'narada', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_pylontech', 'Pylontech', 'pylontech', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_solis', 'Solis', 'solis', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_brands (id, name, slug, active)
values ('mpbrand_ws1_sunchaser', 'SunChaser', 'sunchaser', true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_brands.slug = excluded.slug;

insert into public.mp_categories (id, name, slug, description, sort_order, active)
values ('mpcat_ws1_solar_inverters', 'Solar Inverters', 'solar-inverters', 'Hybrid, On-Grid, and Off-Grid solar inverters from top brands', 1, true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_categories.slug = excluded.slug;

insert into public.mp_categories (id, name, slug, description, sort_order, active)
values ('mpcat_ws1_solar_panels', 'Solar Panels', 'solar-panels', 'High-efficiency mono and poly crystalline solar panels', 2, true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_categories.slug = excluded.slug;

insert into public.mp_categories (id, name, slug, description, sort_order, active)
values ('mpcat_ws1_lithium_batteries', 'Lithium Batteries', 'lithium-batteries', 'Long-lasting lithium-ion and LiFePO4 batteries for solar storage', 3, true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_categories.slug = excluded.slug;

insert into public.mp_categories (id, name, slug, description, sort_order, active)
values ('mpcat_ws1_hybrid_systems', 'Hybrid Systems', 'hybrid-systems', 'Complete hybrid solar system packages for homes and businesses', 4, true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_categories.slug = excluded.slug;

insert into public.mp_categories (id, name, slug, description, sort_order, active)
values ('mpcat_ws1_accessories', 'Accessories', 'accessories', 'Solar mounting structures, cables, connectors, and protection devices', 5, true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_categories.slug = excluded.slug;

insert into public.mp_categories (id, name, slug, description, sort_order, active)
values ('mpcat_ws1_on_grid_inverters', 'On-Grid Inverters', 'on-grid-inverters', 'Grid-tied inverters for net metering and zero export systems', 6, true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = timezone('utc', now())
where public.mp_categories.slug = excluded.slug;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid', 'mpbrand_ws1_knox', 'mpcat_ws1_solar_inverters',
  'Knox Krypton Eco 6.2KW IP-21 PV6600 Hybrid Solar Inverter', 'knox-krypton-eco-6-2kw-hybrid', 'The Knox Krypton Eco 6.2KW is a powerful hybrid solar inverter with PV6600 input, built-in MPPT charge controller, and WiFi monitoring. Perfect for residential solar systems with battery backup capability.',
  array['knox','hybrid','6kw','residential']::text[], true, true,
  111000, 'priced_auto', '{"Power": "6.2KW","Type": "Hybrid","MPPT": "Dual MPPT","PVInput": "6600W","BatteryVoltage": "48V","Efficiency": "97.6%","Protection": "IP21","Display": "LCD","WiFi": "Built-in"}'::jsonb, '2 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid', 'mpbrand_ws1_knox', 'mpcat_ws1_solar_inverters',
  'Knox Krypton 6.5KW PV9055 Hybrid Solar Inverter', 'knox-krypton-6-5kw-pv9055-hybrid', 'Advanced 6.5KW hybrid inverter from Knox with high PV input of 9055W, dual MPPT trackers, and smart energy management. Ideal for medium-sized homes.',
  array['knox','hybrid','6.5kw']::text[], true, true,
  135000, 'priced_auto', '{"Power": "6.5KW","Type": "Hybrid","MPPT": "Dual MPPT","PVInput": "9055W","BatteryVoltage": "48V","Efficiency": "97.8%","Protection": "IP21","WiFi": "Built-in"}'::jsonb, '2 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid', 'mpbrand_ws1_growatt', 'mpcat_ws1_solar_inverters',
  'Growatt MIN 6000TL-XH 6KW Hybrid Solar Inverter', 'growatt-min-6000tl-xh-6kw-hybrid', 'Growatt MIN 6000TL-XH is a compact and efficient 6KW hybrid inverter with built-in MPPT, battery management, and remote monitoring via ShinePhone app.',
  array['growatt','hybrid','6kw','ip65']::text[], true, true,
  175000, 'priced_auto', '{"Power": "6KW","Type": "Hybrid","MPPT": "Dual MPPT","PVInput": "8000W","BatteryVoltage": "48V","Efficiency": "97.6%","Protection": "IP65","Display": "OLED","WiFi": "Built-in"}'::jsonb, '5 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid', 'mpbrand_ws1_growatt', 'mpcat_ws1_solar_inverters',
  'Growatt SPH 8000TL3-BH 8KW Three Phase Hybrid Inverter', 'growatt-sph-8000tl3-8kw-hybrid', 'Premium 8KW three-phase hybrid inverter from Growatt with advanced battery management and high efficiency for commercial installations.',
  array['growatt','hybrid','8kw','three-phase','commercial']::text[], true, false,
  245000, 'priced_auto', '{"Power": "8KW","Type": "Hybrid Three Phase","MPPT": "Dual MPPT","PVInput": "12000W","BatteryVoltage": "48V","Efficiency": "98%","Protection": "IP65"}'::jsonb, '5 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid', 'mpbrand_ws1_solis', 'mpcat_ws1_solar_inverters',
  'Solis S6-EH1P 6KW IP66 L Plus Hybrid Inverter', 'solis-6kw-ip66-l-plus-hybrid', 'Solis 6KW IP66 rated hybrid inverter with L Plus technology, outdoor installation ready, dual MPPT, and comprehensive battery compatibility.',
  array['solis','hybrid','6kw','ip66','outdoor']::text[], true, true,
  195000, 'priced_auto', '{"Power": "6KW","Type": "Hybrid","MPPT": "Dual MPPT","PVInput": "9000W","BatteryVoltage": "48V","Efficiency": "97.7%","Protection": "IP66","Display": "LCD"}'::jsonb, '5 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid', 'mpbrand_ws1_solis', 'mpcat_ws1_solar_inverters',
  'Solis S6-EH1P 8KW IP66 L Plus Hybrid Inverter', 'solis-8kw-ip66-l-plus-hybrid', 'Solis 8KW IP66 rated hybrid inverter with L Plus technology for larger residential and small commercial systems.',
  array['solis','hybrid','8kw','ip66']::text[], true, false,
  315000, 'priced_auto', '{"Power": "8KW","Type": "Hybrid","MPPT": "Dual MPPT","PVInput": "12000W","BatteryVoltage": "48V","Efficiency": "97.8%","Protection": "IP66"}'::jsonb, '5 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_huawei_sun2000_5kw_hybrid', 'mpbrand_ws1_huawei', 'mpcat_ws1_solar_inverters',
  'Huawei SUN2000-5KTL-M1 5KW Hybrid Inverter', 'huawei-sun2000-5kw-hybrid', 'Huawei 5KW hybrid inverter with AI-powered energy management, built-in PID recovery, and FusionSolar app for smart monitoring.',
  array['huawei','hybrid','5kw','premium']::text[], true, true,
  210000, 'priced_auto', '{"Power": "5KW","Type": "Hybrid","MPPT": "Dual MPPT","PVInput": "7500W","BatteryVoltage": "48V","Efficiency": "98.6%","Protection": "IP65","WiFi": "Built-in"}'::jsonb, '5 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_huawei_sun2000_8kw_hybrid', 'mpbrand_ws1_huawei', 'mpcat_ws1_solar_inverters',
  'Huawei SUN2000-8KTL-M1 8KW Hybrid Inverter', 'huawei-sun2000-8kw-hybrid', 'Premium 8KW hybrid inverter from Huawei with industry-leading efficiency and smart energy management capabilities.',
  array['huawei','hybrid','8kw','premium']::text[], true, false,
  320000, 'priced_auto', '{"Power": "8KW","Type": "Hybrid","MPPT": "Dual MPPT","PVInput": "12000W","Efficiency": "98.6%","Protection": "IP65"}'::jsonb, '5 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_inverex_nitrox_10kw_hybrid', 'mpbrand_ws1_inverex', 'mpcat_ws1_solar_inverters',
  'Inverex Nitrox 10KW Hybrid Solar Inverter', 'inverex-nitrox-10kw-hybrid', 'Inverex Nitrox 10KW hybrid inverter with high PV input, dual MPPT, and robust build quality for large residential and commercial systems.',
  array['inverex','hybrid','10kw','commercial']::text[], true, false,
  285000, 'priced_auto', '{"Power": "10KW","Type": "Hybrid","MPPT": "Dual MPPT","PVInput": "14000W","BatteryVoltage": "48V","Efficiency": "97.5%","Protection": "IP21"}'::jsonb, '2 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_maxpower_suntronic_6kw_hybrid', 'mpbrand_ws1_maxpower', 'mpcat_ws1_solar_inverters',
  'MaxPower Suntronic 6KW PV7000 Hybrid Inverter', 'maxpower-suntronic-6kw-hybrid', 'MaxPower Suntronic 6KW hybrid inverter with PV7000 input, MPPT charge controller, and WiFi monitoring for residential solar systems.',
  array['maxpower','hybrid','6kw','budget']::text[], true, false,
  115000, 'priced_auto', '{"Power": "6KW","Type": "Hybrid","MPPT": "Dual MPPT","PVInput": "7000W","BatteryVoltage": "48V","Efficiency": "97.2%","Protection": "IP21"}'::jsonb, '2 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_longi_himo6_580w_mono', 'mpbrand_ws1_longi', 'mpcat_ws1_solar_panels',
  'Longi Hi-MO 6 580W Mono PERC Solar Panel', 'longi-himo6-580w-mono', 'Longi Hi-MO 6 580W monocrystalline solar panel with PERC technology, offering industry-leading efficiency and 25-year performance warranty.',
  array['longi','580w','mono','tier1','a-grade']::text[], true, true,
  18500, 'priced_auto', '{"Power": "580W","Type": "Monocrystalline PERC","Efficiency": "22.3%","Cells": "144 Half-Cut","Dimensions": "2278x1134x35mm","Weight": "28.6kg","Connector": "MC4"}'::jsonb, '12 Year Product + 25 Year Performance'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_longi_himo7_600w_ntype', 'mpbrand_ws1_longi', 'mpcat_ws1_solar_panels',
  'Longi Hi-MO 7 600W N-Type Solar Panel', 'longi-himo7-600w-ntype', 'Latest Longi Hi-MO 7 600W N-Type solar panel with HPBC technology for maximum energy yield and superior low-light performance.',
  array['longi','600w','n-type','premium']::text[], true, true,
  19500, 'priced_auto', '{"Power": "600W","Type": "N-Type HPBC","Efficiency": "23.2%","Cells": "144 Half-Cut","Dimensions": "2278x1134x35mm","Weight": "29.2kg"}'::jsonb, '12 Year Product + 30 Year Performance'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_canadian_solar_hiku7_580w', 'mpbrand_ws1_canadian_solar', 'mpcat_ws1_solar_panels',
  'Canadian Solar HiKu7 CS7L-580MS Mono PERC Panel', 'canadian-solar-hiku7-580w', 'Canadian Solar HiKu7 580W mono PERC panel with half-cut cell technology for enhanced shade tolerance and higher energy output.',
  array['canadian-solar','580w','mono','tier1']::text[], true, true,
  18000, 'priced_auto', '{"Power": "580W","Type": "Monocrystalline PERC","Efficiency": "22.1%","Cells": "144 Half-Cut","Dimensions": "2278x1134x35mm","Weight": "28.8kg"}'::jsonb, '12 Year Product + 25 Year Performance'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_jinko_tiger_neo_580w', 'mpbrand_ws1_jinko', 'mpcat_ws1_solar_panels',
  'Jinko Tiger Neo 580W N-Type Solar Panel', 'jinko-tiger-neo-580w', 'Jinko Tiger Neo 580W N-Type panel with TOPCon technology delivering exceptional efficiency and temperature coefficient performance.',
  array['jinko','580w','n-type','topcon']::text[], true, false,
  18200, 'priced_auto', '{"Power": "580W","Type": "N-Type TOPCon","Efficiency": "22.5%","Cells": "144 Half-Cut","Dimensions": "2278x1134x30mm","Weight": "28.4kg"}'::jsonb, '12 Year Product + 30 Year Performance'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_ja_solar_deepblue_580w', 'mpbrand_ws1_ja_solar', 'mpcat_ws1_solar_panels',
  'JA Solar DeepBlue 4.0 580W Mono PERC Panel', 'ja-solar-deepblue-580w', 'JA Solar DeepBlue 4.0 580W panel with advanced PERC technology, excellent low-light performance, and proven reliability.',
  array['ja-solar','580w','mono','budget-tier1']::text[], true, false,
  17800, 'priced_auto', '{"Power": "580W","Type": "Monocrystalline PERC","Efficiency": "22.2%","Cells": "144 Half-Cut","Dimensions": "2278x1134x35mm","Weight": "28.5kg"}'::jsonb, '12 Year Product + 25 Year Performance'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_narada_5_12kwh_lithium', 'mpbrand_ws1_narada', 'mpcat_ws1_lithium_batteries',
  'Narada 5.12kWh 51.2V LiFePO4 Lithium Battery', 'narada-5-12kwh-lithium', 'Narada 5.12kWh lithium iron phosphate battery with 6000+ cycle life, built-in BMS, and stackable design for solar energy storage.',
  array['narada','5kwh','lithium','lifepo4']::text[], true, true,
  245000, 'priced_auto', '{"Capacity": "5.12kWh","Voltage": "51.2V","Chemistry": "LiFePO4","CycleLife": "6000+ cycles","DoD": "95%","BMS": "Built-in","Stackable": "Yes","Weight": "52kg"}'::jsonb, '5 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_knox_5_12kwh_lithium', 'mpbrand_ws1_knox', 'mpcat_ws1_lithium_batteries',
  'Knox 5.12kWh 100Ah Lithium Battery', 'knox-5-12kwh-lithium', 'Knox 5.12kWh lithium battery with 100Ah capacity, built-in BMS, and parallel expansion capability for residential solar storage.',
  array['knox','5kwh','lithium']::text[], true, false,
  235000, 'priced_auto', '{"Capacity": "5.12kWh","Voltage": "51.2V","Current": "100Ah","Chemistry": "LiFePO4","CycleLife": "6000+ cycles","BMS": "Built-in","Stackable": "Yes"}'::jsonb, '3 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_pylontech_us5000_4_8kwh', 'mpbrand_ws1_pylontech', 'mpcat_ws1_lithium_batteries',
  'Pylontech US5000 4.8kWh Lithium Battery', 'pylontech-us5000-4-8kwh', 'Pylontech US5000 4.8kWh lithium battery with industry-leading cycle life, modular design, and wide inverter compatibility.',
  array['pylontech','4.8kwh','lithium','premium']::text[], true, true,
  265000, 'priced_auto', '{"Capacity": "4.8kWh","Voltage": "48V","Chemistry": "LiFePO4","CycleLife": "6000+ cycles","DoD": "95%","BMS": "Built-in","Stackable": "Up to 16 units"}'::jsonb, '5 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_inverex_lv2_6_lithium', 'mpbrand_ws1_inverex', 'mpcat_ws1_lithium_batteries',
  'Inverex LV2.6 25.6V 104Ah Lithium-Ion Battery', 'inverex-lv2-6-lithium', 'Inverex LV2.6 compact lithium battery with 2.6kWh capacity, ideal for smaller solar systems and backup power.',
  array['inverex','2.6kwh','lithium','compact']::text[], true, false,
  188000, 'priced_auto', '{"Capacity": "2.6kWh","Voltage": "25.6V","Current": "104Ah","Chemistry": "Lithium-Ion","CycleLife": "4000+ cycles","BMS": "Built-in"}'::jsonb, '2 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_fronus_meta_10kw_ongrid', 'mpbrand_ws1_fronus', 'mpcat_ws1_on_grid_inverters',
  'Fronus Meta 10KW PV14000 Battery Less On-Grid Inverter', 'fronus-meta-10kw-ongrid', 'Fronus Meta 10KW on-grid inverter designed for net metering systems. Battery-less operation with high PV input for maximum grid export.',
  array['fronus','10kw','on-grid','net-metering']::text[], true, true,
  165000, 'priced_auto', '{"Power": "10KW","Type": "On-Grid","MPPT": "Dual MPPT","PVInput": "14000W","Efficiency": "98.2%","Protection": "IP65","NetMetering": "Yes"}'::jsonb, '5 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_solis_6kw_ongrid_string', 'mpbrand_ws1_solis', 'mpcat_ws1_on_grid_inverters',
  'Solis S6-GR1P 6KW On-Grid String Inverter', 'solis-6kw-ongrid-string', 'Solis 6KW on-grid string inverter for residential net metering with high efficiency and reliable grid-tied operation.',
  array['solis','6kw','on-grid','net-metering']::text[], true, false,
  145000, 'priced_auto', '{"Power": "6KW","Type": "On-Grid","MPPT": "Dual MPPT","PVInput": "9000W","Efficiency": "97.8%","Protection": "IP66"}'::jsonb, '5 Years Official Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_solar_mounting_structure_per_kw', 'mpbrand_ws1_sunchaser', 'mpcat_ws1_accessories',
  'Solar Panel Mounting Structure (Per KW)', 'solar-mounting-structure-per-kw', 'Heavy-duty galvanized steel solar panel mounting structure. Suitable for rooftop and ground-mount installations. Price per KW.',
  array['mounting','structure','rooftop']::text[], true, false,
  8000, 'priced_auto', '{"Material": "Galvanized Steel","Type": "Rooftop/Ground Mount","WindRating": "Up to 150 km/h","Tilt": "Adjustable 10-30°"}'::jsonb, '10 Years Structural Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_dc_solar_cable_6mm_per_meter', 'mpbrand_ws1_generic', 'mpcat_ws1_accessories',
  'DC Solar Cable 6mm² (Per Meter)', 'dc-solar-cable-6mm-per-meter', 'UV-resistant 6mm² DC solar cable for connecting solar panels. TUV certified with excellent weather resistance.',
  array['cable','dc','6mm']::text[], true, false,
  150, 'priced_auto', '{"Size": "6mm²","Type": "DC Solar Cable","Rating": "1000V DC","Certification": "TUV","UVResistant": "Yes"}'::jsonb, 'N/A'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_mc4_solar_connectors_pair', 'mpbrand_ws1_generic', 'mpcat_ws1_accessories',
  'MC4 Solar Connectors (Pair)', 'mc4-solar-connectors-pair', 'High-quality MC4 solar connectors for reliable panel-to-cable connections. IP67 rated and TUV certified.',
  array['mc4','connectors']::text[], true, false,
  300, 'priced_auto', '{"Type": "MC4","Rating": "30A / 1000V DC","Protection": "IP67","Material": "PPO + Copper"}'::jsonb, 'N/A'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_solar_lightning_arrester_dc', 'mpbrand_ws1_generic', 'mpcat_ws1_accessories',
  'Solar Lightning Arrester DC 1000V', 'solar-lightning-arrester-dc', 'DC surge protection device for solar systems. Protects inverters and panels from lightning and voltage surges.',
  array['lightning','arrester','protection']::text[], true, false,
  5000, 'priced_auto', '{"Type": "DC SPD","Rating": "1000V DC","Protection": "Type II","Discharge": "40kA"}'::jsonb, '1 Year Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_ac_dc_distribution_box', 'mpbrand_ws1_sunchaser', 'mpcat_ws1_accessories',
  'AC/DC Distribution Box Complete', 'ac-dc-distribution-box', 'Complete AC/DC distribution box with breakers, surge protection, and proper labeling for solar installations.',
  array['distribution','box','breakers']::text[], true, false,
  12000, 'priced_auto', '{"Type": "Distribution Box","Includes": "AC+DC Breakers, SPD, MCBs","Material": "Metal Enclosure","Protection": "IP54"}'::jsonb, '1 Year Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_bi_directional_net_meter', 'mpbrand_ws1_generic', 'mpcat_ws1_accessories',
  'Bi-Directional Net Metering Meter', 'bi-directional-net-meter', 'Bi-directional energy meter for net metering systems. Records both import and export energy for accurate billing.',
  array['meter','net-metering','bi-directional']::text[], true, false,
  15000, 'priced_auto', '{"Type": "Bi-Directional","Phase": "Single/Three Phase","Display": "LCD","Communication": "RS485","Accuracy": "Class 1"}'::jsonb, '2 Years Warranty'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_6kw_complete_hybrid_system', 'mpbrand_ws1_sunchaser', 'mpcat_ws1_hybrid_systems',
  '6KW Complete Hybrid Solar System Package', '6kw-complete-hybrid-system', 'Complete 6KW hybrid solar system including inverter, panels, battery, mounting structure, cables, and installation. Perfect for 3-4 bedroom homes with 15,000-25,000 PKR monthly bills.',
  array['complete','system','6kw','residential','package']::text[], true, true,
  850000, 'priced_auto', '{"SystemSize": "6KW","Inverter": "6KW Hybrid","Panels": "10x 580W Tier-1","Battery": "5.12kWh Lithium","Structure": "Included","Cables": "Included","Installation": "Included","MonthlyBillRange": "PKR 15,000-25,000"}'::jsonb, 'Component-specific warranty terms confirmed in the final quotation.'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_10kw_complete_hybrid_system', 'mpbrand_ws1_sunchaser', 'mpcat_ws1_hybrid_systems',
  '10KW Complete Hybrid Solar System Package', '10kw-complete-hybrid-system', 'Complete 10KW hybrid solar system for larger homes and small commercial setups. Includes premium inverter, panels, battery bank, and full installation.',
  array['complete','system','10kw','commercial','package']::text[], true, true,
  1450000, 'priced_auto', '{"SystemSize": "10KW","Inverter": "10KW Hybrid","Panels": "17x 580W Tier-1","Battery": "10.24kWh Lithium","Structure": "Included","Cables": "Included","Installation": "Included","MonthlyBillRange": "PKR 25,000-50,000"}'::jsonb, 'Component-specific warranty terms confirmed in the final quotation.'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_products (
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  display_from_price, display_price_state, specifications, warranty
) values (
  'mpprod_ws1_15kw_commercial_solar_system', 'mpbrand_ws1_sunchaser', 'mpcat_ws1_hybrid_systems',
  '15KW Commercial Solar System Package', '15kw-commercial-solar-system', 'Premium 15KW commercial solar system with three-phase inverter, high-efficiency panels, and industrial-grade battery storage.',
  array['complete','system','15kw','commercial','three-phase']::text[], true, false,
  2200000, 'priced_auto', '{"SystemSize": "15KW","Inverter": "15KW Three Phase Hybrid","Panels": "26x 580W Tier-1","Battery": "15.36kWh Lithium","Structure": "Included","Installation": "Included","MonthlyBillRange": "PKR 50,000-100,000"}'::jsonb, 'Component-specific warranty terms confirmed in the final quotation.'
)
on conflict (id) do update set
  brand_id = excluded.brand_id,
  category_id = excluded.category_id,
  title = excluded.title,
  slug = excluded.slug,
  description = excluded.description,
  tags = excluded.tags,
  active = true,
  featured = excluded.featured,
  specifications = excluded.specifications,
  warranty = excluded.warranty,
  display_from_price = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_from_price
    else public.mp_products.display_from_price
  end,
  display_price_state = case
    when exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
        and v.is_default and v.active
        and v.website_price_source = 'seed'
    ) or not exists (
      select 1 from public.mp_product_variants v
      where v.product_id = public.mp_products.id
    )
    then excluded.display_price_state
    else public.mp_products.display_price_state
  end,
  updated_at = timezone('utc', now())
where public.mp_products.slug = excluded.slug
  and public.mp_products.brand_id = excluded.brand_id
  and public.mp_products.category_id = excluded.category_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_knox_krypton_eco_6_2kw_hybrid', 'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid', 'SC-KNOX_KRYPTON_ECO_6_2KW_HYBRID', 'Default',
  true, true, 'unknown', 111000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_knox_krypton_6_5kw_pv9055_hybrid', 'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid', 'SC-KNOX_KRYPTON_6_5KW_PV9055_HYBRID', 'Default',
  true, true, 'unknown', 135000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_growatt_min_6000tl_xh_6kw_hybrid', 'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid', 'SC-GROWATT_MIN_6000TL_XH_6KW_HYBRID', 'Default',
  true, true, 'unknown', 175000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_growatt_sph_8000tl3_8kw_hybrid', 'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid', 'SC-GROWATT_SPH_8000TL3_8KW_HYBRID', 'Default',
  true, true, 'unknown', 245000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_solis_6kw_ip66_l_plus_hybrid', 'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid', 'SC-SOLIS_6KW_IP66_L_PLUS_HYBRID', 'Default',
  true, true, 'unknown', 195000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_solis_8kw_ip66_l_plus_hybrid', 'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid', 'SC-SOLIS_8KW_IP66_L_PLUS_HYBRID', 'Default',
  true, true, 'unknown', 315000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_huawei_sun2000_5kw_hybrid', 'mpprod_ws1_huawei_sun2000_5kw_hybrid', 'SC-HUAWEI_SUN2000_5KW_HYBRID', 'Default',
  true, true, 'unknown', 210000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_huawei_sun2000_8kw_hybrid', 'mpprod_ws1_huawei_sun2000_8kw_hybrid', 'SC-HUAWEI_SUN2000_8KW_HYBRID', 'Default',
  true, true, 'unknown', 320000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_inverex_nitrox_10kw_hybrid', 'mpprod_ws1_inverex_nitrox_10kw_hybrid', 'SC-INVEREX_NITROX_10KW_HYBRID', 'Default',
  true, true, 'unknown', 285000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_maxpower_suntronic_6kw_hybrid', 'mpprod_ws1_maxpower_suntronic_6kw_hybrid', 'SC-MAXPOWER_SUNTRONIC_6KW_HYBRID', 'Default',
  true, true, 'unknown', 115000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_longi_himo6_580w_mono', 'mpprod_ws1_longi_himo6_580w_mono', 'SC-LONGI_HIMO6_580W_MONO', 'Default',
  true, true, 'unknown', 18500, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_longi_himo7_600w_ntype', 'mpprod_ws1_longi_himo7_600w_ntype', 'SC-LONGI_HIMO7_600W_NTYPE', 'Default',
  true, true, 'unknown', 19500, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_canadian_solar_hiku7_580w', 'mpprod_ws1_canadian_solar_hiku7_580w', 'SC-CANADIAN_SOLAR_HIKU7_580W', 'Default',
  true, true, 'unknown', 18000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_jinko_tiger_neo_580w', 'mpprod_ws1_jinko_tiger_neo_580w', 'SC-JINKO_TIGER_NEO_580W', 'Default',
  true, true, 'unknown', 18200, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_ja_solar_deepblue_580w', 'mpprod_ws1_ja_solar_deepblue_580w', 'SC-JA_SOLAR_DEEPBLUE_580W', 'Default',
  true, true, 'unknown', 17800, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_narada_5_12kwh_lithium', 'mpprod_ws1_narada_5_12kwh_lithium', 'SC-NARADA_5_12KWH_LITHIUM', 'Default',
  true, true, 'unknown', 245000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_knox_5_12kwh_lithium', 'mpprod_ws1_knox_5_12kwh_lithium', 'SC-KNOX_5_12KWH_LITHIUM', 'Default',
  true, true, 'unknown', 235000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_pylontech_us5000_4_8kwh', 'mpprod_ws1_pylontech_us5000_4_8kwh', 'SC-PYLONTECH_US5000_4_8KWH', 'Default',
  true, true, 'unknown', 265000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_inverex_lv2_6_lithium', 'mpprod_ws1_inverex_lv2_6_lithium', 'SC-INVEREX_LV2_6_LITHIUM', 'Default',
  true, true, 'unknown', 188000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_fronus_meta_10kw_ongrid', 'mpprod_ws1_fronus_meta_10kw_ongrid', 'SC-FRONUS_META_10KW_ONGRID', 'Default',
  true, true, 'unknown', 165000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_solis_6kw_ongrid_string', 'mpprod_ws1_solis_6kw_ongrid_string', 'SC-SOLIS_6KW_ONGRID_STRING', 'Default',
  true, true, 'unknown', 145000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_solar_mounting_structure_per_kw', 'mpprod_ws1_solar_mounting_structure_per_kw', 'SC-SOLAR_MOUNTING_STRUCTURE_PER_KW', 'Default',
  true, true, 'unknown', 8000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_dc_solar_cable_6mm_per_meter', 'mpprod_ws1_dc_solar_cable_6mm_per_meter', 'SC-DC_SOLAR_CABLE_6MM_PER_METER', 'Default',
  true, true, 'unknown', 150, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_mc4_solar_connectors_pair', 'mpprod_ws1_mc4_solar_connectors_pair', 'SC-MC4_SOLAR_CONNECTORS_PAIR', 'Default',
  true, true, 'unknown', 300, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_solar_lightning_arrester_dc', 'mpprod_ws1_solar_lightning_arrester_dc', 'SC-SOLAR_LIGHTNING_ARRESTER_DC', 'Default',
  true, true, 'unknown', 5000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_ac_dc_distribution_box', 'mpprod_ws1_ac_dc_distribution_box', 'SC-AC_DC_DISTRIBUTION_BOX', 'Default',
  true, true, 'unknown', 12000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_bi_directional_net_meter', 'mpprod_ws1_bi_directional_net_meter', 'SC-BI_DIRECTIONAL_NET_METER', 'Default',
  true, true, 'unknown', 15000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_6kw_complete_hybrid_system', 'mpprod_ws1_6kw_complete_hybrid_system', 'SC-6KW_COMPLETE_HYBRID_SYSTEM', 'Default',
  true, true, 'unknown', 850000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_10kw_complete_hybrid_system', 'mpprod_ws1_10kw_complete_hybrid_system', 'SC-10KW_COMPLETE_HYBRID_SYSTEM', 'Default',
  true, true, 'unknown', 1450000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;

insert into public.mp_product_variants (
  id, product_id, sku, title, is_default, is_priceable,
  stock_status, website_price, website_price_state, website_price_source, active
) values (
  'mpvar_ws1_15kw_commercial_solar_system', 'mpprod_ws1_15kw_commercial_solar_system', 'SC-15KW_COMMERCIAL_SOLAR_SYSTEM', 'Default',
  true, true, 'unknown', 2200000, 'priced_auto', 'seed', true
)
on conflict (id) do update set
  product_id = excluded.product_id,
  sku = excluded.sku,
  title = excluded.title,
  is_default = true,
  is_priceable = true,
  active = true,
  stock_status = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.stock_status
    else public.mp_product_variants.stock_status
  end,
  website_price = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price
    else public.mp_product_variants.website_price
  end,
  website_price_state = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_state
    else public.mp_product_variants.website_price_state
  end,
  website_price_source = case
    when public.mp_product_variants.website_price_source = 'seed'
      then excluded.website_price_source
    else public.mp_product_variants.website_price_source
  end,
  updated_at = timezone('utc', now())
where public.mp_product_variants.sku = excluded.sku
  and public.mp_product_variants.product_id = excluded.product_id;


do $assert$
declare
  v_products integer;
  v_variants integer;
begin
  select count(*) into v_products from public.mp_products where id like 'mpprod\_ws1\_%' escape '\';
  select count(*) into v_variants from public.mp_product_variants
    where id like 'mpvar\_ws1\_%' escape '\' and is_default = true;
  if v_products <> 30 or v_variants <> 30 then
    raise exception 'WS1 seed assertion failed: products=% default_variants=% (expected 30/30)', v_products, v_variants;
  end if;
end $assert$;

commit;
