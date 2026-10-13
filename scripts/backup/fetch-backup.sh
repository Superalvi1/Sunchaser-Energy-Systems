#!/usr/bin/env bash
# Downloads one backup set (all files of <stamp>) from the backup bucket into a local directory, ready for restore-verify.sh.
#   fetch-backup.sh <stamp> <dest dir>
# Uses the same BACKUP_S3_* variables as pg-backup.sh (read-only credentials are enough: this script only issues GETs).
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
STAMP="${1:?usage: fetch-backup.sh <YYYYMMDDTHHMMSSZ> <dest dir>}"; DEST="${2:?dest dir}"
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "stamp must look like 20261009T061824Z"
need curl; umask 077; mkdir -p "$DEST/$STAMP"
for k in ENDPOINT BUCKET ACCESS_KEY_ID SECRET_ACCESS_KEY; do v="BACKUP_S3_$k"; [ -n "${!v:-}" ] || die "$v is not set"; done
ep="${BACKUP_S3_ENDPOINT%/}"; scheme="${ep%%://*}"; host="${ep#*://}"; pre="${BACKUP_S3_PREFIX:-db-backups}"; pre="${pre%/}"
for f in SHA256SUMS SHA256SUMS.sig backup-info.json db.dump.age roles.sql.age manifest.tsv.age; do
  if [ "${BACKUP_S3_ADDRESSING:-virtual}" = path ]; then url="$scheme://$host/$BACKUP_S3_BUCKET/$pre/$STAMP/$f"; else url="$scheme://$BACKUP_S3_BUCKET.$host/$pre/$STAMP/$f"; fi
  printf 'user = "%s:%s"\n' "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" |
    curl -sS --fail-with-body -K - --aws-sigv4 "aws:amz:${BACKUP_S3_REGION:-auto}:s3" ${BACKUP_S3_CACERT:+--cacert "$BACKUP_S3_CACERT"} \
         -H "x-amz-content-sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" -o "$DEST/$STAMP/$f" "$url" \
    || { [ "$f" = SHA256SUMS.sig ] && { warn "no signature object (unsigned set)"; rm -f "$DEST/$STAMP/$f"; continue; }; die "download of $f failed" "$EX_UPLOAD"; }
done
log "downloaded $STAMP to $DEST/$STAMP"
echo "$DEST/$STAMP"
