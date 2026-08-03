-- =============================================================================
-- Marketplace CEO auto-import — product media persistence (ADDITIVE)
-- =============================================================================
-- DO NOT APPLY in this PR's automation. Prepare for CTO-approved SQL apply.
--
-- Uses existing public.mp_media. Does not drop tables or mutate live rows until
-- applied. After apply, next CEO sync (or the prepared backfill script) populates
-- images for imported products.
--
-- Enhancements (Catalogue Manager):
--   - identity columns: source_key, supplier_code, manual_control
--   - unique (product_id, source_url) de-dupe
--   - skip supplier media mutation when primary_image/gallery_images override active
--   - never unpublish manual_control or non-supplier rows
--   - never overwrite manual_control rows on upsert
--
-- Publish gate compliance for supplier CDN images:
--   source_type = 'supplier'
--   rights_status = 'supplier_approved'
--   approved_by = 'ceo_auto_import'
--   approved_at = now()
--   published = true
-- =============================================================================

alter table public.mp_media
  add column if not exists source_key text;

alter table public.mp_media
  add column if not exists supplier_code text;

alter table public.mp_media
  add column if not exists manual_control boolean not null default false;

do $media$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mp_media_supplier_code_ck'
      and conrelid = 'public.mp_media'::regclass
  ) then
    alter table public.mp_media
      add constraint mp_media_supplier_code_ck
      check (
        supplier_code is null
        or supplier_code in ('kamal', 'alladin')
      );
  end if;
end $media$;

-- Deterministic de-dupe key for supplier CDN URLs per product.
create unique index if not exists mp_media_product_source_url_uidx
  on public.mp_media (product_id, source_url)
  where source_url is not null
    and role <> 'receipt'
    and product_id is not null;

create or replace function public.mp_ceo_auto_import_sync_product_media(
  p_product_id text,
  p_variant_id text,
  p_supplier text,
  p_images jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_img jsonb;
  v_url text;
  v_sort integer;
  v_host text;
  v_id text;
  v_path text;
  v_source_key text;
  v_kept text[] := array[]::text[];
  v_allowed boolean;
  v_locked boolean := false;
begin
  if p_product_id is null or length(trim(p_product_id)) = 0 then
    raise exception 'VALIDATION_ERROR: product_id required for media sync'
      using errcode = 'check_violation';
  end if;
  if p_supplier not in ('kamal', 'alladin') then
    raise exception 'VALIDATION_ERROR: supplier invalid for media sync'
      using errcode = 'check_violation';
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    p_images := '[]'::jsonb;
  end if;

  -- Catalogue Manager: active image overrides block supplier media mutation.
  if to_regprocedure('public.mp_has_active_field_override(text, text)') is not null then
    v_locked :=
      public.mp_has_active_field_override(p_product_id, 'primary_image')
      or public.mp_has_active_field_override(p_product_id, 'gallery_images');
  end if;
  if v_locked then
    return;
  end if;

  for v_img in select * from jsonb_array_elements(p_images)
  loop
    v_url := nullif(trim(coalesce(v_img->>'url', '')), '');
    if v_url is null then
      continue;
    end if;
    -- HTTPS only; reject javascript/data/relative.
    if v_url !~* '^https://' then
      continue;
    end if;
    v_host := lower(split_part(regexp_replace(v_url, '^https://', ''), '/', 1));
    v_allowed := v_host in (
      'cdn.shopify.com',
      'kamalsolar.pk',
      'www.kamalsolar.pk',
      'alladin.pk',
      'www.alladin.pk'
    );
    if not v_allowed then
      continue;
    end if;
    v_sort := greatest(0, least(7, coalesce((v_img->>'sortOrder')::integer, 0)));
    v_path := 'supplier-cdn/' || p_supplier || '/' || left(md5(v_url), 32);
    v_id := 'mpmedia_' || left(md5(p_product_id || '|' || v_url), 24);
    v_source_key := nullif(trim(coalesce(v_img->>'sourceKey', '')), '');
    v_kept := array_append(v_kept, v_url);

    insert into public.mp_media (
      id, product_id, variant_id, storage_path, role, alt, sort_order,
      source_type, source_url, rights_status, permission_reference,
      approved_by, approved_at, published,
      source_key, supplier_code, manual_control
    ) values (
      v_id,
      p_product_id,
      p_variant_id,
      v_path,
      case when v_sort = 0 then 'thumbnail' else 'gallery' end,
      null,
      v_sort,
      'supplier',
      v_url,
      'supplier_approved',
      'ceo_auto_import:' || p_supplier,
      'ceo_auto_import',
      timezone('utc', now()),
      true,
      v_source_key,
      p_supplier,
      false
    )
    on conflict (id) do update
      set product_id = excluded.product_id,
          variant_id = excluded.variant_id,
          storage_path = excluded.storage_path,
          role = excluded.role,
          sort_order = excluded.sort_order,
          source_type = excluded.source_type,
          source_url = excluded.source_url,
          rights_status = excluded.rights_status,
          permission_reference = excluded.permission_reference,
          approved_by = excluded.approved_by,
          approved_at = excluded.approved_at,
          published = excluded.published,
          source_key = excluded.source_key,
          supplier_code = excluded.supplier_code
      where public.mp_media.manual_control is distinct from true;
  end loop;

  -- Unpublish stale supplier CDN rows for this product (no delete — retain audit).
  -- Never touch manual_control or non-supplier rows.
  update public.mp_media m
  set published = false
  where m.product_id = p_product_id
    and m.source_type = 'supplier'
    and coalesce(m.manual_control, false) = false
    and m.role <> 'receipt'
    and (
      cardinality(v_kept) = 0
      or m.source_url is null
      or not (m.source_url = any (v_kept))
    );
end;
$$;

revoke all on function public.mp_ceo_auto_import_sync_product_media(text, text, text, jsonb) from public;
do $media_fn$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mp_ceo_auto_import_sync_product_media(text, text, text, jsonb) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.mp_ceo_auto_import_sync_product_media(text, text, text, jsonb) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mp_ceo_auto_import_sync_product_media(text, text, text, jsonb) to service_role;
  end if;
end $media_fn$;
