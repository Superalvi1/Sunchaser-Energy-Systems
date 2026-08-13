-- Marketplace WS1 — public catalogue RPC contract (manual apply only)
-- Contract: sunchaser-marketplace-architecture-contract.md Revision 5.1
--
-- *****************************************************************************
-- DO NOT AUTO-APPLY TO PRODUCTION.
-- DO NOT apply to staging without separate owner authorization.
-- *****************************************************************************
--
-- Adds:
--   - mp_products.ws1_public boolean NOT NULL DEFAULT false
--   - public.mp_public_catalogue_list(...)
--   - public.mp_public_catalogue_get_by_slug(...)
--
-- The ws1_public flag is the explicit fail-closed gate for the curated WS1
-- public scope (30 seed products). It defaults to false, so existing rows are
-- NOT automatically exposed.
--
-- A separately reviewable DML plan to enable the 30 WS1 seed products is
-- included at the bottom of this file as comments only. Do not execute it
-- during migration review.
--
-- Prerequisites: WS0 foundation + WS1 additive schema + core.sql applied.

-- =============================================================================
-- 1. Explicit WS1 public-scope gate
-- =============================================================================
alter table public.mp_products
  add column if not exists ws1_public boolean not null default false;

comment on column public.mp_products.ws1_public is
  'Fail-closed gate: only products with ws1_public=true are returned by the WS1 public RPCs.';

-- =============================================================================
-- 2. Public catalogue list RPC
-- =============================================================================
create or replace function public.mp_public_catalogue_list(
  p_category_slug text default null,
  p_brand_slug text default null,
  p_featured_only boolean default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(product jsonb, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible as (
    select
      p.id,
      p.slug,
      p.title,
      p.description,
      p.short_description,
      p.model,
      p.seo_title,
      p.seo_description,
      p.datasheet_url,
      p.tags,
      p.featured,
      p.specifications,
      p.warranty,
      b.slug as brand_slug,
      b.name as brand_name,
      c.slug as category_slug,
      c.name as category_name,
      c.description as category_description,
      c.sort_order as category_sort_order,
      v.sku as variant_sku,
      v.title as variant_title,
      v.website_price as variant_website_price,
      v.website_price_state as variant_website_price_state,
      v.website_price_source as variant_website_price_source,
      v.stock_status as variant_stock_status
    from public.mp_products p
    join public.mp_brands b
      on b.id = p.brand_id
      and b.active = true
    join public.mp_categories c
      on c.id = p.category_id
      and c.active = true
    join public.mp_product_variants v
      on v.product_id = p.id
      and v.is_default = true
      and v.active <> false
    where p.active = true
      and p.public_visible = true
      and p.ws1_public = true
      and (p_featured_only is null or p.featured = p_featured_only)
      and (p_brand_slug is null or b.slug = p_brand_slug)
      and (p_category_slug is null or c.slug = p_category_slug)
  ),
  total_cte as (
    select count(*)::bigint as total from eligible
  ),
  media_eligible as (
    select
      m.product_id,
      m.source_url,
      row_number() over (
        partition by m.product_id
        order by
          case when m.role = 'thumbnail' then 0 else 1 end,
          m.sort_order,
          m.id
      ) as rn
    from public.mp_media m
    where m.published = true
      and m.role <> 'receipt'
      and m.source_type in ('supplier', 'own', 'licensed', 'user_upload', 'manufacturer')
      and m.rights_status in ('supplier_approved', 'own', 'licensed')
  ),
  paged as (
    select e.*, tc.total
    from eligible e
    cross join total_cte tc
    order by e.title, e.id
    offset greatest(0, p_offset)
    limit greatest(1, least(p_limit, 500))
  )
  select
    jsonb_build_object(
      'slug', p.slug,
      'title', p.title,
      'description', p.description,
      'shortDescription', p.short_description,
      'model', p.model,
      'seoTitle', p.seo_title,
      'seoDescription', p.seo_description,
      'datasheetUrl', p.datasheet_url,
      'brand', jsonb_build_object(
        'slug', p.brand_slug,
        'name', p.brand_name
      ),
      'category', jsonb_build_object(
        'slug', p.category_slug,
        'name', p.category_name,
        'description', p.category_description,
        'sortOrder', p.category_sort_order
      ),
      'tags', coalesce(p.tags, array[]::text[]),
      'featured', p.featured,
      'specifications', coalesce(p.specifications, '{}'::jsonb),
      'warranty', p.warranty,
      'image', (select me.source_url from media_eligible me where me.product_id = p.id and me.rn = 1),
      'images', coalesce(
        (select jsonb_agg(me.source_url order by me.rn)
         from media_eligible me
         where me.product_id = p.id and me.rn > 1),
        '[]'::jsonb
      ),
      'defaultVariant', jsonb_build_object(
        'sku', p.variant_sku,
        'title', p.variant_title,
        'isDefault', true,
        'websitePrice', p.variant_website_price,
        'websitePriceState', p.variant_website_price_state,
        'websitePriceSource', p.variant_website_price_source,
        'stockStatus', p.variant_stock_status
      )
    ) as product,
    p.total
  from paged p
  union all
  select null::jsonb, tc.total
  from total_cte tc
  where not exists (select 1 from paged);
$$;

-- =============================================================================
-- 3. Public catalogue single-product RPC
-- =============================================================================
create or replace function public.mp_public_catalogue_get_by_slug(
  p_slug text
)
returns table(product jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible as (
    select
      p.id,
      p.slug,
      p.title,
      p.description,
      p.short_description,
      p.model,
      p.seo_title,
      p.seo_description,
      p.datasheet_url,
      p.tags,
      p.featured,
      p.specifications,
      p.warranty,
      b.slug as brand_slug,
      b.name as brand_name,
      c.slug as category_slug,
      c.name as category_name,
      c.description as category_description,
      c.sort_order as category_sort_order,
      v.sku as variant_sku,
      v.title as variant_title,
      v.website_price as variant_website_price,
      v.website_price_state as variant_website_price_state,
      v.website_price_source as variant_website_price_source,
      v.stock_status as variant_stock_status
    from public.mp_products p
    join public.mp_brands b
      on b.id = p.brand_id
      and b.active = true
    join public.mp_categories c
      on c.id = p.category_id
      and c.active = true
    join public.mp_product_variants v
      on v.product_id = p.id
      and v.is_default = true
      and v.active <> false
    where p.slug = p_slug
      and p.active = true
      and p.public_visible = true
      and p.ws1_public = true
  ),
  media_eligible as (
    select
      m.product_id,
      m.source_url,
      row_number() over (
        partition by m.product_id
        order by
          case when m.role = 'thumbnail' then 0 else 1 end,
          m.sort_order,
          m.id
      ) as rn
    from public.mp_media m
    where m.published = true
      and m.role <> 'receipt'
      and m.source_type in ('supplier', 'own', 'licensed', 'user_upload', 'manufacturer')
      and m.rights_status in ('supplier_approved', 'own', 'licensed')
  )
  select jsonb_build_object(
    'slug', e.slug,
    'title', e.title,
    'description', e.description,
    'shortDescription', e.short_description,
    'model', e.model,
    'seoTitle', e.seo_title,
    'seoDescription', e.seo_description,
    'datasheetUrl', e.datasheet_url,
    'brand', jsonb_build_object(
      'slug', e.brand_slug,
      'name', e.brand_name
    ),
    'category', jsonb_build_object(
      'slug', e.category_slug,
      'name', e.category_name,
      'description', e.category_description,
      'sortOrder', e.category_sort_order
    ),
    'tags', coalesce(e.tags, array[]::text[]),
    'featured', e.featured,
    'specifications', coalesce(e.specifications, '{}'::jsonb),
    'warranty', e.warranty,
    'image', (select me.source_url from media_eligible me where me.product_id = e.id and me.rn = 1),
    'images', coalesce(
      (select jsonb_agg(me.source_url order by me.rn)
       from media_eligible me
       where me.product_id = e.id and me.rn > 1),
      '[]'::jsonb
    ),
    'defaultVariant', jsonb_build_object(
      'sku', e.variant_sku,
      'title', e.variant_title,
      'isDefault', true,
      'websitePrice', e.variant_website_price,
      'websitePriceState', e.variant_website_price_state,
      'websitePriceSource', e.variant_website_price_source,
      'stockStatus', e.variant_stock_status
    )
  ) as product
  from eligible e;
$$;

-- =============================================================================
-- 4. Privileges — revoke from PUBLIC first, then grant only intended roles
-- =============================================================================
revoke all on function public.mp_public_catalogue_list(
  text, text, boolean, integer, integer
) from public;

revoke all on function public.mp_public_catalogue_get_by_slug(
  text
) from public;

do $ws1_priv$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mp_public_catalogue_list(
      text, text, boolean, integer, integer
    ) from anon;
    revoke all on function public.mp_public_catalogue_get_by_slug(
      text
    ) from anon;

    grant execute on function public.mp_public_catalogue_list(
      text, text, boolean, integer, integer
    ) to anon;
    grant execute on function public.mp_public_catalogue_get_by_slug(
      text
    ) to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.mp_public_catalogue_list(
      text, text, boolean, integer, integer
    ) from authenticated;
    revoke all on function public.mp_public_catalogue_get_by_slug(
      text
    ) from authenticated;

    grant execute on function public.mp_public_catalogue_list(
      text, text, boolean, integer, integer
    ) to authenticated;
    grant execute on function public.mp_public_catalogue_get_by_slug(
      text
    ) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mp_public_catalogue_list(
      text, text, boolean, integer, integer
    ) to service_role;
    grant execute on function public.mp_public_catalogue_get_by_slug(
      text
    ) to service_role;
  end if;
end $ws1_priv$;

-- Reaffirm table RLS so the gate cannot be bypassed by direct table reads.
alter table public.mp_products enable row level security;
alter table public.mp_products force row level security;

-- =============================================================================
-- 5. Schema-cache reload notification
-- =============================================================================
notify pgrst, 'reload schema';

-- =============================================================================
-- 6. Separately reviewable DML plan (DO NOT EXECUTE as part of this migration)
-- =============================================================================
-- The following UPDATE enables the 30 curated WS1 seed products for public
-- catalogue display. It must be reviewed and executed separately, only after
-- business approval.
--
-- update public.mp_products
-- set ws1_public = true
-- where id in (
--   'mpprod_ws1_knox_krypton_eco_6_2kw_hybrid',
--   'mpprod_ws1_knox_krypton_6_5kw_pv9055_hybrid',
--   'mpprod_ws1_growatt_min_6000tl_xh_6kw_hybrid',
--   'mpprod_ws1_growatt_sph_8000tl3_8kw_hybrid',
--   'mpprod_ws1_solis_6kw_ip66_l_plus_hybrid',
--   'mpprod_ws1_solis_8kw_ip66_l_plus_hybrid',
--   'mpprod_ws1_huawei_sun2000_5kw_hybrid',
--   'mpprod_ws1_huawei_sun2000_8kw_hybrid',
--   'mpprod_ws1_inverex_nitrox_10kw_hybrid',
--   'mpprod_ws1_maxpower_suntronic_6kw_hybrid',
--   'mpprod_ws1_longi_himo6_580w_mono',
--   'mpprod_ws1_longi_himo7_600w_ntype',
--   'mpprod_ws1_canadian_solar_hiku7_580w',
--   'mpprod_ws1_jinko_tiger_neo_580w',
--   'mpprod_ws1_ja_solar_deepblue_580w',
--   'mpprod_ws1_narada_5_12kwh_lithium',
--   'mpprod_ws1_knox_5_12kwh_lithium',
--   'mpprod_ws1_pylontech_us5000_4_8kwh',
--   'mpprod_ws1_inverex_lv2_6_lithium',
--   'mpprod_ws1_fronus_meta_10kw_ongrid',
--   'mpprod_ws1_solis_6kw_ongrid_string',
--   'mpprod_ws1_solar_mounting_structure_per_kw',
--   'mpprod_ws1_dc_solar_cable_6mm_per_meter',
--   'mpprod_ws1_mc4_solar_connectors_pair',
--   'mpprod_ws1_solar_lightning_arrester_dc',
--   'mpprod_ws1_ac_dc_distribution_box',
--   'mpprod_ws1_bi_directional_net_meter',
--   'mpprod_ws1_6kw_complete_hybrid_system',
--   'mpprod_ws1_10kw_complete_hybrid_system',
--   'mpprod_ws1_15kw_commercial_solar_system'
-- );
