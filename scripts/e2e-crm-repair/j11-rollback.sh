#!/usr/bin/env bash
# J11: apply twice -> use the app with the guard -> roll back -> compare. Disposable stack only.
# Needs the stack env (source $E2E_STACK_DIR/env.sh), TEST_PW, and the app running. Writes dumps under $OUT (default $E2E_STATE_DIR/j11-rollback).
#   bash scripts/e2e-crm-repair/j11-rollback.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
: "${E2E_PSQL:?source the stack env first}" "${TEST_PW:?}"
OUT="${OUT:-${E2E_STATE_DIR:-/tmp}/j11-rollback}"; mkdir -p "$OUT"
PSQL="psql $E2E_PSQL -X -q -v ON_ERROR_STOP=1"
DUMPARGS="$(echo "$E2E_PSQL" | sed 's/-d [^ ]*//')"; DB="$(echo "$E2E_PSQL" | sed 's/.*-d //')"
ok=0; bad=0
check() { if [ "$2" = "0" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1"; bad=$((bad+1)); fi; }
dump_schema() { pg_dump $DUMPARGS -s -d "$DB" | grep -v -E '^\\(un)?restrict ' > "$1"; }
fingerprint() { $PSQL -tA -c "select 'invoices', count(*), md5(string_agg(x::text,'|' order by id)) from invoices x
  union all select 'items', count(*), md5(string_agg(x::text,'|' order by id)) from invoice_items x
  union all select 'payments', count(*), md5(string_agg(x::text,'|' order by id)) from invoice_payments x" > "$1"; }
fingerprint_pre() { $PSQL -tA -v ids="$(cat "$OUT/ids-0.txt")" -f - > "$1" <<'SQL'
select 'invoices', count(*), md5(string_agg(x::text,'|' order by id)) from invoices x where id = any(string_to_array(:'ids', ','))
union all select 'items', count(*), md5(string_agg(x::text,'|' order by id)) from invoice_items x where invoice_id = any(string_to_array(:'ids', ','))
union all select 'payments', count(*), md5(string_agg(x::text,'|' order by id)) from invoice_payments x where invoice_id = any(string_to_array(:'ids', ','));
SQL
}
guard_objects() { $PSQL -tA -c "select (select count(*) from pg_trigger where not tgisinternal and tgname in ('invoice_payments_before_insert_guard','invoice_payments_after_change_sync','invoice_payments_before_update_guard','invoices_before_update_ledger_guard','invoices_before_delete_payment_guard'))
  || '+' || (select count(*) from pg_proc where proname in ('invoice_guard_skipped','invoice_ledger_status','invoice_sync_header','invoice_payments_before_insert','invoice_payments_after_change','invoices_before_update_ledger','invoices_before_delete_guard','invoice_payments_before_update'))"; }

# 0. start from the pre-guard state
$PSQL -f scripts/invoice-payments-integrity-rollback.sql 2>/dev/null
dump_schema "$OUT/schema-0-preguard.sql"; fingerprint "$OUT/data-0-preguard.txt"
$PSQL -tA -c "select string_agg(id, ',' order by id) from invoices" > "$OUT/ids-0.txt"; fingerprint_pre "$OUT/pre-rows-0.txt"
check "pre-guard state has no guard objects" "$([ "$(guard_objects)" = "0+0" ] && echo 0 || echo 1)"

# 1. apply twice (idempotent)
T0=$(date +%s%N); $PSQL -f scripts/invoice-payments-integrity.sql 2>/dev/null; rc1=$?; T1=$(date +%s%N)
$PSQL -f scripts/invoice-payments-integrity.sql 2>/dev/null; rc2=$?
check "apply, then apply again, both succeed ($(( (T1-T0)/1000000 )) ms for the first)" "$((rc1+rc2))"
check "guard objects present after apply (5 triggers + 8 functions)" "$([ "$(guard_objects)" = "5+8" ] && echo 0 || echo 1)"
dump_schema "$OUT/schema-1-applied.sql"; fingerprint "$OUT/data-1-applied.txt"
check "apply changed no row (invoices / items / payments fingerprints identical)" "$(cmp -s "$OUT/data-0-preguard.txt" "$OUT/data-1-applied.txt" && echo 0 || echo 1)"
echo "--- schema diff pre-guard vs applied (guard objects only):"; diff "$OUT/schema-0-preguard.sql" "$OUT/schema-1-applied.sql" | grep -E '^[<>] (CREATE|ALTER|REVOKE|GRANT|COMMENT)' | sed 's/^/    /' | head -40

# 2. use the application with the guard on
export E2E_BASE_URL
node scripts/e2e-crm-repair/j11-use-app.mjs > "$OUT/use-app.log" 2>&1; rc=$?
check "application usage with the guard (payments, edits, archive, refusals) passes: $(tail -1 "$OUT/use-app.log")" "$rc"
fingerprint "$OUT/data-2-after-use.txt"

# 3. roll back
T0=$(date +%s%N); $PSQL -f scripts/invoice-payments-integrity-rollback.sql; rc=$?; T1=$(date +%s%N)
check "rollback succeeds ($(( (T1-T0)/1000000 )) ms)" "$rc"
$PSQL -f scripts/invoice-payments-integrity-rollback.sql 2>/dev/null; check "rollback twice is harmless" "$?"
check "no guard objects remain after rollback" "$([ "$(guard_objects)" = "0+0" ] && echo 0 || echo 1)"
dump_schema "$OUT/schema-3-rolledback.sql"; fingerprint "$OUT/data-3-rolledback.txt"
check "schema after rollback is byte-identical to the pre-guard schema" "$(cmp -s "$OUT/schema-0-preguard.sql" "$OUT/schema-3-rolledback.sql" && echo 0 || echo 1)"
# rows that existed before the guard are untouched (the app only changed invoices it created itself)
fingerprint_pre "$OUT/pre-rows-3.txt"
check "every invoice / line / payment row that existed before the guard is byte-identical after use + rollback" "$([ -s "$OUT/pre-rows-0.txt" ] && cmp -s "$OUT/pre-rows-0.txt" "$OUT/pre-rows-3.txt" && echo 0 || echo 1)"
check "the rows the app wrote while the guard was on are still there (rollback does not delete data)" "$([ "$($PSQL -tA -c "select count(*) from invoices where customer_name like 'J11 Use Client%'")" -ge 2 ] && echo 0 || echo 1)"

# 4. the app works without the guard
PAYMENT_ROUNDS=3 node scripts/e2e-crm-repair/j8-payment-concurrency.mjs > "$OUT/j8-noguard.log" 2>&1; rc=$?
check "j8 payment suite passes against the rolled-back database (app-level protection only)" "$rc"

# 5. re-apply works and enforces again
$PSQL -f scripts/invoice-payments-integrity.sql 2>/dev/null; check "re-apply after rollback succeeds" "$?"
check "guard objects present again" "$([ "$(guard_objects)" = "5+8" ] && echo 0 || echo 1)"
dump_schema "$OUT/schema-5-reapplied.sql"
check "re-applied schema is byte-identical to the first applied schema" "$(cmp -s "$OUT/schema-1-applied.sql" "$OUT/schema-5-reapplied.sql" && echo 0 || echo 1)"
node scripts/e2e-crm-repair/j11-use-app.mjs > "$OUT/use-app-2.log" 2>&1; check "application usage passes again after re-apply" "$?"
echo "passed=$ok failed=$bad (dumps in $OUT)"; [ "$bad" = "0" ]
