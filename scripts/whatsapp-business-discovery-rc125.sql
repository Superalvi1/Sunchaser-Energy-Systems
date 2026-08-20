-- Migration: Add Meta business portfolio discovery fields to whatsapp_connections
-- Corresponds to RC-125: business_management App Review readiness
-- All columns nullable for backward-compatibility with existing rows.

ALTER TABLE whatsapp_connections
  ADD COLUMN IF NOT EXISTS business_portfolio_id     TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS business_portfolio_name   TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS business_discovery_status TEXT    DEFAULT NULL
    CHECK (
      business_discovery_status IS NULL OR
      business_discovery_status IN ('success', 'failed', 'unresolved')
    );

COMMENT ON COLUMN whatsapp_connections.business_portfolio_id IS
  'Meta Business Portfolio ID from GET /me/businesses — unmasked, encrypted at rest via application layer; never expose raw in API responses.';
COMMENT ON COLUMN whatsapp_connections.business_portfolio_name IS
  'Display name of the Meta Business Portfolio authorized during Embedded Signup.';
COMMENT ON COLUMN whatsapp_connections.business_discovery_status IS
  'Result of server-side business_management discovery: success | failed | unresolved. NULL = not yet attempted.';
