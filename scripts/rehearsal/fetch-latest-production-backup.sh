#!/usr/bin/env bash
# Downloads the NEWEST archive of the existing daily production backup job (database-backups/<stamp>/sunchaser-postgres.tar.gz) with READ-ONLY requests
# (one LIST, one GET). The bucket credentials come from the environment of the process; this script never prints, stores or logs them.
#
# Intended use, from your own computer, credentials injected by the Railway CLI into this one process only:
#   railway run -p <project id> -e <environment id> -s <backup job service> bash scripts/rehearsal/fetch-latest-production-backup.sh <dest dir>
# Environment it reads: RAILWAY_S3_ENDPOINT RAILWAY_S3_BUCKET RAILWAY_S3_ACCESS_KEY_ID RAILWAY_S3_SECRET_ACCESS_KEY [RAILWAY_S3_REGION]
# Works with bash 3.2 (macOS) and curl >= 7.75 (--aws-sigv4). Output: <dest>/sunchaser-postgres.tar.gz and <dest>/download.info (key, size, sha256).
set -uo pipefail
DEST="${1:?usage: fetch-latest-production-backup.sh <dest dir>}"

# 1. Forget every other variable the Railway CLI injected (database URLs, tokens ...) so nothing else can leak from this process.
keep=" PATH HOME TMPDIR LANG TERM SHELL USER LOGNAME HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy SSL_CERT_FILE CURL_CA_BUNDLE RAILWAY_S3_ENDPOINT RAILWAY_S3_BUCKET RAILWAY_S3_ACCESS_KEY_ID RAILWAY_S3_SECRET_ACCESS_KEY RAILWAY_S3_REGION PWD OLDPWD SHLVL _ "
for v in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p'); do
  case "$v" in LC_*) continue;; esac
  case "$keep" in *" $v "*) ;; *) unset "$v" 2>/dev/null || true;; esac
done
for v in RAILWAY_S3_ENDPOINT RAILWAY_S3_BUCKET RAILWAY_S3_ACCESS_KEY_ID RAILWAY_S3_SECRET_ACCESS_KEY; do
  [ -n "${!v:-}" ] || { echo "FATAL: $v is not set (run this through: railway run -s <backup job service> ...)" >&2; exit 1; }
done
command -v curl >/dev/null || { echo "FATAL: curl not found" >&2; exit 1; }
umask 077; mkdir -p "$DEST"; chmod 700 "$DEST"

ep="${RAILWAY_S3_ENDPOINT%/}"; scheme="${ep%%://*}"; host="${ep#*://}"; region="${RAILWAY_S3_REGION:-auto}"
[ "$scheme" = https ] || { echo "FATAL: the storage endpoint is not https" >&2; exit 1; }
EMPTY_SHA=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

# s3get <url> <output file or ->   (credentials are passed on stdin, not on the command line)
s3get() {
  printf 'user = "%s:%s"\n' "$RAILWAY_S3_ACCESS_KEY_ID" "$RAILWAY_S3_SECRET_ACCESS_KEY" |
    curl -sS --fail-with-body -K - --aws-sigv4 "aws:amz:${region}:s3" -H "x-amz-content-sha256: $EMPTY_SHA" -o "$2" "$1"
}
urlenc() { sed -e 's/%/%25/g' -e 's/+/%2B/g' -e 's/\//%2F/g' -e 's/=/%3D/g'; }
prefix="database-backups/"

# 2. LIST (virtual-hosted style first, then path style) and pick the newest matching key.
list_all() { # base-url-for-list -> concatenated XML pages on stdout
  local base="$1" token="" page
  while :; do
    local q="list-type=2&prefix=$prefix"; [ -n "$token" ] && q="$q&continuation-token=$(printf '%s' "$token" | urlenc)"
    page="$(s3get "$base?$q" -)" || return 1
    case "$page" in *"<ListBucketResult"*) ;; *) return 1;; esac
    printf '%s\n' "$page"
    case "$page" in *"<IsTruncated>true</IsTruncated>"*) token="$(printf '%s' "$page" | sed -n 's#.*<NextContinuationToken>\([^<]*\)</NextContinuationToken>.*#\1#p')"; [ -n "$token" ] || return 1;; *) return 0;; esac
  done
}
STYLE=virtual; LISTING="$(list_all "$scheme://$RAILWAY_S3_BUCKET.$host/" 2>/dev/null)" || { STYLE=path; LISTING="$(list_all "$scheme://$host/$RAILWAY_S3_BUCKET" 2>/dev/null)"; } || true
[ -n "$LISTING" ] || { echo "FATAL: could not list the bucket (wrong service for 'railway run -s', or the endpoint/credentials are not valid)" >&2; exit 1; }
# one line per object: key size
OBJS="$(printf '%s' "$LISTING" | sed 's#<Contents>#\
<Contents>#g' | sed -n 's#.*<Key>\([^<]*\)</Key>.*<Size>\([0-9]*\)</Size>.*#\1 \2#p')"
LATEST="$(printf '%s\n' "$OBJS" | grep -E '^database-backups/[0-9]{8}T[0-9]{6}Z/sunchaser-postgres\.tar\.gz ' | sort | tail -1)"
[ -n "$LATEST" ] || { echo "FATAL: no database-backups/<stamp>/sunchaser-postgres.tar.gz in the bucket" >&2; exit 1; }
KEY="${LATEST% *}"; LSIZE="${LATEST##* }"; STAMP="$(printf '%s' "$KEY" | sed -n 's#database-backups/\([0-9T]*Z\)/.*#\1#p')"
echo "newest backup: $KEY ($LSIZE bytes, listed $(printf '%s\n' "$OBJS" | grep -cE '^database-backups/[0-9]{8}T[0-9]{6}Z/sunchaser-postgres\.tar\.gz ') in total, addressing: $STYLE)"
now="$(date -u +%Y%m%d%H%M%S)"; echo "backup stamp $STAMP, now $now (UTC); a backup older than ~36 hours means the daily job failed"

# 3. GET
if [ "$STYLE" = virtual ]; then url="$scheme://$RAILWAY_S3_BUCKET.$host/$KEY"; else url="$scheme://$host/$RAILWAY_S3_BUCKET/$KEY"; fi
OUT="$DEST/sunchaser-postgres.tar.gz"
s3get "$url" "$OUT" || { echo "FATAL: download failed" >&2; rm -f "$OUT"; exit 1; }
SIZE="$(wc -c < "$OUT" | tr -d ' ')"
[ "$SIZE" = "$LSIZE" ] || { echo "FATAL: downloaded $SIZE bytes but the listing said $LSIZE" >&2; rm -f "$OUT"; exit 1; }
if command -v sha256sum >/dev/null; then SHA="$(sha256sum "$OUT" | cut -d' ' -f1)"; else SHA="$(shasum -a 256 "$OUT" | cut -d' ' -f1)"; fi
tar -tzf "$OUT" > "$DEST/archive.list" 2>/dev/null || { echo "FATAL: the file is not a readable .tar.gz" >&2; exit 1; }
grep -qx 'database.dump' "$DEST/archive.list" && grep -qx 'globals.sql' "$DEST/archive.list" || { echo "FATAL: archive does not contain database.dump and globals.sql" >&2; exit 1; }
printf 'key=%s\nstamp=%s\nbytes=%s\nsha256=%s\n' "$KEY" "$STAMP" "$SIZE" "$SHA" > "$DEST/download.info"
echo "downloaded $SIZE bytes, sha256 $SHA, contents: $(tr '\n' ' ' < "$DEST/archive.list")"
