-- =============================================================================
-- Marketplace WS4 — supplier ingestion / job control / alerts (additive)
-- Contract: Sunchaser Marketplace Architecture Contract Revision 5.1
--
-- Do NOT auto-apply
--
-- Manual apply only on disposable / target DBs after WS0–WS3.
-- Live supplier adapters remain disabled by default in application code.
-- Manual-only operation is insufficient for production release.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Evidence-gap blockers (locked mappings; do not unlock without verified evidence)
--    Variants must already exist (WS1 catalogue seed). Skips if product/variant absent.
-- -----------------------------------------------------------------------------
do $ws4_blockers$
declare
  v_kamal text := 'mpsup_kamal';
  v_alladin text := 'mpsup_alladin';
  r record;
begin
  for r in
    select * from (values
      ('mpprod_ws1_inverex_nitrox_10kw_hybrid', 'mpvar_ws1_inverex_nitrox_10kw_hybrid',
       'NITROX_BLOCKED', 'inverex-nitrox-10kw-hybrid', 'Nitrox evidence blocker'),
      ('mpprod_ws1_pylontech_us5000_4_8kwh', 'mpvar_ws1_pylontech_us5000_4_8kwh',
       'PYLONTECH_US5000_BLOCKED', 'pylontech-us5000', 'Pylontech US5000 evidence blocker'),
      ('mpprod_ws1_inverex_lv2_6_lithium', 'mpvar_ws1_inverex_lv2_6_lithium',
       'INVEREX_LV2_6_BLOCKED', 'inverex-lv2-6', 'Inverex LV2.6 evidence blocker'),
      ('mpprod_ws1_fronus_meta_10kw_ongrid', 'mpvar_ws1_fronus_meta_10kw_ongrid',
       'FRONUS_META_BLOCKED', 'fronus-meta-10kw', 'Fronus Meta evidence blocker')
    ) as t(product_id, variant_id, supplier_product_id, model, note)
  loop
    if exists (
      select 1 from public.mp_product_variants v
      where v.id = r.variant_id and v.product_id = r.product_id
    ) then
      insert into public.mp_supplier_products (
        id, supplier_id, product_id, variant_id,
        supplier_product_id, supplier_variant_id, supplier_sku,
        normalized_exact_model, match_evidence, match_confidence,
        match_locked, active
      ) values (
        public.mp_new_id('mpsp'), v_kamal, r.product_id, r.variant_id,
        r.supplier_product_id, null, r.supplier_product_id,
        r.model,
        jsonb_build_object(
          'blocker', true,
          'reason', 'verified_supplier_evidence_required',
          'note', r.note,
          'unlockRequires', 'verified_identity_evidence'
        ),
        'uncertain',
        true,
        true
      )
      on conflict (supplier_id, variant_id) do update
        set match_locked = true,
            match_confidence = case
              when public.mp_supplier_products.match_confidence = 'exact'
                   and public.mp_supplier_products.match_locked = false
              then public.mp_supplier_products.match_confidence
              else 'uncertain'
            end,
            match_evidence = coalesce(public.mp_supplier_products.match_evidence, '{}'::jsonb)
              || jsonb_build_object(
                'blocker', true,
                'reason', 'verified_supplier_evidence_required',
                'note', r.note
              ),
            updated_at = timezone('utc', now())
      where public.mp_supplier_products.match_locked = false
         or public.mp_supplier_products.match_evidence->>'blocker' is distinct from 'true';

      -- Force-lock even if a prior unlocked exact mapping existed (evidence gap).
      update public.mp_supplier_products sp
      set match_locked = true,
          match_confidence = case
            when sp.match_confidence = 'exact' then 'exact'
            else 'uncertain'
          end,
          match_evidence = coalesce(sp.match_evidence, '{}'::jsonb)
            || jsonb_build_object(
              'blocker', true,
              'reason', 'verified_supplier_evidence_required',
              'note', r.note,
              'unlockRequires', 'verified_identity_evidence'
            ),
          updated_at = timezone('utc', now())
      where sp.supplier_id = v_kamal
        and sp.variant_id = r.variant_id;

      insert into public.mp_supplier_products (
        id, supplier_id, product_id, variant_id,
        supplier_product_id, supplier_variant_id, supplier_sku,
        normalized_exact_model, match_evidence, match_confidence,
        match_locked, active
      ) values (
        public.mp_new_id('mpsp'), v_alladin, r.product_id, r.variant_id,
        r.supplier_product_id || '_ALLADIN', null, r.supplier_product_id,
        r.model,
        jsonb_build_object(
          'blocker', true,
          'reason', 'verified_supplier_evidence_required',
          'note', r.note,
          'unlockRequires', 'verified_identity_evidence'
        ),
        'uncertain',
        true,
        true
      )
      on conflict (supplier_id, variant_id) do update
        set match_locked = true,
            match_evidence = coalesce(public.mp_supplier_products.match_evidence, '{}'::jsonb)
              || jsonb_build_object(
                'blocker', true,
                'reason', 'verified_supplier_evidence_required',
                'note', r.note
              ),
            updated_at = timezone('utc', now());

      update public.mp_supplier_products sp
      set match_locked = true,
          match_evidence = coalesce(sp.match_evidence, '{}'::jsonb)
            || jsonb_build_object(
              'blocker', true,
              'reason', 'verified_supplier_evidence_required',
              'note', r.note,
              'unlockRequires', 'verified_identity_evidence'
            ),
          updated_at = timezone('utc', now())
      where sp.supplier_id = v_alladin
        and sp.variant_id = r.variant_id;
    end if;
  end loop;
end;
$ws4_blockers$;

-- -----------------------------------------------------------------------------
-- 2. Job lifecycle (overlap-safe via unique partial index on running jobs)
-- -----------------------------------------------------------------------------
create or replace function public.mp_ws4_job_start(
  p_actor_scope text,
  p_job_name text,
  p_trigger text,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'VALIDATION_ERROR: job start requires admin or system scope'
      using errcode = 'check_violation';
  end if;
  if p_job_name is null or length(trim(p_job_name)) = 0 then
    raise exception 'VALIDATION_ERROR: job_name required'
      using errcode = 'check_violation';
  end if;
  if p_trigger not in ('manual', 'scheduled') then
    raise exception 'VALIDATION_ERROR: trigger must be manual or scheduled'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.mp_job_runs
    where job_name = p_job_name and status = 'running'
  ) then
    raise exception 'CONFLICT: overlapping job already running'
      using errcode = 'unique_violation';
  end if;

  v_id := public.mp_new_id('mpjob');
  begin
    insert into public.mp_job_runs (id, job_name, status, started_at, meta)
    values (
      v_id,
      p_job_name,
      'running',
      timezone('utc', now()),
      coalesce(p_meta, '{}'::jsonb) || jsonb_build_object(
        'trigger', p_trigger,
        'actorScope', p_actor_scope,
        'manualOnlyInsufficientForProduction', true
      )
    );
  exception
    when unique_violation then
      raise exception 'CONFLICT: overlapping job already running'
        using errcode = 'unique_violation';
  end;

  perform public.mp_write_audit(
    p_actor_scope, 'job.started', 'mp_job_runs', v_id, false,
    jsonb_build_object(
      'jobName', p_job_name,
      'trigger', p_trigger,
      'changedFields', jsonb_build_array('status')
    )
  );

  return jsonb_build_object('ok', true, 'runId', v_id, 'jobName', p_job_name, 'status', 'running');
end;
$$;

create or replace function public.mp_ws4_job_finish(
  p_actor_scope text,
  p_run_id text,
  p_status text,
  p_error text default null,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.mp_job_runs%rowtype;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'VALIDATION_ERROR: job finish requires admin or system scope'
      using errcode = 'check_violation';
  end if;
  if p_status not in ('succeeded', 'failed') then
    raise exception 'VALIDATION_ERROR: terminal status must be succeeded or failed'
      using errcode = 'check_violation';
  end if;

  select * into v_row from public.mp_job_runs where id = p_run_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND: run not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'running' then
    -- Idempotent finish for restart-safe callers.
    return jsonb_build_object(
      'ok', true, 'runId', p_run_id, 'status', v_row.status, 'replay', true
    );
  end if;

  update public.mp_job_runs
  set status = p_status,
      finished_at = timezone('utc', now()),
      error = p_error,
      meta = coalesce(meta, '{}'::jsonb) || coalesce(p_meta, '{}'::jsonb)
  where id = p_run_id;

  perform public.mp_write_audit(
    p_actor_scope, 'job.finished', 'mp_job_runs', p_run_id, false,
    jsonb_build_object(
      'status', p_status,
      'changedFields', jsonb_build_array('status', 'finished_at')
    )
  );

  return jsonb_build_object('ok', true, 'runId', p_run_id, 'status', p_status, 'replay', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Append-only observation insert
-- -----------------------------------------------------------------------------
create or replace function public.mp_ws4_insert_observation(
  p_actor_scope text,
  p_supplier_product_id text,
  p_run_id text,
  p_observed_at timestamptz,
  p_supplier_public_price numeric,
  p_currency text,
  p_availability text,
  p_parse_status text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_map public.mp_supplier_products%rowtype;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'VALIDATION_ERROR: observation insert requires admin or system scope'
      using errcode = 'check_violation';
  end if;

  select * into v_map from public.mp_supplier_products where id = p_supplier_product_id;
  if not found then
    raise exception 'MAPPING_NOT_FOUND: supplier product mapping not found'
      using errcode = 'no_data_found';
  end if;

  if p_availability not in ('in_stock', 'sold_out', 'backorder', 'unknown') then
    raise exception 'VALIDATION_ERROR: invalid availability' using errcode = 'check_violation';
  end if;
  if p_parse_status not in ('ok', 'malformed', 'missing') then
    raise exception 'VALIDATION_ERROR: invalid parse_status' using errcode = 'check_violation';
  end if;
  if p_currency is null or length(trim(p_currency)) = 0 then
    raise exception 'VALIDATION_ERROR: currency required' using errcode = 'check_violation';
  end if;

  v_id := public.mp_new_id('mpobs');
  insert into public.mp_supplier_observations (
    id, supplier_product_id, run_id, observed_at,
    supplier_public_price, currency, availability, parse_status, raw_payload
  ) values (
    v_id,
    p_supplier_product_id,
    p_run_id,
    coalesce(p_observed_at, timezone('utc', now())),
    p_supplier_public_price,
    upper(trim(p_currency)),
    p_availability,
    p_parse_status,
    jsonb_build_object(
      'evidence', coalesce(p_evidence, '{}'::jsonb),
      'mappingId', p_supplier_product_id,
      'variantId', v_map.variant_id,
      'productId', v_map.product_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'observationId', v_id,
    'mappingId', p_supplier_product_id,
    'variantId', v_map.variant_id,
    'productId', v_map.product_id
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Alerts
-- -----------------------------------------------------------------------------
create or replace function public.mp_ws4_create_alert(
  p_actor_scope text,
  p_run_id text,
  p_product_id text,
  p_variant_id text,
  p_alert_type text,
  p_severity text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'VALIDATION_ERROR: alert create requires admin or system scope'
      using errcode = 'check_violation';
  end if;
  if p_alert_type not in (
    'stale', 'malformed', 'conflict', 'safety_breach', 'no_safe_price',
    'soldout', 'backorder', 'unknown_stock', 'supplier_evidence_gap'
  ) then
    raise exception 'VALIDATION_ERROR: invalid alert_type' using errcode = 'check_violation';
  end if;
  if p_severity not in ('info', 'warning', 'critical') then
    raise exception 'VALIDATION_ERROR: invalid severity' using errcode = 'check_violation';
  end if;

  v_id := public.mp_new_id('mpalt');
  insert into public.mp_price_alerts (
    id, run_id, product_id, variant_id, alert_type, severity, message, resolved
  ) values (
    v_id, p_run_id, p_product_id, p_variant_id, p_alert_type, p_severity,
    left(coalesce(p_message, p_alert_type), 500), false
  );

  return jsonb_build_object('ok', true, 'alertId', v_id, 'alertType', p_alert_type);
end;
$$;

create or replace function public.mp_ws4_list_alerts(
  p_actor_scope text,
  p_resolved boolean default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'VALIDATION_ERROR: alert list requires admin or system scope'
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt" desc), '[]'::jsonb)
    into v_rows
  from (
    select
      a.id,
      a.run_id as "runId",
      a.product_id as "productId",
      a.variant_id as "variantId",
      a.alert_type as "alertType",
      a.severity,
      a.message,
      a.resolved,
      a.created_at as "createdAt"
    from public.mp_price_alerts a
    where (p_resolved is null or a.resolved = p_resolved)
    order by a.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) x;

  return jsonb_build_object('ok', true, 'alerts', v_rows);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Harden mp_publish_price: exclude safety-breaching supplier candidates
--    (still the sole website_price writer; precedence unchanged)
-- -----------------------------------------------------------------------------
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
  v_cand_price numeric(14,2);
  v_cand_source text;
  v_pct numeric;
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

  update public.mp_price_overrides
  set status = 'expired'
  where variant_id = p_variant_id
    and status = 'active'
    and mode = 'time_limited'
    and ends_at is not null
    and ends_at <= timezone('utc', now());

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
    -- Kamal (priority 1) then Alladin (priority 2); skip safety-breaching candidates
    for v_cand_price, v_cand_source in
      select o.supplier_public_price, s.code
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
    loop
      if v_variant.website_price is not null and v_variant.website_price > 0 then
        v_pct := ((v_cand_price - v_variant.website_price) / v_variant.website_price) * 100;
        if v_pct > v_cfg.max_increase_pct or v_pct < -v_cfg.max_decrease_pct then
          continue; -- safety_breach: skip this candidate
        end if;
      end if;
      v_new_price := v_cand_price;
      v_source := v_cand_source;
      v_state := 'priced_auto';
      exit;
    end loop;

    if v_state <> 'priced_auto' then
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

-- -----------------------------------------------------------------------------
-- 5b. List active mappings for ingestion
-- -----------------------------------------------------------------------------
create or replace function public.mp_ws4_list_mappings(
  p_actor_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_actor_scope not like 'admin:%' and p_actor_scope not like 'system:%' then
    raise exception 'VALIDATION_ERROR: mapping list requires admin or system scope'
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x."supplierCode", x."variantId"), '[]'::jsonb)
    into v_rows
  from (
    select
      sp.id,
      sp.supplier_id as "supplierId",
      s.code as "supplierCode",
      sp.product_id as "productId",
      sp.variant_id as "variantId",
      sp.supplier_product_id as "supplierProductId",
      sp.supplier_variant_id as "supplierVariantId",
      sp.supplier_sku as "supplierSku",
      sp.normalized_exact_model as "normalizedExactModel",
      sp.match_confidence as "matchConfidence",
      sp.match_locked as "matchLocked",
      sp.active,
      sp.supplier_url as "supplierUrl",
      sp.match_evidence as "matchEvidence"
    from public.mp_supplier_products sp
    join public.mp_suppliers s on s.id = sp.supplier_id
    where sp.active and s.active
  ) x;

  return jsonb_build_object('ok', true, 'mappings', v_rows);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Evidence-blocker trigger — cannot unlock without verifiedEvidence=true
-- -----------------------------------------------------------------------------
create or replace function public.mp_ws4_supplier_products_blocker_trg_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if coalesce(old.match_evidence->>'blocker', '') = 'true'
       and old.match_locked = true
       and new.match_locked = false
       and coalesce(new.match_evidence->>'verifiedEvidence', '') <> 'true' then
      raise exception 'EVIDENCE_BLOCKER: mapping remains locked until verified evidence is supplied'
        using errcode = 'check_violation';
    end if;
    -- Preserve blocker marker unless explicitly verified.
    if coalesce(old.match_evidence->>'blocker', '') = 'true'
       and coalesce(new.match_evidence->>'verifiedEvidence', '') <> 'true' then
      new.match_evidence := coalesce(new.match_evidence, '{}'::jsonb)
        || jsonb_build_object(
          'blocker', true,
          'reason', coalesce(old.match_evidence->>'reason', 'verified_supplier_evidence_required')
        );
      new.match_locked := true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists mp_ws4_supplier_products_blocker_trg on public.mp_supplier_products;
create trigger mp_ws4_supplier_products_blocker_trg
  before update on public.mp_supplier_products
  for each row
  execute function public.mp_ws4_supplier_products_blocker_trg_fn();

-- -----------------------------------------------------------------------------
-- 7. Grants — service_role only
-- -----------------------------------------------------------------------------
do $ws4_grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'mp_ws4_job_start',
        'mp_ws4_job_finish',
        'mp_ws4_insert_observation',
        'mp_ws4_create_alert',
        'mp_ws4_list_alerts',
        'mp_ws4_list_mappings',
        'mp_ws4_supplier_products_blocker_trg_fn',
        'mp_publish_price'
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
end;
$ws4_grants$;
