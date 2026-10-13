#!/usr/bin/env bash
# Company export/restore against a DISPOSABLE database (tenant migrations applied by the runner): restoring one company leaves every other
# company and the founding company byte-identical; tampered and foreign archives are refused. Database only (no object storage).
#   E2E_ADMIN="-h /srv/s -p 55432 -U postgres" bash scripts/saas/tests/test-company-restore.sh
set -euo pipefail
: "${E2E_ADMIN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$HERE/../../.."
DB="${RST_DB:-t_rst_$$}"
bash "$HERE/mkdb.sh" "$DB" > /dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true' EXIT
HOSTARG="$(echo "$E2E_ADMIN" | sed -nE 's/.*-h ([^ ]+).*/\1/p')"; PORTARG="$(echo "$E2E_ADMIN" | sed -nE 's/.*-p ([^ ]+).*/\1/p')"; USERARG="$(echo "$E2E_ADMIN" | sed -nE 's/.*-U ([^ ]+).*/\1/p')"
export PGHOST="$HOSTARG" PGPORT="${PORTARG:-5432}" PGUSER="${USERARG:-postgres}" PGDATABASE="$DB"
psql $E2E_ADMIN -d "$DB" -qc "create schema if not exists app; create table if not exists app.config (key text primary key, value text not null); insert into app.config values ('document_floor.sunchaser.invoice.$(date -u +%Y)','8') on conflict do nothing"
node "$REPO/scripts/migrations/run.mjs" apply --yes > /dev/null
cd "$REPO" && node --import tsx scripts/saas/tests/company-restore-db.mjs
