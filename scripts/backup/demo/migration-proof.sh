#!/usr/bin/env bash
# Live proof of the Smart Quote migration and rollback on SCRATCH databases (never production).
#   bash scripts/backup/demo/migration-proof.sh <directory holding smart-quote-versions-schema.sql and -rollback.sql>
# Needs E2E_STACK_DIR (socket dir, must be /srv/e2e-*) and E2E_PG_PORT of a scratch cluster that has the roles anon, authenticated, service_role.
# Each check prints PASS/FAIL; exit status is the number of failures. Run it against the original files to see which checks the old version fails.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$(cd "${1:?directory with the migration files}" && pwd)"
case "${E2E_STACK_DIR:?}" in /srv/e2e-*) ;; *) echo "refusing: E2E_STACK_DIR must be a /srv/e2e-* scratch directory"; exit 2;; esac
PORT="${E2E_PG_PORT:?}"; TAG="$(date +%s | tail -c 6)"
APPLY="$MIG/smart-quote-versions-schema.sql"; ROLLBACK="$MIG/smart-quote-versions-rollback.sql"
P0="psql -h $E2E_STACK_DIR -p $PORT -U postgres -X -q"
pd() { echo "$P0 -d $1"; }
FAILS=0
check() { if [ "$2" = ok ]; then echo "PASS: $1${3:+ - $3}"; else echo "FAIL: $1${3:+ - $3}"; FAILS=$((FAILS + 1)); fi; }
mk() { bash "$HERE/new-exp-db.sh" "$1" >/dev/null 2>&1 || { echo "cannot create $1"; exit 2; }; }
drop() { $P0 -d postgres -c "drop database if exists $1 with (force)" >/dev/null 2>&1; }
ins() { $(pd "$1") -c "insert into public.smart_quote_versions (id, quote_number, lead_id, customer_id, version_number, client_name, client_phone, system_capacity_kw, panel, inverter, battery, structure, total_pkr, payload_sha256, generated_at) values ('sqv-$2','$3','$4','$5',$6,'Synthetic','923015550001',8,'p','i','b','s',1000000,'x',now())" >/dev/null; }
man() { $(pd "$1") -F $'\t' -f "$HERE/../manifest.sql" 2>/dev/null | LC_ALL=C sort | grep -v '^info'; }

# ---------- 1. apply twice (idempotency) ----------
D1="proof_${TAG}_1"; mk $D1
$(pd $D1) -v ON_ERROR_STOP=1 -f "$APPLY" >/dev/null 2>&1; rc1=$?
man $D1 > /tmp/proof-m1.tsv
$(pd $D1) -v ON_ERROR_STOP=1 -f "$APPLY" >/dev/null 2>&1; rc2=$?
man $D1 > /tmp/proof-m2.tsv
[ $rc1 = 0 ] && [ $rc2 = 0 ] && check "apply twice exits 0 both times" ok || check "apply twice exits 0 both times" bad "exit $rc1/$rc2"
diff -q /tmp/proof-m1.tsv /tmp/proof-m2.tsv >/dev/null && check "state identical after the second apply (all definition hashes, counts)" ok || check "state identical after the second apply" bad
# objects present
n=$($(pd $D1) -tA -c "select (select count(*) from pg_policies where tablename='smart_quote_versions') || '/' || (select count(*) from pg_trigger where tgname='smart_quote_versions_immutable') || '/' || (select relrowsecurity::int from pg_class where relname='smart_quote_versions')")
[ "$n" = "1/1/1" ] && check "policy, trigger and RLS present" ok "$n" || check "policy, trigger and RLS present" bad "$n"

# ---------- 2. locks (measured on a fresh database: the foreign keys are only created on the first apply) ----------
D7="proof_${TAG}_7"; mk $D7
LOCKS=$(E2E_STACK_DIR=$E2E_STACK_DIR E2E_PG_PORT=$PORT bash "$HERE/lock-capture.sh" $D7 "$APPLY" 2>&1)
echo "$LOCKS" | grep -E "^ (leads|customers) " | sed 's/^/      apply: /'
if echo "$LOCKS" | grep -E "^ (leads|customers) " | grep -q "ShareRowExclusiveLock" && ! echo "$LOCKS" | grep -E "^ (leads|customers) " | grep -q "AccessExclusiveLock"; then check "apply holds only SHARE ROW EXCLUSIVE on leads/customers (writes wait, reads continue), $(echo "$LOCKS" | grep -o 'wall clock: [0-9]* ms')" ok; else check "apply holds only SHARE ROW EXCLUSIVE on leads/customers" bad; fi
RLOCKS=$(E2E_STACK_DIR=$E2E_STACK_DIR E2E_PG_PORT=$PORT bash "$HERE/lock-capture.sh" $D7 "$ROLLBACK" 2>&1)
echo "$RLOCKS" | grep -E "^ (leads|customers) " | sed 's/^/      rollback: /'
echo "$RLOCKS" | grep -E "^ (leads|customers) " | grep -q "AccessExclusiveLock" && echo "INFO: rollback takes ACCESS EXCLUSIVE on leads/customers (reads AND writes wait) for $(echo "$RLOCKS" | grep -o 'wall clock: [0-9]* ms'); run it in a quiet moment"

# ---------- 3. a waiting migration must not freeze other writers indefinitely ----------
D2="proof_${TAG}_2"; mk $D2
( $(pd $D2) -qAt -c "begin; update leads set notes = notes where id = 'lead-leg-3'; select pg_sleep(14); commit;" >/dev/null 2>&1 ) & APID=$!
sleep 1
s=$(date +%s.%N); $(pd $D2) -v ON_ERROR_STOP=1 -f "$APPLY" >/dev/null 2>/tmp/proof-wait.err; rcw=$?; e=$(date +%s.%N)
waited=$(echo "$e - $s" | bc -l | cut -c1-4)
if [ $rcw != 0 ] && grep -q "lock timeout" /tmp/proof-wait.err && [ "$(echo "$waited < 8" | bc -l)" = 1 ]; then check "migration gives up on lock contention instead of queueing indefinitely" ok "exit $rcw after ${waited}s: $(grep -m1 -o 'canceling statement due to lock timeout' /tmp/proof-wait.err)"; else check "migration gives up on lock contention instead of queueing indefinitely" bad "exit $rcw after ${waited}s (it waited for the other transaction)"; fi
[ "$($(pd $D2) -tA -c "select to_regclass('public.smart_quote_versions') is null")" = t ] && check "a timed-out migration changed nothing" ok || check "a timed-out migration changed nothing" bad
wait $APID
$(pd $D2) -v ON_ERROR_STOP=1 -f "$APPLY" >/dev/null 2>&1 && check "re-run after the blocker ended succeeds" ok || check "re-run after the blocker ended succeeds" bad

# ---------- 4. pre-existing table with an older shape must fail loudly ----------
D3="proof_${TAG}_3"; mk $D3
# an earlier draft of the table that lacks ONLY pdf_saved_at: nothing in the migration touches that column, so the old script succeeds silently
$(pd $D3) -c "create table public.smart_quote_versions (id text primary key, quote_number text not null unique check (quote_number ~ '^SES-[0-9]{8}-[0-9]{4}\$'), lead_id text not null references public.leads(id) on delete restrict, customer_id text references public.customers(id) on delete set null, version_number integer not null check (version_number > 0), source text not null default 'Smart Quote', client_name text not null, client_phone text not null, client_city text, system_capacity_kw numeric not null, panel text not null, inverter text not null, battery text not null, structure text not null, lines jsonb, subtotal_pkr numeric, discount_pkr numeric, total_pkr numeric not null check (total_pkr >= 0), payload_sha256 text not null, generated_at timestamptz not null, created_at timestamptz not null default now(), pdf_file_name text, pdf_file_url text, pdf_storage_path text, pdf_sha256 text, pdf_size_bytes integer, constraint smart_quote_versions_lead_version_key unique (lead_id, version_number))" >/dev/null 2>&1
$(pd $D3) -v ON_ERROR_STOP=1 -f "$APPLY" >/dev/null 2>/tmp/proof-drift.err; rcd=$?
[ $rcd != 0 ] && check "an older-shaped pre-existing table makes the migration fail (exit $rcd)" ok "$(grep -m1 -o 'different shape[^.]*' /tmp/proof-drift.err | cut -c1-120)" || check "an older-shaped pre-existing table makes the migration fail" bad "exit 0: silently kept the old shape"

# ---------- 5. rollback / re-apply / rollback keeps every version ----------
D4="proof_${TAG}_4"; mk $D4
$(pd $D4) -c "alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated" >/dev/null
$(pd $D4) -v ON_ERROR_STOP=1 -f "$APPLY" >/dev/null 2>&1
ins $D4 a1 SES-20261001-0001 lead-leg-1 cust-leg-1 1; ins $D4 a2 SES-20261001-0002 lead-leg-2 cust-leg-2 1
$(pd $D4) -v ON_ERROR_STOP=1 -f "$ROLLBACK" >/dev/null 2>&1; r1=$?
$(pd $D4) -v ON_ERROR_STOP=1 -f "$APPLY" >/dev/null 2>&1
ins $D4 b1 SES-20261002-0003 lead-leg-1 cust-leg-1 1
$(pd $D4) -v ON_ERROR_STOP=1 -f "$ROLLBACK" >/dev/null 2>&1; r2=$?
q="select string_agg(distinct quote_number, ',' order by quote_number) from public.smart_quote_versions_rollback_backup"
got=$($(pd $D4) -tA -c "$q" 2>/dev/null)
[ "$got" = "SES-20261001-0001,SES-20261001-0002,SES-20261002-0003" ] && check "after rollback, re-apply, rollback the backup holds all three quotations" ok || check "after rollback, re-apply, rollback the backup holds all three quotations" bad "backup has: ${got:-nothing}"
[ "$($(pd $D4) -tA -c "select to_regclass('public.smart_quote_versions') is null")" = t ] && check "feature removed after rollback (app falls back to notes)" ok || check "feature removed after rollback" bad
anon=$($(pd $D4) -tA -c "set role anon; select count(*) from public.smart_quote_versions_rollback_backup" 2>&1 | tail -1)
case "$anon" in *"permission denied"*) check "the rollback backup (client phone numbers) is NOT readable by anon even with Supabase-style default privileges" ok;; *) check "the rollback backup is NOT readable by anon" bad "anon query returned: $anon";; esac
svc=$($(pd $D4) -tA -c "set role service_role; select count(*) from public.smart_quote_versions_rollback_backup" 2>&1 | tail -1)
case "$svc" in *"permission denied"*) check "...nor by service_role (operator-only)" ok;; *) check "...nor by service_role" bad "returned: $svc";; esac
[ "$($(pd $D4) -tA -c "select relrowsecurity from pg_class where relname='smart_quote_versions_rollback_backup'")" = t ] && check "RLS enabled on the backup table" ok || check "RLS enabled on the backup table" bad
# a third cycle: new batch appended, old batches kept
$(pd $D4) -v ON_ERROR_STOP=1 -f "$APPLY" >/dev/null 2>&1; ins $D4 c1 SES-20261003-0004 lead-leg-4 cust-leg-4 1
$(pd $D4) -v ON_ERROR_STOP=1 -f "$ROLLBACK" >/dev/null 2>&1
b=$($(pd $D4) -tA -c "select count(distinct backed_up_at) || ' batches, ' || count(distinct quote_number) || ' distinct quotes' from public.smart_quote_versions_rollback_backup")
[ "$b" = "3 batches, 4 distinct quotes" ] && check "append-only backup: $b" ok || check "append-only backup" bad "$b"

# ---------- 6. rollback on an absent table, and an incomplete copy aborts without dropping ----------
D5="proof_${TAG}_5"; mk $D5
$(pd $D5) -v ON_ERROR_STOP=1 -f "$ROLLBACK" >/dev/null 2>&1; r0=$?
[ $r0 = 0 ] && [ "$($(pd $D5) -tA -c "select to_regclass('public.smart_quote_versions_rollback_backup') is null")" = t ] && check "rollback on a database without the table is a harmless no-op" ok || check "rollback on a database without the table is a harmless no-op" bad "exit $r0 (the old script errors here)"
$(pd $D5) -v ON_ERROR_STOP=1 -f "$APPLY" >/dev/null 2>&1; ins $D5 d1 SES-20261004-0005 lead-leg-1 cust-leg-1 1; ins $D5 d2 SES-20261004-0006 lead-leg-2 cust-leg-2 1
$(pd $D5) -c "create table public.smart_quote_versions_rollback_backup (backed_up_at timestamptz not null, like public.smart_quote_versions); create function public.skip_one() returns trigger language plpgsql as \$f\$ begin if new.quote_number = 'SES-20261004-0006' then return null; end if; return new; end \$f\$; create trigger skip_one before insert on public.smart_quote_versions_rollback_backup for each row execute function public.skip_one();" >/dev/null 2>&1
$(pd $D5) -v ON_ERROR_STOP=1 -f "$ROLLBACK" >/dev/null 2>/tmp/proof-incomplete.err; r5=$?
if [ $r5 != 0 ] && [ "$($(pd $D5) -tA -c "select count(*) from public.smart_quote_versions")" = 2 ]; then check "an incomplete backup copy aborts the rollback and drops nothing" ok "$(grep -m1 -o 'rollback aborted[^;]*' /tmp/proof-incomplete.err | cut -c1-90)"; else check "an incomplete backup copy aborts the rollback and drops nothing" bad "exit $r5, versions left: $($(pd $D5) -tA -c 'select count(*) from public.smart_quote_versions' 2>&1)"; fi

# ---------- 7. foreign key type mismatch fails atomically ----------
D6="proof_${TAG}_6"; $P0 -d postgres -c "create database $D6" >/dev/null; $(pd $D6) -c "create table public.leads (id uuid primary key); create table public.customers (id text primary key);" >/dev/null
$(pd $D6) -v ON_ERROR_STOP=1 -f "$APPLY" >/dev/null 2>/tmp/proof-uuid.err; ru=$?
[ $ru != 0 ] && [ "$($(pd $D6) -tA -c "select to_regclass('public.smart_quote_versions') is null")" = t ] && check "leads.id of another type fails the migration atomically (nothing left behind)" ok "$(grep -m1 -o 'incompatible types[^"]*' /tmp/proof-uuid.err | cut -c1-70)" || check "leads.id of another type fails atomically" bad "exit $ru"

for d in $D1 $D2 $D3 $D4 $D5 $D6 $D7; do drop $d; done
echo "---"; echo "$FAILS check(s) failed"; exit $FAILS
