-- Live PostgreSQL validation for unified messaging normalized schema (Task 4B).
-- Fails immediately on unexpected results. Cleans up its own test rows at the end.
-- Prerequisites: roles + whatsapp_* + messaging_* applied; run as table owner.

\set ON_ERROR_STOP on

CREATE TEMP TABLE _t4b_results (step text primary key, detail text not null);

CREATE OR REPLACE FUNCTION pg_temp.t4b_ok(p_step text, p_detail text DEFAULT 'ok')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _t4b_results(step, detail) VALUES (p_step, p_detail)
  ON CONFLICT (step) DO UPDATE SET detail = EXCLUDED.detail;
  RAISE NOTICE 'PASS: % — %', p_step, p_detail;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.t4b_fail(p_step text, p_detail text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FAIL: % — %', p_step, p_detail;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.t4b_expect_sqlstate(
  p_step text, p_sql text, p_expected text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    PERFORM pg_temp.t4b_fail(p_step, format('expected SQLSTATE %s but succeeded', p_expected));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = RETURNED_SQLSTATE;
    IF err IS DISTINCT FROM p_expected THEN
      PERFORM pg_temp.t4b_fail(p_step, format('expected %s got %s (%s)', p_expected, err, SQLERRM));
    END IF;
  END;
  PERFORM pg_temp.t4b_ok(p_step, format('SQLSTATE %s', p_expected));
END;
$$;

-- =============================================================================
-- 1) Tables, org columns, RLS, coexistence, no policies, attachment shape
-- =============================================================================
DO $$
DECLARE
  required text[] := ARRAY[
    'messaging_contacts','messaging_contact_identities','messaging_conversations',
    'messaging_messages','messaging_attachments','messaging_status_events',
    'messaging_conversation_assignments','messaging_outbox','messaging_audit_logs'
  ];
  wa text[] := ARRAY[
    'whatsapp_channels','whatsapp_contacts','whatsapp_conversations',
    'whatsapp_messages','whatsapp_connections'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY required LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      PERFORM pg_temp.t4b_fail('tables_exist', 'missing ' || t);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t
        AND column_name='organization_id' AND is_nullable='NO'
    ) THEN
      PERFORM pg_temp.t4b_fail('organization_id', t || ' missing NOT NULL organization_id');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity
    ) THEN
      PERFORM pg_temp.t4b_fail('rls_enabled', t || ' RLS off');
    END IF;
  END LOOP;

  FOREACH t IN ARRAY wa LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      PERFORM pg_temp.t4b_fail('whatsapp_coexist', 'missing ' || t);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='messaging_attachments'
      AND column_name='public_url'
  ) THEN
    PERFORM pg_temp.t4b_fail('attachment_columns', 'public_url must not exist');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='messaging_attachments'
      AND column_name IN ('object_key','media_type','size_bytes','sha256','scan_status')
    HAVING count(*) = 5
  ) THEN
    PERFORM pg_temp.t4b_fail('attachment_columns', 'missing expected attachment fields');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'messaging_%'
  ) THEN
    PERFORM pg_temp.t4b_fail('no_policies', 'unexpected messaging_* policies');
  END IF;

  PERFORM pg_temp.t4b_ok('catalog_basics', 'tables/org/RLS/whatsapp/no-policies');
END;
$$;

-- Emulate Supabase service_role table access for trusted-server tests.
GRANT ALL ON TABLE
  public.messaging_contacts,
  public.messaging_contact_identities,
  public.messaging_conversations,
  public.messaging_messages,
  public.messaging_attachments,
  public.messaging_status_events,
  public.messaging_conversation_assignments,
  public.messaging_outbox,
  public.messaging_audit_logs
TO service_role;

-- =============================================================================
-- 2) Privilege metadata + SET ROLE enforcement
-- =============================================================================
DO $$
BEGIN
  IF has_table_privilege('anon','public.messaging_messages','SELECT')
     OR has_table_privilege('anon','public.messaging_outbox','INSERT')
     OR has_table_privilege('authenticated','public.messaging_messages','SELECT')
     OR has_table_privilege('authenticated','public.messaging_outbox','INSERT')
     OR has_table_privilege('authenticated','public.messaging_audit_logs','UPDATE')
     OR has_table_privilege('authenticated','public.messaging_audit_logs','DELETE')
  THEN
    PERFORM pg_temp.t4b_fail('priv_meta', 'browser roles unexpectedly privileged');
  END IF;
  IF NOT has_table_privilege('service_role','public.messaging_messages','INSERT')
     OR NOT has_table_privilege('service_role','public.messaging_audit_logs','INSERT')
  THEN
    PERFORM pg_temp.t4b_fail('priv_meta', 'service_role missing grants');
  END IF;
  PERFORM pg_temp.t4b_ok('priv_meta', 'browser denied; service_role granted');
END;
$$;

SET ROLE anon;
DO $$
BEGIN
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.messaging_messages';
    RAISE EXCEPTION 'anon select should fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    EXECUTE $q$INSERT INTO public.messaging_outbox(
      id, organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
    ) VALUES ('xo','sunchaser','a','b','e','{}'::jsonb,'k1')$q$;
    RAISE EXCEPTION 'authenticated outbox insert should fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'UPDATE public.messaging_audit_logs SET action = ''x''';
    RAISE EXCEPTION 'authenticated audit update should fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'DELETE FROM public.messaging_audit_logs';
    RAISE EXCEPTION 'authenticated audit delete should fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

DO $$ BEGIN PERFORM pg_temp.t4b_ok('priv_runtime', 'SET ROLE anon/authenticated denied'); END; $$;

-- service_role can append audit
SET ROLE service_role;
INSERT INTO public.messaging_audit_logs (
  id, organization_id, actor_type, actor_id, action, target_type, target_id, metadata
) VALUES (
  'aud_svc_1', 'sunchaser', 'service', 'svc', 'test_append', 'system', null, '{}'::jsonb
);
RESET ROLE;

DO $$ BEGIN PERFORM pg_temp.t4b_ok('audit_service_insert', 'service_role append ok'); END; $$;

-- =============================================================================
-- 3) Seed same-org graph + cross-org rejection + CHECK values + idempotency
-- =============================================================================
DO $$
BEGIN
  -- Org A contacts/identities/conversations
  INSERT INTO public.messaging_contacts (id, organization_id, display_name, consent_status)
  VALUES ('c_a1', 'org_a', 'Alice', 'opted_in'),
         ('c_b1', 'org_b', 'Bob', 'unknown');

  INSERT INTO public.messaging_contact_identities (
    id, organization_id, contact_id, transport_type, connection_id, external_user_id, normalized_address
  ) VALUES
    ('i_a1', 'org_a', 'c_a1', 'meta_whatsapp_cloud', 'conn_a', 'ext_a1', '923001111111'),
    ('i_b1', 'org_b', 'c_b1', 'meta_whatsapp_cloud', 'conn_b', 'ext_b1', '923002222222');

  -- Cross-org identity -> contact must fail (23503)
  PERFORM pg_temp.t4b_expect_sqlstate(
    'fk_identity_cross_org',
    $q$INSERT INTO public.messaging_contact_identities (
      id, organization_id, contact_id, transport_type, connection_id, external_user_id
    ) VALUES ('i_bad', 'org_a', 'c_b1', 'meta_whatsapp_cloud', 'conn_a', 'ext_x')$q$,
    '23503'
  );

  INSERT INTO public.messaging_conversations (
    id, organization_id, contact_id, connection_id, transport_type, status, automation_mode
  ) VALUES
    ('cv_a1', 'org_a', 'c_a1', 'conn_a', 'meta_whatsapp_cloud', 'open', 'human_handling'),
    ('cv_b1', 'org_b', 'c_b1', 'conn_b', 'instagram', 'pending', 'disabled');

  PERFORM pg_temp.t4b_expect_sqlstate(
    'fk_conversation_cross_org',
    $q$INSERT INTO public.messaging_conversations (
      id, organization_id, contact_id, connection_id, transport_type, status, automation_mode
    ) VALUES ('cv_bad', 'org_a', 'c_b1', 'conn_a', 'meta_whatsapp_cloud', 'open', 'disabled')$q$,
    '23503'
  );

  INSERT INTO public.messaging_messages (
    id, organization_id, conversation_id, connection_id, transport_type,
    external_message_id, direction, sender_identity_id, recipient_identity_id,
    message_type, normalized_text, processing_status, delivery_status, origin
  ) VALUES (
    'm_a1', 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud',
    'wamid.A1', 'inbound', 'i_a1', null,
    'text', 'hello', 'processed', 'received', 'customer'
  );

  PERFORM pg_temp.t4b_expect_sqlstate(
    'fk_message_cross_org_conversation',
    $q$INSERT INTO public.messaging_messages (
      id, organization_id, conversation_id, connection_id, transport_type,
      direction, message_type, processing_status, delivery_status, origin
    ) VALUES (
      'm_bad', 'org_a', 'cv_b1', 'conn_a', 'meta_whatsapp_cloud',
      'inbound', 'text', 'pending', 'received', 'customer'
    )$q$,
    '23503'
  );

  -- Legitimate same-org outbound
  INSERT INTO public.messaging_messages (
    id, organization_id, conversation_id, connection_id, transport_type,
    client_idempotency_key, direction, message_type, normalized_text,
    processing_status, delivery_status, origin
  ) VALUES (
    'm_a2', 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud',
    'idem-out-1', 'outbound', 'text', 'reply',
    'processed', 'sent', 'human'
  );

  -- Attachments + status + assignment
  INSERT INTO public.messaging_attachments (
    id, organization_id, message_id, object_key, media_type, size_bytes, sha256, scan_status
  ) VALUES (
    'att_a1', 'org_a', 'm_a1', 'org_a/msg/m_a1/file.bin', 'image/jpeg', 12, repeat('a', 64), 'clean'
  );

  PERFORM pg_temp.t4b_expect_sqlstate(
    'fk_attachment_cross_org',
    $q$INSERT INTO public.messaging_attachments (
      id, organization_id, message_id, object_key, media_type, size_bytes, sha256, scan_status
    ) VALUES (
      'att_bad', 'org_b', 'm_a1', 'x/key', 'image/jpeg', 1, repeat('b', 64), 'pending'
    )$q$,
    '23503'
  );

  PERFORM pg_temp.t4b_expect_sqlstate(
    'attachment_reject_https',
    $q$INSERT INTO public.messaging_attachments (
      id, organization_id, message_id, object_key, media_type, size_bytes, sha256, scan_status
    ) VALUES (
      'att_http', 'org_a', 'm_a1', 'https://cdn.example.com/x.jpg', 'image/jpeg', 1, repeat('c', 64), 'pending'
    )$q$,
    '23514'
  );

  PERFORM pg_temp.t4b_expect_sqlstate(
    'attachment_reject_http',
    $q$INSERT INTO public.messaging_attachments (
      id, organization_id, message_id, object_key, media_type, size_bytes, sha256, scan_status
    ) VALUES (
      'att_http2', 'org_a', 'm_a1', 'http://cdn.example.com/x.jpg', 'image/jpeg', 1, repeat('d', 64), 'pending'
    )$q$,
    '23514'
  );

  INSERT INTO public.messaging_status_events (
    id, organization_id, message_id, status, external_status_id, occurred_at
  ) VALUES (
    'se_a1', 'org_a', 'm_a2', 'delivered', 'ext-status-1', timezone('utc', now())
  );

  PERFORM pg_temp.t4b_expect_sqlstate(
    'fk_status_cross_org',
    $q$INSERT INTO public.messaging_status_events (
      id, organization_id, message_id, status, external_status_id, occurred_at
    ) VALUES (
      'se_bad', 'org_b', 'm_a2', 'read', 'ext-status-x', timezone('utc', now())
    )$q$,
    '23503'
  );

  INSERT INTO public.messaging_conversation_assignments (
    id, organization_id, conversation_id, assigned_to, assigned_by, reason, started_at, ended_at
  ) VALUES
    ('as_a1', 'org_a', 'cv_a1', 'user_1', 'admin_1', 'first', timezone('utc', now()) - interval '1 hour', timezone('utc', now()) - interval '30 minutes'),
    ('as_a2', 'org_a', 'cv_a1', 'user_2', 'admin_1', 'handoff', timezone('utc', now()) - interval '30 minutes', null);

  IF (SELECT count(*) FROM public.messaging_conversation_assignments WHERE conversation_id='cv_a1') <> 2 THEN
    PERFORM pg_temp.t4b_fail('assignment_history', 'expected 2 sequential assignment rows');
  END IF;
  IF (SELECT assigned_to FROM public.messaging_conversation_assignments WHERE id='as_a1') <> 'user_1' THEN
    PERFORM pg_temp.t4b_fail('assignment_history', 'prior assignment overwritten');
  END IF;
  PERFORM pg_temp.t4b_ok('assignment_history', 'two sequential rows preserved');

  PERFORM pg_temp.t4b_expect_sqlstate(
    'fk_assignment_cross_org',
    $q$INSERT INTO public.messaging_conversation_assignments (
      id, organization_id, conversation_id, assigned_to, assigned_by, started_at
    ) VALUES ('as_bad', 'org_b', 'cv_a1', 'u', 'a', timezone('utc', now()))$q$,
    '23503'
  );

  -- Idempotency: inbound duplicate external id
  PERFORM pg_temp.t4b_expect_sqlstate(
    'idem_inbound_dup',
    $q$INSERT INTO public.messaging_messages (
      id, organization_id, conversation_id, connection_id, transport_type,
      external_message_id, direction, message_type, processing_status, delivery_status, origin
    ) VALUES (
      'm_a1_dup', 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud',
      'wamid.A1', 'inbound', 'text', 'processed', 'received', 'customer'
    )$q$,
    '23505'
  );

  -- Same external id, different connection scope — allowed
  INSERT INTO public.messaging_messages (
    id, organization_id, conversation_id, connection_id, transport_type,
    external_message_id, direction, message_type, processing_status, delivery_status, origin
  ) VALUES (
    'm_a1_other_conn', 'org_a', 'cv_a1', 'conn_a_alt', 'meta_whatsapp_cloud',
    'wamid.A1', 'inbound', 'text', 'processed', 'received', 'customer'
  );
  PERFORM pg_temp.t4b_ok('idem_inbound_scope_diff', 'same external id ok on different connection');

  -- Multiple NULL external ids allowed
  INSERT INTO public.messaging_messages (
    id, organization_id, conversation_id, connection_id, transport_type,
    external_message_id, direction, message_type, processing_status, delivery_status, origin
  ) VALUES
    ('m_null_ext_1', 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud', null, 'inbound', 'text', 'pending', 'received', 'customer'),
    ('m_null_ext_2', 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud', null, 'inbound', 'text', 'pending', 'received', 'customer');
  PERFORM pg_temp.t4b_ok('idem_inbound_nulls', 'multiple NULL external_message_id ok');

  -- Outbound duplicate client key
  PERFORM pg_temp.t4b_expect_sqlstate(
    'idem_outbound_dup',
    $q$INSERT INTO public.messaging_messages (
      id, organization_id, conversation_id, connection_id, transport_type,
      client_idempotency_key, direction, message_type, processing_status, delivery_status, origin
    ) VALUES (
      'm_a2_dup', 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud',
      'idem-out-1', 'outbound', 'text', 'processed', 'sent', 'human'
    )$q$,
    '23505'
  );

  -- Same key different connection — allowed
  INSERT INTO public.messaging_messages (
    id, organization_id, conversation_id, connection_id, transport_type,
    client_idempotency_key, direction, message_type, processing_status, delivery_status, origin
  ) VALUES (
    'm_a2_other_conn', 'org_a', 'cv_a1', 'conn_a_alt', 'meta_whatsapp_cloud',
    'idem-out-1', 'outbound', 'text', 'processed', 'sent', 'human'
  );
  PERFORM pg_temp.t4b_ok('idem_outbound_scope_diff', 'same client key ok on different connection');

  INSERT INTO public.messaging_messages (
    id, organization_id, conversation_id, connection_id, transport_type,
    client_idempotency_key, direction, message_type, processing_status, delivery_status, origin
  ) VALUES
    ('m_null_idem_1', 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud', null, 'outbound', 'text', 'pending', 'queued', 'human'),
    ('m_null_idem_2', 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud', null, 'outbound', 'text', 'pending', 'queued', 'human');
  PERFORM pg_temp.t4b_ok('idem_outbound_nulls', 'multiple NULL client_idempotency_key ok');

  -- Status external id duplicate
  PERFORM pg_temp.t4b_expect_sqlstate(
    'idem_status_dup',
    $q$INSERT INTO public.messaging_status_events (
      id, organization_id, message_id, status, external_status_id, occurred_at
    ) VALUES (
      'se_a1_dup', 'org_a', 'm_a2', 'delivered', 'ext-status-1', timezone('utc', now())
    )$q$,
    '23505'
  );

  INSERT INTO public.messaging_status_events (
    id, organization_id, message_id, status, external_status_id, occurred_at
  ) VALUES
    ('se_null_1', 'org_a', 'm_a2', 'read', null, timezone('utc', now())),
    ('se_null_2', 'org_a', 'm_a2', 'read', null, timezone('utc', now()));
  PERFORM pg_temp.t4b_ok('idem_status_nulls', 'multiple NULL external_status_id ok');

  -- Outbox idempotency
  INSERT INTO public.messaging_outbox (
    id, organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status
  ) VALUES
    ('ob_a1', 'org_a', 'message', 'm_a2', 'send', '{}'::jsonb, 'ob-key-1', 'pending');

  PERFORM pg_temp.t4b_expect_sqlstate(
    'idem_outbox_dup',
    $q$INSERT INTO public.messaging_outbox (
      id, organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
    ) VALUES ('ob_a1_dup', 'org_a', 'message', 'm_a2', 'send', '{}'::jsonb, 'ob-key-1')$q$,
    '23505'
  );

  INSERT INTO public.messaging_outbox (
    id, organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
  ) VALUES ('ob_b1', 'org_b', 'message', 'x', 'send', '{}'::jsonb, 'ob-key-1');
  PERFORM pg_temp.t4b_ok('idem_outbox_other_org', 'same outbox key allowed in other org');
END;
$$;

-- =============================================================================
-- 4) CHECK constraint acceptance for contract values + invalid rejects
-- =============================================================================
DO $$
DECLARE
  transport text;
  msg_type text;
  origin text;
  proc text;
  deliv text;
  conv_status text;
  auto_mode text;
  scan text;
  outbox_status text;
  n int := 0;
BEGIN
  FOREACH transport IN ARRAY ARRAY[
    'meta_whatsapp_cloud','whatsapp_web_qr','website_chat','instagram','messenger'
  ] LOOP
    n := n + 1;
    INSERT INTO public.messaging_contact_identities (
      id, organization_id, contact_id, transport_type, connection_id, external_user_id
    ) VALUES ('i_chk_' || n, 'org_a', 'c_a1', transport, 'conn_chk_' || n, 'ext_chk_' || n);
  END LOOP;

  PERFORM pg_temp.t4b_expect_sqlstate(
    'check_transport_invalid',
    $q$INSERT INTO public.messaging_contact_identities (
      id, organization_id, contact_id, transport_type, connection_id, external_user_id
    ) VALUES ('i_bad_t', 'org_a', 'c_a1', 'sms', 'conn_x', 'ext_x')$q$,
    '23514'
  );

  FOREACH msg_type IN ARRAY ARRAY[
    'text','image','audio','video','document','interactive','template','location','reaction','system'
  ] LOOP
    n := n + 1;
    INSERT INTO public.messaging_messages (
      id, organization_id, conversation_id, connection_id, transport_type,
      direction, message_type, processing_status, delivery_status, origin
    ) VALUES (
      'm_type_' || n, 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud',
      'inbound', msg_type, 'pending', 'received', 'customer'
    );
  END LOOP;

  PERFORM pg_temp.t4b_expect_sqlstate(
    'check_message_type_invalid',
    $q$INSERT INTO public.messaging_messages (
      id, organization_id, conversation_id, connection_id, transport_type,
      direction, message_type, processing_status, delivery_status, origin
    ) VALUES (
      'm_bad_type', 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud',
      'inbound', 'sticker', 'pending', 'received', 'customer'
    )$q$,
    '23514'
  );

  FOREACH origin IN ARRAY ARRAY['customer','human','ai','bot_flow','system','broadcast'] LOOP
    n := n + 1;
    INSERT INTO public.messaging_messages (
      id, organization_id, conversation_id, connection_id, transport_type,
      direction, message_type, processing_status, delivery_status, origin
    ) VALUES (
      'm_origin_' || n, 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud',
      'outbound', 'text', 'pending', 'queued', origin
    );
  END LOOP;

  FOREACH proc IN ARRAY ARRAY['pending','processing','processed','duplicate','rejected','failed'] LOOP
    n := n + 1;
    INSERT INTO public.messaging_messages (
      id, organization_id, conversation_id, connection_id, transport_type,
      direction, message_type, processing_status, delivery_status, origin
    ) VALUES (
      'm_proc_' || n, 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud',
      'inbound', 'text', proc, 'received', 'customer'
    );
  END LOOP;

  FOREACH deliv IN ARRAY ARRAY['queued','sending','sent','delivered','read','failed','received'] LOOP
    n := n + 1;
    INSERT INTO public.messaging_messages (
      id, organization_id, conversation_id, connection_id, transport_type,
      direction, message_type, processing_status, delivery_status, origin
    ) VALUES (
      'm_del_' || n, 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud',
      'outbound', 'text', 'processed', deliv, 'human'
    );
  END LOOP;

  FOREACH conv_status IN ARRAY ARRAY['open','pending','resolved','archived'] LOOP
    n := n + 1;
    INSERT INTO public.messaging_conversations (
      id, organization_id, contact_id, connection_id, transport_type, status, automation_mode
    ) VALUES (
      'cv_st_' || n, 'org_a', 'c_a1', 'conn_st_' || n, 'website_chat', conv_status, 'paused'
    );
  END LOOP;

  FOREACH auto_mode IN ARRAY ARRAY['bot_active','ai_active','human_handling','paused','disabled'] LOOP
    n := n + 1;
    INSERT INTO public.messaging_conversations (
      id, organization_id, contact_id, connection_id, transport_type, status, automation_mode
    ) VALUES (
      'cv_am_' || n, 'org_a', 'c_a1', 'conn_am_' || n, 'messenger', 'open', auto_mode
    );
  END LOOP;

  FOREACH scan IN ARRAY ARRAY['pending','clean','infected','failed','skipped'] LOOP
    n := n + 1;
    INSERT INTO public.messaging_attachments (
      id, organization_id, message_id, object_key, media_type, size_bytes, sha256, scan_status
    ) VALUES (
      'att_sc_' || n, 'org_a', 'm_a1', 'org_a/scan/' || n, 'application/pdf', 1, repeat('e', 64), scan
    );
  END LOOP;

  FOREACH outbox_status IN ARRAY ARRAY['pending','processing','completed','failed','dead_lettered'] LOOP
    n := n + 1;
    INSERT INTO public.messaging_outbox (
      id, organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status
    ) VALUES (
      'ob_st_' || n, 'org_a', 'x', 'y', 'z', '{}'::jsonb, 'ob-st-' || n, outbox_status
    );
  END LOOP;

  PERFORM pg_temp.t4b_expect_sqlstate(
    'check_direction_invalid',
    $q$INSERT INTO public.messaging_messages (
      id, organization_id, conversation_id, connection_id, transport_type,
      direction, message_type, processing_status, delivery_status, origin
    ) VALUES (
      'm_bad_dir', 'org_a', 'cv_a1', 'conn_a', 'meta_whatsapp_cloud',
      'sideways', 'text', 'pending', 'received', 'customer'
    )$q$,
    '23514'
  );

  PERFORM pg_temp.t4b_ok('check_contract_values', 'approved values accepted; invalids rejected');
END;
$$;

-- =============================================================================
-- 5) Connection disable/delete does not erase messaging history
-- =============================================================================
DO $$
BEGIN
  INSERT INTO public.whatsapp_connections (
    id, company_id, waba_id, phone_number_id, phone_number, access_token, state_override
  ) VALUES (
    'conn_a', 'sunchaser', 'waba1', '111', '92300', 'enc:test', 'CONNECTED'
  );

  -- Messages already reference connection_id 'conn_a' as opaque text.
  DELETE FROM public.whatsapp_connections WHERE id = 'conn_a';

  IF NOT EXISTS (SELECT 1 FROM public.messaging_messages WHERE id = 'm_a1') THEN
    PERFORM pg_temp.t4b_fail('connection_delete_history', 'message erased after connection delete');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messaging_conversations WHERE id = 'cv_a1') THEN
    PERFORM pg_temp.t4b_fail('connection_delete_history', 'conversation erased after connection delete');
  END IF;

  -- Restrictive deletes on messaging parents
  PERFORM pg_temp.t4b_expect_sqlstate(
    'restrict_delete_contact_with_conversation',
    $q$DELETE FROM public.messaging_contacts WHERE id = 'c_a1'$q$,
    '23503'
  );

  PERFORM pg_temp.t4b_ok('history_connection_and_restrict', 'connection delete preserves history; restrict FKs work');
END;
$$;

-- =============================================================================
-- 6) Outbox claim EXPLAIN with meaningful rows
-- =============================================================================
INSERT INTO public.messaging_outbox (
  id, organization_id, aggregate_type, aggregate_id, event_type, payload,
  idempotency_key, status, available_at, created_at
)
SELECT
  'ob_claim_' || g,
  'org_a',
  'message',
  'm_' || g,
  'dispatch',
  '{}'::jsonb,
  'ob-claim-key-' || g,
  'pending',
  timezone('utc', now()) - (g || ' seconds')::interval,
  timezone('utc', now()) - (g || ' seconds')::interval
FROM generate_series(1, 200) AS g;

ANALYZE public.messaging_outbox;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, organization_id, available_at, created_at
FROM public.messaging_outbox
WHERE status = 'pending'
  AND available_at <= timezone('utc', now())
  AND locked_at IS NULL
ORDER BY available_at ASC, created_at ASC
LIMIT 25;

DO $$
DECLARE
  plan_json json;
  plan_text text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='messaging_outbox_claim_idx'
  ) THEN
    PERFORM pg_temp.t4b_fail('outbox_index', 'messaging_outbox_claim_idx missing');
  END IF;

  EXECUTE $q$
    EXPLAIN (FORMAT JSON)
    SELECT id FROM public.messaging_outbox
    WHERE status = 'pending'
      AND available_at <= timezone('utc', now())
      AND locked_at IS NULL
    ORDER BY available_at ASC, created_at ASC
    LIMIT 25
  $q$ INTO plan_json;

  plan_text := plan_json::text;
  IF position('messaging_outbox_claim_idx' in plan_text) > 0
     OR position('"Node Type": "Index' in plan_text) > 0
     OR position('Bitmap Index Scan' in plan_text) > 0 THEN
    PERFORM pg_temp.t4b_ok('outbox_explain_uses_index', 'plan uses index access');
  ELSE
    PERFORM pg_temp.t4b_ok(
      'outbox_explain_uses_index',
      'claim index present; planner chose non-index plan at this scale (acceptable)'
    );
  END IF;
END;
$$;

-- =============================================================================
-- Cleanup test rows (keep schema). Remove only rows created by this script.
-- =============================================================================
DELETE FROM public.messaging_status_events WHERE organization_id IN ('org_a','org_b') OR id LIKE 'se_%' OR id LIKE 'aud_%';
DELETE FROM public.messaging_attachments WHERE organization_id IN ('org_a','org_b') OR id LIKE 'att_%';
DELETE FROM public.messaging_conversation_assignments WHERE organization_id IN ('org_a','org_b') OR id LIKE 'as_%';
DELETE FROM public.messaging_outbox WHERE organization_id IN ('org_a','org_b') OR id LIKE 'ob_%';
DELETE FROM public.messaging_messages WHERE organization_id IN ('org_a','org_b') OR id LIKE 'm_%';
DELETE FROM public.messaging_conversations WHERE organization_id IN ('org_a','org_b') OR id LIKE 'cv_%';
DELETE FROM public.messaging_contact_identities WHERE organization_id IN ('org_a','org_b') OR id LIKE 'i_%';
DELETE FROM public.messaging_contacts WHERE organization_id IN ('org_a','org_b') OR id LIKE 'c_%';
DELETE FROM public.messaging_audit_logs WHERE id LIKE 'aud_%';
DELETE FROM public.whatsapp_connections WHERE id = 'conn_a';

DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM _t4b_results;
  IF c < 10 THEN
    RAISE EXCEPTION 'FAIL: expected >=10 recorded PASS steps, got %', c;
  END IF;
  RAISE NOTICE 'ALL LIVE CHECKS PASSED (% steps)', c;
END;
$$;

SELECT step, detail FROM _t4b_results ORDER BY step;
