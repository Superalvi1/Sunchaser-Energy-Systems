#!/usr/bin/env bash
# J11: the whole payment-guard review in one run. Disposable stack only (isolated-stack.sh), app instance(s) already running.
#   source $E2E_STACK_DIR/env.sh; export TEST_PW=... E2E_BASE_URL_2=http://127.0.0.1:<second app port>
#   bash scripts/e2e-crm-repair/j11-run-all.sh        (ROUNDS=240 by default; SLOW=1 adds the 35 s busy test)
# Order matters: legacy data first (needs the seeded dirty rows), then the guard-on suites, then the destructive rollback/scale runs.
set -uo pipefail
cd "$(dirname "$0")/../.."
: "${E2E_PSQL:?source the stack env first}" "${E2E_BASE_URL_2:?second app instance}"
PSQL="psql $E2E_PSQL -X -q -v ON_ERROR_STOP=1"
rc=0; step() { echo; echo "=== $1"; shift; "$@" || rc=1; }

step "0. seed the dirty legacy dataset (once)" bash -c "[ \"\$($PSQL -tA -c \"select count(*) from invoices where id like 'dirty-d%'\")\" -gt 0 ] || $PSQL -f scripts/e2e-crm-repair/j11-dirty-dataset.sql"
step "1. preflight (read-only) on the dirty data" bash -c "psql $E2E_PSQL -X -f scripts/invoice-payments-preflight.sql | sed -n '1,30p'"
step "2. control: first writes to every legacy invoice kind WITHOUT the guard" bash -c "$PSQL -f scripts/invoice-payments-integrity-rollback.sql 2>/dev/null; LABEL=control node scripts/e2e-crm-repair/j11-legacy-data.mjs > \${E2E_STATE_DIR:-/tmp}/j11-legacy-control.txt; tail -1 \${E2E_STATE_DIR:-/tmp}/j11-legacy-control.txt | cut -c1-100"
step "3. apply the migration; original rows must be byte-identical" bash -c "$PSQL -f scripts/invoice-payments-integrity.sql 2>/dev/null && echo applied"
step "4. same first writes WITH the guard; expect zero differences" bash -c "LABEL=guard node scripts/e2e-crm-repair/j11-legacy-data.mjs > \${E2E_STATE_DIR:-/tmp}/j11-legacy-guard.txt; node scripts/e2e-crm-repair/j11-legacy-data.mjs --compare \${E2E_STATE_DIR:-/tmp}/j11-legacy-control.json \${E2E_STATE_DIR:-/tmp}/j11-legacy-guard.json | tail -3"
step "5. database-level unit checks" bash -c "psql $E2E_PSQL -X -q -o /dev/null -v ON_ERROR_STOP=1 -f scripts/e2e-crm-repair/j11-db-level.sql 2>&1 | grep -c PASS"
step "6. duplicates / boundaries / rounding / huge values" node --import tsx scripts/e2e-crm-repair/j11-duplicates.mjs
step "7. transaction semantics, busy, serialization, deadlock" node scripts/e2e-crm-repair/j11-txn.mjs
step "8. security" node scripts/e2e-crm-repair/j11-security.mjs
step "9. mixed-operation stress, two instances, lock monitor" env ROUNDS="${ROUNDS:-240}" node scripts/e2e-crm-repair/j11-guard-stress.mjs
step "10. revision 1 vs revision 2 probes" node scripts/e2e-crm-repair/j11-rev1-regressions.mjs
step "11. apply twice / use / roll back / re-apply" bash scripts/e2e-crm-repair/j11-rollback.sh
step "12. 100k-invoice apply/rollback timing and per-write overhead" node scripts/e2e-crm-repair/j11-scale.mjs
echo; [ "$rc" = 0 ] && echo "J11 ALL STEPS EXITED 0" || echo "J11: at least one step failed"
exit $rc
