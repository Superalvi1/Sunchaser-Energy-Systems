#!/usr/bin/env bash
# Encrypted, verifiable PostgreSQL backup for the Sunchaser CRM database (PROPOSED - not applied to production).
#
#   pg-backup.sh [--out-dir DIR] [--no-upload] [--prune] [--check-only]
#
# What it produces in DIR/<UTC stamp>/ (mode 700, files 600):
#   db.dump.age        pg_dump custom format (-Fc), encrypted to the age PUBLIC recipients; the host never holds the private key
#   roles.sql.age      role definitions WITHOUT passwords (anon, authenticated, service_role, authenticator, ...), memberships, role/db settings
#   manifest.tsv.age   per-table row count + order-independent row-hash, plus hashes of every column/constraint/index/trigger/policy/
#                      function/ACL definition, sequence values, extensions. Taken in the SAME snapshot as the dump (pg_export_snapshot),
#                      so concurrent writes cannot cause false alarms.
#   backup-info.json   versions, sizes, plaintext/ciphertext sha256 (no secrets)
#   SHA256SUMS[.sig]   sha256 of every file above; optionally signed (Ed25519) so a party who only has the bucket cannot forge a backup
#
# Connection (never on the command line): PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE, or BACKUP_DATABASE_URL (parsed in-process).
# Encryption (required): BACKUP_AGE_RECIPIENTS="age1...,age1..." and/or BACKUP_AGE_RECIPIENTS_FILE. Use two or more recipients.
# Upload (optional, strongly recommended): BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY
#   [BACKUP_S3_REGION=auto] [BACKUP_S3_PREFIX=db-backups] [BACKUP_S3_ADDRESSING=virtual|path] [BACKUP_S3_CACERT=file]
#   These are NOT the CRM bucket credentials. A second offsite copy uses the same variables with the BACKUP_OFFSITE_S3_ prefix.
# Other: BACKUP_OUT_DIR, BACKUP_WORK_DIR (tmpfs for plaintext), BACKUP_SIGNING_KEY (Ed25519 PEM), BACKUP_KEEP_DAILY=14 BACKUP_KEEP_WEEKLY=8 BACKUP_KEEP_MONTHLY=12,
#   BACKUP_MAX_SECONDS=1800, BACKUP_ALLOW_UNENCRYPTED=1 (tests only).
#
# Requires: bash, psql/pg_dump/pg_dumpall/pg_restore of a major version >= the server (PostgreSQL 17 for production), age, curl,
#           coreutils (sha256sum, date, shred), openssl (only when signing).
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(basename "$(dirname "$HERE")")" = scripts ]; then REPO_ROOT="$(cd "$HERE/../.." && pwd)"; else REPO_ROOT=""; fi   # empty when installed outside a checkout (container image)
# shellcheck source=lib.sh
. "$HERE/lib.sh"

OUT_DIR="${BACKUP_OUT_DIR:-}"; DO_UPLOAD=1; DO_PRUNE=0; CHECK_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --no-upload) DO_UPLOAD=0; shift ;;
    --prune) DO_PRUNE=1; shift ;;
    --check-only) CHECK_ONLY=1; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$OUT_DIR" ] || die "set --out-dir or BACKUP_OUT_DIR (a directory outside the git checkout)"
umask 077

# ---- 1. preconditions -------------------------------------------------------------------------------------------------
for t in psql pg_dump pg_dumpall pg_restore sha256sum date; do need "$t"; done
load_url_into_pgenv BACKUP_DATABASE_URL
: "${PGHOST:?PGHOST (or BACKUP_DATABASE_URL) is required}" "${PGUSER:?PGUSER is required}" "${PGDATABASE:?PGDATABASE is required}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}" PGAPPNAME="sunchaser-backup"

OUT_DIR="$(realpath -m "$OUT_DIR")"
# the guard comes first: nothing (not even a lock file) may be created inside a git checkout
if [ -n "$REPO_ROOT" ]; then case "$OUT_DIR/" in "$REPO_ROOT"/*) die "output directory is inside the git checkout ($REPO_ROOT); dumps and keys must never be stored in the repository" "$EX_GUARD" ;; esac; fi
need flock; mkdir -p "$OUT_DIR"; exec 9>"$OUT_DIR/.backup.lock"; flock -n 9 || die "another backup is already running against $OUT_DIR" "$EX_GUARD"

RECIPIENTS="$(mktemp)"; trap 'wipe "${RECIPIENTS:-}"' EXIT
if [ "${BACKUP_ALLOW_UNENCRYPTED:-0}" = 1 ]; then
  warn "BACKUP_ALLOW_UNENCRYPTED=1: files will NOT be encrypted (tests only)"; ENCRYPT=0
else
  need age; make_recipients_file "$RECIPIENTS" || die "no age PUBLIC recipients configured (BACKUP_AGE_RECIPIENTS / BACKUP_AGE_RECIPIENTS_FILE). Refusing to write an unencrypted dump." "$EX_GUARD"
  ENCRYPT=1
  [ "$(grep -Ec '^(age1|ssh-)' "$RECIPIENTS")" -ge 2 ] || warn "only one recipient configured: losing that key loses every backup. Add a second recipient (escrow)."
fi

SERVER_NUM="$(psql -X -qAt -v ON_ERROR_STOP=1 -c 'show server_version_num')" || die "cannot connect to the database (check PG* variables, network path and credentials)" "$EX_COMMAND"
SERVER_MAJOR="$(num_major "$SERVER_NUM")"
for t in pg_dump pg_dumpall pg_restore psql; do assert_client_at_least_server "$t" "$SERVER_MAJOR"; done
log "server PostgreSQL $SERVER_MAJOR (num $SERVER_NUM); clients pg_dump $(tool_major pg_dump), psql $(tool_major psql)"
if [ "$(psql -X -qAt -c 'select pg_is_in_recovery()')" = t ]; then warn "connected to a standby; snapshot export is unavailable there"; fi
[ "$CHECK_ONLY" = 1 ] && { log "precondition checks passed (check-only)"; exit 0; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL="$OUT_DIR/$STAMP"
WORK_ROOT="${BACKUP_WORK_DIR:-$OUT_DIR}"   # set BACKUP_WORK_DIR=/dev/shm (tmpfs) so plaintext never touches the persistent volume
mkdir -p "$WORK_ROOT"; WORK_ROOT="$(cd "$WORK_ROOT" && pwd -P)"
WORK="$WORK_ROOT/.partial-$STAMP"
# plaintext left behind by a killed run (kill -9, OOM, power loss) is wiped on the next start
for stale in "$WORK_ROOT"/.partial-*; do [ -d "$stale" ] || continue; find "$stale" -type f -exec shred -u -n1 {} + 2>/dev/null || true; rm -rf "$stale"; log "removed stale work directory ${stale##*/}"; done
[ ! -e "$FINAL" ] || die "$FINAL already exists"
mkdir "$WORK"
HOLDER_PID=""
release_holder() {
  # Closing the session's stdin ends psql, which ends the server session. (bash unsets HOLDER_PID when the coprocess exits.)
  local pid="${HOLDER_PID:-}"
  [ -n "$pid" ] || return 0
  { printf 'rollback;\n\\q\n' >&"$HOLDER_IN"; } 2>/dev/null || true
  eval "exec ${HOLDER_IN}>&-" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  HOLDER_PID=""
}
cleanup() {
  local rc=$?
  release_holder
  wipe "$WORK/db.dump" "$WORK/roles.sql" "$WORK/manifest.tsv" "$RECIPIENTS"
  if [ -d "$WORK" ]; then rm -rf "$WORK"; fi
  if [ "$rc" -ne 0 ]; then
    if [ -d "${FINAL:-/nonexistent}" ]; then log "BACKUP FAILED AFTER THE LOCAL SET WAS WRITTEN (exit $rc): $FINAL is intact and verified; the failed step needs attention (for example upload)"
    else log "BACKUP FAILED (exit $rc); no partial files were kept"; fi
  fi
  exit "$rc"
}
trap cleanup EXIT

# ---- 2. one consistent snapshot for manifest + dump -------------------------------------------------------------------
# A long-lived psql session exports a snapshot and keeps its REPEATABLE READ transaction open while the manifest queries and pg_dump
# import it. It is driven through a coprocess pipe so that it always ends when this script ends (even on kill -9).
coproc HOLDER { PGAPPNAME=sunchaser-backup-snapshot psql -X -qAt -v ON_ERROR_STOP=1 2>"$WORK/holder.err"; }
HOLDER_IN="${HOLDER[1]}"; HOLDER_OUT="${HOLDER[0]}"
printf '%s\n' "set idle_in_transaction_session_timeout = '${BACKUP_MAX_SECONDS:-1800}s';" "begin isolation level repeatable read read only;" "select pg_export_snapshot();" >&"$HOLDER_IN"
SNAP=""; read -r -t 60 SNAP <&"$HOLDER_OUT" || die "snapshot session gave no snapshot id: $(head -c 300 "$WORK/holder.err" 2>/dev/null)" "$EX_COMMAND"
[[ "$SNAP" =~ ^[0-9A-F]+-[0-9A-F]+-[0-9]+$ ]] || die "unexpected snapshot id from the server" "$EX_COMMAND"

log "writing manifest inside snapshot $SNAP"
TAB="$(printf '\t')"
{ psql -X -q -F "$TAB" -v ON_ERROR_STOP=1 -v "snap=$SNAP" -f "$HERE/manifest.sql" || die "manifest query failed" "$EX_COMMAND"; } | LC_ALL=C sort > "$WORK/manifest.tsv"
[ "$(awk -F'\t' '$1=="table"' "$WORK/manifest.tsv" | wc -l)" -gt 0 ] || die "manifest has no tables; refusing to continue" "$EX_COMMAND"

log "dumping (custom format) in the same snapshot"
pg_dump --format=custom --compress=6 --snapshot="$SNAP" --lock-wait-timeout=60s --quote-all-identifiers --no-tablespaces --no-password \
        --file="$WORK/db.dump" || die "pg_dump failed" "$EX_COMMAND"
release_holder

# Roles are cluster-wide and not part of a database dump. Passwords are intentionally excluded.
{ pg_dumpall --roles-only --no-role-passwords --database="$PGDATABASE" --no-password || die "pg_dumpall --roles-only failed" "$EX_COMMAND"; } > "$WORK/roles.sql"
psql -X -qAt -v ON_ERROR_STOP=1 >> "$WORK/roles.sql" <<'SQL'
-- database-level settings (applied after the target database exists)
select format('ALTER DATABASE :"restore_db" SET %s TO %s;', split_part(s, '=', 1),
       case when split_part(s, '=', 1) in ('search_path','temp_tablespaces','session_preload_libraries','local_preload_libraries','shared_preload_libraries')
            then substr(s, position('=' in s) + 1) else quote_literal(substr(s, position('=' in s) + 1)) end)
from pg_db_role_setting r join pg_database d on d.oid = r.setdatabase, unnest(r.setconfig) s
where r.setrole = 0 and d.datname = current_database();
SQL

# ---- 3. validate the archive before trusting it -----------------------------------------------------------------------
pg_restore --list "$WORK/db.dump" > "$WORK/toc.txt" || die "pg_restore --list cannot read the fresh dump" "$EX_INTEGRITY"
TOC_ENTRIES="$(grep -c '^[0-9]' "$WORK/toc.txt")"; [ "$TOC_ENTRIES" -gt 20 ] || die "dump TOC has only $TOC_ENTRIES entries" "$EX_INTEGRITY"
DUMPED_FROM="$(sed -n 's/^;     Dumped from database version: //p' "$WORK/toc.txt")"; DUMPED_BY="$(sed -n 's/^;     Dumped by pg_dump version: //p' "$WORK/toc.txt")"
TABLES_IN_MANIFEST="$(awk -F'\t' '$1=="table"' "$WORK/manifest.tsv" | wc -l)"
TABLES_IN_TOC="$(grep -c ' TABLE DATA ' "$WORK/toc.txt")"
# Matviews/partitions aside, every manifest table must have a TABLE DATA entry in the archive.
[ "$TABLES_IN_TOC" -ge "$TABLES_IN_MANIFEST" ] || die "archive has $TABLES_IN_TOC TABLE DATA entries but the database has $TABLES_IN_MANIFEST tables" "$EX_INTEGRITY"
DUMP_SHA="$(sha256_of "$WORK/db.dump")"; DUMP_BYTES="$(stat -c %s "$WORK/db.dump")"
rm -f "$WORK/toc.txt" "$WORK/holder.err"

# ---- 4. encrypt, checksum, optionally sign ----------------------------------------------------------------------------
FILES=(db.dump roles.sql manifest.tsv)
for f in "${FILES[@]}"; do
  if [ "$ENCRYPT" = 1 ]; then
    age -R "$RECIPIENTS" -o "$WORK/$f.age" "$WORK/$f" || die "age encryption of $f failed" "$EX_COMMAND"
    [ "$(head -c 21 "$WORK/$f.age")" = "age-encryption.org/v1" ] || die "$f.age is not an age file" "$EX_INTEGRITY"
    wipe "$WORK/$f"
  else
    mv "$WORK/$f" "$WORK/$f.plain"
  fi
done
SUFFIX=$([ "$ENCRYPT" = 1 ] && echo age || echo plain)
cat > "$WORK/backup-info.json" <<JSON
{"format":1,"stamp":"$STAMP","database":"$PGDATABASE","server_version_num":$SERVER_NUM,"dumped_from":"${DUMPED_FROM//\"/}","dumped_by":"${DUMPED_BY//\"/}",
 "toc_entries":$TOC_ENTRIES,"tables":$TABLES_IN_MANIFEST,"dump_plain_sha256":"$DUMP_SHA","dump_plain_bytes":$DUMP_BYTES,"encrypted":$([ "$ENCRYPT" = 1 ] && echo true || echo false),
 "recipients":$(grep -Ec '^(age1|ssh-)' "$RECIPIENTS" || true)}
JSON
(cd "$WORK" && sha256sum "db.dump.$SUFFIX" "roles.sql.$SUFFIX" "manifest.tsv.$SUFFIX" backup-info.json > SHA256SUMS)
if [ -n "${BACKUP_SIGNING_KEY:-}" ]; then
  need openssl
  openssl pkeyutl -sign -inkey "$BACKUP_SIGNING_KEY" -rawin -in "$WORK/SHA256SUMS" -out "$WORK/SHA256SUMS.sig" || die "signing failed" "$EX_COMMAND"
else
  warn "BACKUP_SIGNING_KEY not set: the backup set is not signed (anyone with write access to the bucket and the public age key could forge one)"
fi
chmod 600 "$WORK"/*; mv "$WORK" "$FINAL"; WORK="$OUT_DIR/.gone-$STAMP"   # keep cleanup from deleting the finished set
log "backup set written: $FINAL ($(du -sk "$FINAL" | cut -f1) KiB, $TABLES_IN_MANIFEST tables, dump sha256 ${DUMP_SHA:0:8}...)"

# ---- 5. upload + read-back verification -------------------------------------------------------------------------------
# <prefix> is BACKUP_S3 or BACKUP_OFFSITE_S3
s3_conf() { local v="${1}_$2"; echo "${!v:-}"; }
s3_url() { # <prefix> <key>
  local ep bucket addr scheme host; ep="$(s3_conf "$1" ENDPOINT)"; ep="${ep%/}"; bucket="$(s3_conf "$1" BUCKET)"; addr="$(s3_conf "$1" ADDRESSING)"
  scheme="${ep%%://*}"; host="${ep#*://}"
  if [ "${addr:-virtual}" = path ]; then echo "$scheme://$host/$bucket/$2"; else echo "$scheme://$bucket.$host/$2"; fi
}
s3_curl() { # <prefix> <curl args...>   (credentials via stdin config, never argv)
  local p="$1" ca region; shift
  ca="$(s3_conf "$p" CACERT)"; region="$(s3_conf "$p" REGION)"
  printf 'user = "%s:%s"\n' "$(s3_conf "$p" ACCESS_KEY_ID)" "$(s3_conf "$p" SECRET_ACCESS_KEY)" |
    curl -sS --fail-with-body -K - --aws-sigv4 "aws:amz:${region:-auto}:s3" ${ca:+--cacert "$ca"} --max-time 900 "$@"
}
upload_set() { # <prefix>
  local p="$1" pre f key hash size
  pre="$(s3_conf "$p" PREFIX | sed 's/^$/db-backups/; s#/*$##')"
  for f in "$FINAL"/*; do
    f="$(basename "$f")"; key="$pre/$STAMP/$f"; hash="$(sha256_of "$FINAL/$f")"; size="$(stat -c %s "$FINAL/$f")"
    s3_curl "$p" -o /dev/null -H "x-amz-content-sha256: $hash" -H "content-type: application/octet-stream" -T "$FINAL/$f" "$(s3_url "$p" "$key")" || return 1
    # read back and compare hash (a 200 on PUT alone is not proof of a stored object)
    local back; back="$(s3_curl "$p" -H "x-amz-content-sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" "$(s3_url "$p" "$key")" | sha256sum | cut -d' ' -f1)" || return 1
    [ "$back" = "$hash" ] || { log "read-back hash mismatch for $f"; return 1; }
    log "uploaded and verified $p:$key ($size bytes, sha256 ${hash:0:8})"
  done
}
if [ "$DO_UPLOAD" = 1 ]; then
  need curl; UPLOADED=0
  for p in BACKUP_S3 BACKUP_OFFSITE_S3; do
    [ -n "$(s3_conf "$p" ENDPOINT)" ] || continue
    for k in BUCKET ACCESS_KEY_ID SECRET_ACCESS_KEY; do [ -n "$(s3_conf "$p" "$k")" ] || die "${p}_$k is not set" "$EX_UPLOAD"; done
    upload_set "$p" || die "upload to $p failed; the local backup set $FINAL is intact" "$EX_UPLOAD"
    UPLOADED=$((UPLOADED + 1))
  done
  [ "$UPLOADED" -gt 0 ] || warn "no BACKUP_S3_* destination configured: this backup exists only on this host's disk"
  [ "$UPLOADED" -ge 2 ] || warn "no offsite destination (BACKUP_OFFSITE_S3_*): all copies share one failure domain"
fi

# ---- 6. local retention -----------------------------------------------------------------------------------------------
if [ "$DO_PRUNE" = 1 ]; then
  while IFS= read -r v; do [ -n "$v" ] && { rm -rf "${OUT_DIR:?}/$v"; log "pruned local backup $v"; }; done \
    < <(retention_victims "$OUT_DIR" "${BACKUP_KEEP_DAILY:-14}" "${BACKUP_KEEP_WEEKLY:-8}" "${BACKUP_KEEP_MONTHLY:-12}")
fi
log "BACKUP OK $STAMP"
echo "$FINAL"
