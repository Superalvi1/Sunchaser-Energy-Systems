#!/usr/bin/env bash
# Execute SQL against the disposable local messaging-test Postgres only.
#
# Usage:
#   scripts/messaging-test-db-exec.sh path/to/file.sql
#   scripts/messaging-test-db-exec.sh -c "SELECT 1;"
#
# Rejects non-local hosts. Does not read Supabase / production credentials.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.messaging-test.yml"
PROJECT_NAME="sunchaser-messaging-test"
SERVICE_NAME="messaging-test-db"
CONTAINER_NAME="sunchaser-messaging-test-db"

# Allowed connection targets for this harness only.
ALLOWED_HOSTS_REGEX='^(localhost|127\.0\.0\.1|messaging-test-db)$'
DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT="55432"
DEFAULT_DB="messaging_test"
DEFAULT_USER="messaging_test"
DEFAULT_PASSWORD="messaging_test_local_only"

HOST="${MESSAGING_TEST_DB_HOST:-${DEFAULT_HOST}}"
PORT="${MESSAGING_TEST_DB_PORT:-${DEFAULT_PORT}}"
DB="${MESSAGING_TEST_DB_NAME:-${DEFAULT_DB}}"
USER_NAME="${MESSAGING_TEST_DB_USER:-${DEFAULT_USER}}"
PASSWORD="${MESSAGING_TEST_DB_PASSWORD:-${DEFAULT_PASSWORD}}"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "ERROR: missing compose file: ${COMPOSE_FILE}" >&2
  exit 1
fi

if [[ ! "${HOST}" =~ ${ALLOWED_HOSTS_REGEX} ]]; then
  echo "ERROR: refusing non-local database host '${HOST}'." >&2
  echo "Allowed hosts: localhost, 127.0.0.1, messaging-test-db" >&2
  exit 1
fi

if [[ "${PORT}" != "${DEFAULT_PORT}" ]]; then
  echo "ERROR: refusing unexpected port '${PORT}'. Expected ${DEFAULT_PORT} for this harness." >&2
  exit 1
fi

if [[ "${DB}" != "${DEFAULT_DB}" || "${USER_NAME}" != "${DEFAULT_USER}" ]]; then
  echo "ERROR: refusing unexpected database/user (expected ${DEFAULT_DB}/${DEFAULT_USER})." >&2
  exit 1
fi

# Block accidental use of hosted Supabase env vars for this harness.
if [[ -n "${SUPABASE_DB_URL:-}" || -n "${DATABASE_URL:-}" || -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  # Do not print secret values; only warn that they are ignored.
  echo "NOTE: ignoring SUPABASE_DB_URL / DATABASE_URL / SUPABASE_DB_PASSWORD for local harness execution."
fi

if ! docker inspect --format='{{.State.Status}}' "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "ERROR: container '${CONTAINER_NAME}' is not running. Start it with scripts/messaging-test-db-start.sh" >&2
  exit 1
fi

status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${CONTAINER_NAME}")"
if [[ "${status}" != "healthy" && "${status}" != "running" ]]; then
  echo "ERROR: container '${CONTAINER_NAME}' status is '${status}' (need healthy/running)" >&2
  exit 1
fi

export COMPOSE_PROJECT_NAME="${PROJECT_NAME}"
export PGPASSWORD="${PASSWORD}"

run_psql_in_container() {
  # Execute via the harness container so host-side psql is not required.
  # Uses the container-local Unix socket (never a remote host / hosted Supabase).
  docker compose -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}" exec -T \
    -e PGPASSWORD="${PASSWORD}" \
    "${SERVICE_NAME}" \
    psql \
      -v ON_ERROR_STOP=1 \
      -U "${USER_NAME}" \
      -d "${DB}" \
      "$@"
}

if [[ "${1:-}" == "-c" ]]; then
  shift
  if [[ $# -lt 1 ]]; then
    echo "ERROR: -c requires a SQL string" >&2
    exit 1
  fi
  SQL_STRING="$1"
  run_psql_in_container -c "${SQL_STRING}"
  exit 0
fi

if [[ $# -lt 1 ]]; then
  echo "Usage:" >&2
  echo "  $0 path/to/file.sql" >&2
  echo "  $0 -c \"SELECT 1;\"" >&2
  exit 1
fi

SQL_FILE="$1"
if [[ "${SQL_FILE}" != /* ]]; then
  # Resolve relative to caller CWD first, then repo root.
  if [[ -f "${SQL_FILE}" ]]; then
    SQL_FILE="$(cd "$(dirname "${SQL_FILE}")" && pwd)/$(basename "${SQL_FILE}")"
  elif [[ -f "${REPO_ROOT}/${SQL_FILE}" ]]; then
    SQL_FILE="${REPO_ROOT}/${SQL_FILE}"
  fi
fi

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "ERROR: SQL file not found: $1" >&2
  exit 1
fi

# Stream file into psql; keep file on host (no remote credential use).
run_psql_in_container < "${SQL_FILE}"
