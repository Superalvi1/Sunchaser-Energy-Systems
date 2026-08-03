-- =============================================================================
-- Marketplace Catalogue Manager — effective-value list RPCs
-- =============================================================================
-- Additive / backward-compatible.
-- Adds two RPCs:
--   mp_catalogue_manager_list() — admin (service_role only), all filters
--   mp_public_catalogue_list()  — public (anon/authenticated), active+visible only
--
-- Both resolve effective values using active field overrides, apply filters
-- on EFFECTIVE values, and return paginated product IDs + accurate total —
-- bypassing Supabase's implicit 1000-row response cap.
--
-- The public RPC never returns hidden/inactive products or internal IDs.
-- DO NOT APPLY in automation. Prepare for CTO-approved SQL apply only.
-- =============================================================================

-- Ensure selected_supplier column exists (may be added by auto-import migration).
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mp_products'
      and column_name = 'selected_supplier'
  ) then
    alter table public.mp_products add column selected_supplier text;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Admin RPC: mp_catalogue_manager_list (service_role only)
-- ---------------------------------------------------------------------------

create or replace function public.mp_catalogue_manager_list(
  p_limit int default 50,
  p_offset int default 0,
  p_q text default null,
  p_brand_id text default null,
  p_category_id text default null,
  p_supplier text default null,
  p_active bool default null,
  p_public_visible bool default null,
  p_featured bool default null,
  p_stock_status text default null
) returns table(id text, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with effective as (
    select
      p.id,
      coalesce(
        (select o.override_value#>>'{}' from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'title' and o.active),
        p.title
      ) as effective_title,
      coalesce(
        (select o.override_value#>>'{}' from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'brand_id' and o.active),
        p.brand_id
      ) as effective_brand_id,
      coalesce(
        (select o.override_value#>>'{}' from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'category_id' and o.active),
        p.category_id
      ) as effective_category_id,
      coalesce(
        (select o.override_value::boolean from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'public_visible' and o.active),
        p.public_visible
      ) as effective_public_visible,
      coalesce(
        (select o.override_value::boolean from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'featured' and o.active),
        coalesce(p.featured, false)
      ) as effective_featured,
      coalesce(
        (select o.override_value#>>'{}' from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'stock_status' and o.active),
        (select v.stock_status from public.mp_product_variants v
         where v.product_id = p.id and v.is_default and v.active <> false
         limit 1),
        'unknown'
      ) as effective_stock_status,
      p.active as active,
      p.selected_supplier as selected_supplier
    from public.mp_products p
  ),
  filtered as (
    select * from effective
    where (p_active is null or active = p_active)
      and (p_public_visible is null or effective_public_visible = p_public_visible)
      and (p_featured is null or effective_featured = p_featured)
      and (p_stock_status is null or effective_stock_status = p_stock_status)
      and (p_brand_id is null or effective_brand_id = p_brand_id)
      and (p_category_id is null or effective_category_id = p_category_id)
      and (p_supplier is null or selected_supplier = p_supplier)
      and (p_q is null or effective_title ilike '%' || p_q || '%')
  ),
  total_cte as (
    select count(*)::bigint as total from filtered
  ),
  paged as (
    select f.id, tc.total
    from filtered f cross join total_cte tc
    order by f.effective_title, f.id
    offset greatest(0, p_offset)
    limit greatest(1, least(p_limit, 500))
  )
  select p.id, p.total from paged p
  union all
  select null::text, tc.total from total_cte tc
  where not exists (select 1 from paged)
$$;

-- Security: revoke from PUBLIC, anon, authenticated; grant only to service_role
revoke execute on function public.mp_catalogue_manager_list(
  int, int, text, text, text, text, boolean, boolean, boolean, text
) from public;
revoke execute on function public.mp_catalogue_manager_list(
  int, int, text, text, text, text, boolean, boolean, boolean, text
) from anon;
revoke execute on function public.mp_catalogue_manager_list(
  int, int, text, text, text, text, boolean, boolean, boolean, text
) from authenticated;
grant execute on function public.mp_catalogue_manager_list(
  int, int, text, text, text, text, boolean, boolean, boolean, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Public RPC: mp_public_catalogue_list (anon + authenticated)
-- ---------------------------------------------------------------------------
-- Returns only active, public_visible=true products with effective brand/
-- category slugs for filtering. Never returns hidden/inactive products or
-- internal product IDs — only the public slug for DTO mapping.

create or replace function public.mp_public_catalogue_list(
  p_limit int default 50,
  p_offset int default 0,
  p_featured bool default null,
  p_brand_slug text default null,
  p_category_slug text default null
) returns table(slug text, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with effective as (
    select
      p.id,
      p.slug,
      coalesce(
        (select o.override_value#>>'{}' from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'title' and o.active),
        p.title
      ) as effective_title,
      coalesce(
        (select o.override_value#>>'{}' from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'brand_id' and o.active),
        p.brand_id
      ) as effective_brand_id,
      coalesce(
        (select o.override_value#>>'{}' from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'category_id' and o.active),
        p.category_id
      ) as effective_category_id,
      coalesce(
        (select o.override_value::boolean from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'public_visible' and o.active),
        p.public_visible
      ) as effective_public_visible,
      coalesce(
        (select o.override_value::boolean from public.mp_field_overrides o
         where o.product_id = p.id and o.field_name = 'featured' and o.active),
        coalesce(p.featured, false)
      ) as effective_featured
    from public.mp_products p
    where p.active = true
  ),
  visible as (
    select * from effective
    where effective_public_visible = true
  ),
  filtered as (
    select v.*
    from visible v
    where (p_featured is null or v.effective_featured = p_featured)
      and (
        p_brand_slug is null or
        v.effective_brand_id in (
          select id from public.mp_brands where slug = p_brand_slug and active = true
        )
      )
      and (
        p_category_slug is null or
        v.effective_category_id in (
          select id from public.mp_categories where slug = p_category_slug and active = true
        )
      )
  ),
  total_cte as (
    select count(*)::bigint as total from filtered
  ),
  paged as (
    select f.slug, tc.total
    from filtered f cross join total_cte tc
    order by f.effective_title, f.id
    offset greatest(0, p_offset)
    limit greatest(1, least(p_limit, 500))
  )
  select p.slug, p.total from paged p
  union all
  select null::text, tc.total from total_cte tc
  where not exists (select 1 from paged)
$$;

-- Public RPC: grant to anon and authenticated
grant execute on function public.mp_public_catalogue_list(
  int, int, boolean, text, text
) to anon;
grant execute on function public.mp_public_catalogue_list(
  int, int, boolean, text, text
) to authenticated;
