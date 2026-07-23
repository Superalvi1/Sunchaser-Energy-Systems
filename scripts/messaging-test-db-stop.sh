#!/usr/bin/env bash
# Stop and remove ONLY the disposable messaging-test Postgres harness resources.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.messaging-test.yml"
PROJECT_NAME="sunchaser-messaging-test"
CONTAINER_NAME="sunchaser-messaging-test-db"
VOLUME_NAME="sunchaser-messaging-test-pgdata"
NETWORK_NAME="sunchaser-messaging-test-net"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "ERROR: missing compose file: ${COMPOSE_FILE}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required but not found on PATH" >&2
  exit 1
fi

export COMPOSE_PROJECT_NAME="${PROJECT_NAME}"

echo "Stopping harness project '${PROJECT_NAME}' (containers + anonymous orphans)..."
docker compose -f "${COMPOSE_FILE}" -p "${PROJECT_NAME}" down --volumes --remove-orphans

# Belt-and-suspenders: only remove explicitly named harness resources if still present.
if docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "Removing leftover harness container ${CONTAINER_NAME}..."
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

if docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
  echo "Removing leftover harness volume ${VOLUME_NAME}..."
  docker volume rm "${VOLUME_NAME}" >/dev/null
fi

if docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  echo "Removing leftover harness network ${NETWORK_NAME}..."
  docker network rm "${NETWORK_NAME}" >/dev/null || true
fi

echo "OK: harness cleaned up (project=${PROJECT_NAME})"
