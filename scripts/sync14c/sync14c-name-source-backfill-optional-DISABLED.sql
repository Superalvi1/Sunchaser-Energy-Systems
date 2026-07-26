-- =============================================================================
-- SYNC-14C-A — OPTIONAL legacy name_source backfill (DISABLED / REVIEW ONLY)
-- =============================================================================
-- STATUS: DISABLED. Do NOT enable. Do NOT apply to production in SYNC-14C-A.
--
-- Intent (future, separately approved):
--   For rows with nonempty profile_name and name_source IS NULL, set
--   name_source = 'whatsapp_legacy' so DB provenance matches app ranking.
--
-- Why separate / disabled:
--   - SYNC-14B application already treats nonempty+null as effective
--     whatsapp_legacy without requiring stored provenance.
--   - Backfill is a data rewrite, not required for constraint expansion.
--   - Must only run AFTER forward migration allows whatsapp_legacy.
--   - Needs its own approval, batching plan, and verification.
--
-- This file intentionally contains no executable DML. The sample UPDATE below
-- is commented out permanently for this release pack.
-- =============================================================================

-- PRECONDITIONS (if ever approved later):
--   1. sync14c-name-source-forward-migration.sql applied and post-verify PASS
--   2. Explicit human approval for data rewrite
--   3. PITR / backup confirmed
--   4. Batching strategy for large tables (not defined here)

-- SAMPLE ONLY — DO NOT UNCOMMENT FOR SYNC-14C-A:
--
-- begin;
-- update public.whatsapp_contacts
-- set
--   name_source = 'whatsapp_legacy',
--   updated_at = timezone('utc', now())
-- where name_source is null
--   and nullif(btrim(profile_name), '') is not null
--   and id in (
--     select id
--     from public.whatsapp_contacts
--     where name_source is null
--       and nullif(btrim(profile_name), '') is not null
--     order by updated_at nulls last
--     limit 500
--   );
-- -- review row count, then commit or rollback;
-- rollback;

select
  'DISABLED' as backfill_status,
  'sync14c-name-source-backfill-optional-DISABLED.sql' as script,
  'Do not apply. Optional legacy provenance rewrite is out of scope for SYNC-14C-A.'
    as message;
