-- Unified Messaging — READ-ONLY Supabase SQL Editor preflight
--
-- Purpose: Run manually BEFORE applying scripts/unified-messaging-normalized-schema.sql
-- Mode: SELECT / catalog inspection / RAISE only. NO DDL, NO DML.
--
-- Project identity (org name / project ref) MUST be confirmed in the Supabase
-- Dashboard separately. Do not treat SQL session settings as proof of project ref.
--
-- Expected outcome for a first deployment:
--   NOTICE: PASS: preflight — safe to seek human deployment approval
-- STOP outcomes raise EXCEPTION with prefix 'STOP:'.

-- -----------------------------------------------------------------------------
-- 1. Session identity (informational — not project-ref proof)
-- -----------------------------------------------------------------------------
SELECT
  version() AS postgres_version,
  current_database() AS current_database,
  current_user AS current_user,
  session_user AS session_user,
  current_setting('server_version_num') AS server_version_num;

-- -----------------------------------------------------------------------------
-- 2–9. Assertions (fail closed)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  stop_reasons text[] := ARRAY[]::text[];
  role_name text;
  missing_roles text[] := ARRAY[]::text[];
  required_roles text[] := ARRAY['anon', 'authenticated', 'service_role'];
  wa_table text;
  missing_wa text[] := ARRAY[]::text[];
  required_wa text[] := ARRAY[
    'whatsapp_channels',
    'whatsapp_contacts',
    'whatsapp_conversations',
    'whatsapp_messages',
    'whatsapp_message_status_events',
    'whatsapp_webhook_events',
    'whatsapp_audit_events',
    'whatsapp_connections',
    'whatsapp_oauth_states',
    'whatsapp_conversation_crm_links',
    'whatsapp_outbound_idempotency_keys'
  ];
  msg_table text;
  target_tables text[] := ARRAY[
    'messaging_contacts',
    'messaging_contact_identities',
    'messaging_conversations',
    'messaging_messages',
    'messaging_attachments',
    'messaging_status_events',
    'messaging_conversation_assignments',
    'messaging_outbox',
    'messaging_audit_logs'
  ];
  existing_targets text[] := ARRAY[]::text[];
  conflict_names text[] := ARRAY[]::text[];
  messaging_rel_count int;
  claim_idx_exists boolean;
  unsafe_default_acl boolean := false;
  unsafe_policy_count int;
  unsafe_grant_count int;
BEGIN
  -- Roles
  FOREACH role_name IN ARRAY required_roles LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      missing_roles := array_append(missing_roles, role_name);
    END IF;
  END LOOP;
  IF coalesce(array_length(missing_roles, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'missing Supabase-native roles: ' || array_to_string(missing_roles, ', ')
    );
  END IF;

  -- WhatsApp coexistence baseline (from repository WhatsApp scripts)
  FOREACH wa_table IN ARRAY required_wa LOOP
    IF to_regclass('public.' || wa_table) IS NULL THEN
      missing_wa := array_append(missing_wa, wa_table);
    END IF;
  END LOOP;
  IF coalesce(array_length(missing_wa, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'WhatsApp coexistence baseline incomplete; missing: ' || array_to_string(missing_wa, ', ')
    );
  END IF;

  -- Target names already present (first deploy expects none)
  FOREACH msg_table IN ARRAY target_tables LOOP
    IF to_regclass('public.' || msg_table) IS NOT NULL THEN
      existing_targets := array_append(existing_targets, msg_table);
    END IF;
  END LOOP;
  IF coalesce(array_length(existing_targets, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'normalized messaging table(s) already exist — do not re-apply blindly: '
        || array_to_string(existing_targets, ', ')
    );
  END IF;

  -- Conflicting non-table objects occupying target names in public
  SELECT coalesce(array_agg(c.relname ORDER BY c.relname), ARRAY[]::text[])
  INTO conflict_names
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY (target_tables)
    AND c.relkind <> 'r';

  IF coalesce(array_length(conflict_names, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'target name(s) occupied by non-table objects: ' || array_to_string(conflict_names, ', ')
    );
  END IF;

  -- Any messaging_* relation inventory (informational + stop if unexpected before deploy)
  SELECT count(*)::int INTO messaging_rel_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname LIKE 'messaging_%';

  IF messaging_rel_count > 0 AND coalesce(array_length(existing_targets, 1), 0) = 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      format(
        'found %s public messaging_* relation(s) outside the nine target table names — inspect before deploy',
        messaging_rel_count
      )
    );
  END IF;

  -- Claim index must not already exist before first deploy
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'messaging_outbox_claim_idx'
  ) INTO claim_idx_exists;

  IF claim_idx_exists THEN
    stop_reasons := array_append(
      stop_reasons,
      'messaging_outbox_claim_idx already exists — stop and reconcile before deploy'
    );
  END IF;

  -- Default privileges: often grant browser roles on new public tables in Supabase.
  -- Canonical DDL compensates with explicit REVOKE. Do not STOP solely on defaults;
  -- surface them for operator review and require post-deploy privilege verification.
  SELECT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE n.nspname = 'public'
      AND d.defaclobjtype = 'r'
      AND (
        array_to_string(d.defaclacl, ',') ILIKE '%anon%'
        OR array_to_string(d.defaclacl, ',') ILIKE '%authenticated%'
      )
  ) INTO unsafe_default_acl;

  IF unsafe_default_acl THEN
    RAISE NOTICE 'WARN: public default privileges include anon/authenticated — post-deploy MUST prove REVOKE succeeded';
  END IF;

  -- Existing policies / grants on any already-present messaging_* (should be none pre-deploy)
  SELECT count(*)::int INTO unsafe_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename LIKE 'messaging_%';

  IF unsafe_policy_count > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      format('existing messaging_* RLS policies present (%s) — unsafe for first deploy', unsafe_policy_count)
    );
  END IF;

  SELECT count(*)::int INTO unsafe_grant_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name LIKE 'messaging_%'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

  IF unsafe_grant_count > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      format('browser-role grants already exist on messaging_* (%s grant rows)', unsafe_grant_count)
    );
  END IF;

  -- Emit inventory for operator review (always)
  RAISE NOTICE 'preflight inventory: postgres=% database=% user=%',
    current_setting('server_version'), current_database(), current_user;
  RAISE NOTICE 'preflight inventory: roles anon=% authenticated=% service_role=%',
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon'),
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'),
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
  RAISE NOTICE 'preflight inventory: missing_whatsapp=% existing_targets=% messaging_rel_count=% claim_idx=% unsafe_default_acl=%',
    missing_wa, existing_targets, messaging_rel_count, claim_idx_exists, unsafe_default_acl;

  IF coalesce(array_length(stop_reasons, 1), 0) > 0 THEN
    RAISE EXCEPTION 'STOP: preflight failed — %', array_to_string(stop_reasons, ' | ');
  END IF;

  RAISE NOTICE 'PASS: preflight — safe to seek human deployment approval (Dashboard project-ref + PITR still required)';
END
$$;

-- -----------------------------------------------------------------------------
-- Supporting inventory SELECTs (read-only; for saving with the preflight output)
-- -----------------------------------------------------------------------------
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY rolname;

SELECT c.relname AS relation_name, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND (
    c.relname LIKE 'messaging_%'
    OR c.relname LIKE 'whatsapp_%'
  )
ORDER BY c.relname;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (tablename LIKE 'messaging_%' OR tablename LIKE 'whatsapp_%')
ORDER BY tablename, policyname;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name LIKE 'messaging_%'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

SELECT n.nspname AS schema_name,
       pg_get_userbyid(d.defaclrole) AS owner_role,
       d.defaclobjtype,
       d.defaclacl::text AS default_acl
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE n.nspname = 'public'
ORDER BY 1, 2, 3;
