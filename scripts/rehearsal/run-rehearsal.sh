#!/usr/bin/env bash
# Deployment rehearsal on a RESTORED COPY: preflight -> encrypted backup -> restore into a scratch server -> migrations one by one
# (verify, rollback, re-apply) -> proof that pre-existing data is untouched.   NOTHING here writes to the source database.
#
#   SRC_PGHOST=... SRC_PGPORT=... SRC_PGUSER=... SRC_PGDATABASE=... [SRC_PGPASSWORD=...] \
#   RESTORE_PGHOST=... RESTORE_PGPORT=... RESTORE_PGUSER=... [RESTORE_PGPASSWORD=...] \
#   REHEARSAL_DIR=/path/for/reports  bash scripts/rehearsal/run-rehearsal.sh
#
# The source is only ever read (pg_dump inside pg-backup.sh, read-only preflights). The scratch server must be a different server
# from the source; the restored database is named restore_rehearsal and is dropped and re-created on every run.
# Exit status = number of FAIL lines. Output: one PASS/FAIL line per check, reports under $REHEARSAL_DIR.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
: "${SRC_PGHOST:?}" "${SRC_PGPORT:?}" "${SRC_PGUSER:?}" "${SRC_PGDATABASE:?}" "${RESTORE_PGHOST:?}" "${RESTORE_PGPORT:?}" "${RESTORE_PGUSER:?}" "${REHEARSAL_DIR:?}"
[ "$SRC_PGHOST:$SRC_PGPORT" != "$RESTORE_PGHOST:$RESTORE_PGPORT" ] || { echo "refusing: source and scratch server are the same"; exit 2; }
mkdir -p "$REHEARSAL_DIR/keys" "$REHEARSAL_DIR/backup" "$REHEARSAL_DIR/logs"; chmod 700 "$REHEARSAL_DIR" "$REHEARSAL_DIR/keys"
DB=restore_rehearsal
TAB=$'\t'
FAILS=0
pass() { echo "PASS: $1${2:+ - $2}"; }
fail() { echo "FAIL: $1${2:+ - $2}"; FAILS=$((FAILS + 1)); }
check() { if [ "$2" = ok ]; then pass "$1" "${3:-}"; else fail "$1" "${3:-}"; fi; }

SRC() { PGHOST="$SRC_PGHOST" PGPORT="$SRC_PGPORT" PGUSER="$SRC_PGUSER" PGPASSWORD="${SRC_PGPASSWORD:-}" PGOPTIONS='-c default_transaction_read_only=on' "$@"; }
TGT() { PGHOST="$RESTORE_PGHOST" PGPORT="$RESTORE_PGPORT" PGUSER="$RESTORE_PGUSER" PGPASSWORD="${RESTORE_PGPASSWORD:-}" "$@"; }
read -r -d '' ACLQ <<'SQL' || true
select md5(string_agg(format('%s.%s %s', n.nspname, c.relname,
         regexp_replace(coalesce(c.relacl, acldefault((case c.relkind when 'S' then 's' else 'r' end)::"char", c.relowner))::text, '=([a-zA-Z*]*)m([a-zA-Z*]*)/', '=\1\2/', 'g')), '|' order by n.nspname, c.relname))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','p','v','m','S') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
SQL
aclmd5() { TGT psql -X -qAt -d "$DB" -c "$ACLQ"; }   # ACLs normalised across majors: NULL = owner default, PG17 MAINTAIN letter removed
manifest() { TGT psql -X -q -d "$DB" -F "$TAB" -f "$REPO/scripts/backup/manifest.sql" 2>/dev/null | LC_ALL=C sort | grep -v '^info'; }

echo "== 0. versions"
SRC_VER="$(SRC psql -X -qAt -d "$SRC_PGDATABASE" -c 'show server_version')"; TGT_VER="$(TGT psql -X -qAt -d postgres -c 'show server_version')"
echo "source server $SRC_VER | scratch server $TGT_VER | client $(psql --version | awk '{print $3}') | pg_dump $(pg_dump --version | awk '{print $3}')"
check "scratch server is PostgreSQL 17" "$([ "${TGT_VER%%.*}" = 17 ] && echo ok || echo bad)" "$TGT_VER"

echo "== 1. read-only preflights on the SOURCE"
for f in smart-quote-versions-preflight session-revocation-preflight invoice-payments-preflight; do
  SRC psql -X -v ON_ERROR_STOP=1 -d "$SRC_PGDATABASE" -f "$REPO/scripts/$f.sql" > "$REHEARSAL_DIR/logs/$f.out" 2>&1
  rc=$?; blockers="$(grep -cE '\| BLOCKER +\|' "$REHEARSAL_DIR/logs/$f.out" || true)"
  check "preflight $f runs read-only" "$([ $rc = 0 ] && echo ok || echo bad)" "exit $rc, BLOCKER rows: $blockers"
done
sed -n '/=== 1. VERDICT ===/,/=== 2/p' "$REHEARSAL_DIR/logs/invoice-payments-preflight.out" | head -30

echo "== 2. encrypted backup of the source (no upload)"
[ -f "$REHEARSAL_DIR/keys/owner.key" ] || age-keygen -o "$REHEARSAL_DIR/keys/owner.key" >/dev/null 2>&1
[ -f "$REHEARSAL_DIR/keys/escrow.key" ] || age-keygen -o "$REHEARSAL_DIR/keys/escrow.key" >/dev/null 2>&1
RECIP="$(age-keygen -y "$REHEARSAL_DIR/keys/owner.key"),$(age-keygen -y "$REHEARSAL_DIR/keys/escrow.key")"
rm -rf "$REHEARSAL_DIR/backup"/*
PGHOST="$SRC_PGHOST" PGPORT="$SRC_PGPORT" PGUSER="$SRC_PGUSER" PGPASSWORD="${SRC_PGPASSWORD:-}" PGDATABASE="$SRC_PGDATABASE" BACKUP_AGE_RECIPIENTS="$RECIP" \
  bash "$REPO/scripts/backup/pg-backup.sh" --out-dir "$REHEARSAL_DIR/backup" --no-upload > "$REHEARSAL_DIR/logs/backup.out" 2>&1
check "pg-backup.sh finished" "$([ $? = 0 ] && echo ok || echo bad)" "$(tail -1 "$REHEARSAL_DIR/logs/backup.out" | cut -c1-120)"
SET_DIR="$(ls -d "$REHEARSAL_DIR/backup"/*/ 2>/dev/null | head -1)"; SET_DIR="${SET_DIR%/}"
check "backup set is encrypted (no plaintext dump on disk)" "$([ -f "$SET_DIR/db.dump.age" ] && ! ls "$SET_DIR" | grep -qE '^db\.dump$|\.sql$' && echo ok || echo bad)" "$(ls "$SET_DIR" | tr '\n' ' ')"

echo "== 3. restore into the scratch PostgreSQL 17 server and compare with the source manifest"
RESTORE_PGHOST="$RESTORE_PGHOST" RESTORE_PGPORT="$RESTORE_PGPORT" RESTORE_PGUSER="$RESTORE_PGUSER" RESTORE_PGPASSWORD="${RESTORE_PGPASSWORD:-}" \
  bash "$REPO/scripts/backup/restore-verify.sh" --backup-dir "$SET_DIR" --identity "$REHEARSAL_DIR/keys/owner.key" --target-db "$DB" --replace --keep > "$REHEARSAL_DIR/logs/restore.out" 2>&1
rc=$?
if [ $rc = 3 ] && [ "${SRC_VER%%.*}" != "${TGT_VER%%.*}" ]; then
  # Cross-major only: PostgreSQL 17 adds the MAINTAIN privilege ('m') to every table ACL string and stores an owner-only ACL as NULL. Accept
  # exit 3 solely when the ONLY differing manifest line is relation_acls AND the two ACL sets are identical once normalised.
  nd="$(grep -cE '^[<>] ' "$REHEARSAL_DIR/logs/restore.out" || true)"; other="$(grep -E '^[<>] ' "$REHEARSAL_DIR/logs/restore.out" | grep -vc 'defs.relation_acls' || true)"
  a="$(SRC psql -X -qAt -d "$SRC_PGDATABASE" -c "$ACLQ")"; b="$(aclmd5)"
  if [ "$other" = 0 ] && [ "$nd" = 2 ] && [ -n "$a" ] && [ "${#a}" = 32 ] && [ "$a" = "$b" ]; then rc=0; echo "NOTE: cross-major restore ($SRC_VER -> $TGT_VER): only relation ACL text differs: PostgreSQL 17's MAINTAIN privilege letter, and owner-only ACLs stored as NULL (the default); identical in effect once normalised"; fi
fi
check "restore-verify.sh: every table row-hash, definition, ACL and sequence equals the source" "$([ $rc = 0 ] && echo ok || echo bad)" "exit $rc; $(tail -2 "$REHEARSAL_DIR/logs/restore.out" | tr '\n' ' ' | cut -c1-200)"
[ $rc = 0 ] || { echo "cannot continue without a verified restore"; exit $((FAILS > 0 ? FAILS : 1)); }
# deliberate corruption must be detected (proves the comparison is not vacuous)
TGT psql -X -qAt -d "$DB" -c "update public.users set name = name || 'x' where id = (select id from public.users limit 1)" >/dev/null 2>&1
RESTORE_PGHOST="$RESTORE_PGHOST" RESTORE_PGPORT="$RESTORE_PGPORT" RESTORE_PGUSER="$RESTORE_PGUSER" RESTORE_PGPASSWORD="${RESTORE_PGPASSWORD:-}" \
  bash "$REPO/scripts/backup/restore-verify.sh" --backup-dir "$SET_DIR" --identity "$REHEARSAL_DIR/keys/owner.key" --target-db "$DB" --compare-only > "$REHEARSAL_DIR/logs/restore-detect.out" 2>&1
drc=$?; check "a single altered cell in the restored copy is detected (exit 3, public.users row-hash differs)" "$([ $drc = 3 ] && grep -qE "^[<>] table.public.users" "$REHEARSAL_DIR/logs/restore-detect.out" && echo ok || echo bad)"
RESTORE_PGHOST="$RESTORE_PGHOST" RESTORE_PGPORT="$RESTORE_PGPORT" RESTORE_PGUSER="$RESTORE_PGUSER" RESTORE_PGPASSWORD="${RESTORE_PGPASSWORD:-}" \
  bash "$REPO/scripts/backup/restore-verify.sh" --backup-dir "$SET_DIR" --identity "$REHEARSAL_DIR/keys/owner.key" --target-db "$DB" --replace --keep > "$REHEARSAL_DIR/logs/restore2.out" 2>&1
r2=$?; [ $r2 = 3 ] && [ "$(grep -E "^[<>] " "$REHEARSAL_DIR/logs/restore2.out" | grep -vc "defs.relation_acls")" = 0 ] && r2=0
check "restore repeated cleanly after the detection test" "$([ $r2 = 0 ] && echo ok || echo bad)"

manifest > "$REHEARSAL_DIR/m0-restored.tsv"; A0="$(aclmd5)"
ROWS_BEFORE="$(grep -c '^table' "$REHEARSAL_DIR/m0-restored.tsv")"
echo "restored copy: $ROWS_BEFORE tables"

apply() { # name file [verify-file]
  local name="$1" file="$2"
  local t0; t0=$(date +%s.%N)
  TGT psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$REPO/scripts/$file" > "$REHEARSAL_DIR/logs/apply-$name.out" 2>&1
  local rc=$? ms; ms=$(awk -v a="$t0" -v b="$(date +%s.%N)" 'BEGIN{printf "%d", (b-a)*1000}')
  check "apply $name" "$([ $rc = 0 ] && echo ok || echo bad)" "${ms} ms"
}
verify_sql() { # label file expected-problem-pattern
  TGT psql -X -d "$DB" -f "$REPO/scripts/$2" > "$REHEARSAL_DIR/logs/verify-$1.out" 2>&1
  local bad env; bad="$(grep -E '^ FAIL|PROBLEM' "$REHEARSAL_DIR/logs/verify-$1.out" | grep -vc 'PostgREST is listening' || true)"
  env="$(grep -E '^ FAIL' "$REHEARSAL_DIR/logs/verify-$1.out" | grep -c 'PostgREST is listening' || true)"
  check "verify $1" "$([ "$bad" = 0 ] && echo ok || echo bad)" "$bad problem rows; $env environment row(s) skipped (no PostgREST attached to the scratch database in this script - covered by the app smoke)"
}
# data of every table that existed before must be identical after a migration (rows and hashes), except tables a migration is allowed to touch
same_data() { # label allowed-tables-regex
  manifest > "$REHEARSAL_DIR/m-$1.tsv"
  local d; d="$(diff <(grep '^table' "$REHEARSAL_DIR/m0-restored.tsv") <(grep '^table' "$REHEARSAL_DIR/m-$1.tsv") | grep -E '^<' | grep -vE "${2:-^$}" | wc -l)"
  check "after $1: row counts and row hashes of all pre-existing tables unchanged" "$([ "$d" = 0 ] && echo ok || echo bad)" "$d tables differ"
}

echo "== 4. migrations on the restored copy, in deployment order"
apply smart-quote-versions smart-quote-versions-schema.sql
verify_sql smart-quote-versions smart-quote-versions-verify.sql
same_data smart-quote-versions
apply session-revocation session-revocation-schema.sql
check "session revocation objects exist" "$(TGT psql -X -qAt -d "$DB" -c "select (to_regclass('public.revoked_sessions') is not null and exists(select 1 from information_schema.columns where table_name='users' and column_name='session_epoch'))" | grep -q t && echo ok || echo bad)"
same_data session-revocation 'table.public.users[[:space:]]'
apply invoice-payments-integrity invoice-payments-integrity.sql
verify_sql invoice-payments invoice-payments-verify.sql
same_data invoice-payments-integrity 'table.public.users[[:space:]]'
apply invoice-save-atomic invoice-save-atomic.sql
check "invoice_save_atomic exists and is not executable by anon/authenticated" "$(TGT psql -X -qAt -d "$DB" -c "select to_regprocedure('public.invoice_save_atomic(text,timestamptz,jsonb,jsonb)') is not null and not has_function_privilege('anon','public.invoice_save_atomic(text,timestamptz,jsonb,jsonb)','execute') and not has_function_privilege('authenticated','public.invoice_save_atomic(text,timestamptz,jsonb,jsonb)','execute')" | grep -q t && echo ok || echo bad)"
same_data final-forward 'table.public.users[[:space:]]'
manifest > "$REHEARSAL_DIR/m1-migrated.tsv"; A1="$(aclmd5)"

echo "== 5. rollback in reverse order, then compare with the restored copy"
for r in invoice-save-atomic-rollback invoice-payments-integrity-rollback session-revocation-rollback smart-quote-versions-rollback; do
  TGT psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$REPO/scripts/$r.sql" > "$REHEARSAL_DIR/logs/$r.out" 2>&1
  check "rollback $r" "$([ $? = 0 ] && echo ok || echo bad)"
done
manifest > "$REHEARSAL_DIR/m2-rolledback.tsv"; A2="$(aclmd5)"
diff <(grep -v '^table' "$REHEARSAL_DIR/m0-restored.tsv" | grep -v relation_acls) <(grep -v '^table' "$REHEARSAL_DIR/m2-rolledback.tsv" | grep -v relation_acls) > "$REHEARSAL_DIR/rollback-residue.diff"
diff <(grep '^table' "$REHEARSAL_DIR/m0-restored.tsv" | grep -v 'smart_quote_versions_rollback_backup') <(grep '^table' "$REHEARSAL_DIR/m2-rolledback.tsv" | grep -v 'smart_quote_versions_rollback_backup') > "$REHEARSAL_DIR/rollback-data.diff"
check "rollback restores every pre-existing table's rows and hashes" "$([ ! -s "$REHEARSAL_DIR/rollback-data.diff" ] && echo ok || echo bad)" "$(wc -l < "$REHEARSAL_DIR/rollback-data.diff") differing lines"
check "rollback restores every definition (columns, constraints, indexes, triggers, policies, functions) and, normalised, every ACL" "$([ ! -s "$REHEARSAL_DIR/rollback-residue.diff" ] && [ -n "$A0" ] && [ "$A0" = "$A2" ] && echo ok || echo bad)" "$(wc -l < "$REHEARSAL_DIR/rollback-residue.diff") differing definition lines; ACL md5 $A0 vs $A2"
[ -s "$REHEARSAL_DIR/rollback-residue.diff" ] && cut -c1-150 "$REHEARSAL_DIR/rollback-residue.diff" | head -12

echo "== 6. re-apply everything (final state of the rehearsal)"
for f in smart-quote-versions-schema session-revocation-schema invoice-payments-integrity invoice-save-atomic; do
  TGT psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$REPO/scripts/$f.sql" > "$REHEARSAL_DIR/logs/reapply-$f.out" 2>&1
  check "re-apply $f after rollback" "$([ $? = 0 ] && echo ok || echo bad)"
done
manifest > "$REHEARSAL_DIR/m3-final.tsv"; A3="$(aclmd5)"
d="$(diff <(grep -v '^table' "$REHEARSAL_DIR/m1-migrated.tsv" | grep -v relation_acls) <(grep -v '^table' "$REHEARSAL_DIR/m3-final.tsv" | grep -v relation_acls) | wc -l)"
check "final state equals the first forward run (definitions exactly, ACLs normalised)" "$([ "$d" = 0 ] && [ -n "$A1" ] && [ "$A1" = "$A3" ] && echo ok || echo bad)" "$d differing definition lines; ACL md5 $A1 vs $A3"

echo "== summary: $FAILS FAIL"
exit "$FAILS"
