-- Marketplace WS5 — secure cart, delivery quote, possession checkout (additive)
-- Contract: sunchaser-marketplace-architecture-contract.md Revision 5.1
--
-- *****************************************************************************
-- DO NOT AUTO-APPLY TO PRODUCTION / SHARED SUPABASE.
-- Disposable local databases for verification only unless separately authorized.
-- *****************************************************************************
--
-- Adds cart checked_out_at, optional delivery seed, and SECURITY DEFINER RPCs:
--   mp_cart_create, mp_cart_upsert_item, mp_cart_quote_delivery, mp_cart_checkout
-- Does not write website_price, costs, supplier data, or pricing config.
-- Does not grant browser-role execute.

-- =============================================================================
-- 1. Additive cart lifecycle column
-- =============================================================================
alter table public.mp_carts
  add column if not exists checked_out_at timestamptz;

create index if not exists mp_carts_customer_open_idx
  on public.mp_carts (customer_id)
  where customer_id is not null and checked_out_at is null;

-- =============================================================================
-- 2. Optional delivery foundation seed (idempotent)
-- =============================================================================
insert into public.mp_delivery_zones (id, code, name, cod_eligible, active)
values
  ('mpzone_lhr', 'LHR', 'Lahore', true, true),
  ('mpzone_isb', 'ISB', 'Islamabad', true, true),
  ('mpzone_khi', 'KHI', 'Karachi', false, true)
on conflict (id) do nothing;

insert into public.mp_delivery_rates (
  id, zone_id, min_subtotal, max_subtotal, delivery_charge, active
) values
  ('mprate_lhr_std', 'mpzone_lhr', 0, 99999.99, 500, true),
  ('mprate_lhr_free', 'mpzone_lhr', 100000, null, 0, true),
  ('mprate_isb_std', 'mpzone_isb', 0, null, 750, true),
  ('mprate_khi_std', 'mpzone_khi', 0, null, 1000, true)
on conflict (id) do nothing;

-- =============================================================================
-- 3. Helpers
-- =============================================================================
create or replace function public.mp_cart_assert_open(p_cart public.mp_carts)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_cart.checked_out_at is not null then
    raise exception 'CART_ALREADY_CHECKED_OUT: cart already checked out'
      using errcode = 'check_violation';
  end if;
  if p_cart.expires_at <= timezone('utc', now()) then
    raise exception 'CART_EXPIRED: cart has expired'
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.mp_cart_resolve_delivery(
  p_zone_code text,
  p_subtotal numeric
)
returns table (
  zone_id text,
  zone_code text,
  delivery_charge numeric,
  cod_eligible boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_zone public.mp_delivery_zones%rowtype;
  v_rate public.mp_delivery_rates%rowtype;
  v_code text;
begin
  v_code := upper(trim(coalesce(p_zone_code, '')));
  if length(v_code) = 0 then
    raise exception 'INVALID_DELIVERY_ZONE: zone code is required'
      using errcode = 'check_violation';
  end if;

  select * into v_zone
  from public.mp_delivery_zones z
  where z.code = v_code
    and z.active = true;
  if not found then
    raise exception 'INVALID_DELIVERY_ZONE: zone not found or inactive'
      using errcode = 'no_data_found';
  end if;

  select * into v_rate
  from public.mp_delivery_rates r
  where r.zone_id = v_zone.id
    and r.active = true
    and r.min_subtotal <= p_subtotal
    and (r.max_subtotal is null or r.max_subtotal >= p_subtotal)
  order by r.min_subtotal desc
  limit 1;

  if not found then
    raise exception 'DELIVERY_NOT_AVAILABLE: no delivery rate for zone/subtotal'
      using errcode = 'check_violation';
  end if;

  zone_id := v_zone.id;
  zone_code := v_zone.code;
  delivery_charge := v_rate.delivery_charge;
  cod_eligible := v_zone.cod_eligible;
  return next;
end;
$$;

-- =============================================================================
-- 4. mp_cart_create
-- =============================================================================
create or replace function public.mp_cart_create(
  p_actor_scope text,
  p_customer_id text,
  p_guest_token_hash text,
  p_ttl_hours integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_ref text;
  v_ttl integer;
  v_expires timestamptz;
begin
  if p_actor_scope is null or length(trim(p_actor_scope)) = 0 then
    raise exception 'VALIDATION_ERROR: actor_scope required'
      using errcode = 'check_violation';
  end if;
  if p_actor_scope like 'client:%' then
    raise exception 'VALIDATION_ERROR: client-supplied actor_scope rejected'
      using errcode = 'check_violation';
  end if;

  if (p_customer_id is null) = (p_guest_token_hash is null) then
    raise exception 'VALIDATION_ERROR: cart requires exactly one of customer or guest'
      using errcode = 'check_violation';
  end if;

  v_ttl := greatest(1, coalesce(p_ttl_hours, 72));
  v_expires := timezone('utc', now()) + make_interval(hours => v_ttl);
  v_id := public.mp_new_id('mpcart');
  v_ref := 'mpcref_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.mp_carts (
    id, public_ref, customer_id, guest_token_hash, expires_at
  ) values (
    v_id, v_ref, p_customer_id, p_guest_token_hash, v_expires
  );

  perform public.mp_write_audit(
    p_actor_scope, 'cart.created', 'mp_carts', v_id, false,
    jsonb_build_object(
      'publicRef', v_ref,
      'ownership', case when p_customer_id is null then 'guest' else 'customer' end,
      'changedFields', jsonb_build_array('public_ref', 'expires_at')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'publicRef', v_ref,
    'expiresAt', v_expires
  );
end;
$$;

-- =============================================================================
-- 5. mp_cart_upsert_item
-- =============================================================================
create or replace function public.mp_cart_upsert_item(
  p_actor_scope text,
  p_public_ref text,
  p_customer_id text,
  p_guest_token_hash text,
  p_variant_sku text,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart public.mp_carts%rowtype;
  v_variant public.mp_product_variants%rowtype;
  v_product public.mp_products%rowtype;
  v_item_id text;
  v_qty integer;
  v_sku text;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'INVALID_QUANTITY: quantity must be between 1 and 99'
      using errcode = 'check_violation';
  end if;

  v_sku := lower(trim(coalesce(p_variant_sku, '')));
  if length(v_sku) = 0 or length(v_sku) > 64 then
    raise exception 'VARIANT_NOT_FOUND: variant not found'
      using errcode = 'no_data_found';
  end if;

  select * into v_cart
  from public.mp_carts c
  where c.public_ref = p_public_ref
  for update;
  if not found then
    raise exception 'CART_NOT_FOUND: cart not found'
      using errcode = 'no_data_found';
  end if;

  -- Ownership (enumeration-safe: same code for mismatch)
  if p_customer_id is not null then
    if v_cart.customer_id is distinct from p_customer_id then
      raise exception 'CART_NOT_FOUND: cart not found'
        using errcode = 'no_data_found';
    end if;
  elsif p_guest_token_hash is not null then
    if v_cart.guest_token_hash is distinct from p_guest_token_hash then
      raise exception 'CART_NOT_FOUND: cart not found'
        using errcode = 'no_data_found';
    end if;
  else
    raise exception 'CART_NOT_AUTHORIZED: ownership required'
      using errcode = 'check_violation';
  end if;

  perform public.mp_cart_assert_open(v_cart);

  select * into v_variant
  from public.mp_product_variants v
  where lower(v.sku) = v_sku
  for update;
  if not found then
    raise exception 'VARIANT_NOT_FOUND: variant not found'
      using errcode = 'no_data_found';
  end if;

  select * into v_product
  from public.mp_products p
  where p.id = v_variant.product_id;
  if not found or not v_product.active then
    raise exception 'PRODUCT_UNAVAILABLE: product is not available'
      using errcode = 'check_violation';
  end if;

  if not v_variant.active or not v_variant.is_priceable then
    raise exception 'PRODUCT_UNAVAILABLE: variant is not available'
      using errcode = 'check_violation';
  end if;
  if v_variant.website_price_state = 'confirm_price'
     or v_variant.website_price is null
     or v_variant.website_price <= 0 then
    raise exception 'CONFIRM_PRICE_REQUIRED: variant is not purchasable'
      using errcode = 'check_violation';
  end if;
  if v_variant.stock_status <> 'in_stock' then
    raise exception 'STOCK_NOT_ELIGIBLE: variant stock is not in_stock'
      using errcode = 'check_violation';
  end if;

  select id, quantity into v_item_id, v_qty
  from public.mp_cart_items
  where cart_id = v_cart.id
    and variant_id = v_variant.id
  for update;

  if v_item_id is null then
    v_item_id := public.mp_new_id('mpci');
    insert into public.mp_cart_items (
      id, cart_id, product_id, variant_id, quantity, unit_price_snap
    ) values (
      v_item_id, v_cart.id, v_variant.product_id, v_variant.id,
      p_quantity, v_variant.website_price
    );
  else
    v_qty := least(99, v_qty + p_quantity);
    update public.mp_cart_items
    set quantity = v_qty,
        unit_price_snap = v_variant.website_price
    where id = v_item_id;
  end if;

  update public.mp_carts
  set updated_at = timezone('utc', now())
  where id = v_cart.id;

  perform public.mp_write_audit(
    p_actor_scope, 'cart.item_upserted', 'mp_cart_items', v_item_id, false,
    jsonb_build_object(
      'publicRef', v_cart.public_ref,
      'sku', v_variant.sku,
      'changedFields', jsonb_build_array('quantity', 'unit_price_snap')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'publicRef', v_cart.public_ref,
    'sku', v_variant.sku,
    'quantity', (select quantity from public.mp_cart_items where id = v_item_id),
    'unitPrice', v_variant.website_price
  );
end;
$$;

-- =============================================================================
-- 6. mp_cart_quote_delivery
-- =============================================================================
create or replace function public.mp_cart_quote_delivery(
  p_actor_scope text,
  p_public_ref text,
  p_customer_id text,
  p_guest_token_hash text,
  p_zone_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart public.mp_carts%rowtype;
  v_subtotal numeric(14,2) := 0;
  v_quote record;
begin
  select * into v_cart
  from public.mp_carts c
  where c.public_ref = p_public_ref
  for update;
  if not found then
    raise exception 'CART_NOT_FOUND: cart not found'
      using errcode = 'no_data_found';
  end if;

  if p_customer_id is not null then
    if v_cart.customer_id is distinct from p_customer_id then
      raise exception 'CART_NOT_FOUND: cart not found'
        using errcode = 'no_data_found';
    end if;
  elsif p_guest_token_hash is not null then
    if v_cart.guest_token_hash is distinct from p_guest_token_hash then
      raise exception 'CART_NOT_FOUND: cart not found'
        using errcode = 'no_data_found';
    end if;
  else
    raise exception 'CART_NOT_AUTHORIZED: ownership required'
      using errcode = 'check_violation';
  end if;

  perform public.mp_cart_assert_open(v_cart);

  select coalesce(sum(i.unit_price_snap * i.quantity), 0) into v_subtotal
  from public.mp_cart_items i
  where i.cart_id = v_cart.id;

  if v_subtotal <= 0 then
    raise exception 'EMPTY_CART: cart has no priced items'
      using errcode = 'check_violation';
  end if;

  select * into v_quote
  from public.mp_cart_resolve_delivery(p_zone_code, v_subtotal);

  return jsonb_build_object(
    'ok', true,
    'publicRef', v_cart.public_ref,
    'zoneCode', v_quote.zone_code,
    'subtotal', v_subtotal,
    'deliveryCharge', v_quote.delivery_charge,
    'codEligible', v_quote.cod_eligible,
    'grandTotal', v_subtotal + v_quote.delivery_charge
  );
end;
$$;

-- =============================================================================
-- 7. mp_cart_checkout — atomic cart → order
-- =============================================================================
create or replace function public.mp_cart_checkout(
  p_actor_scope text,
  p_public_ref text,
  p_customer_id text,
  p_guest_token_hash text,
  p_zone_code text,
  p_plan_type text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart public.mp_carts%rowtype;
  v_preflight jsonb;
  v_item record;
  v_variant public.mp_product_variants%rowtype;
  v_product public.mp_products%rowtype;
  v_subtotal numeric(14,2) := 0;
  v_quote record;
  v_cfg public.mp_pricing_config%rowtype;
  v_order_id text;
  v_order_ref text;
  v_order_number text;
  v_plan_id text;
  v_grand numeric(14,2);
  v_plan text;
  v_upfront numeric(14,2);
  v_balance numeric(14,2);
  v_balance_cod boolean := false;
  v_result jsonb;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0
     or length(trim(p_idempotency_key)) > 128 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED: Idempotency-Key is required'
      using errcode = 'check_violation';
  end if;
  if p_request_hash is null or length(trim(p_request_hash)) = 0 then
    raise exception 'VALIDATION_ERROR: request hash required'
      using errcode = 'check_violation';
  end if;

  v_preflight := public.mp_idempotency_preflight(
    trim(p_idempotency_key),
    'marketplace_checkout',
    p_actor_scope,
    trim(p_request_hash),
    p_public_ref
  );

  if v_preflight->>'status' = 'REQUEST_HASH_CONFLICT' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'IDEMPOTENCY_CONFLICT',
        'message', 'Idempotency-Key reuse with different request'
      )
    );
  end if;
  if v_preflight->>'status' = 'COMPLETED_REPLAY' then
    return coalesce(v_preflight->'result_payload', '{}'::jsonb)
      || jsonb_build_object('replay', true);
  end if;
  if v_preflight->>'status' = 'FAILED_KNOWN_REPLAY' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', coalesce(v_preflight->>'last_error_code', 'CONFLICT'),
        'message', coalesce(v_preflight->>'last_error_message', 'checkout failed')
      ),
      'replay', true
    );
  end if;
  if v_preflight->>'status' = 'IN_PROGRESS' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'CONFLICT',
        'message', 'checkout already in progress'
      )
    );
  end if;

  -- Nested block: on failure, roll back order writes but keep idempotency claim
  -- so failed_known can be persisted in the outer transaction.
  begin
    select * into v_cart
    from public.mp_carts c
    where c.public_ref = p_public_ref
    for update;
    if not found then
      raise exception 'CART_NOT_FOUND: cart not found'
        using errcode = 'no_data_found';
    end if;

    if p_customer_id is not null then
      if v_cart.customer_id is distinct from p_customer_id then
        raise exception 'CART_NOT_FOUND: cart not found'
          using errcode = 'no_data_found';
      end if;
    elsif p_guest_token_hash is not null then
      if v_cart.guest_token_hash is distinct from p_guest_token_hash then
        raise exception 'CART_NOT_FOUND: cart not found'
          using errcode = 'no_data_found';
      end if;
    else
      raise exception 'CART_NOT_AUTHORIZED: ownership required'
        using errcode = 'check_violation';
    end if;

    perform public.mp_cart_assert_open(v_cart);

    if not exists (
      select 1 from public.mp_cart_items i where i.cart_id = v_cart.id
    ) then
      raise exception 'EMPTY_CART: cart is empty'
        using errcode = 'check_violation';
    end if;

    -- Lock + revalidate every cart line against live commercial fields
    for v_item in
      select * from public.mp_cart_items i
      where i.cart_id = v_cart.id
      order by i.created_at
      for update
    loop
      select * into v_variant
      from public.mp_product_variants v
      where v.id = v_item.variant_id
        and v.product_id = v_item.product_id
      for update;
      if not found then
        raise exception 'VARIANT_NOT_FOUND: variant missing'
          using errcode = 'no_data_found';
      end if;

      select * into v_product from public.mp_products p where p.id = v_variant.product_id;
      if not found or not v_product.active or not v_variant.active then
        raise exception 'PRODUCT_UNAVAILABLE: product/variant unavailable'
          using errcode = 'check_violation';
      end if;
      if v_variant.website_price_state = 'confirm_price'
         or v_variant.website_price is null
         or v_variant.website_price <= 0 then
        raise exception 'CONFIRM_PRICE_REQUIRED: variant not purchasable'
          using errcode = 'check_violation';
      end if;
      if v_variant.stock_status <> 'in_stock' then
        raise exception 'STOCK_NOT_ELIGIBLE: stock not in_stock'
          using errcode = 'check_violation';
      end if;
      if v_item.unit_price_snap is distinct from v_variant.website_price then
        raise exception 'PRICE_CHANGED: cart price no longer matches website price'
          using errcode = 'check_violation';
      end if;

      v_subtotal := v_subtotal + (v_variant.website_price * v_item.quantity);
    end loop;

    select * into v_quote
    from public.mp_cart_resolve_delivery(p_zone_code, v_subtotal);

    v_grand := v_subtotal + v_quote.delivery_charge;
    v_plan := coalesce(nullif(trim(p_plan_type), ''), 'full');
    if v_plan not in ('full', 'cod_eligible') then
      raise exception 'VALIDATION_ERROR: unsupported plan type'
        using errcode = 'check_violation';
    end if;

    if v_plan = 'cod_eligible' then
      if not v_quote.cod_eligible then
        raise exception 'COD_NOT_AVAILABLE: zone is not COD eligible'
          using errcode = 'check_violation';
      end if;
      select * into v_cfg from public.mp_pricing_config where company_id = 'sunchaser';
      if v_cfg.cod_max_order_value is not null and v_grand > v_cfg.cod_max_order_value then
        raise exception 'COD_NOT_AVAILABLE: order exceeds COD max value'
          using errcode = 'check_violation';
      end if;
      v_upfront := 0;
      v_balance := v_grand;
      v_balance_cod := true;
    else
      v_upfront := v_grand;
      v_balance := 0;
      v_balance_cod := false;
    end if;

    v_order_id := public.mp_new_id('mpord');
    v_order_ref := 'mporef_' || replace(gen_random_uuid()::text, '-', '');
    v_order_number := 'MPO-' || to_char(timezone('utc', now()), 'YYYYMMDD')
      || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

    insert into public.mp_orders (
      id, public_ref, order_number, customer_id, guest_token_hash, status,
      subtotal, delivery_fee, tax, grand_total, delivery_zone_id, checkout_locked
    ) values (
      v_order_id, v_order_ref, v_order_number,
      v_cart.customer_id, v_cart.guest_token_hash,
      'pending_payment',
      v_subtotal, v_quote.delivery_charge, 0, v_grand,
      v_quote.zone_id, true
    );

    for v_item in
      select * from public.mp_cart_items i
      where i.cart_id = v_cart.id
      order by i.created_at
    loop
      select * into v_variant
      from public.mp_product_variants v
      where v.id = v_item.variant_id;

      insert into public.mp_order_items (
        id, order_id, product_id, variant_id, title_snap, sku_snap,
        quantity, unit_price, line_total
      ) values (
        public.mp_new_id('mpoi'),
        v_order_id,
        v_variant.product_id,
        v_variant.id,
        v_variant.title,
        v_variant.sku,
        v_item.quantity,
        v_variant.website_price,
        v_variant.website_price * v_item.quantity
      );
    end loop;

    v_plan_id := public.mp_new_id('mpplan');
    insert into public.mp_payment_plans (
      id, order_id, plan_type, grand_total, upfront_amount, balance_due, balance_on_delivery
    ) values (
      v_plan_id, v_order_id, v_plan, v_grand, v_upfront, v_balance, v_balance_cod
    );

    if v_plan = 'cod_eligible' and v_balance > 0 then
      insert into public.mp_payments (
        id, order_id, payment_plan_id, amount, method, status, recorded_by
      ) values (
        public.mp_new_id('mppay'), v_order_id, v_plan_id, v_balance,
        'cash_on_delivery', 'pending', p_actor_scope
      );
    end if;

    update public.mp_carts
    set checked_out_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_cart.id;

    perform public.mp_write_audit(
      p_actor_scope, 'checkout.completed', 'mp_orders', v_order_id, true,
      jsonb_build_object(
        'orderPublicRef', v_order_ref,
        'cartPublicRef', v_cart.public_ref,
        'planType', v_plan,
        'zoneCode', v_quote.zone_code,
        'itemCount', (select count(*) from public.mp_order_items where order_id = v_order_id),
        'changedFields', jsonb_build_array('status', 'subtotal', 'delivery_fee', 'grand_total')
      )
    );

    v_result := jsonb_build_object(
      'ok', true,
      'publicRef', v_order_ref,
      'orderNumber', v_order_number,
      'cartPublicRef', v_cart.public_ref,
      'planType', v_plan,
      'zoneCode', v_quote.zone_code,
      'codEligible', v_quote.cod_eligible,
      'subtotal', v_subtotal,
      'deliveryCharge', v_quote.delivery_charge,
      'grandTotal', v_grand,
      'replay', false
    );

    update public.mp_idempotency_keys
    set state = 'completed',
        result_ref = v_order_ref,
        result_payload = v_result,
        completed_at = timezone('utc', now())
    where idempotency_key = trim(p_idempotency_key)
      and operation_type = 'marketplace_checkout'
      and actor_scope = p_actor_scope;

    return v_result;
  exception
    when others then
      update public.mp_idempotency_keys
      set state = 'failed_known',
          last_error_code = split_part(SQLERRM, ':', 1),
          last_error_message = 'checkout failed',
          completed_at = timezone('utc', now())
      where idempotency_key = trim(p_idempotency_key)
        and operation_type = 'marketplace_checkout'
        and actor_scope = p_actor_scope
        and state = 'processing';

      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', split_part(SQLERRM, ':', 1),
          'message', 'checkout failed'
        )
      );
  end;
end;
$$;

-- =============================================================================
-- 8. Order read helper (ownership-safe)
-- =============================================================================
create or replace function public.mp_order_get(
  p_public_ref text,
  p_customer_id text,
  p_guest_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.mp_orders%rowtype;
  v_items jsonb;
begin
  select * into v_order
  from public.mp_orders o
  where o.public_ref = p_public_ref;
  if not found then
    raise exception 'CART_NOT_FOUND: order not found'
      using errcode = 'no_data_found';
  end if;

  if p_customer_id is not null then
    if v_order.customer_id is distinct from p_customer_id then
      raise exception 'CART_NOT_FOUND: order not found'
        using errcode = 'no_data_found';
    end if;
  elsif p_guest_token_hash is not null then
    if v_order.guest_token_hash is distinct from p_guest_token_hash then
      raise exception 'CART_NOT_FOUND: order not found'
        using errcode = 'no_data_found';
    end if;
  else
    raise exception 'CART_NOT_AUTHORIZED: ownership required'
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'sku', i.sku_snap,
      'title', i.title_snap,
      'quantity', i.quantity,
      'unitPrice', i.unit_price,
      'lineTotal', i.line_total
    ) order by i.created_at
  ), '[]'::jsonb)
  into v_items
  from public.mp_order_items i
  where i.order_id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'publicRef', v_order.public_ref,
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'subtotal', v_order.subtotal,
    'deliveryCharge', v_order.delivery_fee,
    'grandTotal', v_order.grand_total,
    'currency', v_order.currency,
    'items', v_items
  );
end;
$$;

-- =============================================================================
-- 9. Grants
-- =============================================================================
do $ws5_grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'mp_cart_assert_open',
        'mp_cart_resolve_delivery',
        'mp_cart_create',
        'mp_cart_upsert_item',
        'mp_cart_quote_delivery',
        'mp_cart_checkout',
        'mp_order_get'
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
$ws5_grants$;

notify pgrst, 'reload schema';
