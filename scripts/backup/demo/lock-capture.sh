#!/usr/bin/env bash
# Runs a migration file on a SCRATCH database and prints every relation lock the migration transaction holds just before COMMIT,
# plus wall-clock time. usage: lock-capture.sh <db> <sql file>    (env: E2E_STACK_DIR, E2E_PG_PORT)
set -euo pipefail
DB="$1"; FILE="$2"; T="$(mktemp)"
LOCKQ="select c.relname as relation, case c.relkind when 'r' then 'table' when 'i' then 'index' when 'S' then 'sequence' else c.relkind::text end as kind, l.mode, l.granted from pg_locks l join pg_class c on c.oid = l.relation where l.pid = pg_backend_pid() and c.relnamespace = 'public'::regnamespace and l.locktype = 'relation' and l.mode <> 'AccessShareLock' order by (c.relkind = 'r') desc, 1, 3;"
# the first standalone COMMIT in the file is replaced by: lock listing + COMMIT
awk -v q="$LOCKQ" 'BEGIN{done=0} /^commit;$/ && !done {print q; print "commit;"; done=1; next} {print}' "$FILE" > "$T"
S=$(date +%s.%N)
psql -h "$E2E_STACK_DIR" -p "$E2E_PG_PORT" -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 -P pager=off -f "$T" 2>&1 | grep -v '^NOTICE' || true
E=$(date +%s.%N); printf 'wall clock: %.0f ms\n' "$(echo "($E - $S) * 1000" | bc -l)"
rm -f "$T"
