#!/usr/bin/env bash
# Start the disposable local PostgreSQL harness for unified-messaging schema tests.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.messaging-test.yml"
PROJECT_NAME="sunchaser-messaging-test"
SERVICE_NAME="messaging-test-db"
CONTAINER_NAME="sunchaser-messaging-test-db"
HOST_PORT="55432"
HEALTH_TIMEOUT_SEC="${MESSAGING_TEST_DB_HEALTH_TIMEOUT_SEC:-90}"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "ERROR: missing compose file: ${COMPOSE_FILE}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required but not found on PATH" >&2
  exit 1
fi

export COMPOSE_PROJECT_NAME="${PROJECT_NAME}"

echo "Validating compose config..."
docker compose -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}" config --quiet

echo "Starting disposable Postgres (${PROJECT_NAME}) on 127.0.0.1:${HOST_PORT}..."
docker compose -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}" up -d --remove-orphans

echo "Waiting for health (timeout ${HEALTH_TIMEOUT_SEC}s)..."
deadline=$((SECONDS + HEALTH_TIMEOUT_SEC))
while true; do
  status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${CONTAINER_NAME}" 2>/dev/null || echo "missing")"
  if [[ "${status}" == "healthy" ]]; then
    echo "OK: ${CONTAINER_NAME} is healthy"
    echo "Local DSN (disposable): postgresql://messaging_test:messaging_test_local_only@127.0.0.1:${HOST_PORT}/messaging_test"
    exit 0
  fi
  if [[ "${status}" == "exited" || "${status}" == "dead" || "${status}" == "missing" ]]; then
    echo "ERROR: container status is '${status}' before becoming healthy" >&2
    docker compose -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}" logs --no-color --tail=80 "${SERVICE_NAME}" >&2 || true
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    echo "ERROR: timed out waiting for healthy status (last='${status}')" >&2
    docker compose -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}" ps >&2 || true
    docker compose -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}" logs --no-color --tail=80 "${SERVICE_NAME}" >&2 || true
    exit 1
  fi
  sleep 1
done
