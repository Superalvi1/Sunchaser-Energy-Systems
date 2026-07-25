#!/usr/bin/env bash
# Start disposable Postgres, apply baseline + normalized schema, run repository tests.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

START="${SCRIPT_DIR}/messaging-test-db-start.sh"
STOP="${SCRIPT_DIR}/messaging-test-db-stop.sh"
APPLY="${SCRIPT_DIR}/messaging-test-db-apply-baseline.sh"
EXEC="${SCRIPT_DIR}/messaging-test-db-exec.sh"

cleanup() {
  "${STOP}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${START}"
"${APPLY}"
"${EXEC}" "${REPO_ROOT}/scripts/unified-messaging-normalized-schema.sql"

export PLAYWRIGHT_BROWSERS_PATH=0
npx tsx server/unifiedMessaging/postgresMessagingRepository.test.ts
