#!/usr/bin/env bash
# Runs the CRM repair journeys against a DISPOSABLE stack made by scripts/e2e-crm-repair/isolated-stack.sh (synthetic data only), with the PostgREST
# binary of your choice, so the same journeys can be repeated for every PostgREST version you consider (12.2.3 was the original test version;
# production pulls `latest`, which was v16.4 from 24 Sep 2026).
#
#   TEST_PW=... E2E_STACK_DIR=/srv/e2e-x E2E_PG_PORT=... E2E_PGRST_PORT=... E2E_APP_PORT=3620 POSTGREST_BIN=/path/postgrest \
#   BUNDLE=dist/server.cjs [MIGRATIONS=yes] bash scripts/rehearsal/run-journeys.sh
#
# Prerequisites: the stack exists and its PostgreSQL is running; the web UI is built (VITE_API_BASE_URL= npx vite build) and the server bundle exists.
# It (re)starts PostgREST and two app instances, runs the journeys, writes PASS/FAIL counts, and stops what it started (by PID).
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$REPO"
: "${TEST_PW:?}" "${E2E_STACK_DIR:?}" "${E2E_PG_PORT:?}" "${E2E_PGRST_PORT:?}" "${E2E_APP_PORT:?}" "${POSTGREST_BIN:?}" "${BUNDLE:?}"
case "$E2E_STACK_DIR" in /srv/e2e-*) ;; *) echo "refusing: E2E_STACK_DIR must be a /srv/e2e-* scratch directory"; exit 2;; esac
OUT="${OUT_DIR:-$E2E_STACK_DIR/journey-results}"; mkdir -p "$OUT"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
if [ "${MIGRATIONS:-yes}" = yes ]; then
  for f in session-revocation-schema invoice-payments-integrity invoice-save-atomic; do
    psql -h "$E2E_STACK_DIR" -p "$E2E_PG_PORT" -U postgres -d sunchaser_test -X -q -v ON_ERROR_STOP=1 -f "scripts/$f.sql" >/dev/null 2>&1 || echo "NOTE: $f not applied (already applied or failed)"
  done
fi
# PostgREST with the requested binary (same config file and secrets as the stack). START_POSTGREST=no: the stack already started it; pass E2E_PGRST_PID.
if [ "${START_POSTGREST:-yes}" = yes ]; then
  (nohup "$POSTGREST_BIN" "$E2E_STACK_DIR/pgrst.conf" > "$OUT/postgrest.log" 2>&1 & echo $! > "$OUT/postgrest.pid"); PIDS+=("$(cat "$OUT/postgrest.pid")")
  sleep 3
else
  : "${E2E_PGRST_PID:?START_POSTGREST=no needs E2E_PGRST_PID}"; echo "$E2E_PGRST_PID" > "$OUT/postgrest.pid"; cp "$E2E_STACK_DIR/pgrst.log" "$OUT/postgrest.log" 2>/dev/null
fi
"$POSTGREST_BIN" --version | tee "$OUT/postgrest.version"
grep -E "Schema cache loaded" "$OUT/postgrest.log" | head -1 | sed 's/^[^S]*//' | tee "$OUT/postgrest.cachemsg"
start_app() { # port extra-env
  ( source "$E2E_STACK_DIR/env.sh"; env $2 PORT="$1" nohup node "$BUNDLE" > "$OUT/app-$1.log" 2>&1 & echo $! > "$OUT/app-$1.pid" ); PIDS+=("$(cat "$OUT/app-$1.pid")")
}
A1="$E2E_APP_PORT"; A2=$((E2E_APP_PORT + 1))
start_app "$A1" "SESSION_REFRESH_GRACE_SECONDS=3 SESSION_REVOCATION_REPROBE_MS=300 REFRESH_RATE_LIMIT_MAX=500"; start_app "$A2" "SESSION_REVOCATION_REPROBE_MS=300"
sleep 12; curl -s "http://127.0.0.1:$A1/health" | tee "$OUT/health.json"; echo
source "$E2E_STACK_DIR/env.sh"
export TEST_PW E2E_ENV_FILE="$E2E_STACK_DIR/env.sh" E2E_STATE_DIR="$OUT/state" E2E_BASE_URL="http://127.0.0.1:$A1" E2E_BASE_URL_2="http://127.0.0.1:$A2" \
  E2E_PSQL="-h $E2E_STACK_DIR -p $E2E_PG_PORT -U postgres -d sunchaser_test" E2E_PGRST_PID="$(cat "$OUT/postgrest.pid")" E2E_STACK_DIR POSTGREST_BIN
[ -n "${E2E_CHROMIUM:-}" ] && export E2E_CHROMIUM
TOTAL_FAIL=0
run() { # name script [env]
  env ${3:-} timeout 1200 node "scripts/e2e-crm-repair/$2.mjs" > "$OUT/$1.txt" 2>&1; rc=$?
  p=$(grep -c '^PASS' "$OUT/$1.txt"); f=$(grep -c '^FAIL' "$OUT/$1.txt")
  echo "$1: exit=$rc pass=$p fail=$f"; [ "$rc" = 0 ] || TOTAL_FAIL=$((TOTAL_FAIL + 1))
}
run j1-smartquote j1-smartquote; run j1-staff-crm j1-staff-crm; run j6-finance j6-finance; run link-portal link-portal
run j3-documents j3-documents; run j5-rename j5-rename; run j7-session j7-session; run j4-whatsapp j4-whatsapp
run j8-payment-concurrency j8-payment-concurrency; run j10-smartquote-link j10-smartquote-link; run final-verify final-verify "E2E_BASE_URL=http://127.0.0.1:$A2"
run j9-logout j9-logout
run j13-compat-matrix j13-compat-matrix "LABEL=compat-matrix"
run j12-atomic-edit j12-atomic-edit "ROUNDS=300 MODE=atomic"
ROUNDS=40 node scripts/e2e-crm-repair/two-instance-payments.mjs > "$OUT/two-instance-payments.txt" 2>&1; echo "two-instance-payments: $(tail -1 "$OUT/two-instance-payments.txt")"
grep -q '"overpaidRounds":0,"headerLedgerMismatchRounds":0' "$OUT/two-instance-payments.txt" || TOTAL_FAIL=$((TOTAL_FAIL + 1))
echo "== journeys with $(cat "$OUT/postgrest.version"): $TOTAL_FAIL failing journey(s)"
exit "$TOTAL_FAIL"
