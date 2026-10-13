#!/usr/bin/env bash
# Shows what happens to other writers when a migration has to WAIT for a lock on leads/customers.
# usage: lock-pileup.sh <scratch db> <migration file>     (env: E2E_STACK_DIR, E2E_PG_PORT)
set -uo pipefail
DB="$1"; FILE="$2"; P="psql -h $E2E_STACK_DIR -p $E2E_PG_PORT -U postgres -d $DB -X -qAt"
t0=$(date +%s.%N); ts() { printf '[+%5.1fs] ' "$(echo "$(date +%s.%N) - $t0" | bc -l)"; }
# A: an ordinary application transaction that has updated one lead and is still open (e.g. a slow request / forgotten transaction)
$P -c "begin; update leads set notes = notes where id = 'lead-leg-3'; select pg_sleep(10); commit;" >/dev/null 2>&1 & APID=$!
sleep 1; ts; echo "A: transaction open on lead-leg-3 (10 s)"
( ts; echo "MIGRATION: started"; $P -v ON_ERROR_STOP=1 -f "$FILE" >/dev/null 2>"/tmp/pileup-mig.err"; rc=$?; ts; echo "MIGRATION: finished rc=$rc $(grep -m1 -i 'error' /tmp/pileup-mig.err | cut -c1-120)" ) & MPID=$!
sleep 2
$P -c "select 'migration backend wait: ' || coalesce(wait_event_type || '/' || wait_event, 'none') from pg_stat_activity where query ilike '%smart_quote_versions%' and pid <> pg_backend_pid() and state = 'active' limit 1" | sed "s/^/$(ts)/"
# C: an unrelated user saves a different lead (different row: normally never blocked by A)
( ts; echo "C: UPDATE of a DIFFERENT lead (lead-leg-2) sent"; s=$(date +%s.%N); $P -c "set lock_timeout = '15s'; update leads set notes = notes where id = 'lead-leg-2'" >/dev/null 2>&1; rc=$?; e=$(date +%s.%N); ts; printf 'C: UPDATE returned rc=%s after %.1f s\n' "$rc" "$(echo "$e - $s" | bc -l)" ) &
CPID=$!
# D: a read of the same table, and a write to an unrelated table
sleep 0.3; ( s=$(date +%s.%N); $P -c "select count(*) from leads" >/dev/null; e=$(date +%s.%N); ts; printf 'D: SELECT from leads took %.2f s (reads are not blocked)\n' "$(echo "$e - $s" | bc -l)" )
( s=$(date +%s.%N); $P -c "set lock_timeout='15s'; update invoices set notes = notes where false" >/dev/null 2>&1; e=$(date +%s.%N); ts; printf 'E: write to an unrelated table took %.2f s\n' "$(echo "$e - $s" | bc -l)" )
wait $APID $MPID $CPID 2>/dev/null
ts; echo "all sessions finished"
