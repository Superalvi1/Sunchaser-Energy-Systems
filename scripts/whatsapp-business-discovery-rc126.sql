-- WhatsApp Business Discovery RC-126
-- Apply in Supabase SQL Editor after RC-125. Do NOT auto-apply.
--
-- Adds sanitized discovery reason, explicit association status, and WABA name.

ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS business_discovery_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS business_association_status TEXT DEFAULT NULL
    CHECK (
      business_association_status IS NULL OR
      business_association_status IN (
        'confirmed', 'unresolved', 'mismatch', 'not_available'
      )
    ),
  ADD COLUMN IF NOT EXISTS waba_name TEXT DEFAULT NULL;
