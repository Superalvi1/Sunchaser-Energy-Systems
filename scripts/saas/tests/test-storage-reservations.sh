#!/usr/bin/env bash
# Proves phase2h (atomic storage reservations) on a DISPOSABLE database: additive and idempotent, the reservation arithmetic (pending, finished before/after a
# mark, released, expired), argument checks, privileges (service role only), and - the point of it - that 40 simultaneous sessions competing for the last
# room of one company are admitted EXACTLY as far as the limit allows, while another company is unaffected.
#   E2E_ADMIN="-h /srv/s -p 55432 -U postgres" bash scripts/saas/tests/test-storage-reservations.sh
set -euo pipefail
: "${E2E_ADMIN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; SAAS="$HERE/.."
DB="${SR_DB:-t_sr_$$}"
bash "$HERE/mkdb.sh" "$DB" > /dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true' EXIT
P="psql $E2E_ADMIN -d $DB -q -v ON_ERROR_STOP=1"; Q="psql $E2E_ADMIN -d $DB -tA"
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }
as() { psql $E2E_ADMIN -d "$DB" -tA -v ON_ERROR_STOP=1 -c "begin; set local role $1; $2; commit;" 2>&1 | grep -E 'ERROR|^[^A-Z]' | head -1 | sed -E 's/^.*ERROR:  //' | cut -c1-120; }
reserve() { $Q -c "select public.saas_storage_reserve('$1', $2, $3, $4, $5, ${6:-180}, ${7:-900})"; }

for f in phase2-company-foundation phase2d-company-settings phase2e-subscriptions phase2g-company-admin; do $P -f "$SAAS/$f.sql" > /dev/null 2>&1; done
$P -f "$SAAS/phase2h-storage-reservations.sql" > /dev/null 2>&1; check "phase2h applies" "$?" "0"
$P -f "$SAAS/phase2h-storage-reservations-rollback.sql" > /dev/null 2>&1; check "rollback applies" "$?" "0"
check "rollback removes the table, the functions and the sequence" "$($Q -c "select to_regclass('public.saas_storage_reservations') is null and to_regprocedure('public.saas_storage_reserve(text,bigint,bigint,bigint,bigint,integer,integer)') is null and to_regclass('public.saas_storage_seq') is null")" "t"
$P -f "$SAAS/phase2h-storage-reservations.sql" > /dev/null 2>&1; check "re-apply after rollback works" "$?" "0"
$P -f "$SAAS/phase2h-storage-reservations.sql" > /dev/null 2>&1; check "applying twice is harmless (idempotent)" "$?" "0"
$P -c "insert into companies (id, slug, name, status) values ('co_a','co-a','A','active'), ('co_b','co-b','B','active')"

# --- arithmetic. limit 100; the application measured 40 bytes at mark M
M=$($Q -c "select public.saas_storage_mark()")
r=$(reserve co_a 50 100 40 "$M"); check "50 bytes on top of 40 measured fit in 100" "$(echo "$r" | grep -o '"ok": true')" '"ok": true'
ID1=$(echo "$r" | grep -o '"id": "[^"]*"' | cut -d'"' -f4)
check "the used figure returned is the measured one" "$(echo "$r" | grep -o '"used": [0-9]*')" '"used": 40'
r=$(reserve co_a 20 100 40 "$M"); check "20 more do NOT fit (40 measured + 50 pending + 20 > 100)" "$(echo "$r" | grep -o '"ok": false')" '"ok": false'
check "the refusal says how much is counted (90) and how much of it is in flight (50)" "$(echo "$r" | grep -oE '"(used|in_flight)": [0-9]+' | sort | tr '\n' ' ')" '"in_flight": 50 "used": 90 '
$Q -c "select public.saas_storage_settle('$ID1', 'release')" > /dev/null
check "a released reservation leaves no row" "$($Q -c "select count(*) from saas_storage_reservations")" "0"
r=$(reserve co_a 20 100 40 "$M"); check "after the release the 20 fit again" "$(echo "$r" | grep -o '"ok": true')" '"ok": true'
ID2=$(echo "$r" | grep -o '"id": "[^"]*"' | cut -d'"' -f4)
$Q -c "select public.saas_storage_settle('$ID2', 'commit')" > /dev/null
check "a committed reservation becomes 'done' with a sequence number" "$($Q -c "select state || ':' || (done_seq is not null) from saas_storage_reservations where id='$ID2'")" "done:true"
r=$(reserve co_a 45 100 40 "$M"); check "a process whose listing is OLDER than the commit still counts it (40 + 20 + 45 > 100)" "$(echo "$r" | grep -o '"ok": false')" '"ok": false'
M2=$($Q -c "select public.saas_storage_mark()")
r=$(reserve co_a 45 100 60 "$M2"); check "a process that listed AFTER the commit has it in its listing and does not count it twice (60 measured + 45 = 105 > 100 refused, 60 + 40 fits)" "$(echo "$r" | grep -o '"ok": false')" '"ok": false'
r=$(reserve co_a 40 100 60 "$M2"); check "...exactly 40 more fit" "$(echo "$r" | grep -o '"ok": true')" '"ok": true'
$Q -c "select public.saas_storage_settle('$(echo "$r" | grep -o '"id": "[^"]*"' | cut -d'"' -f4)', 'commit')" > /dev/null
$Q -c "select public.saas_storage_settle('$ID2', 'commit')" > /dev/null; $Q -c "select public.saas_storage_settle('00000000-0000-0000-0000-000000000000', 'release')" > /dev/null
check "settling twice, or an unknown id, is not an error" "$?" "0"

# --- expiry. A pending reservation of a dead process stops counting; a finished one is purged after its retain period; the purge happens on the next reserve
$P -c "delete from saas_storage_reservations"
r=$(reserve co_a 90 100 0 "$M2" 60 900); IDX=$(echo "$r" | grep -o '"id": "[^"]*"' | cut -d'"' -f4)
r=$(reserve co_a 20 100 0 "$M2"); check "a live pending reservation counts" "$(echo "$r" | grep -o '"ok": false')" '"ok": false'
$P -c "update saas_storage_reservations set expires_at = clock_timestamp() - interval '1 second' where id='$IDX'"
r=$(reserve co_a 20 100 0 "$M2"); check "the same reservation, expired, no longer counts" "$(echo "$r" | grep -o '"ok": true')" '"ok": true'
check "...and the expired row was purged by that call" "$($Q -c "select count(*) from saas_storage_reservations where id='$IDX'")" "0"

# --- argument checks and isolation between companies
check "a zero byte reservation is refused" "$(as service_role "select public.saas_storage_reserve('co_a', 0, 100, 0, 1)")" "saas_storage_reserve: invalid arguments"
check "a negative limit is refused" "$(as service_role "select public.saas_storage_reserve('co_a', 1, -1, 0, 1)")" "saas_storage_reserve: invalid arguments"
check "an unknown outcome is refused" "$(as service_role "select public.saas_storage_settle('00000000-0000-0000-0000-000000000000', 'nonsense')")" "saas_storage_settle: outcome must be commit or release"
check "a company that does not exist cannot hold a reservation (foreign key)" "$($P -c "select public.saas_storage_reserve('nope', 1, 100, 0, 1)" 2>&1 | grep -c 'violates foreign key')" "1"
$P -c "delete from saas_storage_reservations"
reserve co_a 100 100 0 "$M2" > /dev/null
r=$(reserve co_b 100 100 0 "$M2"); check "another company's reservations never count (co_b still has its whole limit)" "$(echo "$r" | grep -o '"ok": true')" '"ok": true'

# --- privileges
check "the service role may call the functions" "$(as service_role "select public.saas_storage_mark() > 0")" "t"
check "the tenant role may NOT call reserve" "$(as crm_tenant "select public.saas_storage_reserve('co_a', 1, 100, 0, 1)")" "permission denied for function saas_storage_reserve"
check "the tenant role may NOT call settle" "$(as crm_tenant "select public.saas_storage_settle('00000000-0000-0000-0000-000000000000', 'release')")" "permission denied for function saas_storage_settle"
check "the tenant role may NOT call mark" "$(as crm_tenant "select public.saas_storage_mark()")" "permission denied for function saas_storage_mark"
check "the tenant role cannot read the table" "$(as crm_tenant "select count(*) from saas_storage_reservations")" "permission denied for table saas_storage_reservations"
check "the public role cannot call the functions" "$($P -c "set role anon; select public.saas_storage_mark()" 2>&1 | grep -c 'permission denied')" "1"

# --- concurrency: 40 sessions at once, limit 10, 1 byte each, nothing measured: exactly 10 are admitted. Repeated 5 times with a fresh company state.
for round in 1 2 3 4 5; do
  $P -c "delete from saas_storage_reservations"
  M3=$($Q -c "select public.saas_storage_mark()")
  tmp=$(mktemp -d)
  for i in $(seq 1 40); do ( $Q -c "select public.saas_storage_reserve('co_a', 1, 10, 0, $M3)" > "$tmp/$i" 2>&1 ) & done
  wait
  admitted=$(cat "$tmp"/* | grep -c '"ok": true' || true); refused=$(cat "$tmp"/* | grep -c '"ok": false' || true)
  check "round $round: 40 simultaneous sessions, room for 10: admitted exactly 10 (refused $refused)" "$admitted:$refused" "10:30"
  check "round $round: the table holds exactly 10 reservations" "$($Q -c "select count(*) from saas_storage_reservations where company_id='co_a'")" "10"
  rm -rf "$tmp"
done

# --- negative control: the SAME function without its advisory lock admits far more than the limit when sessions race (so the test above can fail)
$Q -c "select replace(replace(pg_get_functiondef('public.saas_storage_reserve(text,bigint,bigint,bigint,bigint,integer,integer)'::regprocedure), 'saas_storage_reserve', 'saas_storage_reserve_nolock'), 'perform pg_advisory_xact_lock(hashtextextended(''saas_storage:'' || p_company, 0));', 'null;')" > /tmp/nolock-$$.sql
grep -q "advisory" /tmp/nolock-$$.sql && { echo "FAIL: could not strip the lock from the control function"; bad=$((bad+1)); } || true
$P -f /tmp/nolock-$$.sql > /dev/null 2>&1; rm -f /tmp/nolock-$$.sql
most=0
for round in 1 2 3 4 5; do
  $P -c "delete from saas_storage_reservations"
  M4=$($Q -c "select public.saas_storage_mark()"); tmp=$(mktemp -d)
  for i in $(seq 1 40); do ( $Q -c "select public.saas_storage_reserve_nolock('co_a', 1, 10, 0, $M4)" > "$tmp/$i" 2>&1 ) & done
  wait
  n=$(cat "$tmp"/* | grep -c '"ok": true' || true); [ "$n" -gt "$most" ] && most=$n; rm -rf "$tmp"
done
check "NEGATIVE CONTROL: without the lock the same race admits MORE than the 10 that fit (most in 5 rounds: $most)" "$([ "$most" -gt 10 ] && echo yes || echo no)" "yes"

# --- deleting a company removes its reservations
$P -c "delete from companies where id='co_b'"
check "deleting a company removes its reservations" "$($Q -c "select count(*) from saas_storage_reservations where company_id='co_b'")" "0"

echo; echo "storage reservations (phase2h): $ok passed, $bad failed"; [ "$bad" = 0 ]
