-- Unified Messaging — READ-ONLY Supabase SQL Editor post-deployment verification
--
-- Purpose: Run manually AFTER applying scripts/unified-messaging-normalized-schema.sql
-- Mode: SELECT / catalog inspection / RAISE only. NO DDL, NO DML, NO test-row inserts.
--
-- Expected outcome:
--   NOTICE: PASS: post-deploy verification
-- Failures raise EXCEPTION with prefix 'STOP:'.

DO $$
DECLARE
  stop_reasons text[] := ARRAY[]::text[];
  t text;
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
  missing_tables text[] := ARRAY[]::text[];
  missing_org text[] := ARRAY[]::text[];
  missing_rls text[] := ARRAY[]::text[];
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
  missing_wa text[] := ARRAY[]::text[];
  required_checks text[] := ARRAY[
    'messaging_contacts_consent_check',
    'messaging_contact_identities_transport_check',
    'messaging_conversations_transport_check',
    'messaging_conversations_status_check',
    'messaging_conversations_automation_check',
    'messaging_messages_transport_check',
    'messaging_messages_direction_check',
    'messaging_messages_type_check',
    'messaging_messages_origin_check',
    'messaging_messages_processing_check',
    'messaging_messages_delivery_check',
    'messaging_attachments_object_key_private',
    'messaging_attachments_scan_check',
    'messaging_status_events_status_check',
    'messaging_outbox_status_check',
    'messaging_audit_logs_actor_type_check'
  ];
  missing_checks text[] := ARRAY[]::text[];
  required_fks text[] := ARRAY[
    'messaging_contact_identities_contact_fk',
    'messaging_conversations_contact_fk',
    'messaging_messages_conversation_fk',
    'messaging_attachments_message_fk',
    'messaging_status_events_message_fk',
    'messaging_conversation_assignments_conversation_fk'
  ];
  missing_fks text[] := ARRAY[]::text[];
  required_uidx text[] := ARRAY[
    'messaging_contact_identities_provider_uidx',
    'messaging_messages_inbound_external_uidx',
    'messaging_messages_outbound_idempotency_uidx',
    'messaging_status_events_external_uidx',
    'messaging_outbox_idempotency_uidx'
  ];
  missing_uidx text[] := ARRAY[]::text[];
  policy_count int;
  browser_grant_count int;
  unexpected_tables text[] := ARRAY[]::text[];
  claim_def text;
  expected_claim_fragment text := 'CREATE INDEX messaging_outbox_claim_idx ON public.messaging_outbox USING btree (status, available_at, created_at) WHERE (status = ''pending''::text)';
  service_ok boolean := false;
  has_public_url boolean := false;
  chk text;
  fk text;
  uidx text;
BEGIN
  -- Nine tables
  FOREACH t IN ARRAY target_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      missing_tables := array_append(missing_tables, t);
    END IF;
  END LOOP;
  IF coalesce(array_length(missing_tables, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'missing normalized tables: ' || array_to_string(missing_tables, ', ')
    );
  END IF;

  -- organization_id NOT NULL on each target table
  FOREACH t IN ARRAY target_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = t
           AND column_name = 'organization_id'
           AND data_type = 'text'
           AND is_nullable = 'NO'
       ) THEN
      missing_org := array_append(missing_org, t);
    END IF;
  END LOOP;
  IF coalesce(array_length(missing_org, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'organization_id text NOT NULL missing on: ' || array_to_string(missing_org, ', ')
    );
  END IF;

  -- Primary keys (id)
  FOREACH t IN ARRAY target_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM pg_constraint c
         JOIN pg_class rel ON rel.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = rel.relnamespace
         WHERE n.nspname = 'public'
           AND rel.relname = t
           AND c.contype = 'p'
       ) THEN
      stop_reasons := array_append(stop_reasons, 'missing primary key on ' || t);
    END IF;
  END LOOP;

  -- Composite / named FKs
  FOREACH fk IN ARRAY required_fks LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = fk AND contype = 'f'
    ) THEN
      missing_fks := array_append(missing_fks, fk);
    END IF;
  END LOOP;
  IF coalesce(array_length(missing_fks, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'missing foreign keys: ' || array_to_string(missing_fks, ', ')
    );
  END IF;

  -- CHECK constraints (named)
  FOREACH chk IN ARRAY required_checks LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = chk AND contype = 'c'
    ) THEN
      missing_checks := array_append(missing_checks, chk);
    END IF;
  END LOOP;
  IF coalesce(array_length(missing_checks, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'missing CHECK constraints: ' || array_to_string(missing_checks, ', ')
    );
  END IF;

  -- Unique indexes
  FOREACH uidx IN ARRAY required_uidx LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = uidx
    ) THEN
      missing_uidx := array_append(missing_uidx, uidx);
    END IF;
  END LOOP;
  IF coalesce(array_length(missing_uidx, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'missing unique indexes: ' || array_to_string(missing_uidx, ', ')
    );
  END IF;

  -- Claim index definition
  SELECT indexdef INTO claim_def
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'messaging_outbox_claim_idx';

  IF claim_def IS NULL THEN
    stop_reasons := array_append(stop_reasons, 'messaging_outbox_claim_idx missing');
  ELSIF position('status, available_at, created_at' in claim_def) = 0
     OR position('pending' in claim_def) = 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'messaging_outbox_claim_idx definition unexpected: ' || claim_def
        || ' (expected fragment near: ' || expected_claim_fragment || ')'
    );
  END IF;

  -- RLS enabled
  FOREACH t IN ARRAY target_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = t
           AND c.relrowsecurity IS TRUE
       ) THEN
      missing_rls := array_append(missing_rls, t);
    END IF;
  END LOOP;
  IF coalesce(array_length(missing_rls, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'RLS not enabled on: ' || array_to_string(missing_rls, ', ')
    );
  END IF;

  -- Zero policies on normalized tables
  SELECT count(*)::int INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = ANY (target_tables);

  IF policy_count <> 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      format('expected 0 browser/RLS policies on normalized tables; found %s', policy_count)
    );
  END IF;

  -- Browser roles: no direct table privileges
  SELECT count(*)::int INTO browser_grant_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = ANY (target_tables)
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

  IF browser_grant_count <> 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      format('anon/authenticated still have %s privilege grant(s) on normalized tables', browser_grant_count)
    );
  END IF;

  FOREACH t IN ARRAY target_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      IF has_table_privilege('anon', 'public.' || t, 'SELECT')
         OR has_table_privilege('anon', 'public.' || t, 'INSERT')
         OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
         OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
         OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
         OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
        stop_reasons := array_append(
          stop_reasons,
          'browser role still privileged on ' || t || ' via has_table_privilege'
        );
      END IF;
    END IF;
  END LOOP;

  -- service_role trusted-server access (canonical DDL relies on Supabase service_role,
  -- typically BYPASSRLS + table privileges; require usable INSERT on messages + audit)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    service_ok :=
      (
        has_table_privilege('service_role', 'public.messaging_messages', 'INSERT')
        AND has_table_privilege('service_role', 'public.messaging_audit_logs', 'INSERT')
        AND has_table_privilege('service_role', 'public.messaging_outbox', 'INSERT')
      )
      OR EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls
      );
    IF NOT service_ok THEN
      stop_reasons := array_append(
        stop_reasons,
        'service_role lacks expected trusted-server access (INSERT privileges or BYPASSRLS)'
      );
    END IF;
  ELSE
    stop_reasons := array_append(stop_reasons, 'service_role role missing');
  END IF;

  -- Attachment privacy: no public_url column
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messaging_attachments'
      AND column_name = 'public_url'
  ) INTO has_public_url;

  IF has_public_url THEN
    stop_reasons := array_append(stop_reasons, 'messaging_attachments.public_url must not exist');
  END IF;

  IF to_regclass('public.messaging_attachments') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'messaging_attachments'
        AND column_name IN ('object_key', 'media_type', 'size_bytes', 'sha256', 'scan_status')
      GROUP BY table_name
      HAVING count(*) = 5
    ) THEN
      stop_reasons := array_append(
        stop_reasons,
        'messaging_attachments missing expected object_key/media_type/size/hash/scan fields'
      );
    END IF;
  END IF;

  -- WhatsApp coexistence retained
  FOREACH t IN ARRAY required_wa LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      missing_wa := array_append(missing_wa, t);
    END IF;
  END LOOP;
  IF coalesce(array_length(missing_wa, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'whatsapp_* baseline missing after deploy: ' || array_to_string(missing_wa, ', ')
    );
  END IF;

  -- Unexpected extra messaging_* tables beyond the nine
  SELECT coalesce(array_agg(c.relname ORDER BY c.relname), ARRAY[]::text[])
  INTO unexpected_tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname LIKE 'messaging_%'
    AND NOT (c.relname = ANY (target_tables));

  IF coalesce(array_length(unexpected_tables, 1), 0) > 0 THEN
    stop_reasons := array_append(
      stop_reasons,
      'unexpected messaging_* tables: ' || array_to_string(unexpected_tables, ', ')
    );
  END IF;

  IF coalesce(array_length(stop_reasons, 1), 0) > 0 THEN
    RAISE EXCEPTION 'STOP: post-deploy verification failed — %', array_to_string(stop_reasons, ' | ');
  END IF;

  RAISE NOTICE 'PASS: post-deploy verification — nine tables, FKs/CHECKs/indexes, RLS lockdown, WhatsApp coexistence intact';
END
$$;

-- Explicit catalog snapshots for the deployment record
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name LIKE 'messaging_%'
  AND column_name = 'organization_id'
ORDER BY table_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'messaging_%'
ORDER BY indexname;

SELECT c.conname, c.contype, rel.relname AS table_name
FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname LIKE 'messaging_%'
ORDER BY rel.relname, c.contype, c.conname;

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'messaging_%'
ORDER BY tablename;

SELECT count(*) AS messaging_policy_count
FROM pg_policies
WHERE schemaname = 'public' AND tablename LIKE 'messaging_%';
-- expected: messaging_policy_count = 0

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name LIKE 'messaging_%'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;
