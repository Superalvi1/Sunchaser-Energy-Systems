#!/usr/bin/env bash
# Builds a DISPOSABLE multi-company stack and runs the main two-company journeys against it: black-box API journeys, real-Chromium PDFs read
# back as bytes, and real-browser journeys of the interface. Used by CI (job "pilot-journeys") and runnable locally.
#
# The stack: PostgreSQL (the CI service container, or any scratch server), PostgREST (the pinned image, or a local binary), an S3-compatible
# store over HTTPS (scripts/e2e-crm-repair/s3-mock.mjs), and the built application (dist/server.cjs) with MULTI_COMPANY_ENABLED=true.
# Everything is synthetic; nothing here talks to a hosted service. Refuses a database that looks hosted.
#
# Requires: dist/ built with an EMPTY VITE_API_BASE_URL (npx vite build, then esbuild server.ts -> dist/server.cjs), psql, node, poppler-utils
# (pdftotext, pdfimages, pdfinfo), Chromium for Playwright, and either docker (POSTGREST_MODE=docker, default) or a PostgREST binary.
#
#   CI_PG="-h 127.0.0.1 -p 5432 -U postgres" PGPASSWORD=postgres bash scripts/saas/ci/run-pilot-journeys.sh
#   (locally: CI_PG="-h /srv/saas-c1 -p 55651 -U postgres" POSTGREST_MODE=binary POSTGREST_BIN=/path/postgrest ...)
#
# Exit status is 0 only if every journey passed. Logs: $REPORT_DIR/<journey>.log and $REPORT_DIR/summary.md.
set -uo pipefail
cd "$(dirname "$0")/../../.."
REPO="$PWD"

: "${CI_PG:?psql connection arguments without -d, for a DISPOSABLE server}"
case "$CI_PG" in *railway*|*supabase*|*rlwy*|*amazonaws*) echo "Refusing: looks like a hosted database." >&2; exit 2;; esac
export E2E_ADMIN="$CI_PG"
DB="${CI_DB:-t_ci_stack}"
APP_PORT="${APP_PORT:-3199}"; APP2_PORT="${APP2_PORT:-3197}"; PGRST_PORT="${PGRST_PORT:-54399}"; S3_PORT="${S3_PORT:-9499}"
REPORT_DIR="${REPORT_DIR:-$REPO/ci-report-stack}"
WORK="$(mktemp -d)"
POSTGREST_MODE="${POSTGREST_MODE:-docker}"
POSTGREST_IMAGE="${POSTGREST_IMAGE:-postgrest/postgrest:v16.4@sha256:d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df}"  # docs/ops/POSTGREST_PIN.md
export TEST_PW="${TEST_PW:-$(openssl rand -hex 12)Aa1!}"  # throw-away password of the synthetic users
mkdir -p "$REPORT_DIR"; : > "$REPORT_DIR/summary.md"
PIDS=(); PGRST_CONTAINER=""
cleanup() {
  # The application drains on SIGTERM and can outlive the script: ask, wait up to 10 seconds, then force. A survivor would keep the port, and
  # the next run would silently test the old process.
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  for i in $(seq 1 10); do alive=0; for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -0 "$p" 2>/dev/null && alive=1; done; [ "$alive" = 0 ] && break; sleep 1; done
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -9 "$p" 2>/dev/null || true; done
  [ -n "$PGRST_CONTAINER" ] && docker rm -f "$PGRST_CONTAINER" > /dev/null 2>&1 || true
  psql $CI_PG -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
say() { echo "== $*"; }
die() { echo "FATAL: $*" >&2; { echo "**Stack could not be built:** $*"; } >> "$REPORT_DIR/summary.md"; exit 1; }

# Refuse to run against something that is already listening: a stale process would be tested instead of this build.
for port in "$APP_PORT" "$APP2_PORT" "$PGRST_PORT" "$S3_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then die "port $port is already in use (a previous run's process?)"; fi
done

[ -f dist/server.cjs ] && [ -f dist/index.html ] || die "dist/ is not built (vite build with an empty VITE_API_BASE_URL, then esbuild server.ts)."

# ---------------------------------------------------------------------------------------------------------------------------------- database
say "database $DB"
bash scripts/saas/tests/build-base.sh > "$REPORT_DIR/build-base.log" 2>&1 || { tail -5 "$REPORT_DIR/build-base.log"; die "could not build the base schema"; }
bash scripts/saas/tests/mkdb.sh "$DB" > /dev/null || die "could not create $DB"
parg() { echo "$CI_PG" | sed -nE "s/.*$1 ([^ ]+).*/\1/p"; }
PGH="$(parg -h)"; PGP="$(parg -p)"; PGU="$(parg -U)"; PGP="${PGP:-5432}"; PGU="${PGU:-postgres}"
export E2E_PSQL="$CI_PG -d $DB" E2E_BASE_URL="http://127.0.0.1:$APP_PORT"
export PGHOST="$PGH" PGPORT="$PGP" PGUSER="$PGU" PGDATABASE="$DB"
# the founding company's synthetic users exist BEFORE the tenant migrations, which give them their memberships
node --import tsx scripts/saas/e2e/seed-founding-test-users.mjs || die "could not seed the founding test users"
# owner decision the invoice-numbering migration insists on: the last number ever issued (synthetic here)
psql $CI_PG -d "$DB" -qc "create schema if not exists app; create table if not exists app.config (key text primary key, value text not null); insert into app.config values ('document_floor.sunchaser.invoice.$(date -u +%Y)','8') on conflict do nothing" || die "floor"
node scripts/migrations/run.mjs apply --yes > "$REPORT_DIR/migrations.log" 2>&1 || { tail -8 "$REPORT_DIR/migrations.log"; die "migrations failed"; }
node scripts/migrations/run.mjs verify >> "$REPORT_DIR/migrations.log" 2>&1 || { tail -8 "$REPORT_DIR/migrations.log"; die "migration verification failed"; }
AUTH_PW="$(openssl rand -hex 12)"
psql $CI_PG -d "$DB" -qc "alter role authenticator password '$AUTH_PW'" || die "authenticator password"

# ------------------------------------------------------------------------------------------------------------------------------- PostgREST
say "PostgREST ($POSTGREST_MODE)"
PGRST_SECRET="$(openssl rand -hex 32)"
SERVICE_KEY="$(node -e "console.log(require('jsonwebtoken').sign({role:'service_role'},process.argv[1],{expiresIn:'1d'}))" "$PGRST_SECRET")"
TENANT_KEY="$(PGRST_JWT_SECRET="$PGRST_SECRET" node scripts/saas/make-tenant-key.mjs --days 1)"
case "$PGH" in
  /*) DB_URI="postgres://authenticator:$AUTH_PW@/$DB?host=$PGH&port=$PGP" ;;
  *)  DB_URI="postgres://authenticator:$AUTH_PW@$PGH:$PGP/$DB" ;;
esac
if [ "$POSTGREST_MODE" = docker ]; then
  PGRST_CONTAINER="pgrst-$$"
  docker run -d --name "$PGRST_CONTAINER" --network host \
    -e PGRST_DB_URI="$DB_URI" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$PGRST_SECRET" \
    -e PGRST_SERVER_HOST=127.0.0.1 -e PGRST_SERVER_PORT="$PGRST_PORT" "$POSTGREST_IMAGE" > /dev/null || die "could not start PostgREST"
else
  cat > "$WORK/pgrst.conf" <<CONF
db-uri = "$DB_URI"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$PGRST_SECRET"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
CONF
  "${POSTGREST_BIN:?set POSTGREST_BIN}" "$WORK/pgrst.conf" > "$REPORT_DIR/postgrest.log" 2>&1 & PIDS+=($!)
fi
for i in $(seq 1 40); do curl -s --noproxy '*' -o /dev/null "http://127.0.0.1:$PGRST_PORT/" && break; sleep 1; [ "$i" = 40 ] && { [ -n "$PGRST_CONTAINER" ] && docker logs "$PGRST_CONTAINER" 2>&1 | tail -5; die "PostgREST did not come up"; }; done

# ----------------------------------------------------------------------------------------------------------------------- object store (HTTPS)
say "object store"
mkdir -p "$WORK/s3/objects"
SUDO=""; [ "$(id -u)" != 0 ] && SUDO="sudo"
grep -q "testbucket.s3.local" /etc/hosts || echo "127.0.0.1 s3.local testbucket.s3.local" | $SUDO tee -a /etc/hosts > /dev/null || die "could not add s3.local to /etc/hosts"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$WORK/s3/key.pem" -out "$WORK/s3/cert.pem" -days 2 -subj "/CN=s3.local" -addext "subjectAltName=DNS:s3.local,DNS:testbucket.s3.local" 2>/dev/null || die "certificate"
( cd "$WORK/s3" && exec env S3_PORT="$S3_PORT" node "$REPO/scripts/e2e-crm-repair/s3-mock.mjs" "$WORK/s3/objects" ) > "$REPORT_DIR/s3.log" 2>&1 & PIDS+=($!)  # exec: the recorded pid IS the node process
sleep 2

# -------------------------------------------------------------------------------------------------------------------------------- application
say "application on :$APP_PORT"
export RAILWAY_OBJECT_PROXY_SECRET="$(openssl rand -hex 32)"  # shared by the application and by the journeys that read the object store
export E2E_S3_DIR="$WORK/s3/objects"
# the journeys that read the object store directly (company restore) need the same settings the application has
export RAILWAY_S3_ENDPOINT="https://s3.local:$S3_PORT" RAILWAY_S3_BUCKET=testbucket RAILWAY_S3_ACCESS_KEY_ID=test RAILWAY_S3_SECRET_ACCESS_KEY=test RAILWAY_S3_REGION=auto NODE_EXTRA_CA_CERTS="$WORK/s3/cert.pem"
JWT_SECRET_VALUE="$(openssl rand -hex 32)"
# run-app.sh <port> <true|false> [KEY=VALUE ...]: the application's environment in one place, so that a journey can start (and restart) a process of its own - the
# restart journeys do. Execs node; the recorded pid IS the application.
cat > "$WORK/run-app.sh" <<APPSH
#!/usr/bin/env bash
cd "$REPO"
port="\$1"; multi="\$2"; shift 2
export NODE_ENV=production PORT="\$port" JWT_EXPIRES_IN=8h LOGIN_RATE_LIMIT_MAX=5000
export RAILWAY_POSTGREST_URL="http://127.0.0.1:$PGRST_PORT" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"
if [ "\$multi" = true ]; then export CRM_TENANT_POSTGREST_KEY="$TENANT_KEY" MULTI_COMPANY_ENABLED=true; else unset CRM_TENANT_POSTGREST_KEY MULTI_COMPANY_ENABLED; fi
export JWT_SECRET="$JWT_SECRET_VALUE" RAILWAY_OBJECT_PROXY_SECRET="$RAILWAY_OBJECT_PROXY_SECRET"
export RAILWAY_S3_ENDPOINT="https://s3.local:$S3_PORT" RAILWAY_S3_BUCKET=testbucket RAILWAY_S3_ACCESS_KEY_ID=test RAILWAY_S3_SECRET_ACCESS_KEY=test RAILWAY_S3_REGION=auto
export NODE_EXTRA_CA_CERTS="$WORK/s3/cert.pem" NO_PROXY='*' no_proxy='*'
unset https_proxy HTTPS_PROXY http_proxy HTTP_PROXY
export STORAGE_USAGE_CACHE_MS=2000 STORAGE_LIMIT_CACHE_MS=2000   # short caches so the storage journey does not wait out the production defaults (60 s / 15 s)
export WHATSAPP_CONVERSATIONS_ENABLED=true WHATSAPP_APP_SECRET="\$(openssl rand -hex 24)" WHATSAPP_WEBHOOK_VERIFY_TOKEN="\$(openssl rand -hex 12)" WHATSAPP_PHONE_NUMBER_ID=100000000000001
export WHATSAPP_TOKEN_ENCRYPTION_KEY="\$(openssl rand -base64 32)"
export WHATSAPP_AI_AUTO_REPLY_ENABLED=false WHATSAPP_AI_QUERY_DRAFT_ENABLED=false WHATSAPP_AI_LIVE_PROVIDER_ENABLED=false MARKETPLACE_ENABLED=false UNIFIED_MESSAGING_POSTGRES_ENABLED=false
for kv in "\$@"; do export "\$kv"; done
exec node "\${APP_BUNDLE:-dist/server.cjs}"
APPSH
chmod +x "$WORK/run-app.sh"; export E2E_RUN_APP="$WORK/run-app.sh"
# start_app <port> <multi-company true|false> <log file> [KEY=VALUE ...]: With multi-company "false" the flag and the tenant key are NOT set - the deployment
# as it is today (single company), on the same migrated database.
start_app() {
  local port="$1" multi="$2" log="$3"; shift 3
  "$WORK/run-app.sh" "$port" "$multi" "$@" > "$log" 2>&1 & PIDS+=($!); LAST_APP_PID=$!
  for i in $(seq 1 60); do curl -s --noproxy '*' "http://127.0.0.1:$port/health" | grep -q '"ok"' && return 0; sleep 1; done
  tail -15 "$log"; die "the application on :$port did not come up"
}
start_app "$APP_PORT" true "$REPORT_DIR/app.log"; APP1_PID="$LAST_APP_PID"
# A SECOND process of the same build against the same database, for the journeys that prove the storage limit holds across server processes.
# Its pending storage reservations expire after 12 s (production default 180 s) so the journey can show that a killed process stops counting.
start_app "$APP2_PORT" true "$REPORT_DIR/app2.log" STORAGE_RESERVATION_TTL_SECONDS=12; APP2_PID="$LAST_APP_PID"
export E2E_BASE_URL_2="http://127.0.0.1:$APP2_PORT" E2E_APP1_PID="$APP1_PID" E2E_APP2_PID="$APP2_PID" E2E_APP1_LOG="$REPORT_DIR/app.log" E2E_APP2_LOG="$REPORT_DIR/app2.log"
echo "stack up: PostgreSQL $(psql $CI_PG -d "$DB" -tAc 'show server_version'), PostgREST ($POSTGREST_MODE), app on :$APP_PORT"

# ------------------------------------------------------------------------------------------------------------------------------- journeys
{ echo "## Pilot journeys"; echo; echo "Stack: PostgreSQL $(psql $CI_PG -d "$DB" -tAc 'show server_version'), PostgREST (\`$POSTGREST_MODE\`), built SPA + server bundle, MULTI_COMPANY_ENABLED=true."; echo; echo "| Journey | Result | Seconds | What it proves |"; echo "|---|---|---|---|"; } > "$REPORT_DIR/summary.md"
FAILED=0
# The journeys start from clean companies. Resetting them changes memberships behind the application's back, and the application caches
# memberships, companies and subscriptions for 5 seconds; wait that out so a journey never reads the previous journey's cache.
reseed() { node --import tsx scripts/saas/e2e/seed-two-companies.mjs --cleanup > /dev/null 2>&1; node --import tsx scripts/saas/e2e/seed-two-companies.mjs > "$REPORT_DIR/seed.log" 2>&1 || { tail -3 "$REPORT_DIR/seed.log"; die "seeding failed"; }; sleep 6; }
journey() { # name, command..., (the description is in $DESC)
  local name="$1"; shift
  # JOURNEYS="name1,name2" runs only those (for diagnosing one journey); unset runs all, which is what CI does.
  if [ -n "${JOURNEYS:-}" ] && ! echo ",$JOURNEYS," | grep -q ",$name,"; then return 0; fi
  # JOURNEY_REPEAT=N runs each selected journey N times (reseeding every time), keeping every log: for catching an intermittent failure.
  local n total="${JOURNEY_REPEAT:-1}" suffix=""
  for n in $(seq 1 "$total"); do
    [ "$total" -gt 1 ] && suffix=".$n"
    # a journey may kill the second process on purpose (storage-two-instances); bring it back so the next repeat starts from two processes
    if ! kill -0 "$APP2_PID" 2>/dev/null; then start_app "$APP2_PORT" true "$REPORT_DIR/app2.log" STORAGE_RESERVATION_TTL_SECONDS=12; APP2_PID="$LAST_APP_PID"; export E2E_APP2_PID="$APP2_PID"; fi
    reseed
    local t0=$SECONDS
    echo "-- $name$suffix"
    if "$@" > "$REPORT_DIR/$name$suffix.log" 2>&1; then r="pass"; else r="FAIL"; FAILED=$((FAILED+1)); tail -12 "$REPORT_DIR/$name$suffix.log" | sed 's/^/   | /'; fi
    local tail_line; tail_line="$(grep -E '[0-9]+ passed, [0-9]+ failed|passed.*failed' "$REPORT_DIR/$name$suffix.log" | tail -1)"
    echo "$name$suffix: $r ${tail_line:+($tail_line)}"
    echo "| \`$name$suffix\` | $r${tail_line:+ — $tail_line} | $((SECONDS - t0)) | $DESC |" >> "$REPORT_DIR/summary.md"
  done
}
export OUT_DIR="$REPORT_DIR/screens"; mkdir -p "$OUT_DIR"
node --import tsx scripts/saas/e2e/reset-founding-test-passwords.mjs > /dev/null 2>&1 || true

DESC="two companies run lead to quotation to invoice to payment; every cross-company read, write and PDF attempt is refused" journey two-company-api node scripts/saas/e2e/two-company-api.mjs
DESC="whole flow for two companies at the same time, attacks on each other's records, PDFs and files, canary sweep, database integrity" journey two-company-complete node scripts/saas/e2e/two-company-complete.mjs
DESC="per-company branding, bank accounts, terms and prices; quotations keep the settings they were saved with" journey company-settings node scripts/saas/e2e/company-settings.mjs
DESC="real Chromium PDFs per company, read back as bytes (text, logo, amounts), no other company or Sunchaser identity" journey pdf-render node --import tsx scripts/saas/e2e/pdf-render.mjs
DESC="operator onboarding, manual subscriptions, enforced plan limits, operator audit trail" journey platform-onboarding node scripts/saas/e2e/platform-onboarding.mjs
DESC="invoice issuance snapshot and legacy label, local QR, AutoSizer and after-sales refused, subscription expiry at request time, storage limit, settings permissions and history" journey pilot-round3 node scripts/saas/e2e/pilot-round3.mjs
DESC="every disabled module (AutoSizer, after-sales, WhatsApp inbox, design tools, AI) answers 404 to the real pilot users - administrators, sales, portal customers - before any handler runs" journey disabled-modules node scripts/saas/e2e/disabled-modules.mjs
DESC="storage limit: concurrent uploads at the boundary, every upload route, usage that cannot be verified (fail closed, retryable), no limit set" journey storage-quota node scripts/saas/e2e/storage-quota.mjs
DESC="storage limit across TWO server processes: 24 uploads of mixed routes at the boundary race over both, failed writes give their room back, a deleted file frees exactly its room, a database refusal fails closed, a process killed mid-upload stops counting after its reservation expires" journey storage-two-instances node scripts/saas/e2e/storage-two-instances.mjs
DESC="72 contracts of two companies at the same instant: every one succeeds and provisions its own invoice (row ids no longer collide on the clock; found by the restore journey)" journey concurrent-contracts node scripts/saas/e2e/concurrent-contracts.mjs
DESC="customer codes at insert time: forced real unique-index collisions (1, 2, 4, and more than the bound), 30 simultaneous requests of two companies, the invoice route; bounded retry, no orphan rows" journey customer-code-collisions node scripts/saas/e2e/customer-code-collisions.mjs
DESC="company restore leaves every other company and the founding company byte-identical" journey company-restore node --import tsx scripts/saas/e2e/company-restore.mjs
DESC="deploy order: the new backend keeps working on a database where migrations t6 and t7 are not applied yet (they are rolled back, checked, re-applied)" journey compat-before-t6-t7 node scripts/saas/e2e/compat-before-t6-t7.mjs
DESC="rollback keeps files and quota accounting: t8 alone (fails closed meanwhile, boundary identical after re-apply) and every tenant migration t8..t1 (objects, document rows and invoices byte-identical, limit and downloads intact after re-apply)" journey rollback-files-quota node scripts/saas/e2e/rollback-files-quota.mjs
DESC="company selection and Switch company in a real browser" journey browser-company-ui node scripts/saas/e2e/browser-company-ui.mjs
DESC="settings screen: bank account edit and delete with confirmation, history with the values before and after, a non-administrator read-only; customer portal and welcome guide with and without logo/phone/review link (no Sunchaser identity); unfinished modules not offered" journey browser-pilot-round4 node scripts/saas/e2e/browser-pilot-round4.mjs
DESC="storage limit in the browser (refusal at the limit, retryable message with Retry upload when the store cannot be checked, earlier files still download) and the per-lead design tools for one lead and quotation: absent in the pilot UI and never called, present for the founding company, 404 not_available from the API" journey browser-pilot-round5 node --import tsx scripts/saas/e2e/browser-pilot-round5.mjs
DESC="Sunchaser Sync on sign-in and company selection, company branding in the workspace, settings screen and history, hidden modules, founding company unchanged" journey browser-pilot-round3 node scripts/saas/e2e/browser-pilot-round3.mjs

# ----------------------------------------------------------------------------- flag-off equivalence (the deployment as it is today)
# A second instance of the SAME build on the SAME migrated database, started WITHOUT the multi-company flag and without the tenant key: what a
# single-company deployment sees must not change. Run after the multi-company journeys, so the migrations are in place when the flag is off.
OFF_PORT="${FLAG_OFF_PORT:-3198}"
if (exec 3<>"/dev/tcp/127.0.0.1/$OFF_PORT") 2>/dev/null; then die "port $OFF_PORT is already in use"; fi
node --import tsx scripts/saas/e2e/reset-founding-test-passwords.mjs > /dev/null 2>&1 || true
start_app "$OFF_PORT" false "$REPORT_DIR/app-flag-off.log"
off_journey() { # same reporting as journey(), against the flag-off instance
  local name="$1"; shift
  if [ -n "${JOURNEYS:-}" ] && ! echo ",$JOURNEYS," | grep -q ",$name,"; then return 0; fi
  local t0=$SECONDS
  echo "-- $name (flag off)"
  if E2E_BASE_URL="http://127.0.0.1:$OFF_PORT" "$@" > "$REPORT_DIR/$name.log" 2>&1; then r="pass"; else r="FAIL"; FAILED=$((FAILED+1)); tail -12 "$REPORT_DIR/$name.log" | sed 's/^/   | /'; fi
  local tail_line; tail_line="$(grep -E '[0-9]+ passed, [0-9]+ failed|passed.*failed' "$REPORT_DIR/$name.log" | tail -1)"
  echo "$name: $r ${tail_line:+($tail_line)}"
  echo "| \`$name\` | $r${tail_line:+ — $tail_line} | $((SECONDS - t0)) | $DESC |" >> "$REPORT_DIR/summary.md"
}
export E2E_BASE_URL_ON="http://127.0.0.1:$APP_PORT" E2E_REPORT_DIR="$REPORT_DIR"
[ -n "${REPAIR_BUNDLE:-}" ] && [ -f "$REPAIR_BUNDLE" ] && export E2E_REPAIR_BUNDLE="$REPAIR_BUNDLE"   # optional: the repair build, to MEASURE what an older backend shows
[ -z "${JOURNEYS:-}" ] || echo ",$JOURNEYS," | grep -q ",feature-disable-reenable," && reseed   # clean pilot companies for the next journey
DESC="the switch OFF while pilot companies exist (a flag-off process of the same build) PAUSES: founding and pilot sessions are refused with the maintenance error, nothing is read or written; the pilot's files, rows and quota are untouched and served again when it is switched on" off_journey feature-disable-reenable node scripts/saas/e2e/feature-disable-reenable.mjs
# Company isolation independent of the flag: the journey starts and restarts flag-off processes of its own, rolls schema back and forward, removes the pilot companies and proves the process resumes.
DESC="isolation independent of the flag: with pilot data present a flag-off process serves nothing (reads, searches, exports, PDFs, file downloads, writes, sign-in, webhook; founding, pilot and earlier sessions), across a restart, after schema rollback t8..t3, and when the database cannot be reached; flag-on sessions issued before still work isolated; resumes by itself once the pilot data is removed" journey tenant-isolation-guard node scripts/saas/e2e/tenant-isolation-guard.mjs
# The single-company deployment as it is today is only legitimate on a database with the founding company alone: remove the pilot companies, wait for the flag-off process to notice.
if [ -z "${JOURNEYS:-}" ] || echo ",$JOURNEYS," | grep -qE ",(single-company-smoke|flag-off-round3),"; then
  node --import tsx scripts/saas/e2e/seed-two-companies.mjs --cleanup > /dev/null 2>&1
  for i in $(seq 1 30); do curl -s --noproxy '*' "http://127.0.0.1:$OFF_PORT/health" | grep -q '"paused":false' && break; sleep 1; done
  node --import tsx scripts/saas/e2e/reset-founding-test-passwords.mjs > /dev/null 2>&1 || true
fi
DESC="flag off (single-company mode) on the migrated database: login, lead, quotation, contract, invoice, payment, PDF as before; no company fields in any response" off_journey single-company-smoke node scripts/saas/e2e/single-company-smoke.mjs
DESC="flag off: no module flags, no identity mark, AutoSizer, after-sales, WhatsApp inbox and design tools all available as before, Sunchaser sign-in kept, uploads unmetered" off_journey flag-off-round3 node scripts/saas/e2e/flag-off-round3.mjs

echo; echo "$([ "$FAILED" = 0 ] && echo "All journeys passed." || echo "$FAILED journey(s) FAILED.")" | tee -a "$REPORT_DIR/summary.md"
cat "$REPORT_DIR/summary.md"
[ "$FAILED" = 0 ]
