-- Disposable-development rollback for normalized messaging tables ONLY.
-- Reverse dependency order. Does NOT drop whatsapp_* objects.
-- Manual / test harness use only — not a production migration.

DROP TABLE IF EXISTS public.messaging_audit_logs CASCADE;
DROP TABLE IF EXISTS public.messaging_outbox CASCADE;
DROP TABLE IF EXISTS public.messaging_conversation_assignments CASCADE;
DROP TABLE IF EXISTS public.messaging_status_events CASCADE;
DROP TABLE IF EXISTS public.messaging_attachments CASCADE;
DROP TABLE IF EXISTS public.messaging_messages CASCADE;
DROP TABLE IF EXISTS public.messaging_conversations CASCADE;
DROP TABLE IF EXISTS public.messaging_contact_identities CASCADE;
DROP TABLE IF EXISTS public.messaging_contacts CASCADE;
