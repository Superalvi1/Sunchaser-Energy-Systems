#!/usr/bin/env bash
# Restores a pg-backup.sh backup set into a SCRATCH PostgreSQL server and proves it is complete (PROPOSED - not applied to production).
#
#   restore-verify.sh --backup-dir <DIR/STAMP> --identity <age private key file> [options]
#     --target-db NAME      database to create on the scratch server (default restore_verify_<stamp>); must match ^restore_[a-z0-9_]+$
#     --keep                keep the restored database for smoke tests (default: drop it afterwards)
#     --replace             drop the target database first if it exists
#     --compare-only        do not restore; only compare the existing --target-db against the manifest (used to demonstrate detection)
#     --signing-pub FILE    verify SHA256SUMS.sig with this Ed25519 public key (set RESTORE_REQUIRE_SIGNATURE=1 to make it mandatory)
#     --smoke-cmd 'CMD'     run CMD against the restored database (PG* variables exported); a non-zero exit fails the verification
#
# Scratch server connection (never defaults to PG*, so a stray production variable cannot be restored onto):
#   RESTORE_PGHOST  RESTORE_PGPORT  RESTORE_PGUSER (superuser of the scratch server)  RESTORE_PGPASSWORD
#
# Exit codes: 0 verified | 2 integrity (checksum, signature, decryption) | 3 manifest mismatch | 4 restore command failed
#             5 safety/version guard | 1 other
# Fails loudly: any difference in a table row count, row-hash, column/constraint/index/trigger/policy/function/ACL definition,
# extension, role or sequence position between the source manifest and the restored database is a failure.
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

BACKUP_DIR=""; IDENTITY=""; TARGET_DB=""; KEEP=0; REPLACE=0; COMPARE_ONLY=0; SIGN_PUB=""; SMOKE_CMD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --target-db) TARGET_DB="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --replace) REPLACE=1; shift ;;
    --compare-only) COMPARE_ONLY=1; shift ;;
    --signing-pub) SIGN_PUB="$2"; shift 2 ;;
    --smoke-cmd) SMOKE_CMD="$2"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -d "$BACKUP_DIR" ] || die "--backup-dir must be an existing backup set directory"
[ -r "$IDENTITY" ] || die "--identity must be a readable age private key file (kept outside the repo)"
for t in psql pg_restore sha256sum age awk diff; do need "$t"; done
: "${RESTORE_PGHOST:?RESTORE_PGHOST is required (the scratch server, never production)}" "${RESTORE_PGUSER:?RESTORE_PGUSER is required}"
umask 077

# Guard 1: never the same endpoint as a configured source.
if [ -n "${PGHOST:-}" ] && [ "$PGHOST:${PGPORT:-5432}" = "$RESTORE_PGHOST:${RESTORE_PGPORT:-5432}" ]; then
  die "RESTORE_PGHOST:PORT equals PGHOST:PORT (the backup source). Refusing to restore onto the source." "$EX_GUARD"
fi
export PGHOST="$RESTORE_PGHOST" PGPORT="${RESTORE_PGPORT:-5432}" PGUSER="$RESTORE_PGUSER" PGCONNECT_TIMEOUT=15 PGAPPNAME=sunchaser-restore-verify
[ -n "${RESTORE_PGPASSWORD:-}" ] && export PGPASSWORD="$RESTORE_PGPASSWORD" || unset PGPASSWORD
unset PGDATABASE PGSERVICE PGSSLMODE_UNUSED 2>/dev/null || true
export PGDATABASE=postgres

STAMP_DIR="$(basename "$BACKUP_DIR")"
TARGET_DB="${TARGET_DB:-restore_verify_$(echo "$STAMP_DIR" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9')}"
[[ "$TARGET_DB" =~ ^restore_[a-z0-9_]+$ ]] || die "target database name must match ^restore_[a-z0-9_]+$ (got '$TARGET_DB')" "$EX_GUARD"

WORK="$(mktemp -d "${RESTORE_TMPDIR:-${TMPDIR:-/tmp}}/restore-verify.XXXXXX")"
cleanup() {
  local rc=$?
  [ -d "$WORK" ] && { find "$WORK" -type f -exec shred -u -n1 {} + 2>/dev/null || true; rm -rf "$WORK"; }
  if [ "$rc" -ne 0 ]; then log "RESTORE VERIFICATION FAILED (exit $rc)"; fi
  exit "$rc"
}
trap cleanup EXIT

# ---- 1. integrity of the stored files -------------------------------------------------------------------------------
log "verifying checksums of $BACKUP_DIR"
(cd "$BACKUP_DIR" && sha256sum --check --strict SHA256SUMS >"$WORK/sums.out" 2>&1) || { sed 's/^/  /' "$WORK/sums.out" >&2; die "SHA256SUMS verification failed: the backup set is corrupt or has been altered" "$EX_INTEGRITY"; }
if [ -n "$SIGN_PUB" ]; then
  need openssl
  [ -f "$BACKUP_DIR/SHA256SUMS.sig" ] || die "no SHA256SUMS.sig but a signing key was supplied" "$EX_INTEGRITY"
  openssl pkeyutl -verify -pubin -inkey "$SIGN_PUB" -rawin -in "$BACKUP_DIR/SHA256SUMS" -sigfile "$BACKUP_DIR/SHA256SUMS.sig" >/dev/null 2>&1 || die "signature of SHA256SUMS is INVALID" "$EX_INTEGRITY"
  log "signature OK"
elif [ "${RESTORE_REQUIRE_SIGNATURE:-0}" = 1 ]; then die "RESTORE_REQUIRE_SIGNATURE=1 but --signing-pub was not given" "$EX_INTEGRITY"
else warn "signature not verified (no --signing-pub)"; fi

dec() { age -d -i "$IDENTITY" -o "$2" "$BACKUP_DIR/$1" 2>"$WORK/age.err" || { sed 's/^/  /' "$WORK/age.err" >&2; die "decryption of $1 failed (wrong key, or the file is corrupt/truncated)" "$EX_INTEGRITY"; }; }
dec manifest.tsv.age "$WORK/source.tsv"
sha_info() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p" "$BACKUP_DIR/backup-info.json"; }
SRC_NUM="$(awk -F'\t' '$1=="info" && $2=="server_version_num" {print $3}' "$WORK/source.tsv")"
SRC_ID="$(awk -F'\t' '$1=="info" && $2=="system_identifier" {print $3}' "$WORK/source.tsv")"
SRC_DB="$(awk -F'\t' '$1=="info" && $2=="database" {print $3}' "$WORK/source.tsv")"
SRC_ENC="$(awk -F'\t' '$1=="info" && $2=="encoding" {print $3}' "$WORK/source.tsv")"
SRC_COLL="$(awk -F'\t' '$1=="info" && $2=="datcollate" {print $3}' "$WORK/source.tsv")"
SRC_CTYPE="$(awk -F'\t' '$1=="info" && $2=="datctype" {print $3}' "$WORK/source.tsv")"
SRC_PROV="$(awk -F'\t' '$1=="info" && $2=="datlocprovider" {print $3}' "$WORK/source.tsv")"
[ -n "$SRC_NUM" ] || die "manifest has no server_version_num" "$EX_INTEGRITY"

# ---- 2. scratch server guards ----------------------------------------------------------------------------------------
TGT_NUM="$(psql -X -qAt -v ON_ERROR_STOP=1 -c 'show server_version_num')" || die "cannot connect to the scratch server" "$EX_COMMAND"
TGT_ID="$(psql -X -qAt -c 'select system_identifier from pg_control_system()' 2>/dev/null || echo unknown)"
[ "$TGT_ID" != "$SRC_ID" ] || die "the scratch server has the same system identifier as the backup source: it IS the source cluster. Refusing." "$EX_GUARD"
log "source PostgreSQL $(num_major "$SRC_NUM") -> scratch server PostgreSQL $(num_major "$TGT_NUM")"
[ "$(num_major "$TGT_NUM")" -ge "$(num_major "$SRC_NUM")" ] || die "scratch server is older than the source ($(num_major "$TGT_NUM") < $(num_major "$SRC_NUM"))" "$EX_GUARD"
if [ "$(num_major "$TGT_NUM")" -ne "$(num_major "$SRC_NUM")" ]; then warn "major versions differ: definition hashes may legitimately differ; restore on the production major version for the official proof"; fi
TAB="$(printf '\t')"

if [ "$COMPARE_ONLY" = 0 ]; then
  [ "$SRC_PROV" = c ] || die "source uses locale provider '$SRC_PROV'; this script only recreates libc databases" "$EX_GUARD"
  need pg_restore
  assert_client_at_least_server pg_restore "$(num_major "$SRC_NUM")"
  dec db.dump.age "$WORK/db.dump"; dec roles.sql.age "$WORK/roles.sql"
  EXPECT_SHA="$(sha_info dump_plain_sha256)"; GOT_SHA="$(sha256_of "$WORK/db.dump")"
  [ -n "$EXPECT_SHA" ] && [ "$EXPECT_SHA" = "$GOT_SHA" ] || die "decrypted dump sha256 (${GOT_SHA:0:8}) differs from the recorded one (${EXPECT_SHA:0:8})" "$EX_INTEGRITY"
  pg_restore --list "$WORK/db.dump" > "$WORK/toc.txt" || die "pg_restore cannot read the archive" "$EX_INTEGRITY"
  # extensions the dump needs must exist on the scratch server (contrib/PostGIS etc. are not part of a dump)
  while read -r ext; do
    [ -n "$ext" ] || continue
    [ "$(psql -X -qAt -c "select count(*) from pg_available_extensions where name = '$ext'")" = 1 ] || die "extension '$ext' is required by the dump but not installed on the scratch server" "$EX_GUARD"
  done < <(awk '$0 ~ / EXTENSION - / && $0 !~ /COMMENT/ {print $NF}' "$WORK/toc.txt" | tr -d '"')

  # ---- 3. create the database and roles ------------------------------------------------------------------------------
  EXISTS="$(psql -X -qAt -c "select count(*) from pg_database where datname = '$TARGET_DB'")"
  if [ "$EXISTS" != 0 ]; then
    [ "$REPLACE" = 1 ] || die "database $TARGET_DB already exists on the scratch server (use --replace)" "$EX_GUARD"
    psql -X -qAt -c "drop database \"$TARGET_DB\" with (force)" >/dev/null
  fi
  # Roles: never create superusers or replication roles; skip the connecting superuser; tolerate roles that already exist.
  sed -E \
    -e "/^(CREATE|ALTER) ROLE \"?${RESTORE_PGUSER}\"?( |;)/d" \
    -e 's/ WITH SUPERUSER / WITH NOSUPERUSER /; s/ REPLICATION / NOREPLICATION /; s/ REPLICATION;/ NOREPLICATION;/' \
    -e 's/^CREATE ROLE ("?[A-Za-z0-9_]+"?);$/DO $$ BEGIN CREATE ROLE \1; EXCEPTION WHEN duplicate_object THEN NULL; END $$;/' \
    "$WORK/roles.sql" | grep -v ' IN DATABASE ' > "$WORK/roles.pre.sql" || true
  psql -X -q -v ON_ERROR_STOP=1 -f "$WORK/roles.pre.sql" >/dev/null || die "applying role definitions failed" "$EX_COMMAND"
  psql -X -qAt -v ON_ERROR_STOP=1 -c "create database \"$TARGET_DB\" template template0 encoding '$SRC_ENC' lc_collate '$SRC_COLL' lc_ctype '$SRC_CTYPE'" >/dev/null || die "cannot create $TARGET_DB with the source locale ($SRC_COLL)" "$EX_COMMAND"
  grep ' IN DATABASE ' "$WORK/roles.sql" | sed -E "s/ IN DATABASE \"?${SRC_DB}\"? / IN DATABASE \"${TARGET_DB}\" /" > "$WORK/roles.post.sql" || true
  [ -s "$WORK/roles.post.sql" ] && psql -X -q -v ON_ERROR_STOP=1 -f "$WORK/roles.post.sql" >/dev/null
  grep '^ALTER DATABASE' "$WORK/roles.sql" > "$WORK/dbset.sql" || true
  [ -s "$WORK/dbset.sql" ] && psql -X -q -v ON_ERROR_STOP=1 -v "restore_db=$TARGET_DB" -f "$WORK/dbset.sql" >/dev/null

  # ---- 4. restore: single transaction, first error aborts everything ------------------------------------------------
  log "restoring into $TARGET_DB (single transaction, exit on first error)"
  if ! pg_restore --exit-on-error --single-transaction --no-password --dbname="$TARGET_DB" "$WORK/db.dump" > /dev/null 2> "$WORK/restore.err"; then
    # CONTEXT/DETAIL lines can contain row values; never print them.
    grep -Ev '^(CONTEXT|DETAIL|STATEMENT):' "$WORK/restore.err" | head -20 | cut -c1-300 >&2
    die "pg_restore failed; the target database was not populated" "$EX_COMMAND"
  fi
  psql -X -q -d "$TARGET_DB" -c 'analyze' >/dev/null
fi

# ---- 5. manifest of the restored database and comparison ---------------------------------------------------------------
[ "$(psql -X -qAt -c "select count(*) from pg_database where datname = '$TARGET_DB'")" = 1 ] || die "database $TARGET_DB does not exist" "$EX_GUARD"
{ psql -X -q -d "$TARGET_DB" -F "$TAB" -v ON_ERROR_STOP=1 -f "$HERE/manifest.sql" || die "manifest of the restored database failed" "$EX_COMMAND"; } | LC_ALL=C sort > "$WORK/restored.tsv"
SRC_TABLES="$(awk -F'\t' '$1=="table"' "$WORK/source.tsv" | wc -l)"
SRC_ROWS="$(awk -F'\t' '$1=="table" {s += $3} END {print s + 0}' "$WORK/source.tsv")"
if manifest_compare "$WORK/source.tsv" "$WORK/restored.tsv" > "$WORK/compare.out"; then
  log "MANIFEST MATCH: $SRC_TABLES tables, $SRC_ROWS rows, every definition hash and sequence position verified"
  MATCH=1
else
  cat "$WORK/compare.out" >&2
  log "MANIFEST MISMATCH: the restored database does NOT equal the backup source"
  MATCH=0
fi

# ---- 6. functional smoke (optional hook) ------------------------------------------------------------------------------
SMOKE=skipped
if [ "$MATCH" = 1 ] && [ -n "$SMOKE_CMD" ]; then
  log "running smoke command against $TARGET_DB"
  if PGDATABASE="$TARGET_DB" RESTORED_DB="$TARGET_DB" bash -c "$SMOKE_CMD"; then SMOKE=passed; else SMOKE=failed; fi
fi

REPORT="$BACKUP_DIR/restore-report-$(date -u +%Y%m%dT%H%M%SZ).json"
printf '{"backup":"%s","target_db":"%s","scratch_pg_major":%s,"tables":%s,"rows":%s,"manifest_match":%s,"smoke":"%s","compare_only":%s}\n' \
  "$STAMP_DIR" "$TARGET_DB" "$(num_major "$TGT_NUM")" "$SRC_TABLES" "$SRC_ROWS" "$([ "$MATCH" = 1 ] && echo true || echo false)" "$SMOKE" "$([ "$COMPARE_ONLY" = 1 ] && echo true || echo false)" > "$REPORT" 2>/dev/null || true

if [ "$KEEP" = 0 ] && [ "$COMPARE_ONLY" = 0 ]; then psql -X -qAt -c "drop database if exists \"$TARGET_DB\" with (force)" >/dev/null || true; fi
[ "$MATCH" = 1 ] || exit "$EX_MISMATCH"
[ "$SMOKE" != failed ] || die "smoke command failed" "$EX_COMMAND"
log "RESTORE VERIFIED ($TARGET_DB, smoke: $SMOKE)"
