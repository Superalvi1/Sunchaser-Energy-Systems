-- Migration: Sunchaser Connect Phase 1A + Phase 2A Schema Extension
-- Date: 2026-07-23
-- Target Tables: public.whatsapp_messages, public.whatsapp_conversations
--
-- APPLICATION INSTRUCTIONS:
-- Execute this migration script on the target Supabase Postgres database.
-- Example: psql -h <db_host> -U postgres -d postgres -f scripts/whatsapp-connect-phase1a-2a-migration.sql
-- Or run via Supabase SQL Editor in the Dashboard.
--
-- ROLLBACK INSTRUCTIONS (IF NEEDED):
-- ALTER TABLE public.whatsapp_conversations DROP COLUMN IF EXISTS ai_ownership_state;
-- ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS message_type, DROP COLUMN IF EXISTS meta_media_id, DROP COLUMN IF EXISTS mime_type, DROP COLUMN IF EXISTS caption, DROP COLUMN IF EXISTS filename, DROP COLUMN IF EXISTS sha256, DROP COLUMN IF EXISTS voice, DROP COLUMN IF EXISTS latitude, DROP COLUMN IF EXISTS longitude, DROP COLUMN IF EXISTS address, DROP COLUMN IF EXISTS place_name, DROP COLUMN IF EXISTS raw_metadata;

BEGIN;

-- 1. Add AI Ownership State to whatsapp_conversations (Default: AI_SHADOW)
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS ai_ownership_state text NOT NULL DEFAULT 'AI_SHADOW';

ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_ai_ownership_state_check;

ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_ai_ownership_state_check
  CHECK (ai_ownership_state IN ('AI_SHADOW', 'AI_ACTIVE', 'HUMAN_HANDLING', 'AI_PAUSED'));

-- 2. Add Media & Location Metadata Columns to whatsapp_messages
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS meta_media_id text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS caption text,
  ADD COLUMN IF NOT EXISTS filename text,
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS voice boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS place_name text,
  ADD COLUMN IF NOT EXISTS raw_metadata jsonb;

COMMIT;
