#!/usr/bin/env bash
# Proves the company-ownership migration (phase2b) on a DISPOSABLE database built from a release-schema dump:
#   foundation -> tests FAIL (the released functions have the defects) -> phase2b twice (idempotent) -> tests PASS
#   -> rollback restores the released function definitions exactly and the tests fail again -> phase2b again -> PASS
#   E2E_ADMIN="-h /srv/s -p 55432 -U postgres" E2E_BASE_DUMP=/srv/s/release.dump bash scripts/saas/tests/test-ownership.sh
set -euo pipefail
: "${E2E_ADMIN:?}" "${E2E_BASE_DUMP:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; SAAS="$HERE/.."
DB="${OWN_DB:-t_own_$$}"
bash "$HERE/mkdb.sh" "$DB" > /dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true' EXIT
P="psql $E2E_ADMIN -d $DB -q -v ON_ERROR_STOP=1"; Q="psql $E2E_ADMIN -d $DB -tA"
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }
defs() { $Q -c "select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.oid::regprocedure::text)) from pg_proc p where p.oid in ('public.invoice_payments_before_insert()'::regprocedure, 'public.invoice_payments_before_update()'::regprocedure, 'public.invoice_save_atomic(text,timestamptz,jsonb,jsonb)'::regprocedure, 'app.assert_same_company()'::regprocedure)"; }
run_tests() { psql $E2E_ADMIN -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/ownership.test.sql" 2>&1; }
failed_of() { echo "$1" | sed -nE 's/^[0-9]+ passed, ([0-9]+) failed$/\1/p' | tail -1; }

$P -f "$SAAS/phase2-company-foundation.sql" > /dev/null 2>&1
BEFORE_DEFS="$(defs)"
OUT="$(run_tests)"; { echo "$OUT" | grep -E '^FAIL' | cut -c1-200 | sed 's/^/   before the fix: /' || true; }
check "before the fix the tests detect the defects ($(failed_of "$OUT") failing checks)" "$([ "$(failed_of "$OUT")" -gt 0 ] && echo yes || echo no)" yes

$P -f "$SAAS/phase2b-ownership.sql" > /dev/null 2>&1; check "phase2b applies" "$?" "0"
$P -f "$SAAS/phase2b-ownership.sql" > /dev/null 2>&1; check "phase2b applies a second time (idempotent)" "$?" "0"
OUT="$(run_tests)"; echo "$OUT" | grep -E '^FAIL' | cut -c1-250 || true
check "ownership tests after the fix: 0 failing ($(echo "$OUT" | grep -c '^PASS') passing)" "$(failed_of "$OUT")" "0"

$P -f "$SAAS/phase2b-ownership-rollback.sql" > /dev/null 2>&1; check "rollback applies" "$?" "0"
check "rollback restores the released function definitions exactly" "$(defs)" "$BEFORE_DEFS"
check "after rollback the tenant role cannot execute invoice_save_atomic again" "$($Q -c "select has_function_privilege('crm_tenant','public.invoice_save_atomic(text,timestamptz,jsonb,jsonb)','execute')")" "f"
OUT="$(run_tests)"; check "after rollback the tests fail again (they are not vacuous)" "$([ "$(failed_of "$OUT")" -gt 0 ] && echo yes || echo no)" yes
$P -f "$SAAS/phase2b-ownership.sql" > /dev/null 2>&1; check "phase2b re-applies after a rollback" "$?" "0"
OUT="$(run_tests)"; check "ownership tests pass again after re-apply" "$(failed_of "$OUT")" "0"
echo; echo "$ok passed, $bad failed"; [ "$bad" = 0 ]
