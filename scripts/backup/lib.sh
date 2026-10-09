# shellcheck shell=bash
# Shared helpers for pg-backup.sh and restore-verify.sh. Source it; do not execute it.
# Rules: never print a credential, a connection string or a row; fail loudly (non-zero exit) on anything unexpected.

# Exit codes (so a scheduler can tell failures apart):
#   1 generic/precondition   2 integrity (checksum/signature/decrypt)   3 manifest mismatch after restore
#   4 restore/dump command failed   5 version or safety guard   6 upload/verification of upload failed
EX_GENERIC=1; EX_INTEGRITY=2; EX_MISMATCH=3; EX_COMMAND=4; EX_GUARD=5; EX_UPLOAD=6

log()  { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
warn() { log "WARNING: $*"; }
die()  { local code="${2:-$EX_GENERIC}"; log "FATAL: $1"; exit "$code"; }
need() { command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1" "$EX_GENERIC"; }

# "pg_dump (PostgreSQL) 16.15 (Ubuntu ...)" -> 16 ; "pg_dump (PostgreSQL) 17.2" -> 17
tool_major() { "$1" --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/'; }
# server_version_num 170002 -> 17 ; 160015 -> 16
num_major() { echo $(( $1 / 10000 )); }

# Refuse to dump a newer server with an older client, or to restore a newer archive with an older pg_restore.
assert_client_at_least_server() { # <tool> <server_major>
  local c; c="$(tool_major "$1")"
  [ "$c" -ge "$2" ] || die "$1 is PostgreSQL $c but the server is PostgreSQL $2. A client older than the server cannot produce a restorable dump. Use a postgres:$2 image or postgresql-client-$2." "$EX_GUARD"
}

# Load PG* variables from a URL held in an environment variable (name passed in) without putting it on a command line.
# postgres://user:pass@host:port/db?sslmode=require
load_url_into_pgenv() { # <env var name holding the URL>
  local url="${!1:-}"
  [ -n "$url" ] || return 0
  local re='^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/?]+)(:([0-9]+))?/([^?]+)(\?(.*))?$'
  [[ "$url" =~ $re ]] || die "$1 is not a postgres:// URL (value not shown)" "$EX_GENERIC"
  export PGUSER="${BASH_REMATCH[2]}" PGHOST="${BASH_REMATCH[5]}" PGDATABASE="${BASH_REMATCH[8]}"
  [ -n "${BASH_REMATCH[4]}" ] && export PGPASSWORD="$(printf '%b' "${BASH_REMATCH[4]//%/\\x}")"
  [ -n "${BASH_REMATCH[7]}" ] && export PGPORT="${BASH_REMATCH[7]}"
  local q="${BASH_REMATCH[10]}" kv
  for kv in ${q//&/ }; do [ "${kv%%=*}" = sslmode ] && export PGSSLMODE="${kv#*=}"; done
  return 0
}

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# Best-effort secure removal (shred where available; ephemeral/tmpfs storage is still recommended).
wipe() { local f; for f in "$@"; do [ -e "$f" ] || continue; if command -v shred >/dev/null 2>&1; then shred -u -n1 "$f" 2>/dev/null || rm -f "$f"; else rm -f "$f"; fi; done; }

# Build an age recipients file from BACKUP_AGE_RECIPIENTS (public keys, whitespace or comma separated) and/or BACKUP_AGE_RECIPIENTS_FILE.
# Only PUBLIC recipients are ever read here. Private identities never touch the backup host.
make_recipients_file() { # <out file>
  : > "$1"
  [ -n "${BACKUP_AGE_RECIPIENTS_FILE:-}" ] && cat "$BACKUP_AGE_RECIPIENTS_FILE" >> "$1"
  [ -n "${BACKUP_AGE_RECIPIENTS:-}" ] && tr ', ' '\n\n' <<<"$BACKUP_AGE_RECIPIENTS" >> "$1"
  grep -Eq '^(age1|ssh-(ed25519|rsa) )' "$1" || return 1
  if grep -q 'AGE-SECRET-KEY' "$1"; then die "a PRIVATE age key was supplied where public recipients are expected; refusing to continue" "$EX_GUARD"; fi
}

# Retention (grandfather-father-son) over directories named YYYYMMDDTHHMMSSZ. Prints the names to DELETE.
# keeps: newest backup of each of the last D days, W ISO weeks and M months, and never fewer than the newest 3 backups.
retention_victims() { # <dir> <daily> <weekly> <monthly>
  local dir="$1" D="$2" W="$3" M="$4" name day wk mo
  local -A seen_d=() seen_w=() seen_m=() keep=()
  local n=0
  while IFS= read -r name; do
    [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
    n=$((n + 1)); day="${name:0:8}"
    wk="$(date -u -d "${day:0:4}-${day:4:2}-${day:6:2}" +%G-W%V)"; mo="${day:0:6}"
    [ "$n" -le 3 ] && keep[$name]=1
    if [ -z "${seen_d[$day]:-}" ]; then seen_d[$day]=1; [ "${#seen_d[@]}" -le "$D" ] && keep[$name]=1; fi
    if [ -z "${seen_w[$wk]:-}" ]; then seen_w[$wk]=1; [ "${#seen_w[@]}" -le "$W" ] && keep[$name]=1; fi
    if [ -z "${seen_m[$mo]:-}" ]; then seen_m[$mo]=1; [ "${#seen_m[@]}" -le "$M" ] && keep[$name]=1; fi
  done < <(ls -1 "$dir" 2>/dev/null | LC_ALL=C sort -r)
  while IFS= read -r name; do
    [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
    [ -n "${keep[$name]:-}" ] || echo "$name"
  done < <(ls -1 "$dir" 2>/dev/null | LC_ALL=C sort)
}

# Compare two manifests (TSV from manifest.sql, sorted). Prints differences; returns 0 only when identical.
# info lines are ignored. Sequences may only be >= the source (the source can advance while it is being dumped).
manifest_compare() { # <source manifest> <restored manifest>
  local src="$1" dst="$2" rc=0
  awk -F'\t' '$1!="info" && $1!="seq"' "$src" > "$dst.cmp.src"
  awk -F'\t' '$1!="info" && $1!="seq"' "$dst" > "$dst.cmp.dst"
  diff "$dst.cmp.src" "$dst.cmp.dst" > "$dst.diff" || rc=1
  # sequences: effective position = last_value*2 + is_called must not go backwards; missing sequences are a mismatch.
  local seqout
  seqout="$(awk -F'\t' '
    FNR==NR { if ($1=="seq") { s[$2]=($3==""?0:$3)*2 + ($4=="true"?1:0); known[$2]=1 } next }
    $1=="seq" { d[$2]=($3==""?0:$3)*2 + ($4=="true"?1:0); seen[$2]=1 }
    END {
      for (k in known) { if (!(k in seen)) print "seq missing after restore: " k; else if (d[k] < s[k]) print "seq went backwards: " k " source=" s[k] " restored=" d[k] }
      for (k in seen) if (!(k in known)) print "seq not in source: " k
    }' "$src" "$dst" | LC_ALL=C sort)"
  if [ -s "$dst.diff" ]; then
    echo "--- MANIFEST DIFFERENCES (< source, > restored); only names, counts and hashes are shown ---"
    cat "$dst.diff"
    rc=1
  fi
  if [ -n "$seqout" ]; then echo "$seqout"; rc=1; fi
  rm -f "$dst.cmp.src" "$dst.cmp.dst"
  return "$rc"
}
