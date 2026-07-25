#!/usr/bin/env bash
# Orchestrate live disposable-Postgres validation for normalized messaging schema.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
START="${SCRIPT_DIR}/messaging-test-db-start.sh"
EXEC="${SCRIPT_DIR}/messaging-test-db-exec.sh"
STOP="${SCRIPT_DIR}/messaging-test-db-stop.sh"
APPLY_BASELINE="${SCRIPT_DIR}/messaging-test-db-apply-baseline.sh"

cd "${REPO_ROOT}"

echo "==== T4B: start disposable Postgres ===="
"${START}"

echo "==== T4B: confirm local target ===="
"${EXEC}" -c "SELECT version();"
"${EXEC}" -c "SELECT current_database();"
"${EXEC}" -c "SHOW listen_addresses;" || true
docker port sunchaser-messaging-test-db

echo "==== T4B: failure-atomicity (controlled rollback) ===="
set +e
"${EXEC}" "${REPO_ROOT}/scripts/test-unified-messaging-atomicity.sql"
atom_rc=$?
set -e
if [[ "${atom_rc}" -eq 0 ]]; then
  echo "ERROR: atomicity probe was expected to fail" >&2
  exit 1
fi
"${EXEC}" -c "SELECT count(*) AS messaging_tables FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'messaging_%';"
leftover="$("${EXEC}" -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'messaging_%';" | sed -n '3p' | tr -d ' ')"
# psql aligned output: parse more reliably
leftover_count="$("${EXEC}" -c "COPY (SELECT count(*)::text FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'messaging_%') TO STDOUT;")"
if [[ "${leftover_count}" != "0" ]]; then
  echo "ERROR: atomicity failed — leftover messaging_* tables: ${leftover_count}" >&2
  exit 1
fi
echo "PASS: atomicity — controlled failure left zero messaging_* tables"

echo "==== T4B: apply baseline (roles + whatsapp_*) ===="
chmod +x "${APPLY_BASELINE}"
"${APPLY_BASELINE}"

echo "==== T4B: apply normalized messaging schema ===="
"${EXEC}" "${REPO_ROOT}/scripts/unified-messaging-normalized-schema.sql"

echo "==== T4B: catalog smoke after apply ===="
"${EXEC}" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'messaging_%' ORDER BY 1;"
"${EXEC}" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'whatsapp_%' ORDER BY 1;"

echo "==== T4B: live validation ===="
"${EXEC}" "${REPO_ROOT}/scripts/test-unified-messaging-postgres.sql"

echo "==== T4B: outbox EXPLAIN (ANALYZE, BUFFERS) ===="
# Seed claim rows then explain (validation SQL already analyzed; re-seed briefly)
"${EXEC}" -c "
INSERT INTO public.messaging_outbox (
  id, organization_id, aggregate_type, aggregate_id, event_type, payload,
  idempotency_key, status, available_at, created_at
)
SELECT
  'ob_x_' || g, 'org_explain', 'message', 'm', 'dispatch', '{}'::jsonb,
  'ob-x-' || g, 'pending',
  timezone('utc', now()) - (g || ' seconds')::interval,
  timezone('utc', now()) - (g || ' seconds')::interval
FROM generate_series(1, 300) g
ON CONFLICT DO NOTHING;
ANALYZE public.messaging_outbox;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM public.messaging_outbox
WHERE status = 'pending'
  AND available_at <= timezone('utc', now())
  AND locked_at IS NULL
ORDER BY available_at ASC, created_at ASC
LIMIT 25;
DELETE FROM public.messaging_outbox WHERE organization_id = 'org_explain';
"

echo "==== T4B: rollback normalized tables only ===="
"${EXEC}" "${REPO_ROOT}/scripts/test-unified-messaging-rollback.sql"
"${EXEC}" -c "SELECT count(*)::text AS messaging_left FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'messaging_%';"
msg_left="$("${EXEC}" -c "COPY (SELECT count(*)::text FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'messaging_%') TO STDOUT;")"
wa_left="$("${EXEC}" -c "COPY (SELECT count(*)::text FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'whatsapp_%') TO STDOUT;")"
if [[ "${msg_left}" != "0" ]]; then
  echo "ERROR: messaging_* tables remain after rollback: ${msg_left}" >&2
  exit 1
fi
if [[ "${wa_left}" -lt 5 ]]; then
  echo "ERROR: whatsapp_* tables missing after rollback: ${wa_left}" >&2
  exit 1
fi
echo "PASS: rollback removed messaging_*; whatsapp_* remain (${wa_left})"

echo "==== T4B: clean reapply + revalidate ===="
"${EXEC}" "${REPO_ROOT}/scripts/unified-messaging-normalized-schema.sql"
"${EXEC}" "${REPO_ROOT}/scripts/test-unified-messaging-postgres.sql"
echo "PASS: clean reapplication + live validation"

echo "==== T4B: ALL LIVE POSTGRES CHECKS PASSED ===="
