#!/usr/bin/env bash
# Creates a fresh pre-migration scratch database with legacy-style data: new-exp-db.sh <name>   (needs E2E_STACK_DIR, E2E_PG_PORT)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
bash "$HERE/build-premigration-db.sh" "$1" | tail -1
psql -h "$E2E_STACK_DIR" -p "$E2E_PG_PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f "$HERE/seed-legacy.sql"
