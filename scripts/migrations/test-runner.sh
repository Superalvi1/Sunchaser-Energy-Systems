#!/usr/bin/env bash
# Tests the migration runner on a DISPOSABLE server. Part 1: runner mechanics with tiny synthetic migrations (apply order, checksums, drift,
# failure, dependencies, rollback order, dry run, concurrency lock, ledger tamper, remote refusal). Part 2: the REAL manifest on a database
# that already has the release migrations: baseline r1-r4, apply t1-t3, verify, roll back t3-t1, apply again.
#   E2E_ADMIN="-h /srv/s -p 55432 -U postgres" bash scripts/migrations/test-runner.sh
set -uo pipefail
: "${E2E_ADMIN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$HERE/../.."
RUN="node $HERE/run.mjs"
HOSTARG="$(echo "$E2E_ADMIN" | sed -nE 's/.*-h ([^ ]+).*/\1/p')"; PORTARG="$(echo "$E2E_ADMIN" | sed -nE 's/.*-p ([^ ]+).*/\1/p')"; USERARG="$(echo "$E2E_ADMIN" | sed -nE 's/.*-U ([^ ]+).*/\1/p')"
export PGHOST="$HOSTARG" PGPORT="${PORTARG:-5432}" PGUSER="${USERARG:-postgres}"
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }
has() { echo "$2" | grep -qE "$1" && echo yes || echo no; }
T="$(mktemp -d)"; trap 'rm -rf "$T"; for d in t_run1 t_run2; do psql $E2E_ADMIN -d postgres -qc "drop database if exists $d with (force)" >/dev/null 2>&1; done' EXIT
for d in t_run1 t_run2; do psql $E2E_ADMIN -d postgres -qc "drop database if exists $d with (force)" -c "create database $d" >/dev/null 2>&1; done
L() { psql $E2E_ADMIN -d "$1" -tAc "$2"; }

# ---------------------------------------------------------------- part 1: synthetic migrations
mkdir -p "$T/root/scripts/migrations" "$T/root/m"
cat > "$T/root/m/a.sql" <<'SQL'
begin; create table public.zz_a (id int primary key); commit;
SQL
cat > "$T/root/m/a-rb.sql" <<'SQL'
begin; drop table public.zz_a; commit;
SQL
cat > "$T/root/m/b.sql" <<'SQL'
begin; create table public.zz_b (id int references public.zz_a(id) on delete cascade); commit;
SQL
cat > "$T/root/m/b-rb.sql" <<'SQL'
begin; drop table public.zz_b; commit;
SQL
cat > "$T/root/m/c.sql" <<'SQL'
begin; create table public.zz_c (id int); select 1/0; commit;
SQL
cat > "$T/root/m/c-rb.sql" <<'SQL'
select 1;
SQL
cat > "$T/root/m/d.sql" <<'SQL'
begin; create table public.zz_d (id int); select pg_sleep(3); commit;
SQL
cat > "$T/root/m/d-rb.sql" <<'SQL'
begin; drop table public.zz_d; commit;
SQL
mk() { cat > "$T/root/scripts/migrations/manifest.json" <<JSON
{"version":1,"migrations":[
 {"id":"s1-a","series":"x","file":"m/a.sql","rollback":"m/a-rb.sql","requires":[],"gate":"G3","probe":"select to_regclass('public.zz_a') is not null","note":"a"},
 {"id":"s2-b","series":"x","file":"m/b.sql","rollback":"m/b-rb.sql","requires":["s1-a"],"gate":"G3","probe":"select to_regclass('public.zz_b') is not null","note":"b"}$1
]}
JSON
}
mk ""
export PGDATABASE=t_run1
R="$RUN --root $T/root"
OUT="$($R status 2>&1)"; check "status on a fresh database: nothing applied, no ledger" "$(has 'not created yet' "$OUT")$(has 'pending  s1-a' "$OUT")" "yesyes"
OUT="$($R apply 2>&1)"; check "apply without --yes is a dry run" "$(has 'Dry run' "$OUT")$(L t_run1 "select to_regclass('public.zz_a') is null")" "yest"
OUT="$($R apply --to s2-b --yes 2>&1)"; check "apply --yes runs both in order" "$(L t_run1 "select to_regclass('public.zz_a') is not null and to_regclass('public.zz_b') is not null")" "t"
check "the ledger has one OK row each, with the SHA-256 of the file" "$(L t_run1 "select string_agg(migration_id||':'||status||':'||checksum, ',' order by seq) from ops.migration_ledger")" "s1-a:ok:$(sha256sum "$T/root/m/a.sql" | cut -d' ' -f1),s2-b:ok:$(sha256sum "$T/root/m/b.sql" | cut -d' ' -f1)"
OUT="$($R apply --yes 2>&1)"; check "applying again does nothing" "$(has 'Nothing to apply' "$OUT")$(L t_run1 "select count(*) from ops.migration_ledger")" "yes2"
OUT="$($R verify 2>&1)"; check "verify is clean" "$(has '^OK' "$OUT")" "yes"
check "ledger rows cannot be updated" "$(psql $E2E_ADMIN -d t_run1 -c "update ops.migration_ledger set status='failed'" 2>&1 | grep -c 'insert-only')" "1"
check "ledger rows cannot be deleted" "$(psql $E2E_ADMIN -d t_run1 -c "delete from ops.migration_ledger" 2>&1 | grep -c 'insert-only')" "1"
check "the ledger cannot be truncated" "$(psql $E2E_ADMIN -d t_run1 -c "truncate ops.migration_ledger" 2>&1 | grep -c 'insert-only')" "1"
# a superuser who disables the trigger and edits a row is caught by the hash chain
psql $E2E_ADMIN -d t_run1 -qc "alter table ops.migration_ledger disable trigger migration_ledger_no_change; update ops.migration_ledger set applied_by='someone else' where seq=1; alter table ops.migration_ledger enable trigger migration_ledger_no_change" >/dev/null
OUT="$($R verify 2>&1)"; check "an edited ledger row is detected by the hash chain" "$(has 'contents do not match' "$OUT")" "yes"
psql $E2E_ADMIN -d t_run1 -qc "alter table ops.migration_ledger disable trigger migration_ledger_no_change; update ops.migration_ledger set applied_by=(select applied_by from ops.migration_ledger where seq=2) where seq=1; alter table ops.migration_ledger enable trigger migration_ledger_no_change" >/dev/null
# the original applied_by of row 1 equals row 2's (same user/host), so restoring it makes the chain valid again
OUT="$($R verify 2>&1)"; check "restoring the row makes the chain valid again" "$(has '^OK' "$OUT")" "yes"

# drift: change an applied file
echo "-- edited after it was applied" >> "$T/root/m/a.sql"
OUT="$($R status 2>&1)"; check "a file changed after it was applied is reported as DRIFT" "$(has 'DRIFT +s1-a' "$OUT")" "yes"
mk ',{"id":"s3-c","series":"x","file":"m/c.sql","rollback":"m/c-rb.sql","requires":["s2-b"],"gate":"G3","probe":"select to_regclass('"'"'public.zz_c'"'"') is not null","note":"c"}'
OUT="$($R apply --yes 2>&1)"; rc=$?; check "apply refuses while any applied file has drifted" "$([ $rc -ne 0 ] && echo refused)$(has 'changed after it was applied' "$OUT")" "refusedyes"
check "the pending migration did not run" "$(L t_run1 "select to_regclass('public.zz_c') is null")" "t"
sed -i '$ d' "$T/root/m/a.sql"
OUT="$($R status 2>&1)"; check "removing the edit clears the drift" "$(has 'DRIFT' "$OUT")" "no"

# a failing migration is recorded as failed and is not applied; the transaction left nothing behind
OUT="$($R apply --yes 2>&1)"; rc=$?
check "a failing migration stops the run with a non-zero exit" "$([ $rc -ne 0 ] && echo failed)$(has 'division by zero' "$OUT")" "failedyes"
check "it is recorded as failed, not applied" "$(L t_run1 "select status||':'||action from ops.migration_ledger where migration_id='s3-c' order by seq desc limit 1")" "failed:apply"
check "the failed script left no table behind" "$(L t_run1 "select to_regclass('public.zz_c') is null")" "t"
OUT="$($R status 2>&1)"; check "status still shows it as pending" "$(has 'pending  s3-c' "$OUT")" "yes"
OUT="$($R verify 2>&1)"; check "the ledger chain stays valid with a failed row" "$(has '^OK' "$OUT")" "yes"

# rollback: dependencies and order
mk ""
OUT="$($R rollback --to s1-a --yes 2>&1)"; check "rolling back in reverse order undoes b then a" "$(echo "$OUT" | grep -oE 'Rolling back s[0-9]-[a-z]' | tr '\n' ' ')" "Rolling back s2-b Rolling back s1-a "
check "both tables are gone" "$(L t_run1 "select to_regclass('public.zz_a') is null and to_regclass('public.zz_b') is null")" "t"
OUT="$($R status 2>&1)"; check "after the rollback both are pending again" "$(has 'pending  s1-a' "$OUT")$(has 'pending  s2-b' "$OUT")" "yesyes"
$R apply --yes >/dev/null 2>&1
OUT="$($R rollback --to s1-a --yes 2>&1 | head -3)"; check "re-apply after rollback works and rollback --to the first one rolls back every dependent first" "$(echo "$OUT" | grep -c 'Rolling back')" "2"
$R apply --yes >/dev/null 2>&1
OUT="$($R rollback --to s2-b --yes 2>&1)"; check "rolling back only the newest leaves the older one" "$(L t_run1 "select to_regclass('public.zz_a') is not null and to_regclass('public.zz_b') is null")" "t"
OUT="$($R rollback --to s1-a --yes 2>&1)"; $R apply --yes >/dev/null 2>&1
# a dependent blocks a rollback that would orphan it (--to names a migration other than the newest chain end through manifest order)
OUT="$($R rollback --to s2-b 2>&1)"; check "rollback without --yes is a dry run" "$(has 'Dry run' "$OUT")$(L t_run1 "select to_regclass('public.zz_b') is not null")" "yest"

# concurrency: two runners at once -> the second refuses and changes nothing
mk ',{"id":"s4-d","series":"x","file":"m/d.sql","rollback":"m/d-rb.sql","requires":[],"gate":"G3","probe":"select to_regclass('"'"'public.zz_d'"'"') is not null","note":"d (sleeps 3 s)"}'
( $R apply --yes > "$T/run-first.log" 2>&1 & ) ; sleep 1
OUT="$($R apply --yes 2>&1)"; rc=$?
check "a second runner is refused while the first holds the lock" "$([ $rc -eq 3 ] && echo locked)$(has 'Another migration runner' "$OUT")" "lockedyes"
sleep 4
check "the first runner finished and applied it once" "$(L t_run1 "select count(*) from ops.migration_ledger where migration_id='s4-d' and status='ok'")" "1"

# remote refusal
OUT="$(PGHOST=db.example.com $RUN --root $T/root status 2>&1)"; rc=$?
check "a non-local server is refused without --allow-remote and the confirmation variable" "$([ $rc -eq 2 ] && echo refused)$(has 'Refusing' "$OUT")" "refusedyes"
OUT="$(PGHOST=db.example.com $RUN --root $T/root --allow-remote status 2>&1)"; rc=$?
check "--allow-remote alone is not enough" "$([ $rc -eq 2 ] && echo refused)" "refused"

# ---------------------------------------------------------------- part 2: the real manifest on a database with the release migrations
export PGDATABASE=t_run2
E2E_ADMIN="$E2E_ADMIN" bash "$REPO/scripts/saas/tests/mkdb.sh" t_run2 >/dev/null 2>&1
# mkdb clones the template, which already has r1-r4 in ITS ledger; start this database with no ledger, like a database that was migrated by hand
psql $E2E_ADMIN -d t_run2 -qc "drop schema if exists ops cascade" >/dev/null 2>&1
R="$RUN --root $REPO"
OUT="$($R verify 2>&1)"; rc=$?; check "release migrations applied by hand are noticed (probe present, not in ledger)" "$([ $rc -ne 0 ] && echo noticed)$(has 'applied by hand' "$OUT")" "noticedyes"
OUT="$($R baseline --through t1-company-foundation --yes 2>&1)"; rc=$?; check "baseline refuses a migration whose effect is absent (t1 not applied)" "$([ $rc -ne 0 ] && echo refused)$(has 'Cannot baseline t1' "$OUT")" "refusedyes"
OUT="$($R baseline --through r4-invoice-save-atomic --yes 2>&1)"; check "baseline records r1-r4 without executing them" "$(L t_run2 "select string_agg(migration_id||':'||action, ',' order by seq) from ops.migration_ledger")" "r1-smart-quote-versions:baseline,r2-session-revocation:baseline,r3-invoice-payments-integrity:baseline,r4-invoice-save-atomic:baseline"
OUT="$($R verify 2>&1)"; check "after the baseline verify is clean" "$(has '^OK' "$OUT")" "yes"
OUT="$($R apply --yes 2>&1)"; rc=$?
check "t3 refuses to run without the owner's floor (founding company has no invoice number this year)" "$(has 'would restart at 0001' "$OUT")" "yes"
check "t1 and t2 were applied and recorded before that" "$(L t_run2 "select string_agg(migration_id||':'||status, ',' order by seq) from ops.migration_ledger where migration_id like 't%'")" "t1-company-foundation:ok,t2-ownership:ok,t3-document-numbering:failed"
check "the refused t3 is pending, not applied" "$(L t_run2 "select to_regclass('public.document_counters') is null")" "t"
psql $E2E_ADMIN -d t_run2 -qc "insert into app.config (key, value) values ('document_floor.sunchaser.invoice.$(date -u +%Y)', '8')" >/dev/null
OUT="$($R apply --yes 2>&1)"; rc=$?; check "with the floor set t3 applies" "$rc" "0"
OUT="$($R verify 2>&1)"; check "verify is clean with all seven applied" "$(has '^OK' "$OUT")" "yes"
OUT="$($R rollback --to t1-company-foundation --yes 2>&1)"; rc=$?
check "rollback t3, t2, t1 in reverse order" "$(echo "$OUT" | grep -oE 'Rolling back t[0-9]-[a-z-]+' | tr '\n' ' ')" "Rolling back t3-document-numbering Rolling back t2-ownership Rolling back t1-company-foundation "
check "the company foundation is gone and the release migrations remain" "$(L t_run2 "select to_regclass('public.companies') is null and to_regprocedure('public.invoice_save_atomic(text,timestamptz,jsonb,jsonb)') is not null")" "t"
OUT="$($R apply --yes 2>&1)"; check "everything applies again after the rollback (the floor is still set)" "$(L t_run2 "select count(*) from ops.migration_ledger where status='ok' and action='apply' and migration_id like 't%'")" "6"
OUT="$($R verify 2>&1)"; check "final verify is clean" "$(has '^OK' "$OUT")" "yes"
OUT="$($R rollback --to r1-smart-quote-versions 2>&1)"; check "rollback of an early migration lists the dependents first (dry run)" "$(echo "$OUT" | grep -oE 'roll back [a-z0-9-]+' | head -1)" "roll back t3-document-numbering"

echo; echo "$ok passed, $bad failed"; [ "$bad" = 0 ]
