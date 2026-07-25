-- Marketplace WS2 — admin product write atomicity (additive, manual apply only)
-- Contract: sunchaser-marketplace-architecture-contract.md Revision 5.1
--
-- *****************************************************************************
-- DO NOT AUTO-APPLY TO PRODUCTION.
-- DO NOT apply to staging/shared Supabase without separate owner authorization.
-- Apply only to disposable local databases for verification, or via approved ops.
-- *****************************************************************************
--
-- Adds:
--   - deferred exactly-one active-default invariant (products + variants)
--   - transactional SECURITY DEFINER RPCs:
--       mp_admin_create_product
--       mp_admin_update_product
--       mp_admin_create_variant
--       mp_admin_update_variant
--
-- Never sets mp.allow_price_write. Never writes commercial price/cost/stock columns.
-- Access: service_role execute only; PUBLIC/anon/authenticated revoked.

-- =============================================================================
-- 0. Preflight: refuse to enable invariant when invalid catalogue rows exist
-- =============================================================================
do $ws2_pre$
declare
  v_bad text;
begin
  select p.id into v_bad
  from public.mp_products p
  where (
    select count(*)::integer
    from public.mp_product_variants v
    where v.product_id = p.id
      and v.is_default
      and v.active
  ) <> 1
  limit 1;

  if v_bad is not null then
    raise exception
      'WS2 atomicity migration aborted: product % does not have exactly one active default variant. Fix data before applying.',
      v_bad;
  end if;
end
$ws2_pre$;

-- =============================================================================
-- 1. Deferred exactly-one active-default helpers + constraint triggers
-- =============================================================================
create or replace function public.mp_assert_product_exactly_one_default(p_product_id text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_product_id is null or length(trim(p_product_id)) = 0 then
    return;
  end if;

  -- Product removed (e.g. cascade delete) — skip.
  if not exists (
    select 1 from public.mp_products p where p.id = p_product_id
  ) then
    return;
  end if;

  select count(*)::integer into v_count
  from public.mp_product_variants v
  where v.product_id = p_product_id
    and v.is_default
    and v.active;

  if v_count <> 1 then
    raise exception 'DEFAULT_VARIANT_REQUIRED: product must have exactly one active default variant'
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.mp_variants_exactly_one_default_trg_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.mp_assert_product_exactly_one_default(old.product_id);
    return null;
  end if;

  if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
    perform public.mp_assert_product_exactly_one_default(old.product_id);
    perform public.mp_assert_product_exactly_one_default(new.product_id);
    return null;
  end if;

  perform public.mp_assert_product_exactly_one_default(new.product_id);
  return null;
end;
$$;

create or replace function public.mp_products_exactly_one_default_trg_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return null;
  end if;
  perform public.mp_assert_product_exactly_one_default(new.id);
  return null;
end;
$$;

drop trigger if exists mp_variants_exactly_one_default_trg on public.mp_product_variants;
create constraint trigger mp_variants_exactly_one_default_trg
  after insert or update or delete on public.mp_product_variants
  deferrable initially deferred
  for each row
  execute function public.mp_variants_exactly_one_default_trg_fn();

drop trigger if exists mp_products_exactly_one_default_trg on public.mp_products;
create constraint trigger mp_products_exactly_one_default_trg
  after insert or update on public.mp_products
  deferrable initially deferred
  for each row
  execute function public.mp_products_exactly_one_default_trg_fn();

-- Retain existing at-most-one partial unique index (idempotent).
create unique index if not exists mp_variants_one_default_uidx
  on public.mp_product_variants (product_id)
  where is_default and active;

-- =============================================================================
-- 2. Shared helpers for admin RPCs
-- =============================================================================
create or replace function public.mp_admin_actor_scope(
  p_actor_id text,
  p_actor_username text,
  p_actor_role text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'VALIDATION_ERROR: actor id is required'
      using errcode = 'check_violation';
  end if;
  if p_actor_username is null or length(trim(p_actor_username)) = 0 then
    raise exception 'VALIDATION_ERROR: actor username is required'
      using errcode = 'check_violation';
  end if;
  if p_actor_role is null or length(trim(p_actor_role)) = 0 then
    raise exception 'VALIDATION_ERROR: actor role is required'
      using errcode = 'check_violation';
  end if;
  return 'staff:' || trim(p_actor_id);
end;
$$;

create or replace function public.mp_admin_require_brand(p_brand_id text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_brand_id is null or length(trim(p_brand_id)) = 0 then
    raise exception 'VALIDATION_ERROR: brandId is required'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1
    from public.mp_brands b
    where b.id = p_brand_id
      and b.active = true
  ) then
    raise exception 'INVALID_RELATIONSHIP: brand not found or inactive'
      using errcode = 'foreign_key_violation';
  end if;
end;
$$;

create or replace function public.mp_admin_require_category(p_category_id text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_category_id is null or length(trim(p_category_id)) = 0 then
    raise exception 'VALIDATION_ERROR: categoryId is required'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1
    from public.mp_categories c
    where c.id = p_category_id
      and c.active = true
  ) then
    raise exception 'INVALID_RELATIONSHIP: category not found or inactive'
      using errcode = 'foreign_key_violation';
  end if;
end;
$$;

create or replace function public.mp_admin_clear_other_defaults(
  p_product_id text,
  p_keep_variant_id text
)
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_ids text[];
begin
  with cleared as (
    update public.mp_product_variants v
    set
      is_default = false,
      updated_at = timezone('utc', now())
    where v.product_id = p_product_id
      and v.is_default = true
      and v.active = true
      and (p_keep_variant_id is null or v.id <> p_keep_variant_id)
    returning v.id
  )
  select coalesce(array_agg(id), '{}'::text[]) into v_ids from cleared;

  return coalesce(v_ids, '{}'::text[]);
end;
$$;

create or replace function public.mp_admin_audit_payload(
  p_actor_id text,
  p_actor_username text,
  p_actor_role text,
  p_extra jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'actorId', p_actor_id,
    'actorUsername', p_actor_username,
    'actorRole', p_actor_role
  ) || coalesce(p_extra, '{}'::jsonb);
$$;

-- =============================================================================
-- 3. mp_admin_create_product
-- =============================================================================
create or replace function public.mp_admin_create_product(
  p_actor_id text,
  p_actor_username text,
  p_actor_role text,
  p_brand_id text,
  p_category_id text,
  p_title text,
  p_slug text,
  p_description text,
  p_tags text[],
  p_active boolean,
  p_featured boolean,
  p_variant_sku text,
  p_variant_title text,
  p_variant_is_priceable boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_scope text;
  v_product_id text;
  v_variant_id text;
  v_title text;
  v_slug text;
  v_description text;
  v_tags text[];
  v_sku text;
  v_variant_title text;
begin
  v_actor_scope := public.mp_admin_actor_scope(p_actor_id, p_actor_username, p_actor_role);
  perform public.mp_admin_require_brand(p_brand_id);
  perform public.mp_admin_require_category(p_category_id);

  v_title := trim(coalesce(p_title, ''));
  if length(v_title) = 0 then
    raise exception 'VALIDATION_ERROR: title is required'
      using errcode = 'check_violation';
  end if;

  v_slug := trim(coalesce(p_slug, ''));
  if length(v_slug) = 0 then
    raise exception 'VALIDATION_ERROR: slug is required'
      using errcode = 'check_violation';
  end if;

  v_description := coalesce(p_description, '');
  v_tags := coalesce(p_tags, '{}'::text[]);

  v_sku := upper(trim(coalesce(p_variant_sku, '')));
  if length(v_sku) = 0 then
    raise exception 'VALIDATION_ERROR: default variant sku is required'
      using errcode = 'check_violation';
  end if;

  v_variant_title := trim(coalesce(p_variant_title, ''));
  if length(v_variant_title) = 0 then
    raise exception 'VALIDATION_ERROR: default variant title is required'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.mp_products p where p.slug = v_slug) then
    raise exception 'DUPLICATE_SLUG: product slug already exists'
      using errcode = 'unique_violation';
  end if;

  if exists (select 1 from public.mp_product_variants v where v.sku = v_sku) then
    raise exception 'DUPLICATE_SKU: variant sku already exists'
      using errcode = 'unique_violation';
  end if;

  v_product_id := public.mp_new_id('mpprod');
  v_variant_id := public.mp_new_id('mpvar');

  insert into public.mp_products (
    id, brand_id, category_id, title, slug, description, tags, active, featured
  ) values (
    v_product_id,
    p_brand_id,
    p_category_id,
    v_title,
    v_slug,
    v_description,
    v_tags,
    coalesce(p_active, true),
    coalesce(p_featured, false)
  );

  insert into public.mp_product_variants (
    id, product_id, sku, title, is_default, is_priceable, active
  ) values (
    v_variant_id,
    v_product_id,
    v_sku,
    v_variant_title,
    true,
    coalesce(p_variant_is_priceable, true),
    true
  );

  perform public.mp_write_audit(
    v_actor_scope,
    'product.created',
    'mp_products',
    v_product_id,
    false,
    public.mp_admin_audit_payload(
      trim(p_actor_id),
      trim(p_actor_username),
      trim(p_actor_role),
      jsonb_build_object(
        'changedFields', jsonb_build_array(
          'brand_id', 'category_id', 'title', 'slug', 'description', 'tags', 'active', 'featured'
        ),
        'slug', v_slug
      )
    )
  );

  perform public.mp_write_audit(
    v_actor_scope,
    'variant.created',
    'mp_product_variants',
    v_variant_id,
    false,
    public.mp_admin_audit_payload(
      trim(p_actor_id),
      trim(p_actor_username),
      trim(p_actor_role),
      jsonb_build_object(
        'changedFields', jsonb_build_array(
          'sku', 'title', 'is_default', 'is_priceable', 'active'
        ),
        'productId', v_product_id,
        'sku', v_sku
      )
    )
  );

  perform public.mp_assert_product_exactly_one_default(v_product_id);

  return jsonb_build_object(
    'productId', v_product_id,
    'variantId', v_variant_id
  );
exception
  when unique_violation then
    if sqlerrm like 'DUPLICATE_SLUG%' or sqlerrm like '%mp_products%slug%' or sqlerrm like '%slug%' then
      raise exception 'DUPLICATE_SLUG: product slug already exists'
        using errcode = 'unique_violation';
    end if;
    if sqlerrm like 'DUPLICATE_SKU%' or sqlerrm like '%sku%' then
      raise exception 'DUPLICATE_SKU: variant sku already exists'
        using errcode = 'unique_violation';
    end if;
    raise exception 'CONFLICT: uniqueness conflict'
      using errcode = 'unique_violation';
end;
$$;

-- =============================================================================
-- 4. mp_admin_update_product
-- =============================================================================
create or replace function public.mp_admin_update_product(
  p_actor_id text,
  p_actor_username text,
  p_actor_role text,
  p_product_id text,
  p_brand_id text,
  p_category_id text,
  p_title text,
  p_description text,
  p_tags text[],
  p_active boolean,
  p_featured boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_scope text;
  v_changed text[] := '{}';
  v_lock_id text;
begin
  v_actor_scope := public.mp_admin_actor_scope(p_actor_id, p_actor_username, p_actor_role);

  select p.id into v_lock_id
  from public.mp_products p
  where p.id = p_product_id
  for update;

  if v_lock_id is null then
    raise exception 'PRODUCT_NOT_FOUND: product not found'
      using errcode = 'no_data_found';
  end if;

  if p_brand_id is not null then
    perform public.mp_admin_require_brand(p_brand_id);
  end if;
  if p_category_id is not null then
    perform public.mp_admin_require_category(p_category_id);
  end if;
  if p_title is not null and length(trim(p_title)) = 0 then
    raise exception 'VALIDATION_ERROR: title is required'
      using errcode = 'check_violation';
  end if;

  update public.mp_products p
  set
    brand_id = case when p_brand_id is null then p.brand_id else p_brand_id end,
    category_id = case when p_category_id is null then p.category_id else p_category_id end,
    title = case when p_title is null then p.title else trim(p_title) end,
    description = case when p_description is null then p.description else p_description end,
    tags = case when p_tags is null then p.tags else p_tags end,
    active = case when p_active is null then p.active else p_active end,
    featured = case when p_featured is null then p.featured else p_featured end,
    updated_at = timezone('utc', now())
  where p.id = p_product_id;

  if p_brand_id is not null then v_changed := array_append(v_changed, 'brand_id'); end if;
  if p_category_id is not null then v_changed := array_append(v_changed, 'category_id'); end if;
  if p_title is not null then v_changed := array_append(v_changed, 'title'); end if;
  if p_description is not null then v_changed := array_append(v_changed, 'description'); end if;
  if p_tags is not null then v_changed := array_append(v_changed, 'tags'); end if;
  if p_active is not null then v_changed := array_append(v_changed, 'active'); end if;
  if p_featured is not null then v_changed := array_append(v_changed, 'featured'); end if;

  if coalesce(array_length(v_changed, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: patch body must include at least one allowed field'
      using errcode = 'check_violation';
  end if;

  perform public.mp_write_audit(
    v_actor_scope,
    'product.updated',
    'mp_products',
    p_product_id,
    false,
    public.mp_admin_audit_payload(
      trim(p_actor_id),
      trim(p_actor_username),
      trim(p_actor_role),
      jsonb_build_object('changedFields', to_jsonb(v_changed))
    )
  );

  perform public.mp_assert_product_exactly_one_default(p_product_id);

  return jsonb_build_object('productId', p_product_id);
end;
$$;

-- =============================================================================
-- 5. mp_admin_create_variant
-- =============================================================================
create or replace function public.mp_admin_create_variant(
  p_actor_id text,
  p_actor_username text,
  p_actor_role text,
  p_product_id text,
  p_sku text,
  p_title text,
  p_is_default boolean,
  p_is_priceable boolean,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_scope text;
  v_lock_id text;
  v_variant_id text;
  v_sku text;
  v_title text;
  v_is_default boolean;
  v_active boolean;
  v_previous text[];
begin
  v_actor_scope := public.mp_admin_actor_scope(p_actor_id, p_actor_username, p_actor_role);

  select p.id into v_lock_id
  from public.mp_products p
  where p.id = p_product_id
  for update;

  if v_lock_id is null then
    raise exception 'PRODUCT_NOT_FOUND: product not found'
      using errcode = 'no_data_found';
  end if;

  v_sku := upper(trim(coalesce(p_sku, '')));
  v_title := trim(coalesce(p_title, ''));
  v_is_default := coalesce(p_is_default, false);
  v_active := coalesce(p_active, true);

  if length(v_sku) = 0 then
    raise exception 'VALIDATION_ERROR: sku is required'
      using errcode = 'check_violation';
  end if;
  if length(v_title) = 0 then
    raise exception 'VALIDATION_ERROR: title is required'
      using errcode = 'check_violation';
  end if;
  if v_is_default and not v_active then
    raise exception 'DEFAULT_VARIANT_REQUIRED: a default variant must be active'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.mp_product_variants v where v.sku = v_sku) then
    raise exception 'DUPLICATE_SKU: variant sku already exists'
      using errcode = 'unique_violation';
  end if;

  v_previous := '{}'::text[];
  if v_is_default then
    v_previous := public.mp_admin_clear_other_defaults(p_product_id, null);
  end if;

  v_variant_id := public.mp_new_id('mpvar');

  insert into public.mp_product_variants (
    id, product_id, sku, title, is_default, is_priceable, active
  ) values (
    v_variant_id,
    p_product_id,
    v_sku,
    v_title,
    v_is_default,
    coalesce(p_is_priceable, true),
    v_active
  );

  if v_is_default then
    perform public.mp_write_audit(
      v_actor_scope,
      'variant.default_changed',
      'mp_product_variants',
      v_variant_id,
      false,
      public.mp_admin_audit_payload(
        trim(p_actor_id),
        trim(p_actor_username),
        trim(p_actor_role),
        jsonb_build_object(
          'productId', p_product_id,
          'previousDefaultIds', to_jsonb(v_previous)
        )
      )
    );
  end if;

  perform public.mp_write_audit(
    v_actor_scope,
    'variant.created',
    'mp_product_variants',
    v_variant_id,
    false,
    public.mp_admin_audit_payload(
      trim(p_actor_id),
      trim(p_actor_username),
      trim(p_actor_role),
      jsonb_build_object(
        'changedFields', jsonb_build_array(
          'sku', 'title', 'is_default', 'is_priceable', 'active'
        ),
        'productId', p_product_id,
        'sku', v_sku
      )
    )
  );

  perform public.mp_assert_product_exactly_one_default(p_product_id);

  return jsonb_build_object(
    'productId', p_product_id,
    'variantId', v_variant_id
  );
exception
  when unique_violation then
    if sqlerrm like 'DUPLICATE_SKU%' or sqlerrm like '%sku%' or sqlerrm like '%mp_variants_one_default%' then
      if sqlerrm like '%mp_variants_one_default%' then
        raise exception 'CONFLICT: default variant conflict'
          using errcode = 'unique_violation';
      end if;
      raise exception 'DUPLICATE_SKU: variant sku already exists'
        using errcode = 'unique_violation';
    end if;
    raise exception 'CONFLICT: uniqueness conflict'
      using errcode = 'unique_violation';
end;
$$;

-- =============================================================================
-- 6. mp_admin_update_variant
-- =============================================================================
create or replace function public.mp_admin_update_variant(
  p_actor_id text,
  p_actor_username text,
  p_actor_role text,
  p_product_id text,
  p_variant_id text,
  p_sku text,
  p_title text,
  p_is_default boolean,
  p_is_priceable boolean,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_scope text;
  v_lock_id text;
  v_current public.mp_product_variants%rowtype;
  v_sku text;
  v_title text;
  v_is_default boolean;
  v_is_priceable boolean;
  v_active boolean;
  v_previous text[] := '{}';
  v_changed text[] := '{}';
  v_was_default boolean;
begin
  v_actor_scope := public.mp_admin_actor_scope(p_actor_id, p_actor_username, p_actor_role);

  select p.id into v_lock_id
  from public.mp_products p
  where p.id = p_product_id
  for update;

  if v_lock_id is null then
    raise exception 'PRODUCT_NOT_FOUND: product not found'
      using errcode = 'no_data_found';
  end if;

  select * into v_current
  from public.mp_product_variants v
  where v.id = p_variant_id
    and v.product_id = p_product_id
  for update;

  if not found then
    raise exception 'VARIANT_NOT_FOUND: variant not found for this product'
      using errcode = 'no_data_found';
  end if;

  v_sku := case when p_sku is null then v_current.sku else upper(trim(p_sku)) end;
  v_title := case when p_title is null then v_current.title else trim(p_title) end;
  v_is_default := case when p_is_default is null then v_current.is_default else p_is_default end;
  v_is_priceable := case when p_is_priceable is null then v_current.is_priceable else p_is_priceable end;
  v_active := case when p_active is null then v_current.active else p_active end;
  v_was_default := v_current.is_default and v_current.active;

  if length(v_sku) = 0 then
    raise exception 'VALIDATION_ERROR: sku is required'
      using errcode = 'check_violation';
  end if;
  if length(v_title) = 0 then
    raise exception 'VALIDATION_ERROR: title is required'
      using errcode = 'check_violation';
  end if;
  if v_is_default and not v_active then
    raise exception 'DEFAULT_VARIANT_REQUIRED: a default variant must be active'
      using errcode = 'check_violation';
  end if;

  if p_sku is not null and exists (
    select 1
    from public.mp_product_variants v
    where v.sku = v_sku
      and v.id <> p_variant_id
  ) then
    raise exception 'DUPLICATE_SKU: variant sku already exists'
      using errcode = 'unique_violation';
  end if;

  if v_is_default and v_active then
    v_previous := public.mp_admin_clear_other_defaults(p_product_id, p_variant_id);
  end if;

  update public.mp_product_variants v
  set
    sku = v_sku,
    title = v_title,
    is_default = v_is_default,
    is_priceable = v_is_priceable,
    active = v_active,
    updated_at = timezone('utc', now())
  where v.id = p_variant_id
    and v.product_id = p_product_id;

  if p_sku is not null then v_changed := array_append(v_changed, 'sku'); end if;
  if p_title is not null then v_changed := array_append(v_changed, 'title'); end if;
  if p_is_default is not null or (v_is_default and v_active and not v_was_default) then
    v_changed := array_append(v_changed, 'is_default');
  end if;
  if p_is_priceable is not null then v_changed := array_append(v_changed, 'is_priceable'); end if;
  if p_active is not null then v_changed := array_append(v_changed, 'active'); end if;

  if coalesce(array_length(v_changed, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: patch body must include at least one allowed field'
      using errcode = 'check_violation';
  end if;

  perform public.mp_assert_product_exactly_one_default(p_product_id);

  if v_is_default and v_active and (not v_was_default or coalesce(array_length(v_previous, 1), 0) > 0) then
    perform public.mp_write_audit(
      v_actor_scope,
      'variant.default_changed',
      'mp_product_variants',
      p_variant_id,
      false,
      public.mp_admin_audit_payload(
        trim(p_actor_id),
        trim(p_actor_username),
        trim(p_actor_role),
        jsonb_build_object(
          'productId', p_product_id,
          'previousDefaultIds', to_jsonb(v_previous)
        )
      )
    );
  end if;

  perform public.mp_write_audit(
    v_actor_scope,
    'variant.updated',
    'mp_product_variants',
    p_variant_id,
    false,
    public.mp_admin_audit_payload(
      trim(p_actor_id),
      trim(p_actor_username),
      trim(p_actor_role),
      jsonb_build_object(
        'changedFields', to_jsonb(v_changed),
        'productId', p_product_id
      )
    )
  );

  return jsonb_build_object(
    'productId', p_product_id,
    'variantId', p_variant_id
  );
exception
  when unique_violation then
    if sqlerrm like '%mp_variants_one_default%' then
      raise exception 'CONFLICT: default variant conflict'
        using errcode = 'unique_violation';
    end if;
    if sqlerrm like 'DUPLICATE_SKU%' or sqlerrm like '%sku%' then
      raise exception 'DUPLICATE_SKU: variant sku already exists'
        using errcode = 'unique_violation';
    end if;
    raise exception 'CONFLICT: uniqueness conflict'
      using errcode = 'unique_violation';
end;
$$;

-- =============================================================================
-- 7. Privileges — service_role only
-- =============================================================================
do $ws2_grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'mp_assert_product_exactly_one_default',
        'mp_variants_exactly_one_default_trg_fn',
        'mp_products_exactly_one_default_trg_fn',
        'mp_admin_actor_scope',
        'mp_admin_require_brand',
        'mp_admin_require_category',
        'mp_admin_clear_other_defaults',
        'mp_admin_audit_payload',
        'mp_admin_create_product',
        'mp_admin_update_product',
        'mp_admin_create_variant',
        'mp_admin_update_variant'
      )
  loop
    execute format('revoke all on function %s from public', fn.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', fn.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', fn.sig);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mp_admin_create_product(
      text, text, text, text, text, text, text, text, text[], boolean, boolean, text, text, boolean
    ) to service_role;
    grant execute on function public.mp_admin_update_product(
      text, text, text, text, text, text, text, text, text[], boolean, boolean
    ) to service_role;
    grant execute on function public.mp_admin_create_variant(
      text, text, text, text, text, text, boolean, boolean, boolean
    ) to service_role;
    grant execute on function public.mp_admin_update_variant(
      text, text, text, text, text, text, text, boolean, boolean, boolean
    ) to service_role;
  else
    raise notice 'service_role missing — skip explicit admin RPC grants (local/non-Supabase)';
  end if;
end
$ws2_grants$;

notify pgrst, 'reload schema';
