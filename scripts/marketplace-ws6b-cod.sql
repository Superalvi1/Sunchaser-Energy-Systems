-- =============================================================================
-- Sunchaser Marketplace — WS6b Cash-on-Delivery Workflow (Revision 5.1)
-- Additive only. Reuses WS0/WS5 COD payment stub + WS6A event outbox/audit.
-- Does not alter bank-transfer receipt evidence or payment gateway flows.
-- =============================================================================

create extension if not exists pgcrypto with schema public;

-- -----------------------------------------------------------------------------
-- 1. Fulfillment lifecycle on orders (extends status; does not duplicate payments)
-- -----------------------------------------------------------------------------
alter table public.mp_orders
  add column if not exists fulfillment_state text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mp_orders_fulfillment_state_ck'
  ) then
    alter table public.mp_orders
      add constraint mp_orders_fulfillment_state_ck check (
        fulfillment_state is null or fulfillment_state in (
          'cod_pending',
          'cod_confirmed',
          'dispatched',
          'delivery_attempted',
          'delivery_failed',
          'delivery_refused',
          'collected',
          'cancelled',
          'return_started',
          'return_completed'
        )
      );
  end if;
end $$;

alter table public.mp_orders
  add column if not exists delivery_attempt_count integer not null default 0;

alter table public.mp_orders
  add column if not exists last_fulfillment_reason text;

alter table public.mp_orders
  add column if not exists cod_confirmed_at timestamptz;

alter table public.mp_orders
  add column if not exists dispatched_at timestamptz;

-- Backfill COD checkout stubs created by WS5
update public.mp_orders o
set fulfillment_state = 'cod_pending'
where o.fulfillment_state is null
  and o.status = 'pending_payment'
  and exists (
    select 1 from public.mp_payment_plans p
    where p.order_id = o.id and p.plan_type = 'cod_eligible'
  );

-- -----------------------------------------------------------------------------
-- 2. Extend event outbox for COD / fulfilment events
-- -----------------------------------------------------------------------------
do $$
declare
  c name;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'mp_event_outbox'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%event_type%'
  loop
    execute format('alter table public.mp_event_outbox drop constraint %I', c);
  end loop;
end $$;

alter table public.mp_event_outbox
  add constraint mp_event_outbox_event_type_ck check (event_type in (
    'payment.receipt_submitted',
    'payment.verified',
    'payment.rejected',
    'refund.recorded',
    'cod.confirmed',
    'order.confirmed',
    'order.dispatched',
    'delivery.attempted',
    'cod.collected',
    'delivery.failed',
    'delivery.refused',
    'order.cancelled',
    'return_to_origin.started',
    'return_to_origin.completed'
  ));

create or replace function public.mp_enqueue_event(
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_order_id text,
  p_payment_id text,
  p_actor_scope text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if p_event_type not in (
    'payment.receipt_submitted',
    'payment.verified',
    'payment.rejected',
    'refund.recorded',
    'cod.confirmed',
    'order.confirmed',
    'order.dispatched',
    'delivery.attempted',
    'cod.collected',
    'delivery.failed',
    'delivery.refused',
    'order.cancelled',
    'return_to_origin.started',
    'return_to_origin.completed'
  ) then
    raise exception 'VALIDATION_ERROR: unsupported event_type'
      using errcode = 'check_violation';
  end if;
  if p_actor_scope like 'client:%' then
    raise exception 'FORBIDDEN_FIELD: client-supplied actor_scope rejected'
      using errcode = 'check_violation';
  end if;

  v_id := public.mp_new_id('mpevt');
  insert into public.mp_event_outbox (
    id, event_type, aggregate_type, aggregate_id, order_id, payment_id,
    actor_scope, payload
  ) values (
    v_id, p_event_type, p_aggregate_type, p_aggregate_id, p_order_id, p_payment_id,
    p_actor_scope, coalesce(p_payload, '{}'::jsonb)
  );
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Ownership helper (uniform not-found)
-- -----------------------------------------------------------------------------
create or replace function public.mp_cod_resolve_order(
  p_public_ref text,
  p_customer_id text,
  p_guest_token_hash text
)
returns public.mp_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.mp_orders%rowtype;
begin
  select * into v_order
  from public.mp_orders
  where public_ref = p_public_ref;
  if not found then
    raise exception 'ORDER_NOT_FOUND: order not found'
      using errcode = 'no_data_found';
  end if;

  if p_customer_id is not null then
    if v_order.customer_id is distinct from p_customer_id then
      raise exception 'ORDER_NOT_FOUND: order not found'
        using errcode = 'no_data_found';
    end if;
  elsif p_guest_token_hash is not null then
    if v_order.guest_token_hash is distinct from p_guest_token_hash then
      raise exception 'ORDER_NOT_FOUND: order not found'
        using errcode = 'no_data_found';
    end if;
  else
    raise exception 'ORDER_NOT_AUTHORIZED: ownership required'
      using errcode = 'check_violation';
  end if;

  return v_order;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. COD eligibility / read
-- -----------------------------------------------------------------------------
create or replace function public.mp_cod_get(
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
  v_plan public.mp_payment_plans%rowtype;
  v_payment public.mp_payments%rowtype;
  v_zone public.mp_delivery_zones%rowtype;
begin
  v_order := public.mp_cod_resolve_order(p_public_ref, p_customer_id, p_guest_token_hash);

  select * into v_plan from public.mp_payment_plans where order_id = v_order.id;
  if not found or v_plan.plan_type <> 'cod_eligible' then
    raise exception 'COD_NOT_ALLOWED: order is not COD'
      using errcode = 'check_violation';
  end if;

  select * into v_payment
  from public.mp_payments
  where order_id = v_order.id
    and method = 'cash_on_delivery'
  order by created_at
  limit 1;

  if v_order.delivery_zone_id is not null then
    select * into v_zone from public.mp_delivery_zones where id = v_order.delivery_zone_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'publicRef', v_order.public_ref,
    'orderStatus', v_order.status,
    'fulfillmentState', coalesce(v_order.fulfillment_state, 'cod_pending'),
    'planType', v_plan.plan_type,
    'paymentMethod', 'cash_on_delivery',
    'amountDue', coalesce(v_payment.amount, v_plan.balance_due),
    'currency', v_order.currency,
    'grandTotal', v_order.grand_total,
    'deliveryCharge', v_order.delivery_fee,
    'codEligibleZone', coalesce(v_zone.cod_eligible, false),
    'paymentStatus', coalesce(v_payment.status, 'pending'),
    'deliveryAttemptCount', v_order.delivery_attempt_count,
    'codConfirmedAt', v_order.cod_confirmed_at,
    'dispatchedAt', v_order.dispatched_at
  );
end;
$$;

create or replace function public.mp_cod_assert_eligible(
  p_order public.mp_orders,
  p_allow_terminal boolean default false
)
returns public.mp_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mp_payment_plans%rowtype;
  v_payment public.mp_payments%rowtype;
  v_zone public.mp_delivery_zones%rowtype;
  v_cfg public.mp_pricing_config%rowtype;
begin
  if not coalesce(p_allow_terminal, false)
     and p_order.status in ('cancelled', 'refunded', 'delivered')
  then
    raise exception 'COD_NOT_ALLOWED: order is not eligible'
      using errcode = 'check_violation';
  end if;

  select * into v_plan from public.mp_payment_plans where order_id = p_order.id;
  if not found or v_plan.plan_type <> 'cod_eligible' then
    raise exception 'INVALID_PAYMENT_METHOD: order is not COD'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.mp_payments
    where order_id = p_order.id
      and method = 'bank_transfer'
      and status in ('submitted', 'verified')
  ) then
    raise exception 'COD_NOT_ALLOWED: incompatible bank-transfer payment exists'
      using errcode = 'check_violation';
  end if;

  select * into v_payment
  from public.mp_payments
  where order_id = p_order.id
    and method = 'cash_on_delivery'
  order by created_at
  limit 1
  for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND: COD obligation missing'
      using errcode = 'no_data_found';
  end if;
  if v_payment.status = 'collected'
     and not coalesce(p_allow_terminal, false)
  then
    raise exception 'COD_ALREADY_COLLECTED: cash already collected'
      using errcode = 'check_violation';
  end if;

  if p_order.delivery_zone_id is null then
    raise exception 'COD_NOT_ALLOWED: delivery zone missing'
      using errcode = 'check_violation';
  end if;
  select * into v_zone
  from public.mp_delivery_zones
  where id = p_order.delivery_zone_id
  for update;
  if not found or not v_zone.active or not v_zone.cod_eligible then
    raise exception 'COD_NOT_ALLOWED: delivery zone does not permit COD'
      using errcode = 'check_violation';
  end if;

  select * into v_cfg from public.mp_pricing_config where company_id = 'sunchaser';
  if v_cfg.cod_max_order_value is not null
     and p_order.grand_total > v_cfg.cod_max_order_value
  then
    raise exception 'COD_NOT_ALLOWED: order exceeds COD max value'
      using errcode = 'check_violation';
  end if;

  return v_payment;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Customer/guest + admin COD confirmation
-- -----------------------------------------------------------------------------
create or replace function public.mp_cod_confirm(
  p_public_ref text,
  p_customer_id text,
  p_guest_token_hash text,
  p_actor_scope text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.mp_orders%rowtype;
  v_payment public.mp_payments%rowtype;
  v_claim jsonb;
  v_event_id text;
  v_event2 text;
begin
  if p_actor_scope like 'client:%' then
    raise exception 'FORBIDDEN_FIELD: client-supplied actor_scope rejected'
      using errcode = 'check_violation';
  end if;

  v_order := public.mp_cod_resolve_order(p_public_ref, p_customer_id, p_guest_token_hash);

  v_claim := public.mp_idempotency_preflight(
    p_idempotency_key, 'cod_confirm', p_actor_scope, p_request_hash, v_order.id
  );
  if v_claim->>'status' = 'COMPLETED_REPLAY' then
    return (v_claim->'result_payload') || jsonb_build_object('replay', true);
  end if;
  if v_claim->>'status' = 'FAILED_KNOWN_REPLAY' then
    return jsonb_build_object(
      'ok', false, 'replay', true,
      'error', coalesce(v_claim->>'last_error_code', 'FAILED_KNOWN')
    );
  end if;
  if v_claim->>'status' = 'REQUEST_HASH_CONFLICT' then
    raise exception 'IDEMPOTENCY_CONFLICT: request hash mismatch'
      using errcode = 'unique_violation';
  end if;
  if v_claim->>'status' = 'IN_PROGRESS' then
    raise exception 'CONFLICT: idempotent request in progress'
      using errcode = 'unique_violation';
  end if;

  v_order := public.mp_lock_order_financial(v_order.id);
  v_payment := public.mp_cod_assert_eligible(v_order);

  if v_order.status = 'confirmed'
     and coalesce(v_order.fulfillment_state, '') = 'cod_confirmed'
  then
    raise exception 'COD_ALREADY_CONFIRMED: COD already confirmed'
      using errcode = 'unique_violation';
  end if;
  if v_order.status <> 'pending_payment' then
    raise exception 'INVALID_ORDER_STATUS: COD confirmation requires pending_payment'
      using errcode = 'check_violation';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'COD_NOT_ALLOWED: COD payment not pending'
      using errcode = 'check_violation';
  end if;

  -- Confirm order; never mark funds collected.
  update public.mp_orders
  set status = 'confirmed',
      fulfillment_state = 'cod_confirmed',
      cod_confirmed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_order.id
    and status = 'pending_payment';
  if not found then
    raise exception 'COD_ALREADY_CONFIRMED: COD already confirmed'
      using errcode = 'unique_violation';
  end if;

  perform public.mp_write_audit(
    p_actor_scope, 'cod.confirm', 'mp_orders', v_order.id, true,
    jsonb_build_object(
      'publicRef', v_order.public_ref,
      'paymentId', v_payment.id,
      'amountDue', v_payment.amount,
      'changedFields', jsonb_build_array('status', 'fulfillment_state')
    )
  );

  v_event_id := public.mp_enqueue_event(
    'cod.confirmed', 'mp_orders', v_order.id, v_order.id, v_payment.id,
    p_actor_scope,
    jsonb_build_object('publicRef', v_order.public_ref, 'paymentId', v_payment.id)
  );
  v_event2 := public.mp_enqueue_event(
    'order.confirmed', 'mp_orders', v_order.id, v_order.id, v_payment.id,
    p_actor_scope,
    jsonb_build_object('publicRef', v_order.public_ref)
  );

  update public.mp_idempotency_keys
  set state = 'completed',
      result_ref = v_order.public_ref,
      result_payload = jsonb_build_object(
        'ok', true,
        'publicRef', v_order.public_ref,
        'orderStatus', 'confirmed',
        'fulfillmentState', 'cod_confirmed',
        'paymentStatus', 'pending',
        'amountDue', v_payment.amount
      ),
      completed_at = timezone('utc', now())
  where idempotency_key = p_idempotency_key
    and operation_type = 'cod_confirm'
    and actor_scope = p_actor_scope;

  return jsonb_build_object(
    'ok', true,
    'replay', false,
    'publicRef', v_order.public_ref,
    'orderStatus', 'confirmed',
    'fulfillmentState', 'cod_confirmed',
    'paymentStatus', 'pending',
    'amountDue', v_payment.amount,
    'currency', v_order.currency,
    'eventIds', jsonb_build_array(v_event_id, v_event2)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Admin COD state-machine transitions
-- -----------------------------------------------------------------------------
create or replace function public.mp_cod_admin_transition(
  p_actor_scope text,
  p_public_ref text,
  p_action text,
  p_actor_id text,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.mp_orders%rowtype;
  v_payment public.mp_payments%rowtype;
  v_claim jsonb;
  v_op text;
  v_reason text;
  v_event text;
  v_event2 text;
  v_net numeric(14,2);
  v_result jsonb;
  v_fs text;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'ORDER_NOT_AUTHORIZED: admin actor_scope required'
      using errcode = 'check_violation';
  end if;
  if p_action not in (
    'confirm','dispatch','delivery_attempt','collect','fail','refuse',
    'cancel','return_start','return_complete'
  ) then
    raise exception 'VALIDATION_ERROR: unsupported COD action'
      using errcode = 'check_violation';
  end if;

  select * into v_order from public.mp_orders where public_ref = p_public_ref;
  if not found then
    raise exception 'ORDER_NOT_FOUND: order not found'
      using errcode = 'no_data_found';
  end if;

  v_op := 'cod_admin_' || p_action;
  v_claim := public.mp_idempotency_preflight(
    p_idempotency_key, v_op, p_actor_scope, p_request_hash, v_order.id
  );
  if v_claim->>'status' = 'COMPLETED_REPLAY' then
    return (v_claim->'result_payload') || jsonb_build_object('replay', true);
  end if;
  if v_claim->>'status' = 'FAILED_KNOWN_REPLAY' then
    return jsonb_build_object(
      'ok', false, 'replay', true,
      'error', coalesce(v_claim->>'last_error_code', 'FAILED_KNOWN')
    );
  end if;
  if v_claim->>'status' = 'REQUEST_HASH_CONFLICT' then
    raise exception 'IDEMPOTENCY_CONFLICT: request hash mismatch'
      using errcode = 'unique_violation';
  end if;
  if v_claim->>'status' = 'IN_PROGRESS' then
    raise exception 'CONFLICT: idempotent request in progress'
      using errcode = 'unique_violation';
  end if;

  v_order := public.mp_lock_order_financial(v_order.id);
  v_payment := public.mp_cod_assert_eligible(
    v_order,
    -- allow terminal so cancel can return CANCELLATION_NOT_ALLOWED for collected
    -- and return-to-origin can proceed after fail/refuse/cancel.
    p_action in ('return_start', 'return_complete', 'cancel')
  );
  v_fs := coalesce(v_order.fulfillment_state, 'cod_pending');
  v_reason := trim(coalesce(p_reason, ''));

  if p_action = 'confirm' then
    if v_order.status = 'confirmed' and v_fs = 'cod_confirmed' then
      raise exception 'COD_ALREADY_CONFIRMED: already confirmed'
        using errcode = 'unique_violation';
    end if;
    if v_order.status <> 'pending_payment' then
      raise exception 'INVALID_STATUS_TRANSITION: confirm requires pending_payment'
        using errcode = 'check_violation';
    end if;
    update public.mp_orders
    set status = 'confirmed',
        fulfillment_state = 'cod_confirmed',
        cod_confirmed_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_order.id;
    v_event := public.mp_enqueue_event(
      'cod.confirmed', 'mp_orders', v_order.id, v_order.id, v_payment.id,
      p_actor_scope, jsonb_build_object('publicRef', v_order.public_ref)
    );
    v_event2 := public.mp_enqueue_event(
      'order.confirmed', 'mp_orders', v_order.id, v_order.id, v_payment.id,
      p_actor_scope, jsonb_build_object('publicRef', v_order.public_ref)
    );
    perform public.mp_write_audit(
      p_actor_scope, 'cod.admin_confirm', 'mp_orders', v_order.id, true,
      jsonb_build_object('publicRef', v_order.public_ref, 'actorId', p_actor_id)
    );
    v_result := jsonb_build_object(
      'ok', true, 'publicRef', v_order.public_ref,
      'orderStatus', 'confirmed', 'fulfillmentState', 'cod_confirmed',
      'paymentStatus', v_payment.status
    );

  elsif p_action = 'dispatch' then
    if v_order.status not in ('confirmed', 'processing')
       or v_fs not in ('cod_confirmed')
    then
      raise exception 'INVALID_STATUS_TRANSITION: dispatch requires confirmed COD'
        using errcode = 'check_violation';
    end if;
    update public.mp_orders
    set status = 'dispatched',
        fulfillment_state = 'dispatched',
        dispatched_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_order.id;
    v_event := public.mp_enqueue_event(
      'order.dispatched', 'mp_orders', v_order.id, v_order.id, v_payment.id,
      p_actor_scope, jsonb_build_object('publicRef', v_order.public_ref)
    );
    perform public.mp_write_audit(
      p_actor_scope, 'cod.dispatch', 'mp_orders', v_order.id, true,
      jsonb_build_object('publicRef', v_order.public_ref, 'actorId', p_actor_id)
    );
    v_result := jsonb_build_object(
      'ok', true, 'publicRef', v_order.public_ref,
      'orderStatus', 'dispatched', 'fulfillmentState', 'dispatched',
      'paymentStatus', v_payment.status
    );

  elsif p_action = 'delivery_attempt' then
    if v_order.status <> 'dispatched'
       or v_fs not in ('dispatched', 'delivery_attempted')
    then
      raise exception 'DELIVERY_ATTEMPT_NOT_ALLOWED: dispatch required first'
        using errcode = 'check_violation';
    end if;
    if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
      raise exception 'VALIDATION_ERROR: attempt reason must be 3-500 characters'
        using errcode = 'check_violation';
    end if;
    update public.mp_orders
    set fulfillment_state = 'delivery_attempted',
        delivery_attempt_count = delivery_attempt_count + 1,
        last_fulfillment_reason = left(v_reason, 500),
        updated_at = timezone('utc', now())
    where id = v_order.id;
    v_event := public.mp_enqueue_event(
      'delivery.attempted', 'mp_orders', v_order.id, v_order.id, v_payment.id,
      p_actor_scope,
      jsonb_build_object(
        'publicRef', v_order.public_ref,
        'attemptCount', v_order.delivery_attempt_count + 1
      )
    );
    perform public.mp_write_audit(
      p_actor_scope, 'cod.delivery_attempt', 'mp_orders', v_order.id, true,
      jsonb_build_object(
        'publicRef', v_order.public_ref,
        'reasonLen', char_length(v_reason),
        'actorId', p_actor_id
      )
    );
    v_result := jsonb_build_object(
      'ok', true, 'publicRef', v_order.public_ref,
      'orderStatus', 'dispatched', 'fulfillmentState', 'delivery_attempted',
      'deliveryAttemptCount', v_order.delivery_attempt_count + 1,
      'paymentStatus', v_payment.status
    );

  elsif p_action = 'collect' then
    -- Finance-only collection: require dispatched/attempted; never invent partial COD.
    -- Allowed scopes: admin:finance:*, admin:super*, admin:{id} (Admin), system:*
    -- Denied: admin:ops:*
    if p_actor_scope like 'admin:ops:%'
       or (
         p_actor_scope not like 'admin:finance:%'
         and p_actor_scope not like 'admin:super%'
         and p_actor_scope not like 'system:%'
         and p_actor_scope !~ '^admin:[^:]+$'
       )
    then
      raise exception 'ORDER_NOT_AUTHORIZED: collection requires finance role'
        using errcode = 'check_violation';
    end if;
    if v_order.status <> 'dispatched'
       or v_fs not in ('dispatched', 'delivery_attempted')
    then
      raise exception 'COD_COLLECTION_NOT_ALLOWED: delivery state not eligible'
        using errcode = 'check_violation';
    end if;
    if v_payment.status <> 'pending' then
      raise exception 'COD_ALREADY_COLLECTED: cash already collected'
        using errcode = 'check_violation';
    end if;

    v_net := public.mp_order_net_paid(v_order.id);
    if v_net + v_payment.amount > v_order.grand_total then
      raise exception 'INVALID_AMOUNT: collection would exceed grand_total'
        using errcode = 'check_violation';
    end if;

    update public.mp_payments
    set status = 'collected',
        verified_by = p_actor_id,
        verified_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_payment.id
      and status = 'pending';
    if not found then
      raise exception 'COD_ALREADY_COLLECTED: cash already collected'
        using errcode = 'unique_violation';
    end if;

    update public.mp_orders
    set status = 'delivered',
        fulfillment_state = 'collected',
        updated_at = timezone('utc', now())
    where id = v_order.id;

    perform public.mp_write_audit(
      p_actor_scope, 'cod.collect', 'mp_payments', v_payment.id, true,
      jsonb_build_object(
        'publicRef', v_order.public_ref,
        'amount', v_payment.amount,
        'netPaidBefore', v_net,
        'actorId', p_actor_id
      )
    );
    v_event := public.mp_enqueue_event(
      'cod.collected', 'mp_payments', v_payment.id, v_order.id, v_payment.id,
      p_actor_scope,
      jsonb_build_object(
        'publicRef', v_order.public_ref,
        'paymentId', v_payment.id,
        'amount', v_payment.amount
      )
    );
    v_result := jsonb_build_object(
      'ok', true, 'publicRef', v_order.public_ref,
      'orderStatus', 'delivered', 'fulfillmentState', 'collected',
      'paymentStatus', 'collected', 'amountCollected', v_payment.amount
    );

  elsif p_action = 'fail' then
    if v_order.status <> 'dispatched'
       or v_fs not in ('dispatched', 'delivery_attempted')
    then
      raise exception 'DELIVERY_FAILURE_NOT_ALLOWED: invalid current state'
        using errcode = 'check_violation';
    end if;
    if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
      raise exception 'VALIDATION_ERROR: failure reason must be 3-500 characters'
        using errcode = 'check_violation';
    end if;
    update public.mp_orders
    set fulfillment_state = 'delivery_failed',
        last_fulfillment_reason = left(v_reason, 500),
        updated_at = timezone('utc', now())
    where id = v_order.id;
    -- Payment remains pending (not collected).
    perform public.mp_write_audit(
      p_actor_scope, 'cod.fail', 'mp_orders', v_order.id, true,
      jsonb_build_object(
        'publicRef', v_order.public_ref,
        'reasonLen', char_length(v_reason),
        'paymentStatus', v_payment.status
      )
    );
    v_event := public.mp_enqueue_event(
      'delivery.failed', 'mp_orders', v_order.id, v_order.id, v_payment.id,
      p_actor_scope, jsonb_build_object('publicRef', v_order.public_ref)
    );
    v_result := jsonb_build_object(
      'ok', true, 'publicRef', v_order.public_ref,
      'orderStatus', v_order.status, 'fulfillmentState', 'delivery_failed',
      'paymentStatus', v_payment.status
    );

  elsif p_action = 'refuse' then
    if v_order.status <> 'dispatched'
       or v_fs not in ('dispatched', 'delivery_attempted')
    then
      raise exception 'DELIVERY_REFUSAL_NOT_ALLOWED: invalid current state'
        using errcode = 'check_violation';
    end if;
    if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
      raise exception 'VALIDATION_ERROR: refusal reason must be 3-500 characters'
        using errcode = 'check_violation';
    end if;
    update public.mp_orders
    set fulfillment_state = 'delivery_refused',
        last_fulfillment_reason = left(v_reason, 500),
        updated_at = timezone('utc', now())
    where id = v_order.id;
    perform public.mp_write_audit(
      p_actor_scope, 'cod.refuse', 'mp_orders', v_order.id, true,
      jsonb_build_object(
        'publicRef', v_order.public_ref,
        'reasonLen', char_length(v_reason),
        'paymentStatus', v_payment.status
      )
    );
    v_event := public.mp_enqueue_event(
      'delivery.refused', 'mp_orders', v_order.id, v_order.id, v_payment.id,
      p_actor_scope, jsonb_build_object('publicRef', v_order.public_ref)
    );
    v_result := jsonb_build_object(
      'ok', true, 'publicRef', v_order.public_ref,
      'orderStatus', v_order.status, 'fulfillmentState', 'delivery_refused',
      'paymentStatus', v_payment.status
    );

  elsif p_action = 'cancel' then
    if v_payment.status = 'collected' or v_order.status = 'delivered' or v_fs = 'collected' then
      raise exception 'CANCELLATION_NOT_ALLOWED: collected orders cannot be cancelled'
        using errcode = 'check_violation';
    end if;
    if v_order.status in ('cancelled', 'refunded') then
      raise exception 'CANCELLATION_NOT_ALLOWED: order already closed'
        using errcode = 'check_violation';
    end if;
    if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
      raise exception 'VALIDATION_ERROR: cancellation reason must be 3-500 characters'
        using errcode = 'check_violation';
    end if;

    update public.mp_payments
    set status = 'rejected',
        rejection_reason = left(v_reason, 500),
        updated_at = timezone('utc', now())
    where id = v_payment.id
      and status = 'pending';

    update public.mp_orders
    set status = 'cancelled',
        fulfillment_state = 'cancelled',
        last_fulfillment_reason = left(v_reason, 500),
        updated_at = timezone('utc', now())
    where id = v_order.id;

    perform public.mp_write_audit(
      p_actor_scope, 'cod.cancel', 'mp_orders', v_order.id, true,
      jsonb_build_object(
        'publicRef', v_order.public_ref,
        'reasonLen', char_length(v_reason),
        'paymentId', v_payment.id
      )
    );
    v_event := public.mp_enqueue_event(
      'order.cancelled', 'mp_orders', v_order.id, v_order.id, v_payment.id,
      p_actor_scope, jsonb_build_object('publicRef', v_order.public_ref)
    );
    v_result := jsonb_build_object(
      'ok', true, 'publicRef', v_order.public_ref,
      'orderStatus', 'cancelled', 'fulfillmentState', 'cancelled',
      'paymentStatus', 'rejected'
    );

  elsif p_action = 'return_start' then
    if v_fs not in ('delivery_failed', 'delivery_refused', 'cancelled') then
      raise exception 'RETURN_TO_ORIGIN_NOT_ALLOWED: requires failed/refused/cancelled'
        using errcode = 'check_violation';
    end if;
    if v_fs = 'return_started' or v_fs = 'return_completed' then
      raise exception 'RETURN_TO_ORIGIN_NOT_ALLOWED: return already started'
        using errcode = 'check_violation';
    end if;
    if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
      raise exception 'VALIDATION_ERROR: return reason must be 3-500 characters'
        using errcode = 'check_violation';
    end if;
    update public.mp_orders
    set fulfillment_state = 'return_started',
        last_fulfillment_reason = left(v_reason, 500),
        updated_at = timezone('utc', now())
    where id = v_order.id;
    perform public.mp_write_audit(
      p_actor_scope, 'cod.return_start', 'mp_orders', v_order.id, true,
      jsonb_build_object('publicRef', v_order.public_ref, 'reasonLen', char_length(v_reason))
    );
    v_event := public.mp_enqueue_event(
      'return_to_origin.started', 'mp_orders', v_order.id, v_order.id, v_payment.id,
      p_actor_scope, jsonb_build_object('publicRef', v_order.public_ref)
    );
    v_result := jsonb_build_object(
      'ok', true, 'publicRef', v_order.public_ref,
      'orderStatus', v_order.status, 'fulfillmentState', 'return_started',
      'paymentStatus', v_payment.status
    );

  else -- return_complete
    if v_fs <> 'return_started' then
      raise exception 'RETURN_TO_ORIGIN_NOT_ALLOWED: return must be started first'
        using errcode = 'check_violation';
    end if;
    update public.mp_orders
    set fulfillment_state = 'return_completed',
        updated_at = timezone('utc', now())
    where id = v_order.id;
    perform public.mp_write_audit(
      p_actor_scope, 'cod.return_complete', 'mp_orders', v_order.id, true,
      jsonb_build_object('publicRef', v_order.public_ref, 'actorId', p_actor_id)
    );
    v_event := public.mp_enqueue_event(
      'return_to_origin.completed', 'mp_orders', v_order.id, v_order.id, v_payment.id,
      p_actor_scope, jsonb_build_object('publicRef', v_order.public_ref)
    );
    v_result := jsonb_build_object(
      'ok', true, 'publicRef', v_order.public_ref,
      'orderStatus', v_order.status, 'fulfillmentState', 'return_completed',
      'paymentStatus', v_payment.status
    );
  end if;

  update public.mp_idempotency_keys
  set state = 'completed',
      result_ref = v_order.public_ref,
      result_payload = v_result,
      completed_at = timezone('utc', now())
  where idempotency_key = p_idempotency_key
    and operation_type = v_op
    and actor_scope = p_actor_scope;

  return v_result || jsonb_build_object(
    'replay', false,
    'eventId', v_event,
    'eventId2', v_event2
  );
end;
$$;

-- Harden foundation collect/cancel to require COD fulfilment eligibility when used.
create or replace function public.mp_collect_cod_payment(
  p_actor_scope text,
  p_payment_id text,
  p_collected_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id text;
  v_payment public.mp_payments%rowtype;
  v_order public.mp_orders%rowtype;
  v_public_ref text;
  v_result jsonb;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'ORDER_NOT_AUTHORIZED: collect requires admin/system actor_scope'
      using errcode = 'check_violation';
  end if;
  if p_actor_scope like 'admin:ops:%' then
    raise exception 'ORDER_NOT_AUTHORIZED: collection requires finance role'
      using errcode = 'check_violation';
  end if;

  select order_id into v_order_id from public.mp_payments where id = p_payment_id;
  if v_order_id is null then
    raise exception 'PAYMENT_NOT_FOUND: payment not found'
      using errcode = 'no_data_found';
  end if;
  select public_ref into v_public_ref from public.mp_orders where id = v_order_id;

  v_result := public.mp_cod_admin_transition(
    p_actor_scope,
    v_public_ref,
    'collect',
    p_collected_by,
    null,
    'legacy-collect-' || p_payment_id || '-' || substr(md5(random()::text), 1, 12),
    encode(public.digest(convert_to(p_payment_id || coalesce(p_collected_by, ''), 'UTF8'), 'sha256'), 'hex')
  );
  return v_result || jsonb_build_object('payment_id', p_payment_id, 'paymentId', p_payment_id);
end;
$$;

create or replace function public.mp_cancel_cod_payment(
  p_actor_scope text,
  p_payment_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id text;
  v_public_ref text;
  v_result jsonb;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'ORDER_NOT_AUTHORIZED: cancel COD requires admin/system actor_scope'
      using errcode = 'check_violation';
  end if;

  select order_id into v_order_id from public.mp_payments where id = p_payment_id;
  if v_order_id is null then
    raise exception 'PAYMENT_NOT_FOUND: payment not found'
      using errcode = 'no_data_found';
  end if;
  select public_ref into v_public_ref from public.mp_orders where id = v_order_id;

  v_result := public.mp_cod_admin_transition(
    p_actor_scope,
    v_public_ref,
    'cancel',
    p_actor_scope,
    p_reason,
    'legacy-cancel-' || p_payment_id || '-' || substr(md5(random()::text), 1, 12),
    encode(public.digest(convert_to(p_payment_id || coalesce(p_reason, ''), 'UTF8'), 'sha256'), 'hex')
  );
  return v_result || jsonb_build_object('payment_id', p_payment_id, 'paymentId', p_payment_id);
end;
$$;

create or replace function public.mp_admin_list_cod_orders(
  p_actor_scope text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_rows jsonb;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'ORDER_NOT_AUTHORIZED: admin actor_scope required'
      using errcode = 'check_violation';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
  into v_rows
  from (
    select
      o.public_ref as "publicRef",
      o.status as "orderStatus",
      coalesce(o.fulfillment_state, 'cod_pending') as "fulfillmentState",
      o.grand_total as "grandTotal",
      o.delivery_fee as "deliveryCharge",
      o.currency,
      o.delivery_attempt_count as "deliveryAttemptCount",
      p.status as "paymentStatus",
      p.amount as "amountDue",
      o.created_at as "createdAt"
    from public.mp_orders o
    join public.mp_payment_plans pl on pl.order_id = o.id and pl.plan_type = 'cod_eligible'
    join public.mp_payments p
      on p.order_id = o.id and p.method = 'cash_on_delivery'
    order by o.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object('ok', true, 'orders', v_rows);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Grants / RLS
-- -----------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'mp_enqueue_event',
        'mp_cod_resolve_order',
        'mp_cod_get',
        'mp_cod_assert_eligible',
        'mp_cod_confirm',
        'mp_cod_admin_transition',
        'mp_collect_cod_payment',
        'mp_cancel_cod_payment',
        'mp_admin_list_cod_orders'
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
end $$;

notify pgrst, 'reload schema';
