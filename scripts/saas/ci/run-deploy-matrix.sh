#!/usr/bin/env bash
# Compatibility of every INTERMEDIATE deployment state. DISPOSABLE stack only (refuses a hosted database).
#
# Two releases are deployed separately (docs/ops/COMBINED_DEPLOYMENT_AND_ROLLBACK.md):
#   Release A, the repair release (PR #111):   migrations r1..r4 (M1-M4). Backend first.
#   Release B, the SaaS release (PR #113):     migrations t1..t8. Migrations are additive.
# This script walks ONE database through every step of both releases, one migration at a time (starting from the schema before M1), and after EVERY step
# runs the same single-company workflow smoke (login, lead, quotation, contract, invoice, payment, PDF, document upload and byte-identical download)
# against BOTH backend builds that may be running in that state:
#   NEW     this repository's build, multi-company flag OFF (the single-company deployment as it is today)
#   REPAIR  the build of the repair release (PR #111), when REPAIR_BUNDLE points at its server bundle (optional; needs a build of that commit)
# Backend-first is the NEW column on a schema that is behind; migrations-first is the REPAIR column on a schema that is ahead.
#
#   CI_PG="-h /srv/saas-c1 -p 55651 -U postgres" POSTGREST_MODE=binary POSTGREST_BIN=/path/postgrest [REPAIR_BUNDLE=/repo/.matrix/repair.cjs] \
#     bash scripts/saas/ci/run-deploy-matrix.sh
# Needs the template database (scripts/saas/tests/build-base.sh), dist/server.cjs (the NEW build), psql, node, openssl, Chromium (the PDF check).
set -uo pipefail
cd "$(dirname "$0")/../../.."
REPO="$PWD"
: "${CI_PG:?psql connection arguments without -d, for a DISPOSABLE server}"
case "$CI_PG" in *railway*|*supabase*|*rlwy*|*amazonaws*) echo "Refusing: looks like a hosted database." >&2; exit 2;; esac
export E2E_ADMIN="$CI_PG"
DB="${MATRIX_DB:-t_deploy_matrix}"
NEW_PORT="${MATRIX_NEW_PORT:-3187}"; REPAIR_PORT="${MATRIX_REPAIR_PORT:-3186}"; PGRST_PORT="${MATRIX_PGRST_PORT:-54389}"; S3_PORT="${MATRIX_S3_PORT:-9489}"
REPORT_DIR="${REPORT_DIR:-$REPO/ci-report-matrix}"
WORK="$(mktemp -d)"; mkdir -p "$REPORT_DIR"; : > "$REPORT_DIR/matrix.md"
POSTGREST_MODE="${POSTGREST_MODE:-docker}"
POSTGREST_IMAGE="${POSTGREST_IMAGE:-postgrest/postgrest:v16.4@sha256:d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df}"
export TEST_PW="${TEST_PW:-$(openssl rand -hex 12)Aa1!}"
PIDS=(); PGRST_CONTAINER=""
emit_failures_to_pg() { # CI only (CI_REPORT_TO_PG=1): the hosted log API returns only the end of a job log, which is the database's own; see run-pilot-journeys.sh
  [ -n "${CI_REPORT_TO_PG:-}" ] && [ "${FAILED:-0}" != 0 ] || return 0
  local sql="do \$q\$ begin" line
  while IFS= read -r line; do sql="$sql raise warning 'MATRIX-FAILURE: %', \$t\$$(printf '%s' "$line" | tr '$' '#' | cut -c1-300)\$t\$;"; done < <({ cat "$REPORT_DIR/matrix.md"; grep -h -E "^FAIL" "$REPORT_DIR"/smoke-*.log 2>/dev/null | head -20; tail -5 "$REPORT_DIR/verify.log" 2>/dev/null; } | head -60)
  sql="$sql end \$q\$"
  psql $CI_PG -d postgres -qc "$sql" > /dev/null 2>&1 || true
}
cleanup() {
  emit_failures_to_pg
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  for i in $(seq 1 10); do alive=0; for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -0 "$p" 2>/dev/null && alive=1; done; [ "$alive" = 0 ] && break; sleep 1; done
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -9 "$p" 2>/dev/null || true; done
  [ -n "$PGRST_CONTAINER" ] && docker rm -f "$PGRST_CONTAINER" > /dev/null 2>&1 || true
  psql $CI_PG -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
die() { echo "FATAL: $*" >&2; exit 1; }
for port in "$NEW_PORT" "$REPAIR_PORT" "$PGRST_PORT" "$S3_PORT"; do (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && die "port $port is already in use"; done
[ -f dist/server.cjs ] || die "dist/server.cjs is not built"

parg() { echo "$CI_PG" | sed -nE "s/.*$1 ([^ ]+).*/\1/p"; }
PGH="$(parg -h)"; PGP="$(parg -p)"; PGU="$(parg -U)"; PGP="${PGP:-5432}"; PGU="${PGU:-postgres}"
export E2E_PSQL="$CI_PG -d $DB" PGHOST="$PGH" PGPORT="$PGP" PGUSER="$PGU" PGDATABASE="$DB"
runner() { node scripts/migrations/run.mjs "$@" --yes 2>&1; }

# ------------------------------------------------------------------ the schema BEFORE any migration of either release
bash scripts/saas/tests/build-base.sh > "$REPORT_DIR/build-base.log" 2>&1 || die "could not build the base schema"
bash scripts/saas/tests/mkdb.sh "$DB" > /dev/null || die "could not create $DB"
runner rollback --to r1-smart-quote-versions > "$REPORT_DIR/rollback-to-r0.log" || { tail -5 "$REPORT_DIR/rollback-to-r0.log"; die "could not roll the base back to the schema before M1"; }
node --import tsx scripts/saas/e2e/seed-founding-test-users.mjs > /dev/null || die "founding test users"
psql $CI_PG -d "$DB" -qc "create schema if not exists app; create table if not exists app.config (key text primary key, value text not null); insert into app.config values ('document_floor.sunchaser.invoice.$(date -u +%Y)','8') on conflict do nothing" || die "floor"
AUTH_PW="$(openssl rand -hex 12)"; psql $CI_PG -d "$DB" -qc "alter role authenticator password '$AUTH_PW'" || die "authenticator"

# ------------------------------------------------------------------ PostgREST, object store, backends
PGRST_SECRET="$(openssl rand -hex 32)"
SERVICE_KEY="$(node -e "console.log(require('jsonwebtoken').sign({role:'service_role'},process.argv[1],{expiresIn:'1d'}))" "$PGRST_SECRET")"
case "$PGH" in /*) DB_URI="postgres://authenticator:$AUTH_PW@/$DB?host=$PGH&port=$PGP" ;; *) DB_URI="postgres://authenticator:$AUTH_PW@$PGH:$PGP/$DB" ;; esac
if [ "$POSTGREST_MODE" = docker ]; then
  PGRST_CONTAINER="pgrst-matrix-$$"
  docker run -d --name "$PGRST_CONTAINER" --network host -e PGRST_DB_URI="$DB_URI" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$PGRST_SECRET" \
    -e PGRST_SERVER_HOST=127.0.0.1 -e PGRST_SERVER_PORT="$PGRST_PORT" "$POSTGREST_IMAGE" > /dev/null || die "PostgREST"
else
  printf 'db-uri = "%s"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "%s"\nserver-host = "127.0.0.1"\nserver-port = %s\n' "$DB_URI" "$PGRST_SECRET" "$PGRST_PORT" > "$WORK/pgrst.conf"
  "${POSTGREST_BIN:?set POSTGREST_BIN}" "$WORK/pgrst.conf" > "$REPORT_DIR/postgrest.log" 2>&1 & PIDS+=($!)
fi
for i in $(seq 1 40); do curl -s --noproxy '*' -o /dev/null "http://127.0.0.1:$PGRST_PORT/" && break; sleep 1; [ "$i" = 40 ] && die "PostgREST did not come up"; done
mkdir -p "$WORK/s3/objects"
SUDO=""; [ "$(id -u)" != 0 ] && SUDO="sudo"
grep -q "testbucket.s3.local" /etc/hosts || echo "127.0.0.1 s3.local testbucket.s3.local" | $SUDO tee -a /etc/hosts > /dev/null || die "hosts"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$WORK/s3/key.pem" -out "$WORK/s3/cert.pem" -days 2 -subj "/CN=s3.local" -addext "subjectAltName=DNS:s3.local,DNS:testbucket.s3.local" 2>/dev/null || die "certificate"
( cd "$WORK/s3" && exec env S3_PORT="$S3_PORT" node "$REPO/scripts/e2e-crm-repair/s3-mock.mjs" "$WORK/s3/objects" ) > "$REPORT_DIR/s3.log" 2>&1 & PIDS+=($!)
sleep 2
export RAILWAY_OBJECT_PROXY_SECRET="$(openssl rand -hex 32)" JWT_SECRET_VALUE="$(openssl rand -hex 32)"
start_backend() { # label port bundle
  local label="$1" port="$2" bundle="$3"
  ( export NODE_ENV=production PORT="$port" JWT_EXPIRES_IN=8h LOGIN_RATE_LIMIT_MAX=5000 RAILWAY_POSTGREST_URL="http://127.0.0.1:$PGRST_PORT" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"
    unset CRM_TENANT_POSTGREST_KEY MULTI_COMPANY_ENABLED
    export JWT_SECRET="$JWT_SECRET_VALUE" RAILWAY_S3_ENDPOINT="https://s3.local:$S3_PORT" RAILWAY_S3_BUCKET=testbucket RAILWAY_S3_ACCESS_KEY_ID=test RAILWAY_S3_SECRET_ACCESS_KEY=test RAILWAY_S3_REGION=auto
    export NODE_EXTRA_CA_CERTS="$WORK/s3/cert.pem" NO_PROXY='*' no_proxy='*'; unset https_proxy HTTPS_PROXY http_proxy HTTP_PROXY
    export WHATSAPP_CONVERSATIONS_ENABLED=true WHATSAPP_APP_SECRET="$(openssl rand -hex 24)" WHATSAPP_WEBHOOK_VERIFY_TOKEN="$(openssl rand -hex 12)" WHATSAPP_PHONE_NUMBER_ID=100000000000001
    export WHATSAPP_TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
    export WHATSAPP_AI_AUTO_REPLY_ENABLED=false WHATSAPP_AI_QUERY_DRAFT_ENABLED=false WHATSAPP_AI_LIVE_PROVIDER_ENABLED=false MARKETPLACE_ENABLED=false UNIFIED_MESSAGING_POSTGRES_ENABLED=false
    exec node "$bundle" ) > "$REPORT_DIR/app-$label.log" 2>&1 & PIDS+=($!)
  for i in $(seq 1 60); do curl -s --noproxy '*' "http://127.0.0.1:$port/health" | grep -q '"ok"' && return 0; sleep 1; done
  tail -10 "$REPORT_DIR/app-$label.log"; die "the $label backend did not come up"
}
start_backend new "$NEW_PORT" "dist/server.cjs"
HAVE_REPAIR=0
if [ -n "${REPAIR_BUNDLE:-}" ] && [ -f "$REPAIR_BUNDLE" ]; then start_backend repair "$REPAIR_PORT" "$REPAIR_BUNDLE"; HAVE_REPAIR=1; fi
export NODE_EXTRA_CA_CERTS="$WORK/s3/cert.pem" RAILWAY_S3_ENDPOINT="https://s3.local:$S3_PORT" RAILWAY_S3_BUCKET=testbucket RAILWAY_S3_ACCESS_KEY_ID=test RAILWAY_S3_SECRET_ACCESS_KEY=test RAILWAY_S3_REGION=auto

echo "# Intermediate deployment states" >> "$REPORT_DIR/matrix.md"
echo "Backends: NEW = this build, multi-company flag off; REPAIR = build of PR #111$([ $HAVE_REPAIR = 0 ] && echo ' (NOT RUN: no REPAIR_BUNDLE given)'). Each cell is the smoke's result: passed/failed checks." >> "$REPORT_DIR/matrix.md"
echo >> "$REPORT_DIR/matrix.md"; echo "| State (schema after this step) | NEW backend | REPAIR backend |" >> "$REPORT_DIR/matrix.md"; echo "|---|---|---|" >> "$REPORT_DIR/matrix.md"
FAILED=0
smoke() { # label port
  local out; out="$(STATE="$1" E2E_BASE_URL="http://127.0.0.1:$2" node --import tsx scripts/saas/e2e/deploy-state-smoke.mjs 2>&1)"; local rc=$?
  echo "$out" >> "$REPORT_DIR/smoke-$1.log"
  SMOKE_CELL="$(echo "$out" | grep -E '^SUMMARY' | sed -E 's/^SUMMARY \[[^]]*\]: //' | cut -c1-200)"
  [ $rc = 0 ] || { FAILED=$((FAILED+1)); echo "$out" | grep -E "^FAIL" | head -4 | sed 's/^/   | /'; }
  [ $rc = 0 ] && SMOKE_CELL="$(echo "$SMOKE_CELL" | sed -E 's/^([0-9]+ passed), 0 failed.*/\1, 0 failed/')"
}
step() { # label (state reached)
  psql $CI_PG -d "$DB" -qc "notify pgrst, 'reload schema'" > /dev/null; sleep 3
  local label="$1"; smoke "$label-new" "$NEW_PORT"; local n="$SMOKE_CELL"; local r="not run"
  [ $HAVE_REPAIR = 1 ] && { smoke "$label-repair" "$REPAIR_PORT"; r="$SMOKE_CELL"; }
  echo "$label: NEW $n | REPAIR $r"
  echo "| $label | $n | $r |" >> "$REPORT_DIR/matrix.md"
}
step "before M1 (schema before the repair release)"
for m in r1-smart-quote-versions r2-session-revocation r3-invoice-payments-integrity r4-invoice-save-atomic t1-company-foundation t1b-tenancy-barrier t2-ownership t3-document-numbering t4-company-settings t5-subscriptions t6-invoice-issuance-snapshot t7-company-admin t8-storage-reservations; do
  runner apply --to "$m" > "$REPORT_DIR/apply-$m.log" || { tail -5 "$REPORT_DIR/apply-$m.log"; die "could not apply $m"; }
  step "after $m"
done
# ------------------------------------------------------------------ informational: what a rollback of the BACKEND to the repair build does once the numbering has a gap
# The repair build numbers invoices by counting (count + 1); the SaaS build by a counter that is never behind the highest number held. If an invoice number is
# missing from the sequence (a deleted invoice, or a number reserved by a save that then failed), count + 1 is a number that exists: the repair build cannot
# create invoices until the gap is filled. This is shown here, not asserted (it is how the OLD build always behaved); the runbook turns it into a pre-rollback check.
GAP_ID="$(psql $CI_PG -d "$DB" -tAc "select id from invoices where company_id='sunchaser' and invoice_number ~ '^INV-' order by invoice_number limit 1")"
psql $CI_PG -d "$DB" -qc "set session_replication_role = replica; delete from invoice_payments where invoice_id='$GAP_ID'; delete from invoice_items where invoice_id='$GAP_ID'; delete from invoices where id='$GAP_ID'" > /dev/null
echo "" >> "$REPORT_DIR/matrix.md"; echo "## Informational: the first invoice of the sequence is deleted (a gap), then each build creates an invoice" >> "$REPORT_DIR/matrix.md"
smoke "gap-new" "$NEW_PORT"; GN="$SMOKE_CELL"; GR="not run"
[ $HAVE_REPAIR = 1 ] && { smoke "gap-repair" "$REPAIR_PORT"; GR="$SMOKE_CELL"; }
[ $HAVE_REPAIR = 1 ] && [ "$(echo "$GR" | grep -c " 0 failed")" = 0 ] && FAILED=$((FAILED-1))
echo "gap: NEW $GN | REPAIR $GR"; echo "| gap in the numbering | NEW $GN | REPAIR $GR |" >> "$REPORT_DIR/matrix.md"
[ "$(echo "$GN" | grep -c ' 0 failed')" = 1 ] || FAILED=$((FAILED+1))   # only the NEW build is required to survive a gap
# ------------------------------------------------------------------ the database barrier: once the tenancy marker is on, an older backend (and a flag-off process of the new build) is refused
# The rows above run with the marker OFF (nothing changes for anyone). Here the marker is switched on, as the operator does before the first pilot company, and both backends are
# asked to sign in. REPAIR has no isolation code at all: the DATABASE refuses it. NEW (flag off) pauses itself (and would be refused by the database anyway).
psql $CI_PG -d "$DB" -qc "select app.tenancy_enable()" > /dev/null; psql $CI_PG -d "$DB" -qc "notify pgrst, 'reload config'; notify pgrst, 'reload schema'" > /dev/null; sleep 8
echo "" >> "$REPORT_DIR/matrix.md"; echo "## With the tenancy marker ON (as before the first pilot company): sign-in on each backend" >> "$REPORT_DIR/matrix.md"
login_cell() { # port -> prints "refused (HTTP n)" or "SERVED"
  local code body; body="$(curl -s --noproxy '*' -m 20 -o /tmp/matrix-login.$$ -w '%{http_code}' -X POST "http://127.0.0.1:$1/api/auth/login" -H 'content-type: application/json' -d "{\"username\":\"t_admin\",\"password\":\"$TEST_PW\"}")"; code="$body"
  if grep -q '"token"' /tmp/matrix-login.$$ 2>/dev/null; then echo "SERVED"; else echo "refused (HTTP $code)"; fi; rm -f /tmp/matrix-login.$$
}
LN="$(login_cell "$NEW_PORT")"; LR="not run"; [ $HAVE_REPAIR = 1 ] && LR="$(login_cell "$REPAIR_PORT")"
echo "marker on: NEW $LN | REPAIR $LR"; echo "| marker on | NEW (flag off) $LN | REPAIR $LR |" >> "$REPORT_DIR/matrix.md"
[ "$LN" = SERVED ] && FAILED=$((FAILED+1)); [ "$LR" = SERVED ] && FAILED=$((FAILED+1))
node scripts/migrations/run.mjs verify > "$REPORT_DIR/verify.log" 2>&1 || { tail -5 "$REPORT_DIR/verify.log"; FAILED=$((FAILED+1)); }
echo; [ "$FAILED" = 0 ] && echo "All states passed." || echo "$FAILED state(s) FAILED."
cat "$REPORT_DIR/matrix.md"
[ "$FAILED" = 0 ]
