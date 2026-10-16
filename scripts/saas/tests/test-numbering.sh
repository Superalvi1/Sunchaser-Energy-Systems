#!/usr/bin/env bash
# Proves atomic per-company document numbering (phase2c) on a DISPOSABLE database built from a release-schema dump:
#   refusal without a floor -> history preserved (never restarts at 0001) -> per-company independence -> concurrency (pgbench)
#   -> privileges -> rollback/re-apply.
#   E2E_ADMIN="-h /srv/s -p 55432 -U postgres" bash scripts/saas/tests/test-numbering.sh
set -euo pipefail
: "${E2E_ADMIN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; SAAS="$HERE/.."
DB="${NUM_DB:-t_num_$$}"; YEAR="$(date -u +%Y)"
bash "$HERE/mkdb.sh" "$DB" > /dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true' EXIT
P="psql $E2E_ADMIN -d $DB -q -v ON_ERROR_STOP=1"; Q="psql $E2E_ADMIN -d $DB -tA"
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }
# one statement as a role, with the company header, one transaction; prints the value or ERR:<message>
as() { # role company sql
  psql $E2E_ADMIN -d "$DB" -tA -v ON_ERROR_STOP=1 -c "begin; set local role $1; select set_config('request.headers', case when '$2' = '' then '{}' else json_build_object('x-company-id','$2')::text end, true); $3; commit;" 2>&1 | grep -v -E '^(BEGIN|SET|COMMIT|)$' | grep -v -E '^\{' | head -1 | sed -E 's/^ERROR:  /ERR:/; s/^psql:.*ERROR:  /ERR:/' | cut -c1-200
}
next() { as "$1" "$2" "select public.next_document_number('invoice','${3:-INV}','${4:-$YEAR}')"; }

$P -f "$SAAS/phase2-company-foundation.sql" > /dev/null 2>&1
$P -f "$SAAS/phase2b-ownership.sql" > /dev/null 2>&1
$P -c "insert into companies (id, slug, name) values ('co_a','co-a','Company A'),('co_b','co-b','Company B') on conflict do nothing"

# 1. owner decision enforced: no invoice number this year and no floor -> the migration refuses
OUT="$(psql $E2E_ADMIN -d $DB -v ON_ERROR_STOP=1 -q -f "$SAAS/phase2c-document-numbering.sql" 2>&1 || true)"
check "phase2c refuses to run when the founding company has no invoice number this year and no floor" "$(echo "$OUT" | grep -c 'would restart at 0001')" "1"
check "the refused migration left nothing behind (single transaction)" "$($Q -c "select to_regclass('public.document_counters') is null")" "t"

# 2. history: the accounts were reset (no invoices). The owner's floor is the last number ever issued (8 in this synthetic case).
$P -c "insert into app.config (key, value) values ('document_floor.sunchaser.invoice.$YEAR', '8') on conflict (key) do update set value = excluded.value"
$P -f "$SAAS/phase2c-document-numbering.sql" > /dev/null 2>&1; check "phase2c applies once the floor is set" "$?" "0"
$P -f "$SAAS/phase2c-document-numbering.sql" > /dev/null 2>&1; check "phase2c applies a second time (idempotent)" "$?" "0"
check "the founding company counter starts at the floor, not at 0" "$($Q -c "select last_value from document_counters where company_id='sunchaser' and kind='invoice' and period='$YEAR'")" "8"
check "Sunchaser's first number after the reset continues the history (INV-$YEAR-0009, not 0001)" "$(next service_role '')" "INV-$YEAR-0009"
$P -c "insert into invoices (id, invoice_number, customer_name) values ('n-s1','INV-$YEAR-0009','x'),('n-s2','INV-$YEAR-0010','x')"
check "deleting invoices never makes a number come back (the counter is its own high-water mark: 0010, not 0009 or 0001)" "$($P -c "delete from invoices where id in ('n-s1','n-s2')" >/dev/null 2>&1; next service_role '')" "INV-$YEAR-0010"

# 3. a counter seeds from existing invoices when it has none yet (history in the invoices table is respected)
$P -c "insert into invoices (id, invoice_number, customer_name, company_id) values ('n-a1','INV-$YEAR-0041','x','co_a'),('n-a2','INV-$YEAR-0007','x','co_a'),('n-aold','INV-2019-0900','x','co_a'),('n-aoth','XYZ-$YEAR-0999','x','co_a')"
check "company A's first number follows A's own highest number (0041), ignoring other years and other prefixes" "$(next crm_tenant co_a)" "INV-$YEAR-0042"
check "company B starts its own sequence independently (INV-$YEAR-0001)" "$(next crm_tenant co_b)" "INV-$YEAR-0001"
check "company B's second number" "$(next crm_tenant co_b)" "INV-$YEAR-0002"
check "A continues unaffected by B" "$(next crm_tenant co_a)" "INV-$YEAR-0043"
$P -c "insert into invoices (id, invoice_number, customer_name, company_id) values ('n-b1','INV-$YEAR-0001','b','co_b')"
check "two companies can both hold INV-$YEAR-0001 (uniqueness is per company)" "$($Q -c "select count(*) from invoices where invoice_number='INV-$YEAR-0001' and company_id in ('co_b')")" "1"
OUT="$(psql $E2E_ADMIN -d $DB -q -c "insert into invoices (id, invoice_number, customer_name, company_id) values ('n-b2','INV-$YEAR-0001','b','co_b')" 2>&1 || true)"
check "the same company cannot hold the same number twice" "$(echo "$OUT" | grep -c 'invoices_company_invoice_number_key')" "1"
check "another year starts at 0001 for a company with no history that year" "$(next crm_tenant co_b INV 2031)" "INV-2031-0001"
check "the prefix is formatting only: a company that changes it continues its sequence (SOL-$YEAR-0003 after 0001, 0002)" "$(next crm_tenant co_b SOL $YEAR)" "SOL-$YEAR-0003"

# 4. concurrency: 16 clients x 40 calls for each of two companies at the same time -> every number distinct, none skipped
$P -c "create schema if not exists zz; drop table if exists zz.nums; create table zz.nums (company text, n text); grant all on schema zz to public; grant all on zz.nums to public"
START_A="$($Q -c "select last_value from document_counters where company_id='co_a' and kind='invoice' and period='$YEAR'")"
START_B="$($Q -c "select last_value from document_counters where company_id='co_b' and kind='invoice' and period='$YEAR'")"
# 16 workers per company, 40 numbers each, all at once: every worker is its own psql process and its own transaction per number.
worker() { # company
  local f; f="$(mktemp)"
  for _ in $(seq 1 40); do
    printf "begin; select set_config('request.headers', '{\"x-company-id\":\"%s\"}', true); insert into zz.nums select '%s', public.next_document_number('invoice','INV','%s'); commit;\n" "$1" "$1" "$YEAR" >> "$f"
  done
  psql $E2E_ADMIN -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null 2>&1; rm -f "$f"
}
PIDS=""
for i in $(seq 1 16); do worker co_a & PIDS="$PIDS $!"; worker co_b & PIDS="$PIDS $!"; done
wait $PIDS
check "concurrent callers: 640 numbers handed out for company A" "$($Q -c "select count(*) from zz.nums where company='co_a'")" "640"
check "concurrent callers: 640 numbers handed out for company B" "$($Q -c "select count(*) from zz.nums where company='co_b'")" "640"
check "concurrent callers: no number given out twice (A)" "$($Q -c "select count(*)-count(distinct n) from zz.nums where company='co_a'")" "0"
check "concurrent callers: no number given out twice (B)" "$($Q -c "select count(*)-count(distinct n) from zz.nums where company='co_b'")" "0"
check "concurrent callers: A's numbers are exactly the next 640 in a row" "$($Q -c "select min(substring(n from '[0-9]+\$')::int) || '-' || max(substring(n from '[0-9]+\$')::int) from zz.nums where company='co_a'")" "$((START_A+1))-$((START_A+640))"
check "concurrent callers: B's numbers are exactly the next 640 in a row" "$($Q -c "select min(substring(n from '[0-9]+\$')::int) || '-' || max(substring(n from '[0-9]+\$')::int) from zz.nums where company='co_b'")" "$((START_B+1))-$((START_B+640))"

# 5. privileges and misuse
check "the tenant role cannot read the counters directly" "$(as crm_tenant co_a "select * from public.document_counters" | grep -c 'permission denied')" "1"
check "the tenant role cannot change a counter directly" "$(as crm_tenant co_a "update public.document_counters set last_value = 0" | grep -c 'permission denied')" "1"
check "the tenant role cannot call the floor tool" "$(as crm_tenant co_a "select public.document_counter_set_floor('co_a','invoice','$YEAR',1)" | grep -c 'permission denied')" "1"
check "anon cannot ask for a number" "$(next anon co_a | grep -c 'permission denied')" "1"
check "the tenant role without a company header is refused" "$(next crm_tenant '' | grep -c 'company_context_required')" "1"
check "a bad prefix is refused" "$(next crm_tenant co_a 'inv;drop' | grep -c 'document_format_invalid')" "1"
check "a bad period is refused" "$(next crm_tenant co_a INV '20x6' | grep -c 'document_format_invalid')" "1"
check "an unknown kind is refused" "$(as crm_tenant co_a "select public.next_document_number('receipt','INV','$YEAR')" | grep -c 'document_kind_unknown')" "1"
check "a counter never moves down (floor below the current value changes nothing)" "$(as service_role '' "select public.document_counter_set_floor('co_b','invoice','$YEAR',1)")" "$($Q -c "select last_value from document_counters where company_id='co_b' and kind='invoice' and period='$YEAR'")"
check "the floor tool raises a counter" "$(as service_role '' "select public.document_counter_set_floor('co_b','invoice','$YEAR',5000)")" "5000"
check "A cannot be given B's counter value by header trickery: the number follows the header company only" "$(next crm_tenant co_a)" "INV-$YEAR-$(printf '%04d' $((START_A+641)))"

# 6. rollback and re-apply
$P -c "delete from invoices where id in ('n-a1','n-a2','n-aold','n-aoth','n-b1')"
$P -f "$SAAS/phase2c-document-numbering-rollback.sql" > /dev/null 2>&1; check "rollback applies when no two companies share a number" "$?" "0"
check "rollback keeps a copy of the counters" "$($Q -c "select count(*) > 0 from app_rollback_backup.document_counters")" "t"
check "rollback removes the functions and the table" "$($Q -c "select to_regprocedure('public.next_document_number(text,text,text,int)') is null and to_regclass('public.document_counters') is null")" "t"
check "rollback restores the global unique key on invoice_number" "$($Q -c "select count(*) from pg_constraint where conrelid='public.invoices'::regclass and contype='u' and conname='invoices_invoice_number_key'")" "1"
$P -f "$SAAS/phase2c-document-numbering.sql" > /dev/null 2>&1; check "phase2c re-applies after a rollback" "$?" "0"
check "after rollback and re-apply the founding company continues its history (0011 after 0010), no number is reissued" "$(next service_role '')" "INV-$YEAR-0011"
$P -c "insert into invoices (id, invoice_number, customer_name, company_id) values ('n-d1','DUP-1','x','sunchaser'),('n-d2','DUP-1','x','co_a')"
OUT="$(psql $E2E_ADMIN -d $DB -q -v ON_ERROR_STOP=1 -f "$SAAS/phase2c-document-numbering-rollback.sql" 2>&1 || true)"
check "rollback refuses to bring the global unique key back while two companies share a number" "$(echo "$OUT" | grep -c 'rollback refused')" "1"
check "the refused rollback changed nothing" "$($Q -c "select to_regprocedure('public.next_document_number(text,text,text,int)') is not null")" "t"

# 3b. numbers issued OUTSIDE the counter (an older backend that numbers by counting, still running during a rolling deployment, or rolled back to and left again):
#     the counter must never hand out a number the company already holds, and must not fall behind it afterwards
CUR="$(next service_role '' | sed -E 's/.*-0*([0-9]+)$/\1/')"
for off in 1 2 3; do N=$((CUR + off)); $P -c "set session_replication_role = replica; insert into invoices (id, invoice_number, company_id, customer_name) values ('outside-$off', 'INV-$YEAR-$(printf %04d $N)', 'sunchaser', 'x')" > /dev/null 2>&1 || $P -c "set session_replication_role = replica; insert into invoices (id, invoice_number, company_id) values ('outside-$off', 'INV-$YEAR-$(printf %04d $N)', 'sunchaser')" > /dev/null; done
EXPECT="INV-$YEAR-$(printf %04d $((CUR + 4)))"
check "numbers issued outside the counter (three invoices numbered by an older backend) are never reissued: the next number is one past the highest the company holds" "$(next service_role '')" "$EXPECT"
check "...and the counter stays ahead afterwards (the following number is one more)" "$(next service_role '')" "INV-$YEAR-$(printf %04d $((CUR + 5)))"
$P -c "delete from invoices where id like 'outside-%'" > /dev/null 2>&1 || true

# 7. t9: width is minimum padding. Reproduce the old real defect before applying the additive repair.
$P -c "select public.document_counter_set_floor('co_a','invoice','2999',9999)" > /dev/null
check "negative control: old formatter truncates 10000 to 1000" "$(next crm_tenant co_a INV 2999)" "INV-2999-1000"
check "negative control: old formatter repeats that truncated number" "$(next crm_tenant co_a INV 2999)" "INV-2999-1000"
$P -f "$SAAS/phase2j-document-number-width.sql" > /dev/null 2>&1
$P -f "$SAAS/phase2j-document-number-width.sql" > /dev/null 2>&1
check "t9 preserves every digit after the counter exceeds four digits (idempotent apply)" "$(next crm_tenant co_a INV 2999)" "INV-2999-10002"
$P -c "select public.document_counter_set_floor('co_a','invoice','2998',9007199254740991)" > /dev/null
check "t9 preserves bigint digits beyond JavaScript's exact-integer range" "$(next crm_tenant co_a INV 2998)" "INV-2998-9007199254740992"
$P -c "select public.document_counter_set_floor('co_a','invoice','2997',9)" > /dev/null
check "a one-digit padding width also expands instead of truncating" "$(as crm_tenant co_a "select public.next_document_number('invoice','INV','2997',1)")" "INV-2997-10"
$P -c "select public.document_counter_set_floor('co_a','invoice','2996',9998); create table zz.width_nums(n text); grant all on zz.width_nums to public" > /dev/null
width_worker() {
  psql $E2E_ADMIN -d "$DB" -q -v ON_ERROR_STOP=1 -c "begin; set local role crm_tenant; select set_config('request.headers','{\"x-company-id\":\"co_a\"}',true); insert into zz.width_nums select public.next_document_number('invoice','INV','2996') from generate_series(1,4); commit;" > /dev/null 2>&1
}
WIDTH_PIDS=""
for i in $(seq 1 16); do width_worker & WIDTH_PIDS="$WIDTH_PIDS $!"; done
wait $WIDTH_PIDS
check "64 concurrent numbers cross the four-digit boundary" "$($Q -c "select count(*) from zz.width_nums")" "64"
check "every concurrent full-width number is distinct" "$($Q -c "select count(distinct n) from zz.width_nums")" "64"
check "the full-width concurrent range is consecutive" "$($Q -c "select min(substring(n from '[0-9]+
)::bigint)||'-'||max(substring(n from '[0-9]+
)::bigint) from zz.width_nums")" "9999-10062"
check "another company keeps its own numbering at the same period" "$(next crm_tenant co_b INV 2996)" "INV-2996-0001"
check "anon remains unable to issue numbers after t9" "$(next anon co_a | grep -c 'permission denied')" "1"
check "missing tenant context remains refused after t9" "$(next crm_tenant '' | grep -c 'company_context_required')" "1"
$P -f "$SAAS/phase2j-document-number-width-rollback.sql" > /dev/null 2>&1
check "t9 rollback refuses oversized issuance rather than restoring truncation" "$(next crm_tenant co_a INV 2999 | grep -c 'document_number_width_requires_upgrade')" "1"
check "refused issuance consumes no number" "$($Q -c "select last_value from document_counters where company_id='co_a' and period='2999'")" "10002"
$P -f "$SAAS/phase2j-document-number-width.sql" > /dev/null 2>&1
check "t9 re-apply continues with the next complete number" "$(next crm_tenant co_a INV 2999)" "INV-2999-10003"

echo; echo "$ok passed, $bad failed"; [ "$bad" = 0 ]
