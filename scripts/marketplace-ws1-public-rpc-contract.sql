-- Marketplace WS1 — public catalogue RPC contract v2 (manual apply only)
-- Contract: sunchaser-marketplace-architecture-contract.md Revision 5.1
--
-- *****************************************************************************
-- DO NOT AUTO-APPLY TO PRODUCTION.
-- DO NOT apply to staging without separate owner authorization.
-- *****************************************************************************
--
-- Versioning rule:
--   This migration is ADDITIVE. It creates *_v2 functions only.
--   It does NOT create, replace, or drop the existing production
--   mp_public_catalogue_list(...) function (defined by
--   scripts/marketplace-catalogue-manager-list-rpc.sql). The v1 contract
--   remains untouched.
--
-- Adds:
--   - mp_products.ws1_public boolean NOT NULL DEFAULT false
--   - public.mp_public_catalogue_list_v2(...)
--   - public.mp_public_catalogue_get_by_slug_v2(text)
--   - public.mp_public_catalogue_categories_v2()
--   - public.mp_public_catalogue_brands_v2()
--
-- The ws1_public flag is the explicit fail-closed gate for the curated WS1
-- public scope. It defaults to false, so existing rows are NOT exposed.
--
-- Product activation (setting ws1_public = true) is NOT part of this
-- migration and is intentionally absent. Zero products are authorized for
-- activation. See the non-executable review document:
--   docs/marketplace-ws1-public-activation-review.md
--
-- Defence layers implemented here:
--   - Eligibility: active + public_visible + ws1_public + active default
--     variant + active brand + active category.
--   - Media: published=true, role<>'receipt', rights_status in
--     ('own','licensed','supplier_approved'), approved_by IS NOT NULL,
--     approved_at IS NOT NULL, source_url IS NOT NULL, HTTPS-only.
--     (The exact hostname allowlist is additionally enforced server-side in
--     the repository DTO mapping path.)
--   - Price: websitePrice is only emitted when website_price_state is
--     priced_auto/priced_override, stock_status='in_stock', and the price is
--     positive. confirm_price and non-in-stock variants emit null price.
--   - Categories/brands: only values connected to eligible products.
--
-- Prerequisites: WS0 foundation + WS1 additive schema applied.

-- =============================================================================
-- 1. Explicit WS1 public-scope gate
-- =============================================================================
alter table public.mp_products
  add column if not exists ws1_public boolean not null default false;

comment on column public.mp_products.ws1_public is
  'Fail-closed gate: only products with ws1_public=true are returned by the WS1 public v2 RPCs.';

-- =============================================================================
-- 2. Public catalogue list RPC (v2)
-- =============================================================================
create or replace function public.mp_public_catalogue_list_v2(
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
      and m.rights_status in ('own', 'licensed', 'supplier_approved')
      and m.approved_by is not null
      and m.approved_at is not null
      and m.source_url is not null
      and m.source_url like 'https://%'
  ),
  paged as (
    select e.*, tc.total
    from eligible e
    cross join total_cte tc
    order by e.title, e.id
    offset greatest(0, coalesce(p_offset, 0))
    limit greatest(1, least(coalesce(p_limit, 50), 500))
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
        'websitePrice', case
          when p.variant_website_price_state in ('priced_auto', 'priced_override')
            and p.variant_stock_status = 'in_stock'
            and p.variant_website_price is not null
            and p.variant_website_price > 0
          then p.variant_website_price
          else null
        end,
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
-- 3. Public catalogue single-product RPC (v2)
-- =============================================================================
create or replace function public.mp_public_catalogue_get_by_slug_v2(
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
      and m.rights_status in ('own', 'licensed', 'supplier_approved')
      and m.approved_by is not null
      and m.approved_at is not null
      and m.source_url is not null
      and m.source_url like 'https://%'
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
      'websitePrice', case
        when e.variant_website_price_state in ('priced_auto', 'priced_override')
          and e.variant_stock_status = 'in_stock'
          and e.variant_website_price is not null
          and e.variant_website_price > 0
        then e.variant_website_price
        else null
      end,
      'websitePriceState', e.variant_website_price_state,
      'websitePriceSource', e.variant_website_price_source,
      'stockStatus', e.variant_stock_status
    )
  ) as product
  from eligible e;
$$;

-- =============================================================================
-- 4. Public category RPC (v2) — scoped to eligible products only
-- =============================================================================
create or replace function public.mp_public_catalogue_categories_v2()
returns table(category jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', c.slug,
    'name', c.name,
    'description', c.description,
    'sortOrder', c.sort_order
  ) as category
  from public.mp_categories c
  where c.active = true
    and exists (
      select 1
      from public.mp_products p
      join public.mp_product_variants v
        on v.product_id = p.id
        and v.is_default = true
        and v.active <> false
      where p.category_id = c.id
        and p.active = true
        and p.public_visible = true
        and p.ws1_public = true
    )
  order by c.sort_order, c.slug;
$$;

-- =============================================================================
-- 5. Public brand RPC (v2) — scoped to eligible products only
-- =============================================================================
create or replace function public.mp_public_catalogue_brands_v2()
returns table(brand jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', b.slug,
    'name', b.name
  ) as brand
  from public.mp_brands b
  where b.active = true
    and exists (
      select 1
      from public.mp_products p
      join public.mp_product_variants v
        on v.product_id = p.id
        and v.is_default = true
        and v.active <> false
      where p.brand_id = b.id
        and p.active = true
        and p.public_visible = true
        and p.ws1_public = true
    )
  order by b.name, b.slug;
$$;

-- =============================================================================
-- 6. Privileges — revoke from PUBLIC first, then grant only intended roles
-- =============================================================================
revoke all on function public.mp_public_catalogue_list_v2(
  text, text, boolean, integer, integer
) from public;

revoke all on function public.mp_public_catalogue_get_by_slug_v2(
  text
) from public;

revoke all on function public.mp_public_catalogue_categories_v2() from public;

revoke all on function public.mp_public_catalogue_brands_v2() from public;

do $ws1_v2_priv$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mp_public_catalogue_list_v2(
      text, text, boolean, integer, integer
    ) from anon;
    revoke all on function public.mp_public_catalogue_get_by_slug_v2(
      text
    ) from anon;
    revoke all on function public.mp_public_catalogue_categories_v2() from anon;
    revoke all on function public.mp_public_catalogue_brands_v2() from anon;

    grant execute on function public.mp_public_catalogue_list_v2(
      text, text, boolean, integer, integer
    ) to anon;
    grant execute on function public.mp_public_catalogue_get_by_slug_v2(
      text
    ) to anon;
    grant execute on function public.mp_public_catalogue_categories_v2() to anon;
    grant execute on function public.mp_public_catalogue_brands_v2() to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.mp_public_catalogue_list_v2(
      text, text, boolean, integer, integer
    ) from authenticated;
    revoke all on function public.mp_public_catalogue_get_by_slug_v2(
      text
    ) from authenticated;
    revoke all on function public.mp_public_catalogue_categories_v2() from authenticated;
    revoke all on function public.mp_public_catalogue_brands_v2() from authenticated;

    grant execute on function public.mp_public_catalogue_list_v2(
      text, text, boolean, integer, integer
    ) to authenticated;
    grant execute on function public.mp_public_catalogue_get_by_slug_v2(
      text
    ) to authenticated;
    grant execute on function public.mp_public_catalogue_categories_v2() to authenticated;
    grant execute on function public.mp_public_catalogue_brands_v2() to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mp_public_catalogue_list_v2(
      text, text, boolean, integer, integer
    ) to service_role;
    grant execute on function public.mp_public_catalogue_get_by_slug_v2(
      text
    ) to service_role;
    grant execute on function public.mp_public_catalogue_categories_v2() to service_role;
    grant execute on function public.mp_public_catalogue_brands_v2() to service_role;
  end if;
end $ws1_v2_priv$;

-- Reaffirm table RLS so the gate cannot be bypassed by direct table reads.
alter table public.mp_products enable row level security;
alter table public.mp_products force row level security;

-- =============================================================================
-- 7. Schema-cache reload notification
-- =============================================================================
notify pgrst, 'reload schema';

-- =============================================================================
-- 8. Product activation is intentionally NOT included.
-- =============================================================================
-- No UPDATE of mp_products.ws1_public exists in this file, executable or
-- commented. Any future activation requires the separately reviewed,
-- non-executable plan in docs/marketplace-ws1-public-activation-review.md
-- plus explicit owner authorization and a standalone DML review.
