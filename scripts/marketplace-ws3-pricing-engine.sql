-- Marketplace WS3 — controlled pricing engine (additive, manual apply only)
-- Contract: sunchaser-marketplace-architecture-contract.md Revision 5.1
--
-- *****************************************************************************
-- DO NOT AUTO-APPLY TO PRODUCTION / SHARED SUPABASE.
-- Disposable local databases for verification only unless separately authorized.
-- *****************************************************************************
--
-- Does not rewrite WS0/WS1 migration files. Uses CREATE OR REPLACE for safer
-- audits on existing pricing RPCs and adds admin helpers for config/mappings/costs.
-- Never grants browser roles commercial writes. mp.allow_price_write is set only
-- transaction-locally inside SECURITY DEFINER pricing RPCs.

-- =============================================================================
-- 1. Harden existing pricing RPCs — safe audit metadata (no prices/costs)
-- =============================================================================
create or replace function public.mp_set_cost(
  p_actor_scope text,
  p_product_id text,
  p_variant_id text,
  p_actual_purchase_cost numeric,
  p_set_by text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if p_actor_scope not like 'admin:super:%' and p_actor_scope <> 'admin:super' then
    raise exception 'VALIDATION_ERROR: set_cost is Super-Admin only'
      using errcode = 'check_violation';
  end if;
  if p_actual_purchase_cost is null or p_actual_purchase_cost < 0 then
    raise exception 'INVALID_PRICE: actual_purchase_cost must be >= 0'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.mp_product_variants
    where id = p_variant_id and product_id = p_product_id
  ) then
    raise exception 'VARIANT_NOT_FOUND: variant/product mismatch'
      using errcode = 'no_data_found';
  end if;

  update public.mp_product_costs
  set effective_to = timezone('utc', now())
  where variant_id = p_variant_id and effective_to is null;

  v_id := public.mp_new_id('mpcost');
  insert into public.mp_product_costs (
    id, product_id, variant_id, actual_purchase_cost, set_by, reason
  ) values (
    v_id, p_product_id, p_variant_id, p_actual_purchase_cost, p_set_by, p_reason
  );

  perform public.mp_write_audit(
    p_actor_scope, 'cost.created', 'mp_product_costs', v_id, false,
    jsonb_build_object(
      'variantId', p_variant_id,
      'productId', p_product_id,
      'changedFields', jsonb_build_array('actual_purchase_cost', 'effective_from')
    )
  );
  return jsonb_build_object('ok', true, 'cost_id', v_id, 'costId', v_id);
end;
$$;

create or replace function public.mp_apply_override(
  p_actor_scope text,
  p_product_id text,
  p_variant_id text,
  p_override_price numeric,
  p_mode text,
  p_ends_at timestamptz,
  p_reason text,
  p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_prior_id text;
  v_old_price numeric(14,2);
  v_old_state text;
begin
  if p_actor_scope not like 'admin:super%' then
    raise exception 'VALIDATION_ERROR: overrides are Super-Admin only'
      using errcode = 'check_violation';
  end if;
  if p_override_price is null or p_override_price <= 0 then
    raise exception 'INVALID_PRICE: override price must be positive'
      using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'VALIDATION_ERROR: reason is required'
      using errcode = 'check_violation';
  end if;
  if p_mode = 'time_limited' then
    if p_ends_at is null then
      raise exception 'VALIDATION_ERROR: time_limited override requires ends_at'
        using errcode = 'check_violation';
    end if;
    if p_ends_at <= timezone('utc', now()) then
      raise exception 'VALIDATION_ERROR: time_limited ends_at must be in the future'
        using errcode = 'check_violation';
    end if;
  end if;

  select website_price, website_price_state into v_old_price, v_old_state
  from public.mp_product_variants
  where id = p_variant_id and product_id = p_product_id
  for update;
  if not found then
    raise exception 'VARIANT_NOT_FOUND: variant not found'
      using errcode = 'no_data_found';
  end if;

  update public.mp_price_overrides
  set status = 'expired'
  where variant_id = p_variant_id
    and status = 'active'
    and mode = 'time_limited'
    and ends_at is not null
    and ends_at <= timezone('utc', now());

  select id into v_prior_id
  from public.mp_price_overrides
  where variant_id = p_variant_id
    and status = 'active'
  for update;

  v_id := public.mp_new_id('mpovr');

  if v_prior_id is not null then
    update public.mp_price_overrides
    set status = 'superseded'
    where id = v_prior_id
      and status = 'active';
  end if;

  insert into public.mp_price_overrides (
    id, product_id, variant_id, override_price, status, mode, ends_at, reason, created_by
  ) values (
    v_id, p_product_id, p_variant_id, p_override_price, 'active', p_mode, p_ends_at, trim(p_reason), p_created_by
  );

  if v_prior_id is not null then
    update public.mp_price_overrides
    set superseded_by = v_id
    where id = v_prior_id
      and status = 'superseded';
  end if;

  perform set_config('mp.allow_price_write', 'on', true);
  update public.mp_product_variants
  set website_price = p_override_price,
      website_price_state = 'priced_override',
      website_price_source = 'override',
      price_published_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_variant_id;

  insert into public.mp_price_history (
    id, product_id, variant_id, old_price, new_price, old_state, new_state,
    source, changed_by, reason, override_id
  ) values (
    public.mp_new_id('mphist'), p_product_id, p_variant_id, v_old_price, p_override_price,
    v_old_state, 'priced_override', 'override', p_created_by, trim(p_reason), v_id
  );

  perform public.mp_write_audit(
    p_actor_scope, 'override.created', 'mp_price_overrides', v_id, false,
    jsonb_build_object(
      'variantId', p_variant_id,
      'productId', p_product_id,
      'mode', p_mode,
      'supersededOverrideId', v_prior_id,
      'changedFields', jsonb_build_array('override_price', 'status', 'mode')
    )
  );
  return jsonb_build_object(
    'ok', true,
    'override_id', v_id,
    'overrideId', v_id,
    'superseded_override_id', v_prior_id
  );
end;
$$;

create or replace function public.mp_revoke_override(
  p_actor_scope text,
  p_override_id text,
  p_revoked_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ovr public.mp_price_overrides%rowtype;
begin
  if p_actor_scope not like 'admin:super%' then
    raise exception 'VALIDATION_ERROR: revoke override is Super-Admin only'
      using errcode = 'check_violation';
  end if;
  select * into v_ovr from public.mp_price_overrides where id = p_override_id for update;
  if not found or v_ovr.status <> 'active' then
    raise exception 'OVERRIDE_NOT_FOUND: active override not found'
      using errcode = 'no_data_found';
  end if;

  update public.mp_price_overrides
  set status = 'revoked', revoked_by = p_revoked_by, revoked_at = timezone('utc', now())
  where id = p_override_id;

  perform set_config('mp.allow_price_write', 'on', true);
  update public.mp_product_variants
  set website_price_state = 'confirm_price',
      website_price_source = null,
      updated_at = timezone('utc', now())
  where id = v_ovr.variant_id;

  insert into public.mp_price_history (
    id, product_id, variant_id, old_price, new_price, old_state, new_state,
    source, changed_by, reason, override_id
  ) values (
    public.mp_new_id('mphist'), v_ovr.product_id, v_ovr.variant_id, v_ovr.override_price, null,
    'priced_override', 'confirm_price', 'override', p_revoked_by, 'revoked', p_override_id
  );

  perform public.mp_write_audit(
    p_actor_scope, 'override.revoked', 'mp_price_overrides', p_override_id, false,
    jsonb_build_object(
      'variantId', v_ovr.variant_id,
      'productId', v_ovr.product_id,
      'changedFields', jsonb_build_array('status', 'revoked_at')
    )
  );
  return jsonb_build_object('ok', true, 'override_id', p_override_id, 'overrideId', p_override_id);
end;
$$;

create or replace function public.mp_publish_price(
  p_actor_scope text,
  p_variant_id text,
  p_changed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant public.mp_product_variants%rowtype;
  v_cfg public.mp_pricing_config%rowtype;
  v_new_price numeric(14,2);
  v_source text;
  v_state text := 'confirm_price';
  v_hist_source text;
  v_audit_action text;
begin
  if p_actor_scope not like 'admin:super%' and p_actor_scope not like 'system:%' then
    raise exception 'VALIDATION_ERROR: publish_price requires Super-Admin or system'
      using errcode = 'check_violation';
  end if;

  select * into v_variant from public.mp_product_variants where id = p_variant_id for update;
  if not found then
    raise exception 'VARIANT_NOT_FOUND: variant not found'
      using errcode = 'no_data_found';
  end if;

  select * into v_cfg from public.mp_pricing_config where company_id = 'sunchaser';
  if not found then
    raise exception 'INTERNAL_ERROR: pricing config missing'
      using errcode = 'check_violation';
  end if;

  -- Expire timed-out overrides before resolution
  update public.mp_price_overrides
  set status = 'expired'
  where variant_id = p_variant_id
    and status = 'active'
    and mode = 'time_limited'
    and ends_at is not null
    and ends_at <= timezone('utc', now());

  -- 1) Active manual override
  select override_price into v_new_price
  from public.mp_price_overrides
  where variant_id = p_variant_id
    and status = 'active'
    and starts_at <= timezone('utc', now())
    and (mode = 'permanent' or ends_at > timezone('utc', now()))
  limit 1;
  if found then
    v_source := 'override';
    v_state := 'priced_override';
  else
    -- 2/3) Exact Kamal then Alladin: fresh, parse_ok, in_stock, price>0, unlocked
    select o.supplier_public_price, s.code
      into v_new_price, v_source
    from public.mp_supplier_products sp
    join public.mp_suppliers s on s.id = sp.supplier_id
    join lateral (
      select obs.*
      from public.mp_supplier_observations obs
      where obs.supplier_product_id = sp.id
      order by obs.observed_at desc
      limit 1
    ) o on true
    where sp.variant_id = p_variant_id
      and sp.active
      and not sp.match_locked
      and sp.match_confidence = 'exact'
      and s.active
      and o.availability = 'in_stock'
      and o.parse_status = 'ok'
      and o.supplier_public_price is not null
      and o.supplier_public_price > 0
      and o.observed_at >= timezone('utc', now()) - make_interval(hours => v_cfg.staleness_hours)
    order by s.priority asc
    limit 1;
    if found then
      v_state := 'priced_auto';
    else
      -- 4) Last approved non-override history
      select new_price, source into v_new_price, v_source
      from public.mp_price_history
      where variant_id = p_variant_id
        and source <> 'override'
        and new_price is not null
      order by created_at desc
      limit 1;
      if found then
        v_state := 'priced_auto';
        v_source := 'last_approved';
      else
        v_new_price := null;
        v_source := null;
        v_state := 'confirm_price';
      end if;
    end if;
  end if;

  -- History source check constraint requires a known source; use last_approved for confirm path.
  v_hist_source := coalesce(v_source, 'last_approved');
  if v_hist_source not in ('kamal', 'alladin', 'seed', 'override', 'last_approved') then
    v_hist_source := 'last_approved';
  end if;

  perform set_config('mp.allow_price_write', 'on', true);
  update public.mp_product_variants
  set website_price = v_new_price,
      website_price_state = v_state,
      website_price_source = v_source,
      price_published_at = case
        when v_state <> 'confirm_price' then timezone('utc', now())
        else price_published_at
      end,
      updated_at = timezone('utc', now())
  where id = p_variant_id;

  insert into public.mp_price_history (
    id, product_id, variant_id, old_price, new_price, old_state, new_state,
    source, changed_by, reason
  ) values (
    public.mp_new_id('mphist'),
    v_variant.product_id,
    p_variant_id,
    v_variant.website_price,
    v_new_price,
    v_variant.website_price_state,
    v_state,
    v_hist_source,
    p_changed_by,
    'mp_publish_price'
  );

  update public.mp_products p
  set display_from_price = (
        select min(website_price)
        from public.mp_product_variants v
        where v.product_id = p.id and v.active and v.website_price is not null
      ),
      display_price_state = case
        when exists (
          select 1 from public.mp_product_variants v
          where v.product_id = p.id and v.website_price_state = 'priced_override'
        ) then 'priced_override'
        when exists (
          select 1 from public.mp_product_variants v
          where v.product_id = p.id and v.website_price_state = 'priced_auto'
        ) then 'priced_auto'
        else 'confirm_price'
      end,
      updated_at = timezone('utc', now())
  where id = v_variant.product_id;

  v_audit_action := case
    when v_state = 'confirm_price' then 'pricing.confirm_required'
    else 'pricing.published'
  end;

  perform public.mp_write_audit(
    p_actor_scope, v_audit_action, 'mp_product_variants', p_variant_id, false,
    jsonb_build_object(
      'variantId', p_variant_id,
      'productId', v_variant.product_id,
      'state', v_state,
      'source', v_source,
      'changedFields', jsonb_build_array(
        'website_price', 'website_price_state', 'website_price_source', 'price_published_at'
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'variant_id', p_variant_id,
    'variantId', p_variant_id,
    'productId', v_variant.product_id,
    'website_price', v_new_price,
    'website_price_state', v_state,
    'website_price_source', v_source,
    'websitePriceState', v_state,
    'websitePriceSource', v_source
  );
end;
$$;

-- =============================================================================
-- 2. Cost patch (close + optional replacement) — no cost values in audit
-- =============================================================================
create or replace function public.mp_admin_update_cost(
  p_actor_scope text,
  p_cost_id text,
  p_set_by text,
  p_actual_purchase_cost numeric,
  p_currency text,
  p_effective_from timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost public.mp_product_costs%rowtype;
  v_new_id text;
  v_changed text[] := '{}';
begin
  if p_actor_scope not like 'admin:super%' then
    raise exception 'VALIDATION_ERROR: cost update is Super-Admin only'
      using errcode = 'check_violation';
  end if;

  select * into v_cost from public.mp_product_costs where id = p_cost_id for update;
  if not found then
    raise exception 'COST_NOT_FOUND: cost not found'
      using errcode = 'no_data_found';
  end if;

  if p_actual_purchase_cost is null
     and p_currency is null
     and p_effective_from is null
     and p_reason is null then
    raise exception 'VALIDATION_ERROR: patch body must include at least one allowed field'
      using errcode = 'check_violation';
  end if;

  -- Amount/currency/effective changes create a superseding row; reason-only updates in place.
  if p_actual_purchase_cost is not null or p_currency is not null or p_effective_from is not null then
    if p_actual_purchase_cost is not null and p_actual_purchase_cost < 0 then
      raise exception 'INVALID_PRICE: actual_purchase_cost must be >= 0'
        using errcode = 'check_violation';
    end if;

    update public.mp_product_costs
    set effective_to = timezone('utc', now())
    where id = p_cost_id
      and effective_to is null;

    v_new_id := public.mp_new_id('mpcost');
    insert into public.mp_product_costs (
      id, product_id, variant_id, actual_purchase_cost, currency,
      effective_from, set_by, reason
    ) values (
      v_new_id,
      v_cost.product_id,
      v_cost.variant_id,
      coalesce(p_actual_purchase_cost, v_cost.actual_purchase_cost),
      coalesce(nullif(trim(p_currency), ''), v_cost.currency),
      coalesce(p_effective_from, timezone('utc', now())),
      p_set_by,
      coalesce(p_reason, v_cost.reason)
    );

    if p_actual_purchase_cost is not null then
      v_changed := array_append(v_changed, 'actual_purchase_cost');
    end if;
    if p_currency is not null then
      v_changed := array_append(v_changed, 'currency');
    end if;
    if p_effective_from is not null then
      v_changed := array_append(v_changed, 'effective_from');
    end if;
    if p_reason is not null then
      v_changed := array_append(v_changed, 'reason');
    end if;

    perform public.mp_write_audit(
      p_actor_scope, 'cost.updated', 'mp_product_costs', v_new_id, false,
      jsonb_build_object(
        'previousCostId', p_cost_id,
        'variantId', v_cost.variant_id,
        'productId', v_cost.product_id,
        'changedFields', to_jsonb(v_changed)
      )
    );
    return jsonb_build_object('ok', true, 'costId', v_new_id, 'previousCostId', p_cost_id);
  end if;

  update public.mp_product_costs
  set reason = p_reason
  where id = p_cost_id;

  perform public.mp_write_audit(
    p_actor_scope, 'cost.updated', 'mp_product_costs', p_cost_id, false,
    jsonb_build_object(
      'variantId', v_cost.variant_id,
      'productId', v_cost.product_id,
      'changedFields', jsonb_build_array('reason')
    )
  );
  return jsonb_build_object('ok', true, 'costId', p_cost_id);
end;
$$;

-- =============================================================================
-- 3. Pricing config update
-- =============================================================================
create or replace function public.mp_admin_update_pricing_config(
  p_actor_scope text,
  p_updated_by text,
  p_max_increase_pct numeric,
  p_max_decrease_pct numeric,
  p_staleness_hours integer,
  p_allow_soldout_reference boolean,
  p_safety_absolute_floor numeric,
  p_safety_absolute_ceiling numeric,
  p_min_token_pct numeric,
  p_max_token_pct numeric,
  p_min_advance_pct numeric,
  p_max_advance_pct numeric,
  p_cod_max_order_value numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := '{}';
begin
  if p_actor_scope not like 'admin:super%' then
    raise exception 'VALIDATION_ERROR: pricing config is Super-Admin only'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.mp_pricing_config where company_id = 'sunchaser'
  ) then
    raise exception 'INTERNAL_ERROR: pricing config missing'
      using errcode = 'check_violation';
  end if;

  update public.mp_pricing_config c
  set
    max_increase_pct = case when p_max_increase_pct is null then c.max_increase_pct else p_max_increase_pct end,
    max_decrease_pct = case when p_max_decrease_pct is null then c.max_decrease_pct else p_max_decrease_pct end,
    staleness_hours = case when p_staleness_hours is null then c.staleness_hours else p_staleness_hours end,
    allow_soldout_reference = case
      when p_allow_soldout_reference is null then c.allow_soldout_reference
      else p_allow_soldout_reference
    end,
    safety_absolute_floor = case
      when p_safety_absolute_floor is null then c.safety_absolute_floor
      else p_safety_absolute_floor
    end,
    safety_absolute_ceiling = case
      when p_safety_absolute_ceiling is null then c.safety_absolute_ceiling
      else p_safety_absolute_ceiling
    end,
    min_token_pct = case when p_min_token_pct is null then c.min_token_pct else p_min_token_pct end,
    max_token_pct = case when p_max_token_pct is null then c.max_token_pct else p_max_token_pct end,
    min_advance_pct = case when p_min_advance_pct is null then c.min_advance_pct else p_min_advance_pct end,
    max_advance_pct = case when p_max_advance_pct is null then c.max_advance_pct else p_max_advance_pct end,
    cod_max_order_value = case
      when p_cod_max_order_value is null then c.cod_max_order_value
      else p_cod_max_order_value
    end,
    updated_by = p_updated_by,
    updated_at = timezone('utc', now())
  where company_id = 'sunchaser';

  if p_max_increase_pct is not null then v_changed := array_append(v_changed, 'max_increase_pct'); end if;
  if p_max_decrease_pct is not null then v_changed := array_append(v_changed, 'max_decrease_pct'); end if;
  if p_staleness_hours is not null then v_changed := array_append(v_changed, 'staleness_hours'); end if;
  if p_allow_soldout_reference is not null then v_changed := array_append(v_changed, 'allow_soldout_reference'); end if;
  if p_safety_absolute_floor is not null then v_changed := array_append(v_changed, 'safety_absolute_floor'); end if;
  if p_safety_absolute_ceiling is not null then v_changed := array_append(v_changed, 'safety_absolute_ceiling'); end if;
  if p_min_token_pct is not null then v_changed := array_append(v_changed, 'min_token_pct'); end if;
  if p_max_token_pct is not null then v_changed := array_append(v_changed, 'max_token_pct'); end if;
  if p_min_advance_pct is not null then v_changed := array_append(v_changed, 'min_advance_pct'); end if;
  if p_max_advance_pct is not null then v_changed := array_append(v_changed, 'max_advance_pct'); end if;
  if p_cod_max_order_value is not null then v_changed := array_append(v_changed, 'cod_max_order_value'); end if;

  if coalesce(array_length(v_changed, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: patch body must include at least one allowed field'
      using errcode = 'check_violation';
  end if;

  perform public.mp_write_audit(
    p_actor_scope, 'pricing_config.updated', 'mp_pricing_config', 'sunchaser', false,
    jsonb_build_object('changedFields', to_jsonb(v_changed))
  );

  return jsonb_build_object('ok', true, 'companyId', 'sunchaser');
end;
$$;

-- =============================================================================
-- 4. Supplier product mapping upsert (exact mappings for WS4 readiness)
-- =============================================================================
create or replace function public.mp_admin_upsert_supplier_mapping(
  p_actor_scope text,
  p_supplier_code text,
  p_product_id text,
  p_variant_id text,
  p_supplier_product_id text,
  p_supplier_variant_id text,
  p_supplier_sku text,
  p_normalized_exact_model text,
  p_match_confidence text,
  p_match_locked boolean,
  p_active boolean,
  p_supplier_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id text;
  v_id text;
  v_existing text;
  v_action text;
  v_confidence text;
begin
  if p_actor_scope not like 'admin:super%' then
    raise exception 'VALIDATION_ERROR: supplier mapping is Super-Admin only'
      using errcode = 'check_violation';
  end if;

  if p_supplier_code not in ('kamal', 'alladin') then
    raise exception 'INVALID_MAPPING: supplier code must be kamal or alladin'
      using errcode = 'check_violation';
  end if;

  select id into v_supplier_id
  from public.mp_suppliers
  where code = p_supplier_code and active = true;
  if v_supplier_id is null then
    raise exception 'INVALID_MAPPING: supplier not found'
      using errcode = 'foreign_key_violation';
  end if;

  if not exists (
    select 1 from public.mp_product_variants
    where id = p_variant_id and product_id = p_product_id
  ) then
    raise exception 'VARIANT_NOT_FOUND: variant/product mismatch'
      using errcode = 'no_data_found';
  end if;

  v_confidence := coalesce(nullif(trim(p_match_confidence), ''), 'exact');
  if v_confidence not in ('exact', 'likely', 'uncertain', 'conflict') then
    raise exception 'INVALID_MAPPING: invalid match_confidence'
      using errcode = 'check_violation';
  end if;
  if p_normalized_exact_model is null or length(trim(p_normalized_exact_model)) = 0 then
    raise exception 'VALIDATION_ERROR: normalizedExactModel is required'
      using errcode = 'check_violation';
  end if;
  if p_supplier_product_id is null or length(trim(p_supplier_product_id)) = 0 then
    raise exception 'VALIDATION_ERROR: supplierProductId is required'
      using errcode = 'check_violation';
  end if;

  select id into v_existing
  from public.mp_supplier_products
  where supplier_id = v_supplier_id
    and variant_id = p_variant_id
  for update;

  if v_existing is null then
    v_id := public.mp_new_id('mpsp');
    insert into public.mp_supplier_products (
      id, supplier_id, product_id, variant_id, supplier_product_id,
      supplier_variant_id, supplier_sku, normalized_exact_model,
      match_confidence, match_locked, active, supplier_url, match_evidence
    ) values (
      v_id, v_supplier_id, p_product_id, p_variant_id, trim(p_supplier_product_id),
      nullif(trim(coalesce(p_supplier_variant_id, '')), ''),
      nullif(trim(coalesce(p_supplier_sku, '')), ''),
      trim(p_normalized_exact_model),
      v_confidence,
      coalesce(p_match_locked, false),
      coalesce(p_active, true),
      nullif(trim(coalesce(p_supplier_url, '')), ''),
      '{}'::jsonb
    );
    v_action := 'supplier_mapping.created';
  else
    v_id := v_existing;
    update public.mp_supplier_products
    set
      supplier_product_id = trim(p_supplier_product_id),
      supplier_variant_id = nullif(trim(coalesce(p_supplier_variant_id, '')), ''),
      supplier_sku = nullif(trim(coalesce(p_supplier_sku, '')), ''),
      normalized_exact_model = trim(p_normalized_exact_model),
      match_confidence = v_confidence,
      match_locked = coalesce(p_match_locked, match_locked),
      active = coalesce(p_active, active),
      supplier_url = coalesce(
        nullif(trim(coalesce(p_supplier_url, '')), ''),
        supplier_url
      ),
      updated_at = timezone('utc', now())
    where id = v_id;
    v_action := 'supplier_mapping.updated';
  end if;

  perform public.mp_write_audit(
    p_actor_scope, v_action, 'mp_supplier_products', v_id, false,
    jsonb_build_object(
      'variantId', p_variant_id,
      'productId', p_product_id,
      'supplierCode', p_supplier_code,
      'matchConfidence', v_confidence,
      'changedFields', jsonb_build_array(
        'supplier_product_id', 'normalized_exact_model', 'match_confidence', 'match_locked', 'active'
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'mappingId', v_id,
    'action', v_action
  );
end;
$$;

-- =============================================================================
-- 5. Grants — service_role only
-- =============================================================================
do $ws3_grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'mp_set_cost',
        'mp_apply_override',
        'mp_revoke_override',
        'mp_publish_price',
        'mp_admin_update_cost',
        'mp_admin_update_pricing_config',
        'mp_admin_upsert_supplier_mapping'
      )
  loop
    execute format('revoke all on function %s from public', fn.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', fn.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', fn.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn.sig);
    end if;
  end loop;
end
$ws3_grants$;

notify pgrst, 'reload schema';
