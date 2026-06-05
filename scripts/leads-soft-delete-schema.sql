-- Soft delete columns for leads (run in Supabase SQL Editor)
-- Idempotent / safe to rerun

ALTER TABLE IF EXISTS public.leads
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text;

CREATE INDEX IF NOT EXISTS leads_deleted_at_idx ON public.leads (deleted_at);

-- Active-lead lookups (deleted_at IS NULL)
CREATE INDEX IF NOT EXISTS leads_active_created_at_idx
  ON public.leads (created_at DESC)
  WHERE deleted_at IS NULL;

-- No UNIQUE on email/phone in base schema (supabase-schema.sql).
-- Partial unique indexes only needed if you add uniqueness later, e.g.:
-- CREATE UNIQUE INDEX IF NOT EXISTS leads_email_active_uidx
--   ON public.leads (lower(email)) WHERE deleted_at IS NULL;
