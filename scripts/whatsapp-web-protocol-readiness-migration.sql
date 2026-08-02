-- WhatsApp Web protocol readiness diagnostics (additive Phase 1 columns)
-- MANUAL APPLY ONLY. Do NOT apply in automation.
--
-- Purpose: Add generation-scoped protocol readiness fields to the owner
-- diagnostics table for Phase 1 false-open observability. These columns
-- are nullable and have safe defaults — existing rows are unaffected.
--
-- Deployment order:
--   1. scripts/whatsapp-web-session-lease-migration.sql (if not applied)
--   2. scripts/whatsapp-web-owner-diagnostics-migration.sql (if not applied)
--   3. THIS script (after owner diagnostics table exists)
--   4. Deploy application code that writes/reads these columns
--
-- Rollback (data loss for new columns only):
--   ALTER TABLE public.whatsapp_web_owner_diagnostics
--     DROP COLUMN IF EXISTS connection_open_at,
--     DROP COLUMN IF EXISTS received_pending_notifications,
--     DROP COLUMN IF EXISTS pending_notifications_received_at,
--     DROP COLUMN IF EXISTS is_online,
--     DROP COLUMN IF EXISTS is_new_login,
--     DROP COLUMN IF EXISTS phone_connected,
--     DROP COLUMN IF EXISTS last_protocol_event_at,
--     DROP COLUMN IF EXISTS protocol_event_counts;
--
-- Idempotent: uses IF NOT EXISTS / DO $$ patterns.
-- Does NOT modify previously applied migration files.

ALTER TABLE public.whatsapp_web_owner_diagnostics
  ADD COLUMN IF NOT EXISTS connection_open_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS received_pending_notifications boolean NULL,
  ADD COLUMN IF NOT EXISTS pending_notifications_received_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS is_online boolean NULL,
  ADD COLUMN IF NOT EXISTS is_new_login boolean NULL,
  ADD COLUMN IF NOT EXISTS phone_connected boolean NULL,
  ADD COLUMN IF NOT EXISTS last_protocol_event_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS protocol_event_counts jsonb NULL;

-- Update inbound_health check constraint to allow new health states.
-- Drop and recreate the constraint atomically.
DO $$
BEGIN
  ALTER TABLE public.whatsapp_web_owner_diagnostics
    DROP CONSTRAINT IF EXISTS whatsapp_web_owner_diagnostics_inbound_health_check;

  ALTER TABLE public.whatsapp_web_owner_diagnostics
    ADD CONSTRAINT whatsapp_web_owner_diagnostics_inbound_health_check
    CHECK (
      inbound_health IN (
        'CONNECTED_SOCKET',
        'LISTENER_READY',
        'AWAITING_PROTOCOL_SYNC',
        'PROTOCOL_ACTIVE_INBOUND_UNCONFIRMED',
        'LIVE_INBOUND_CONFIRMED',
        'INBOUND_SILENT',
        'LEASE_NOT_OWNED'
      )
    );
END $$;

COMMENT ON COLUMN public.whatsapp_web_owner_diagnostics.connection_open_at IS
  'ISO timestamp when Baileys emitted connection: open for the current generation.';
COMMENT ON COLUMN public.whatsapp_web_owner_diagnostics.received_pending_notifications IS
  'Last observed receivedPendingNotifications from Baileys connection.update.';
COMMENT ON COLUMN public.whatsapp_web_owner_diagnostics.pending_notifications_received_at IS
  'First timestamp when receivedPendingNotifications became true for this generation.';
COMMENT ON COLUMN public.whatsapp_web_owner_diagnostics.is_online IS
  'Last observed isOnline from Baileys connection.update.';
COMMENT ON COLUMN public.whatsapp_web_owner_diagnostics.is_new_login IS
  'Last observed isNewLogin from Baileys connection.update.';
COMMENT ON COLUMN public.whatsapp_web_owner_diagnostics.phone_connected IS
  'Last observed legacy.phoneConnected from Baileys connection.update.';
COMMENT ON COLUMN public.whatsapp_web_owner_diagnostics.last_protocol_event_at IS
  'Timestamp of last Baileys protocol event from the current socket generation.';
COMMENT ON COLUMN public.whatsapp_web_owner_diagnostics.protocol_event_counts IS
  'JSONB map of allowlisted Baileys event name → count for current generation. No PII.';
