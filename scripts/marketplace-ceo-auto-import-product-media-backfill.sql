-- =============================================================================
-- Marketplace CEO auto-import — product media BACKFILL (PREPARED, DO NOT APPLY)
-- =============================================================================
-- CTO-approved manual apply only. Do not run from CI or agent automation.
--
-- Preconditions:
--   1. scripts/marketplace-ceo-auto-import-product-media.sql already applied
--   2. Prefer next CEO supplier sync (imports images via commit_batch) over this
--      backfill when a sync window is available.
--
-- This script does NOT call Shopify. It is a no-op template that documents the
-- preferred backfill path:
--
-- Option A (recommended): re-run CEO auto-import sync after media SQL is live.
--   Images flow: Shopify images[].src → normalize → plan → commit_batch →
--   mp_ceo_auto_import_sync_product_media → mp_media → catalogue DTO.
--
-- Option B (offline match): load a JSON staging table of {identity_key, images[]}
--   produced by a read-only Shopify fetch tool, then call
--   mp_ceo_auto_import_sync_product_media for each product_id resolved via
--   mp_products / auto-import identity maps. Do not invent URLs.
--
-- Verification after apply + sync (read-only):
--   select count(*) filter from public.mp_products where active = true;
--   select count(distinct product_id) with_media
--     from public.mp_media
--    where published = true and source_type = 'supplier' and role <> 'receipt';
-- =============================================================================

do $$
begin
  raise notice 'BACKFILL TEMPLATE ONLY — no rows mutated. Prefer next CEO sync after product-media.sql.';
end $$;
