-- =============================================================================
-- Marketplace WS-MAP-0 — legacy supplier-mapping RPC fail-closed guard
--
-- MANUAL APPLICATION ONLY
-- DO NOT AUTO-APPLY
--
-- No hosted SQL was applied during WS-MAP-0 implementation.
-- This artifact is for reviewed local / disposable database application only.
-- Do not apply to Supabase production or any hosted environment from this task.
--
-- Prerequisites: Marketplace WS0–WS3 (function may already exist from WS3).
--
-- Behavior:
--   - Preserves RPC name and signature for compatibility.
--   - Replaces implementation with deterministic fail-closed denial.
--   - NEVER inserts, updates, or activates public.mp_supplier_products.
--   - Preserves all existing mapping rows (no data migration).
--   - Changes no publication flags / website_price / mp_publish_price.
--   - Creates no controlled-mapping tables.
--   - Safe to reapply locally (idempotent create or replace + revoke).
--   - Revokes EXECUTE from public, anon, authenticated, and service_role.
--
-- Callable behavior when executed by a role that still holds EXECUTE
-- (e.g. database owner / superuser in local tests):
--   raises sanitized LEGACY_MAPPING_DISABLED.
-- Application service_role cannot execute after revoke (strictest fail-closed).
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
begin
  -- Parameters retained only for signature compatibility; body never mutates data.
  raise exception 'LEGACY_MAPPING_DISABLED: Legacy supplier mapping is disabled.'
    using errcode = 'check_violation';
end;
$$;

revoke all on function public.mp_admin_upsert_supplier_mapping(
  text, text, text, text, text, text, text, text, text, boolean, boolean, text
) from public;

do $ws_map_0_revoke$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute $sql$
      revoke all on function public.mp_admin_upsert_supplier_mapping(
        text, text, text, text, text, text, text, text, text, boolean, boolean, text
      ) from anon
    $sql$;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute $sql$
      revoke all on function public.mp_admin_upsert_supplier_mapping(
        text, text, text, text, text, text, text, text, text, boolean, boolean, text
      ) from authenticated
    $sql$;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute $sql$
      revoke all on function public.mp_admin_upsert_supplier_mapping(
        text, text, text, text, text, text, text, text, text, boolean, boolean, text
      ) from service_role
    $sql$;
  end if;
end
$ws_map_0_revoke$;

-- Explicitly do not grant EXECUTE to service_role (or any application role).

notify pgrst, 'reload schema';
