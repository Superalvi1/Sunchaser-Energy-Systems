-- =============================================================================
-- Sunchaser Marketplace — WS6a Bank-Transfer Workflow (Revision 5.1)
-- Additive only. Reuses WS0 payment/intent/receipt/idempotency/storage-cleanup
-- objects. Does not implement COD collection (WS6b).
-- =============================================================================

create extension if not exists pgcrypto with schema public;

-- -----------------------------------------------------------------------------
-- 1. Upload-intent expiry (short-lived, single-use)
-- -----------------------------------------------------------------------------
alter table public.mp_upload_intents
  add column if not exists expires_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2. Business-event outbox (notification deferral; distinct from storage cleanup)
--    Established storage cleanup remains mp_storage_cleanup_outbox.
-- -----------------------------------------------------------------------------
create table if not exists public.mp_event_outbox (
  id text primary key,
  event_type text not null check (event_type in (
    'payment.receipt_submitted',
    'payment.verified',
    'payment.rejected',
    'refund.recorded'
  )),
  aggregate_type text not null,
  aggregate_id text not null,
  order_id text references public.mp_orders(id) on delete restrict,
  payment_id text references public.mp_payments(id) on delete restrict,
  actor_scope text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','processed','failed','abandoned')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create index if not exists mp_event_outbox_pending_idx
  on public.mp_event_outbox (created_at) where status = 'pending';

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
    'refund.recorded'
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
-- 3. Ownership-safe bank-transfer preflight
-- -----------------------------------------------------------------------------
create or replace function public.mp_payment_preflight(
  p_public_ref text,
  p_customer_id text,
  p_guest_token_hash text,
  p_actor_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.mp_orders%rowtype;
  v_plan public.mp_payment_plans%rowtype;
  v_net numeric(14,2);
  v_outstanding numeric(14,2);
  v_pending_bt integer;
  v_max_bytes bigint := 5242880;
begin
  if p_actor_scope like 'client:%' then
    raise exception 'FORBIDDEN_FIELD: client-supplied actor_scope rejected'
      using errcode = 'check_violation';
  end if;

  select * into v_order
  from public.mp_orders
  where public_ref = p_public_ref;
  if not found then
    -- Uniform not-found (no enumeration)
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

  if v_order.status in ('cancelled', 'refunded', 'delivered') then
    raise exception 'PAYMENT_NOT_ALLOWED: order is not payable'
      using errcode = 'check_violation';
  end if;
  if v_order.status not in ('pending_payment', 'awaiting_verification', 'confirmed') then
    raise exception 'PAYMENT_NOT_ALLOWED: order is not payable'
      using errcode = 'check_violation';
  end if;

  select * into v_plan
  from public.mp_payment_plans
  where order_id = v_order.id;
  if not found then
    raise exception 'PAYMENT_NOT_ALLOWED: payment plan missing'
      using errcode = 'check_violation';
  end if;

  -- Bank transfer is for full / partial / token plans (not COD-only balance).
  if v_plan.plan_type = 'cod_eligible' and v_plan.upfront_amount <= 0 then
    raise exception 'INVALID_PAYMENT_METHOD: bank transfer not allowed for COD-only plan'
      using errcode = 'check_violation';
  end if;

  v_net := public.mp_order_net_paid(v_order.id);
  v_outstanding := v_order.grand_total - v_net;
  if v_outstanding <= 0 then
    raise exception 'PAYMENT_NOT_ALLOWED: order fully paid'
      using errcode = 'check_violation';
  end if;

  select count(*)::integer into v_pending_bt
  from public.mp_payments
  where order_id = v_order.id
    and method = 'bank_transfer'
    and status = 'submitted';
  if v_pending_bt > 0 then
    raise exception 'PAYMENT_ALREADY_RECORDED: pending bank transfer already submitted'
      using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'ok', true,
    'publicRef', v_order.public_ref,
    'orderStatus', v_order.status,
    'planType', v_plan.plan_type,
    'paymentMethod', 'bank_transfer',
    'currency', v_order.currency,
    'amountDue', v_outstanding,
    'grandTotal', v_order.grand_total,
    'netPaid', v_net,
    'receiptConstraints', jsonb_build_object(
      'allowedMimeTypes', jsonb_build_array('image/jpeg', 'image/png', 'application/pdf'),
      'maxBytes', v_max_bytes
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Enhanced upload-intent create (expiry + ownership via order lock)
-- -----------------------------------------------------------------------------
create or replace function public.mp_create_upload_intent(
  p_order_id text,
  p_operation_type text,
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
  v_claim public.mp_idempotency_keys%rowtype;
  v_existing public.mp_upload_intents%rowtype;
  v_id text;
  v_path text;
  v_order_hash text;
  v_stale_seconds integer;
  v_expires timestamptz;
begin
  if p_operation_type is distinct from 'bank_transfer_receipt' then
    raise exception 'VALIDATION_ERROR: unsupported upload operation_type'
      using errcode = 'check_violation';
  end if;
  if p_actor_scope not like 'customer:%' and p_actor_scope not like 'guest:%'
     and p_actor_scope not like 'admin:%' then
    raise exception 'FORBIDDEN_FIELD: actor_scope must be server-derived'
      using errcode = 'check_violation';
  end if;

  begin
    v_stale_seconds := greatest(
      30,
      coalesce(nullif(current_setting('app.marketplace_upload_intent_stale_seconds', true), '')::integer, 300)
    );
  exception when others then
    v_stale_seconds := 300;
  end;
  v_expires := timezone('utc', now()) + make_interval(secs => v_stale_seconds);

  select * into v_order from public.mp_orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND: order not found'
      using errcode = 'no_data_found';
  end if;
  -- Payable-status gating belongs in mp_payment_preflight / for_order wrappers.
  -- Low-level create remains usable for reconciliation fixtures.

  select * into v_claim
  from public.mp_idempotency_keys
  where idempotency_key = p_idempotency_key
    and operation_type = p_operation_type
    and actor_scope = p_actor_scope
    and request_hash = p_request_hash
  for update;
  if not found or v_claim.state <> 'processing' then
    raise exception 'UPLOAD_INTENT_REQUIRED: matching processing idempotency claim required'
      using errcode = 'check_violation';
  end if;

  select * into v_existing
  from public.mp_upload_intents
  where idempotency_key = p_idempotency_key
    and operation_type = p_operation_type
    and actor_scope = p_actor_scope;
  if found then
    return jsonb_build_object(
      'ok', true,
      'upload_intent_id', v_existing.id,
      'storage_path', v_existing.storage_path,
      'status', v_existing.status,
      'expires_at', v_existing.expires_at,
      'replay', true
    );
  end if;

  v_id := public.mp_new_id('mpui');
  v_order_hash := substr(
    encode(public.digest(convert_to(p_order_id, 'UTF8'), 'sha256'), 'hex'),
    1,
    12
  );
  v_path := 'mp-receipts/' || v_order_hash || '/' || v_id;

  insert into public.mp_upload_intents (
    id, operation_type, actor_scope, order_id,
    idempotency_key, request_hash, storage_path, status, expires_at
  ) values (
    v_id, p_operation_type, p_actor_scope, p_order_id,
    p_idempotency_key, p_request_hash, v_path, 'claimed', v_expires
  );

  return jsonb_build_object(
    'ok', true,
    'upload_intent_id', v_id,
    'storage_path', v_path,
    'status', 'claimed',
    'expires_at', v_expires,
    'replay', false
  );
end;
$$;

-- Resolve server-generated storage path for an owned, live upload intent.
-- Never returns path to unauthenticated callers; browser roles cannot execute.
create or replace function public.mp_get_upload_intent_path(
  p_upload_intent_id text,
  p_actor_scope text default null,
  p_order_public_ref text default null,
  p_customer_id text default null,
  p_guest_token_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.mp_upload_intents%rowtype;
  v_order public.mp_orders%rowtype;
begin
  select * into v_intent
  from public.mp_upload_intents
  where id = p_upload_intent_id;
  if not found then
    raise exception 'UPLOAD_INTENT_INVALID: intent not found'
      using errcode = 'no_data_found';
  end if;

  if v_intent.status not in ('claimed', 'uploaded') then
    raise exception 'UPLOAD_INTENT_USED: intent not usable'
      using errcode = 'check_violation';
  end if;
  if v_intent.expires_at is not null
     and v_intent.expires_at <= timezone('utc', now())
  then
    raise exception 'UPLOAD_INTENT_EXPIRED: intent expired'
      using errcode = 'check_violation';
  end if;

  if p_actor_scope is not null then
    if v_intent.actor_scope is distinct from p_actor_scope then
      raise exception 'ORDER_NOT_FOUND: order not found'
        using errcode = 'no_data_found';
    end if;
  end if;

  if p_order_public_ref is not null then
    select * into v_order from public.mp_orders where id = v_intent.order_id;
    if not found or v_order.public_ref is distinct from p_order_public_ref then
      raise exception 'ORDER_NOT_FOUND: order not found'
        using errcode = 'no_data_found';
    end if;
    if p_customer_id is not null
       and v_order.customer_id is distinct from p_customer_id
    then
      raise exception 'ORDER_NOT_FOUND: order not found'
        using errcode = 'no_data_found';
    end if;
    if p_guest_token_hash is not null
       and v_order.guest_token_hash is distinct from p_guest_token_hash
    then
      raise exception 'ORDER_NOT_FOUND: order not found'
        using errcode = 'no_data_found';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'storage_path', v_intent.storage_path,
    'request_hash', v_intent.request_hash,
    'order_id', v_intent.order_id,
    'status', v_intent.status
  );
end;
$$;

-- Quarantine uploaded-but-unattached intent after DB failure (orphan cleanup)
create or replace function public.mp_quarantine_unattached_upload(
  p_upload_intent_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.mp_upload_intents%rowtype;
begin
  select * into v_intent
  from public.mp_upload_intents
  where id = p_upload_intent_id
  for update;
  if not found then
    return jsonb_build_object('ok', true, 'status', 'missing');
  end if;
  if v_intent.status = 'attached' then
    return jsonb_build_object('ok', true, 'status', 'attached');
  end if;
  if v_intent.status in ('claimed', 'uploaded') then
    update public.mp_upload_intents
    set status = 'cleanup_pending', updated_at = timezone('utc', now())
    where id = p_upload_intent_id;
    insert into public.mp_storage_cleanup_outbox (
      id, storage_path, upload_intent_id, reason, related_order_id, related_idempotency_key
    ) values (
      public.mp_new_id('mpclo'), v_intent.storage_path, v_intent.id,
      'orphan_after_db_failure', v_intent.order_id, v_intent.idempotency_key
    );
    return jsonb_build_object('ok', true, 'status', 'cleanup_pending');
  end if;
  return jsonb_build_object('ok', true, 'status', v_intent.status);
end;
$$;

-- Ownership-bound upload-intent RPC for HTTP layer (public_ref based)
create or replace function public.mp_create_upload_intent_for_order(
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
  v_pre jsonb;
  v_claim jsonb;
  v_intent jsonb;
begin
  -- Authorize + preflight first (no storage path until claim)
  v_pre := public.mp_payment_preflight(
    p_public_ref, p_customer_id, p_guest_token_hash, p_actor_scope
  );

  select * into v_order from public.mp_orders where public_ref = p_public_ref;
  if not found then
    raise exception 'ORDER_NOT_FOUND: order not found'
      using errcode = 'no_data_found';
  end if;

  v_claim := public.mp_idempotency_preflight(
    p_idempotency_key,
    'bank_transfer_receipt',
    p_actor_scope,
    p_request_hash,
    v_order.id
  );

  if v_claim->>'status' = 'COMPLETED_REPLAY' then
    return jsonb_build_object(
      'ok', true,
      'replay', true,
      'status', 'COMPLETED_REPLAY',
      'result', v_claim->'result_payload'
    );
  end if;
  if v_claim->>'status' = 'FAILED_KNOWN_REPLAY' then
    return jsonb_build_object(
      'ok', false,
      'replay', true,
      'status', 'FAILED_KNOWN_REPLAY',
      'error', coalesce(v_claim->>'last_error_code', 'FAILED_KNOWN'),
      'result', v_claim->'result_payload'
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

  v_intent := public.mp_create_upload_intent(
    v_order.id,
    'bank_transfer_receipt',
    p_actor_scope,
    p_idempotency_key,
    p_request_hash
  );

  return jsonb_build_object(
    'ok', true,
    'replay', coalesce((v_intent->>'replay')::boolean, false),
    'uploadIntentId', v_intent->>'upload_intent_id',
    'status', v_intent->>'status',
    'expiresAt', v_intent->>'expires_at',
    'allowedMimeTypes', v_pre->'receiptConstraints'->'allowedMimeTypes',
    'maxBytes', v_pre->'receiptConstraints'->'maxBytes',
    'amountDue', v_pre->'amountDue',
    'currency', v_pre->>'currency'
    -- storage_path intentionally omitted from public API response
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Mark uploaded with expiry / single-use guards
-- -----------------------------------------------------------------------------
create or replace function public.mp_mark_upload_intent_uploaded(
  p_upload_intent_id text,
  p_byte_size bigint,
  p_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sha text;
  v_intent public.mp_upload_intents%rowtype;
begin
  if p_byte_size is null or p_byte_size <= 0 then
    raise exception 'INVALID_FILE_CONTENT: byte_size must be > 0'
      using errcode = 'check_violation';
  end if;
  if p_byte_size > 5242880 then
    raise exception 'FILE_TOO_LARGE: receipt exceeds maximum size'
      using errcode = 'check_violation';
  end if;
  v_sha := lower(trim(coalesce(p_sha256, '')));
  if v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_FILE_CONTENT: sha256 must be a 64-character hex digest'
      using errcode = 'check_violation';
  end if;

  select * into v_intent
  from public.mp_upload_intents
  where id = p_upload_intent_id
  for update;
  if not found then
    raise exception 'UPLOAD_INTENT_INVALID: intent not found'
      using errcode = 'no_data_found';
  end if;
  if v_intent.status = 'attached' or v_intent.status = 'uploaded' then
    raise exception 'UPLOAD_INTENT_USED: intent already used'
      using errcode = 'check_violation';
  end if;
  if v_intent.status <> 'claimed' then
    raise exception 'UPLOAD_INTENT_INVALID: intent not in claimed state'
      using errcode = 'check_violation';
  end if;
  if v_intent.expires_at is not null
     and v_intent.expires_at <= timezone('utc', now())
  then
    update public.mp_upload_intents
    set status = 'abandoned', updated_at = timezone('utc', now())
    where id = p_upload_intent_id and status = 'claimed';
    raise exception 'UPLOAD_INTENT_EXPIRED: intent expired'
      using errcode = 'check_violation';
  end if;

  update public.mp_upload_intents
  set status = 'uploaded',
      byte_size = p_byte_size,
      sha256 = v_sha,
      uploaded_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_upload_intent_id
    and status = 'claimed';
  if not found then
    raise exception 'UPLOAD_INTENT_INVALID: intent not in claimed state'
      using errcode = 'check_violation';
  end if;
  return jsonb_build_object('ok', true, 'status', 'uploaded', 'sha256', v_sha, 'byte_size', p_byte_size);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Record payment (+ transactional notification outbox)
-- -----------------------------------------------------------------------------
create or replace function public.mp_record_payment(
  p_actor_scope text,
  p_order_id text,
  p_upload_intent_id text,
  p_amount numeric,
  p_sha256 text,
  p_byte_size bigint,
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
  v_plan public.mp_payment_plans%rowtype;
  v_intent public.mp_upload_intents%rowtype;
  v_payment_id text;
  v_media_id text;
  v_object_id text;
  v_receipt_id text;
  v_net numeric(14,2);
  v_sha text;
  v_event_id text;
begin
  if p_actor_scope like 'client:%' then
    raise exception 'FORBIDDEN_FIELD: client-supplied actor_scope rejected'
      using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: amount must be positive'
      using errcode = 'check_violation';
  end if;

  v_sha := lower(trim(coalesce(p_sha256, '')));
  v_order := public.mp_lock_order_financial(p_order_id);

  select * into v_intent
  from public.mp_upload_intents
  where id = p_upload_intent_id
  for update;
  if not found or v_intent.order_id is distinct from p_order_id then
    raise exception 'UPLOAD_INTENT_INVALID: upload intent/order mismatch'
      using errcode = 'check_violation';
  end if;
  if v_intent.operation_type is distinct from 'bank_transfer_receipt' then
    raise exception 'UPLOAD_INTENT_INVALID: operation_type must be bank_transfer_receipt'
      using errcode = 'check_violation';
  end if;
  if v_intent.expires_at is not null
     and v_intent.expires_at <= timezone('utc', now())
     and v_intent.status <> 'uploaded'
  then
    raise exception 'UPLOAD_INTENT_EXPIRED: intent expired'
      using errcode = 'check_violation';
  end if;
  if v_intent.status = 'attached' then
    raise exception 'UPLOAD_INTENT_USED: intent already attached'
      using errcode = 'check_violation';
  end if;
  if v_intent.status is distinct from 'uploaded' then
    raise exception 'UPLOAD_INTENT_INVALID: upload intent must be in uploaded status'
      using errcode = 'check_violation';
  end if;
  if v_intent.idempotency_key is distinct from p_idempotency_key
     or v_intent.request_hash is distinct from p_request_hash
     or v_intent.actor_scope is distinct from p_actor_scope
  then
    raise exception 'UPLOAD_INTENT_INVALID: upload intent idempotency mismatch'
      using errcode = 'check_violation';
  end if;
  if v_intent.sha256 is null or v_intent.byte_size is null then
    raise exception 'UPLOAD_INTENT_INVALID: upload intent missing uploaded evidence'
      using errcode = 'check_violation';
  end if;
  if v_sha is distinct from lower(trim(v_intent.sha256))
     or p_byte_size is distinct from v_intent.byte_size
  then
    raise exception 'INVALID_FILE_CONTENT: upload evidence mismatch'
      using errcode = 'check_violation';
  end if;

  if v_order.status <> 'pending_payment' then
    update public.mp_idempotency_keys
    set state = 'failed_known',
        last_error_code = 'ORDER_STATUS',
        last_error_message = 'order not pending_payment',
        completed_at = timezone('utc', now()),
        result_payload = jsonb_build_object('ok', false, 'error', 'ORDER_STATUS')
    where idempotency_key = p_idempotency_key
      and operation_type = 'bank_transfer_receipt'
      and actor_scope = p_actor_scope
      and request_hash = p_request_hash;
    update public.mp_upload_intents
    set status = 'cleanup_pending', updated_at = timezone('utc', now())
    where id = p_upload_intent_id and status = 'uploaded';
    insert into public.mp_storage_cleanup_outbox (
      id, storage_path, upload_intent_id, reason, related_order_id, related_idempotency_key
    )
    select public.mp_new_id('mpclo'), storage_path, id, 'failed_known_unattached',
           order_id, idempotency_key
    from public.mp_upload_intents where id = p_upload_intent_id;
    return jsonb_build_object('ok', false, 'error', 'ORDER_STATUS');
  end if;

  select * into v_plan from public.mp_payment_plans where order_id = p_order_id;
  v_net := public.mp_order_net_paid(p_order_id);
  if v_net + p_amount > v_order.grand_total then
    update public.mp_idempotency_keys
    set state = 'failed_known',
        last_error_code = 'OVERPAY',
        last_error_message = 'amount exceeds outstanding',
        completed_at = timezone('utc', now()),
        result_payload = jsonb_build_object('ok', false, 'error', 'OVERPAY')
    where idempotency_key = p_idempotency_key
      and operation_type = 'bank_transfer_receipt'
      and actor_scope = p_actor_scope;
    return jsonb_build_object('ok', false, 'error', 'OVERPAY');
  end if;

  if exists (
    select 1 from public.mp_payments
    where order_id = p_order_id
      and method = 'bank_transfer'
      and status = 'submitted'
  ) then
    raise exception 'PAYMENT_ALREADY_RECORDED: pending bank transfer exists'
      using errcode = 'unique_violation';
  end if;

  v_payment_id := public.mp_new_id('mppay');
  insert into public.mp_payments (
    id, order_id, payment_plan_id, amount, method, status, recorded_by
  ) values (
    v_payment_id, p_order_id, v_plan.id, p_amount, 'bank_transfer', 'submitted', p_actor_scope
  );

  v_media_id := public.mp_new_id('mpmed');
  insert into public.mp_media (
    id, product_id, variant_id, storage_path, role, source_type, rights_status, published
  ) values (
    v_media_id, null, null, v_intent.storage_path, 'receipt', 'user_upload', 'unknown', false
  );

  v_object_id := v_media_id;
  insert into public.mp_receipt_objects (
    id, media_id, storage_path, sha256, byte_size, upload_intent_id
  ) values (
    v_object_id,
    v_media_id,
    v_intent.storage_path,
    lower(trim(v_intent.sha256)),
    v_intent.byte_size,
    p_upload_intent_id
  );

  update public.mp_upload_intents
  set status = 'attached',
      media_id = v_media_id,
      payment_id = v_payment_id,
      attached_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_upload_intent_id
    and status = 'uploaded';

  v_receipt_id := public.mp_new_id('mprct');
  insert into public.mp_receipts (id, media_id, object_id, order_id, payment_id)
  values (v_receipt_id, v_media_id, v_object_id, p_order_id, v_payment_id);

  update public.mp_orders
  set status = 'awaiting_verification', updated_at = timezone('utc', now())
  where id = p_order_id;

  update public.mp_idempotency_keys
  set state = 'completed',
      result_ref = v_payment_id,
      result_payload = jsonb_build_object(
        'ok', true,
        'paymentId', v_payment_id,
        'receiptId', v_receipt_id,
        'status', 'submitted'
      ),
      completed_at = timezone('utc', now())
  where idempotency_key = p_idempotency_key
    and operation_type = 'bank_transfer_receipt'
    and actor_scope = p_actor_scope;

  perform public.mp_write_audit(
    p_actor_scope, 'record_payment', 'mp_payments', v_payment_id, true,
    jsonb_build_object(
      'order_id', p_order_id,
      'amount', p_amount,
      'receipt_id', v_receipt_id,
      'upload_intent_id', p_upload_intent_id,
      'byte_size', v_intent.byte_size
      -- omit sha256 / storage_path / tokens from audit payload surface
    )
  );

  v_event_id := public.mp_enqueue_event(
    'payment.receipt_submitted',
    'mp_payments',
    v_payment_id,
    p_order_id,
    v_payment_id,
    p_actor_scope,
    jsonb_build_object(
      'paymentId', v_payment_id,
      'orderId', p_order_id,
      'amount', p_amount,
      'method', 'bank_transfer'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'paymentId', v_payment_id,
    'receipt_id', v_receipt_id,
    'receiptId', v_receipt_id,
    'media_id', v_media_id,
    'status', 'submitted',
    'eventId', v_event_id
  );
end;
$$;

-- Ownership-bound receipt recording
create or replace function public.mp_record_payment_for_order(
  p_public_ref text,
  p_customer_id text,
  p_guest_token_hash text,
  p_actor_scope text,
  p_upload_intent_id text,
  p_amount numeric,
  p_sha256 text,
  p_byte_size bigint,
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
  v_claim jsonb;
  v_result jsonb;
begin
  -- Ownership first (uniform not-found), then idempotency replay before payable checks.
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

  v_claim := public.mp_idempotency_preflight(
    p_idempotency_key,
    'bank_transfer_receipt',
    p_actor_scope,
    p_request_hash,
    v_order.id
  );
  if v_claim->>'status' = 'COMPLETED_REPLAY' then
    return jsonb_build_object(
      'ok', true,
      'replay', true,
      'paymentId', coalesce(
        v_claim->'result_payload'->>'paymentId',
        v_claim->'result_payload'->>'payment_id'
      ),
      'receiptId', coalesce(
        v_claim->'result_payload'->>'receiptId',
        v_claim->'result_payload'->>'receipt_id'
      ),
      'status', coalesce(v_claim->'result_payload'->>'status', 'submitted')
    );
  end if;
  if v_claim->>'status' = 'FAILED_KNOWN_REPLAY' then
    return jsonb_build_object(
      'ok', false,
      'replay', true,
      'error', coalesce(v_claim->>'last_error_code', 'FAILED_KNOWN')
    );
  end if;
  if v_claim->>'status' = 'REQUEST_HASH_CONFLICT' then
    raise exception 'IDEMPOTENCY_CONFLICT: request hash mismatch'
      using errcode = 'unique_violation';
  end if;
  -- IN_PROGRESS / NEW_REQUEST: continue after payable preflight

  perform public.mp_payment_preflight(
    p_public_ref, p_customer_id, p_guest_token_hash, p_actor_scope
  );

  v_result := public.mp_record_payment(
    p_actor_scope,
    v_order.id,
    p_upload_intent_id,
    p_amount,
    p_sha256,
    p_byte_size,
    p_idempotency_key,
    p_request_hash
  );
  return v_result || jsonb_build_object('replay', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Verify / reject / refund with outbox events
-- -----------------------------------------------------------------------------
create or replace function public.mp_verify_payment(
  p_actor_scope text,
  p_payment_id text,
  p_verified_by text
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
  v_net numeric(14,2);
  v_event_id text;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'ORDER_NOT_AUTHORIZED: verify requires admin/system actor_scope'
      using errcode = 'check_violation';
  end if;

  select order_id into v_order_id
  from public.mp_payments
  where id = p_payment_id;
  if v_order_id is null then
    raise exception 'PAYMENT_NOT_FOUND: payment not found'
      using errcode = 'no_data_found';
  end if;

  v_order := public.mp_lock_order_financial(v_order_id);

  select * into v_payment
  from public.mp_payments
  where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND: payment not found'
      using errcode = 'no_data_found';
  end if;
  if v_payment.status = 'verified' then
    raise exception 'PAYMENT_ALREADY_VERIFIED: payment already verified'
      using errcode = 'check_violation';
  end if;
  if v_payment.status = 'rejected' then
    raise exception 'PAYMENT_ALREADY_REJECTED: payment already rejected'
      using errcode = 'check_violation';
  end if;
  if v_payment.method <> 'bank_transfer' or v_payment.status <> 'submitted' then
    raise exception 'PAYMENT_NOT_PENDING: payment not verifiable'
      using errcode = 'check_violation';
  end if;

  v_net := public.mp_order_net_paid(v_order.id);
  if v_net + v_payment.amount > v_order.grand_total then
    raise exception 'INVALID_AMOUNT: verification would exceed order grand_total'
      using errcode = 'check_violation';
  end if;

  update public.mp_payments
  set status = 'verified',
      verified_by = p_verified_by,
      verified_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_payment_id
    and status = 'submitted';
  if not found then
    raise exception 'PAYMENT_NOT_PENDING: payment not verifiable'
      using errcode = 'check_violation';
  end if;

  update public.mp_orders
  set status = 'confirmed', updated_at = timezone('utc', now())
  where id = v_order.id;

  perform public.mp_write_audit(
    p_actor_scope, 'verify_payment', 'mp_payments', p_payment_id, true,
    jsonb_build_object(
      'order_id', v_order.id,
      'verified_by', p_verified_by,
      'amount', v_payment.amount,
      'net_paid_before', v_net
    )
  );

  v_event_id := public.mp_enqueue_event(
    'payment.verified',
    'mp_payments',
    p_payment_id,
    v_order.id,
    p_payment_id,
    p_actor_scope,
    jsonb_build_object(
      'paymentId', p_payment_id,
      'orderId', v_order.id,
      'amount', v_payment.amount
    )
  );

  return jsonb_build_object(
    'ok', true,
    'paymentId', p_payment_id,
    'orderStatus', 'confirmed',
    'eventId', v_event_id
  );
end;
$$;

create or replace function public.mp_reject_bank_payment(
  p_actor_scope text,
  p_payment_id text,
  p_reason text,
  p_rejected_by text
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
  v_reason text;
  v_event_id text;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'ORDER_NOT_AUTHORIZED: reject requires admin/system actor_scope'
      using errcode = 'check_violation';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'VALIDATION_ERROR: rejection reason must be 3-500 characters'
      using errcode = 'check_violation';
  end if;

  select order_id into v_order_id
  from public.mp_payments
  where id = p_payment_id;
  if v_order_id is null then
    raise exception 'PAYMENT_NOT_FOUND: payment not found'
      using errcode = 'no_data_found';
  end if;

  v_order := public.mp_lock_order_financial(v_order_id);

  select * into v_payment
  from public.mp_payments
  where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND: payment not found'
      using errcode = 'no_data_found';
  end if;
  if v_payment.status = 'rejected' then
    raise exception 'PAYMENT_ALREADY_REJECTED: payment already rejected'
      using errcode = 'check_violation';
  end if;
  if v_payment.status = 'verified' then
    raise exception 'PAYMENT_ALREADY_VERIFIED: cannot reject verified payment'
      using errcode = 'check_violation';
  end if;
  if v_payment.method <> 'bank_transfer' or v_payment.status <> 'submitted' then
    raise exception 'PAYMENT_NOT_PENDING: payment not rejectable'
      using errcode = 'check_violation';
  end if;

  update public.mp_payments
  set status = 'rejected',
      rejection_reason = v_reason,
      verified_by = p_rejected_by,
      updated_at = timezone('utc', now())
  where id = p_payment_id
    and status = 'submitted';
  if not found then
    raise exception 'PAYMENT_NOT_PENDING: payment not rejectable'
      using errcode = 'check_violation';
  end if;

  -- Preserve receipt/history; return order to pending_payment when no verified funds.
  if public.mp_order_net_paid(v_order.id) <= 0 then
    update public.mp_orders
    set status = 'pending_payment', updated_at = timezone('utc', now())
    where id = v_order.id
      and status = 'awaiting_verification';
  end if;

  perform public.mp_write_audit(
    p_actor_scope, 'reject_payment', 'mp_payments', p_payment_id, true,
    jsonb_build_object(
      'order_id', v_order.id,
      'rejected_by', p_rejected_by,
      'reason_len', char_length(v_reason)
    )
  );

  v_event_id := public.mp_enqueue_event(
    'payment.rejected',
    'mp_payments',
    p_payment_id,
    v_order.id,
    p_payment_id,
    p_actor_scope,
    jsonb_build_object(
      'paymentId', p_payment_id,
      'orderId', v_order.id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'paymentId', p_payment_id,
    'status', 'rejected',
    'eventId', v_event_id
  );
end;
$$;

-- Replace WS0 4-arg signature with optional reason (default null) for WS0 compat.
drop function if exists public.mp_refund_payment(text, text, numeric, text);

create or replace function public.mp_refund_payment(
  p_actor_scope text,
  p_original_payment_id text,
  p_amount numeric,
  p_recorded_by text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id text;
  v_original public.mp_payments%rowtype;
  v_order public.mp_orders%rowtype;
  v_refund_id text;
  v_net numeric(14,2);
  v_already numeric(14,2);
  v_reason text;
  v_event_id text;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'ORDER_NOT_AUTHORIZED: refund requires admin/system actor_scope'
      using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: refund amount must be > 0'
      using errcode = 'check_violation';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  -- Reason required when provided by admin HTTP path; null keeps WS0 4-arg compat.
  if p_reason is not null
     and (char_length(v_reason) < 3 or char_length(v_reason) > 500)
  then
    raise exception 'VALIDATION_ERROR: refund reason must be 3-500 characters'
      using errcode = 'check_violation';
  end if;
  if p_reason is null then
    v_reason := null;
  end if;

  select order_id into v_order_id
  from public.mp_payments
  where id = p_original_payment_id;
  if v_order_id is null then
    raise exception 'PAYMENT_NOT_FOUND: original payment not found'
      using errcode = 'no_data_found';
  end if;

  v_order := public.mp_lock_order_financial(v_order_id);

  select * into v_original
  from public.mp_payments
  where id = p_original_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND: original payment not found'
      using errcode = 'no_data_found';
  end if;
  if v_original.status not in ('verified', 'collected') then
    raise exception 'REFUND_NOT_ALLOWED: refund original must be verified or collected'
      using errcode = 'check_violation';
  end if;
  if v_original.reverses_payment_id is not null then
    raise exception 'REFUND_NOT_ALLOWED: cannot refund a refund'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount), 0) into v_already
  from public.mp_payments
  where reverses_payment_id = p_original_payment_id
    and status = 'refunded';
  if p_amount > (v_original.amount - v_already) then
    raise exception 'REFUND_AMOUNT_EXCEEDED: refund exceeds refundable balance'
      using errcode = 'check_violation';
  end if;

  v_net := public.mp_order_net_paid(v_order.id);
  if p_amount > v_net then
    raise exception 'REFUND_AMOUNT_EXCEEDED: refund would drive net paid negative'
      using errcode = 'check_violation';
  end if;

  v_refund_id := public.mp_new_id('mppay');
  insert into public.mp_payments (
    id, order_id, payment_plan_id, amount, method, status,
    reverses_payment_id, recorded_by, rejection_reason
  ) values (
    v_refund_id, v_original.order_id, v_original.payment_plan_id, p_amount,
    v_original.method, 'refunded', p_original_payment_id, p_recorded_by, v_reason
  );

  perform public.mp_write_audit(
    p_actor_scope, 'refund_payment', 'mp_payments', v_refund_id, true,
    jsonb_build_object(
      'original_payment_id', p_original_payment_id,
      'amount', p_amount,
      'order_id', v_original.order_id,
      'net_paid_before', v_net,
      'reason_len', coalesce(char_length(v_reason), 0)
    )
  );

  v_event_id := public.mp_enqueue_event(
    'refund.recorded',
    'mp_payments',
    v_refund_id,
    v_original.order_id,
    v_refund_id,
    p_actor_scope,
    jsonb_build_object(
      'refundPaymentId', v_refund_id,
      'originalPaymentId', p_original_payment_id,
      'orderId', v_original.order_id,
      'amount', p_amount
    )
  );

  return jsonb_build_object(
    'ok', true,
    'refundPaymentId', v_refund_id,
    'refund_payment_id', v_refund_id,
    'eventId', v_event_id
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. List payments (owner / admin)
-- -----------------------------------------------------------------------------
create or replace function public.mp_list_order_payments(
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
  v_payments jsonb;
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

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'paymentId', p.id,
      'amount', p.amount,
      'method', p.method,
      'status', p.status,
      'createdAt', p.created_at,
      'hasReceipt', exists (
        select 1 from public.mp_receipts r where r.payment_id = p.id
      )
    ) order by p.created_at
  ), '[]'::jsonb)
  into v_payments
  from public.mp_payments p
  where p.order_id = v_order.id
    and p.status <> 'refunded';

  return jsonb_build_object(
    'ok', true,
    'publicRef', v_order.public_ref,
    'payments', v_payments
  );
end;
$$;

create or replace function public.mp_admin_list_payments(
  p_actor_scope text,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_payments jsonb;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'ORDER_NOT_AUTHORIZED: admin actor_scope required'
      using errcode = 'check_violation';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
  into v_payments
  from (
    select
      p.id as "paymentId",
      o.public_ref as "publicRef",
      p.amount,
      p.method,
      p.status,
      p.created_at as "createdAt",
      p.verified_at as "verifiedAt",
      exists (select 1 from public.mp_receipts r where r.payment_id = p.id) as "hasReceipt"
    from public.mp_payments p
    join public.mp_orders o on o.id = p.order_id
    where (p_status is null or p.status = p_status)
      and p.method = 'bank_transfer'
    order by p.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object('ok', true, 'payments', v_payments);
end;
$$;

-- Idempotent admin mutation helper
create or replace function public.mp_admin_payment_action(
  p_actor_scope text,
  p_payment_id text,
  p_action text,
  p_actor_id text,
  p_reason text,
  p_amount numeric,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op text;
  v_claim jsonb;
  v_result jsonb;
begin
  if p_actor_scope not like 'admin:%' then
    raise exception 'ORDER_NOT_AUTHORIZED: admin actor_scope required'
      using errcode = 'check_violation';
  end if;
  if p_action not in ('verify', 'reject', 'refund') then
    raise exception 'VALIDATION_ERROR: unsupported admin action'
      using errcode = 'check_violation';
  end if;

  v_op := 'admin_payment_' || p_action;
  v_claim := public.mp_idempotency_preflight(
    p_idempotency_key, v_op, p_actor_scope, p_request_hash, p_payment_id
  );
  if v_claim->>'status' = 'COMPLETED_REPLAY' then
    return (v_claim->'result_payload') || jsonb_build_object('replay', true);
  end if;
  if v_claim->>'status' = 'FAILED_KNOWN_REPLAY' then
    return jsonb_build_object(
      'ok', false,
      'replay', true,
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

  if p_action = 'verify' then
    v_result := public.mp_verify_payment(p_actor_scope, p_payment_id, p_actor_id);
  elsif p_action = 'reject' then
    v_result := public.mp_reject_bank_payment(p_actor_scope, p_payment_id, p_reason, p_actor_id);
  else
    v_result := public.mp_refund_payment(
      p_actor_scope, p_payment_id, p_amount, p_actor_id, p_reason
    );
  end if;

  update public.mp_idempotency_keys
  set state = 'completed',
      result_ref = coalesce(v_result->>'paymentId', v_result->>'refundPaymentId', p_payment_id),
      result_payload = v_result,
      completed_at = timezone('utc', now())
  where idempotency_key = p_idempotency_key
    and operation_type = v_op
    and actor_scope = p_actor_scope;

  return v_result || jsonb_build_object('replay', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. RLS + grants
-- -----------------------------------------------------------------------------
do $$
begin
  alter table public.mp_event_outbox enable row level security;
  alter table public.mp_event_outbox force row level security;
  revoke all on table public.mp_event_outbox from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.mp_event_outbox from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.mp_event_outbox from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.mp_event_outbox to service_role;
  end if;
end $$;

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
        'mp_payment_preflight',
        'mp_get_upload_intent_path',
        'mp_quarantine_unattached_upload',
        'mp_create_upload_intent',
        'mp_create_upload_intent_for_order',
        'mp_mark_upload_intent_uploaded',
        'mp_record_payment',
        'mp_record_payment_for_order',
        'mp_verify_payment',
        'mp_reject_bank_payment',
        'mp_refund_payment',
        'mp_list_order_payments',
        'mp_admin_list_payments',
        'mp_admin_payment_action'
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
