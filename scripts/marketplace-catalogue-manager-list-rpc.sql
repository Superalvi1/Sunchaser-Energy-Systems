-- =============================================================================
-- Marketplace Catalogue Manager — effective-value list RPC
-- =============================================================================
-- Additive / backward-compatible.
-- Adds mp_catalogue_manager_list() RPC that resolves effective values using
-- active field overrides, applies filters on EFFECTIVE values, and returns
-- paginated product IDs + accurate total — bypassing Supabase's implicit
-- 1000-row response cap.
-- DO NOT APPLY in automation. Prepare for CTO-approved SQL apply only.
-- =============================================================================

-- Ensure selected_supplier column exists (may be added by auto-import migration).
-- This is idempotent and safe.
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mp_products'
      and column_name = 'selected_supplier'
  ) then
    alter table public.mp_products add column selected_supplier text;
  end if;
end $$;

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
  )
  select f.id, count(*) over() as total
  from filtered f
  order by f.effective_title, f.id
  offset greatest(0, p_offset)
  limit greatest(1, least(p_limit, 500))
$$;
