-- Migration: Claude WhatsApp (Baileys) session store + kill switch
-- Date: 2026-07-24
-- Branch: feature/claude-whatsapp-web
-- Target Tables: public.claude_whatsapp_sessions, public.settings
--
-- APPLICATION INSTRUCTIONS:
-- Execute this migration script on the target Supabase Postgres database.
-- Example: psql -h <db_host> -U postgres -d postgres -f scripts/claude-whatsapp-web-migration.sql
-- Or run via Supabase SQL Editor in the Dashboard.
--
-- PURPOSE:
-- Ephemeral Render disks cannot hold a Baileys WhatsApp Web session across
-- restarts. Persist AuthenticationState (creds + Signal keys) in Supabase for
-- the time-boxed live test. Also seed a DB-backed kill switch so staff can
-- abort the test without a redeploy.
--
-- ROLLBACK INSTRUCTIONS (IF NEEDED):
-- DROP TABLE IF EXISTS public.claude_whatsapp_sessions;
-- DELETE FROM public.settings WHERE key = 'claude_whatsapp_enabled';

BEGIN;

-- 1. Baileys auth state (creds + keys) — survives Render restarts
CREATE TABLE IF NOT EXISTS public.claude_whatsapp_sessions (
  id text PRIMARY KEY,
  creds jsonb NOT NULL DEFAULT '{}'::jsonb,
  keys jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.claude_whatsapp_sessions IS
  'Claude WhatsApp (Baileys) AuthenticationState. Render disk is ephemeral; session must survive restarts for the live test.';

ALTER TABLE public.claude_whatsapp_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claude_whatsapp_sessions_service_role" ON public.claude_whatsapp_sessions;
CREATE POLICY "claude_whatsapp_sessions_service_role"
  ON public.claude_whatsapp_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. Fast kill switch — boolean settings row (NOT env-var-backed)
-- value is a JSON boolean: true | false
INSERT INTO public.settings (key, value)
VALUES ('claude_whatsapp_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
