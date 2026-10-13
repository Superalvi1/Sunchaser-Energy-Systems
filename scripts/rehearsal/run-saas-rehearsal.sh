#!/usr/bin/env bash
# SaaS tenant-migration rehearsal on a RESTORED COPY of production (separate from the release rehearsal in run-rehearsal.sh).
# Run it AFTER the release rehearsal has restored the backup into the scratch server (database restore_rehearsal) with the release migrations applied.
# NOTHING here touches production: the scratch server must be a local socket / localhost, and the rehearsal database is only written inside it.
#
#   RESTORE_PGHOST=... RESTORE_PGPORT=... RESTORE_PGUSER=... [RESTORE_PGPASSWORD=...] [RESTORE_DB=restore_rehearsal] \
#   REHEARSAL_DIR=/path/for/reports  FOUNDING_INVOICE_FLOOR=<last invoice number ever issued this year, an OWNER decision>  \
#   bash scripts/rehearsal/run-saas-rehearsal.sh
#
# What it proves, one PASS/FAIL line each (exit status = number of FAIL lines):
#   0  the read-only preflight has no BLOCKER; the production-only table `bills` is described (columns, keys, triggers, rows) in bills-report.txt
#   1  every public table gets a fingerprint (rows and content) BEFORE; the schema is snapshotted
#   2  release migrations present (or recorded by the runner's baseline); the invoice-number floor is set (the migration refuses without it)
#   3  tenant migrations t1..t7 apply through the runner; verify is clean
#   4  AFTER: row counts equal; every pre-existing row is byte-identical (original columns); every row of a company-owned table belongs to `sunchaser`;
#      the founding company's invoice counter is >= the highest invoice number already used (never restarts at 0001)
#   5  the tenant role, with the founding company's header, sees exactly what the service role sees for the company; without a header it sees nothing
#   6  rollback of t7..t1 returns the schema snapshot AND every table fingerprint to the BEFORE state; the migrations then apply again
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
: "${RESTORE_PGHOST:?}" "${RESTORE_PGPORT:?}" "${RESTORE_PGUSER:?}" "${REHEARSAL_DIR:?}"
DB="${RESTORE_DB:-restore_rehearsal}"; YEAR="$(date -u +%Y)"
case "$RESTORE_PGHOST" in /*|localhost|127.0.0.1) ;; *) echo "refusing: the scratch server must be a local unix socket directory, localhost or 127.0.0.1"; exit 2;; esac
case "$DB" in *prod*|*railway*) echo "refusing: database name looks like production"; exit 2;; esac
: "${FOUNDING_INVOICE_FLOOR:?set FOUNDING_INVOICE_FLOOR to the last invoice number ever issued this year (owner decision; the migration never starts Sunchaser at 0001)}"
mkdir -p "$REHEARSAL_DIR/saas"; OUT="$REHEARSAL_DIR/saas"; chmod 700 "$REHEARSAL_DIR"
FAILS=0; pass() { echo "PASS: $1${2:+ - $2}"; }; fail() { echo "FAIL: $1${2:+ - $2}"; FAILS=$((FAILS+1)); }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected '$3', got '$2'"; fi; }
export PGHOST="$RESTORE_PGHOST" PGPORT="$RESTORE_PGPORT" PGUSER="$RESTORE_PGUSER" PGPASSWORD="${RESTORE_PGPASSWORD:-}"
Q() { psql -X -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
RUN() { PGDATABASE="$DB" node "$REPO/scripts/migrations/run.mjs" "$@"; }

echo "== 0. preflight (read-only) and the production-only table bills"
psql -X -q -d "$DB" -f "$REPO/scripts/saas/phase2-preflight.sql" > "$OUT/preflight.txt" 2>&1
check "preflight reports no BLOCKER" "$(grep -c '^ *BLOCKER\| BLOCKER ' "$OUT/preflight.txt" | tr -d ' ')" "0"
{
  echo "bills report (read-only) for $DB at $(date -u +%FT%TZ)"
  if [ "$(Q -c "select to_regclass('public.bills') is not null")" = t ]; then
    echo "-- columns"; Q -c "select column_name||' '||data_type||case when is_nullable='NO' then ' not null' else '' end||coalesce(' default '||column_default,'') from information_schema.columns where table_schema='public' and table_name='bills' order by ordinal_position"
    echo "-- constraints"; Q -c "select conname||' '||pg_get_constraintdef(oid) from pg_constraint where conrelid='public.bills'::regclass order by 1"
    echo "-- indexes"; Q -c "select indexdef from pg_indexes where schemaname='public' and tablename='bills'"
    echo "-- triggers"; Q -c "select tgname||' '||pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.bills'::regclass and not tgisinternal"
    echo "-- policies / grants"; Q -c "select policyname||' '||cmd||' '||roles::text from pg_policies where tablename='bills'"
    echo "-- rows"; Q -c "select count(*) from public.bills"
    echo "-- has company_id?"; Q -c "select count(*) from information_schema.columns where table_schema='public' and table_name='bills' and column_name='company_id'"
  else echo "table public.bills does not exist in this database"; fi
} > "$OUT/bills-report.txt" 2>&1
pass "bills described in bills-report.txt (owner: classify it; tenant if it holds a company's money, with a per-company unique number)"
HAS_BILLS="$(Q -c "select to_regclass('public.bills') is not null")"

echo "== 1. fingerprints BEFORE"
# original columns only: tables that had no company_id before are compared without it afterwards; invoices.issuance_snapshot (t6) is a new
# column and is left out for the same reason (it is NULL for every existing invoice, which the migration test proves)
Q -c "select table_name from information_schema.columns where table_schema='public' and column_name='company_id'" | sort > "$OUT/had_company_id.txt"
fp() { # $1 = label; strips company_id (and other columns added by the migrations) from tables that did not have it before
  local f="$OUT/fp_$1.txt"; : > "$f"
  for t in $(Q -c "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not in ('companies','company_memberships','document_counters','company_settings_audit','saas_plans','saas_subscriptions','saas_payments','saas_audit') order by 1"); do
    local strip=""; grep -qx "$t" "$OUT/had_company_id.txt" || strip="- 'company_id'::text"
    echo "$t|$(Q -c "select count(*)||'|'||md5(coalesce(string_agg((to_jsonb(x) - 'issuance_snapshot'::text $strip)::text, '|' order by (to_jsonb(x) - 'issuance_snapshot'::text $strip)::text), '')) from public.\"$t\" x")" >> "$f"
  done
}
fp before; pass "fingerprint of $(wc -l < "$OUT/fp_before.txt" | tr -d ' ') tables taken"
psql -X -qAt -d "$DB" -f "$REPO/scripts/saas/tests/schema-snapshot.sql" > "$OUT/schema_before.txt" 2>&1
MAXNUM="$(Q -c "select coalesce(max((regexp_match(invoice_number, '^INV-$YEAR-(\d+)\$'))[1]::int), 0) from public.invoices" 2>/dev/null || echo 0)"
echo "highest invoice number already used this year: $MAXNUM; owner floor: $FOUNDING_INVOICE_FLOOR"
[ "$FOUNDING_INVOICE_FLOOR" -ge "$MAXNUM" ] 2>/dev/null && pass "the owner's floor ($FOUNDING_INVOICE_FLOOR) is not below the highest number in use ($MAXNUM)" || fail "the owner's floor is below the highest invoice number in use"

echo "== 2-3. release migrations, floor, tenant migrations through the runner"
Q -c "create schema if not exists app; create table if not exists app.config (key text primary key, value text not null)" >/dev/null
Q -c "insert into app.config (key, value) values ('document_floor.sunchaser.invoice.$YEAR', '$FOUNDING_INVOICE_FLOOR') on conflict (key) do update set value = excluded.value" >/dev/null
RUN status > "$OUT/runner_status_before.txt" 2>&1
RUN baseline --through r4-invoice-save-atomic --yes > "$OUT/runner_baseline.txt" 2>&1; check "release migrations r1..r4 are present (recorded by baseline) - apply them first (release rehearsal) if this fails" "$?" "0"
RUN apply --yes > "$OUT/runner_apply.txt" 2>&1; check "tenant migrations t1..t7 apply through the runner" "$?" "0"
RUN verify > "$OUT/runner_verify.txt" 2>&1; check "runner verify is clean (checksums, ledger chain, probes)" "$?" "0"

echo "== 4. AFTER the migrations: nothing existing changed, everything belongs to the founding company"
fp after
diff -q "$OUT/fp_before.txt" "$OUT/fp_after.txt" > /dev/null; check "every pre-existing table has the same row count AND identical content (original columns)" "$?" "0"
diff "$OUT/fp_before.txt" "$OUT/fp_after.txt" | head -5 > "$OUT/fp_diff.txt" || true
BADCO=""
for t in $(Q -c "select table_name from information_schema.columns where table_schema='public' and column_name='company_id' and table_name not in ('companies','company_memberships','document_counters','saas_payments','saas_audit','saas_subscriptions') order by 1"); do
  n="$(Q -c "select count(*) from public.\"$t\" where company_id is distinct from 'sunchaser'" 2>&1)"
  [ "$n" = 0 ] || BADCO="$BADCO $t($n)"
done
check "every row of every company-owned table belongs to the founding company" "$(echo $BADCO)" ""
CNT="$(Q -c "select coalesce(last_value,-1) from public.document_counters where company_id='sunchaser' and kind='invoice' and period='$YEAR'")"
[ "${CNT:--1}" -ge "$MAXNUM" ] 2>/dev/null && pass "the founding invoice counter ($CNT) is at or above the highest number used ($MAXNUM): numbering never restarts at 0001" || fail "founding invoice counter below the highest number used" "$CNT < $MAXNUM"
check "the first new invoice number continues the history" "$(Q -c "select public.next_document_number('invoice','INV','$YEAR')" 2>&1 | tr -d ' ')" "INV-$YEAR-$(printf '%04d' $(( ${CNT:-0} + 1 )))"
Q -c "update public.document_counters set last_value = last_value - 1 where company_id='sunchaser' and kind='invoice' and period='$YEAR'" >/dev/null   # give the probe number back: the rehearsal must leave the counter where it was
if [ "$HAS_BILLS" = t ]; then
  check "bills now has a company_id column and is covered by row security" "$(Q -c "select (select count(*) from information_schema.columns where table_schema='public' and table_name='bills' and column_name='company_id')||'/'||(select relrowsecurity from pg_class where oid='public.bills'::regclass)")" "1/true"
fi

echo "== 5. the tenant role"
SVC="$(Q -c "select count(*) from public.leads where company_id='sunchaser'")"
TEN="$(Q -c "begin; set local role crm_tenant; select set_config('request.headers','{\"x-company-id\":\"sunchaser\"}',true); select count(*) from public.leads; commit" | grep -E '^[0-9]+$' | head -1)"
NOH="$(Q -c "begin; set local role crm_tenant; select set_config('request.headers','{}',true); select count(*) from public.leads; commit" | grep -E '^[0-9]+$' | head -1)"
check "the tenant role with the founding header sees the same leads as the service role" "$TEN" "$SVC"
check "the tenant role without a company header sees no lead" "${NOH:-0}" "0"

echo "== 6. rollback to the BEFORE state, then apply again"
RUN rollback --to t1-company-foundation --yes > "$OUT/runner_rollback.txt" 2>&1; check "rollback t7..t1 applies" "$?" "0"
fp rolled
diff -q "$OUT/fp_before.txt" "$OUT/fp_rolled.txt" >/dev/null; check "after rollback every table's rows and content equal the BEFORE state" "$?" "0"
psql -X -qAt -d "$DB" -f "$REPO/scripts/saas/tests/schema-snapshot.sql" > "$OUT/schema_rolled.txt" 2>&1
diff -q "$OUT/schema_before.txt" "$OUT/schema_rolled.txt" >/dev/null; check "after rollback the schema snapshot equals the BEFORE snapshot" "$?" "0"
RUN apply --yes > "$OUT/runner_apply2.txt" 2>&1; check "the tenant migrations apply again after the rollback" "$?" "0"
RUN verify >/dev/null 2>&1; check "final verify is clean" "$?" "0"
echo; echo "SaaS rehearsal: $FAILS failure(s). Reports in $OUT"
exit "$FAILS"
