#!/usr/bin/env bash
# Removes what a rehearsal run left behind, ONLY after you have reviewed the result:
#   cleanup-rehearsal.sh <work folder> [<temporary checkout>] [--yes]
# <work folder> = the folder mac-run.sh printed (holds the downloaded backup, the restored copy and logs; customer data).
# <temporary checkout> = the folder you cloned the repository into (no customer data).
# It refuses any path that is not a sunchaser-rehearsal.* / sunchaser-src.* folder directly under /private/tmp, /tmp or $TMPDIR, refuses to delete
# while a PostgreSQL still runs from that folder, shows what it is about to delete, and asks for a typed "yes" (or --yes).
set -uo pipefail
YES=0; ARGS=()
for a in "$@"; do if [ "$a" = "--yes" ]; then YES=1; else ARGS+=("$a"); fi; done
WORK="${ARGS[0]:-}"; SRC="${ARGS[1]:-}"
[ -n "$WORK" ] || { sed -n '2,8p' "$0"; exit 2; }
TMPD="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P || echo /tmp)"
okpath() { # path pattern
  local base parent; base="$(basename "$1")"; parent="$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)" || return 1
  case "$parent" in /private/tmp|/tmp|"$TMPD") ;; *) return 1;; esac
  case "$base" in $2) return 0;; *) return 1;; esac
}
okpath "$WORK" 'sunchaser-rehearsal.*' || { echo "refusing: '$WORK' is not a sunchaser-rehearsal.* folder directly under the temporary directory"; exit 2; }
[ -z "$SRC" ] || okpath "$SRC" 'sunchaser-src.*' || { echo "refusing: '$SRC' is not a sunchaser-src.* folder directly under the temporary directory"; exit 2; }
[ -d "$WORK" ] || { echo "nothing to do: $WORK does not exist"; WORK=""; }
if [ -n "$WORK" ] && [ -f "$WORK/pgdata/postmaster.pid" ] && kill -0 "$(head -1 "$WORK/pgdata/postmaster.pid")" 2>/dev/null; then
  echo "refusing: a PostgreSQL is still running from $WORK/pgdata (stop it with pg_ctl -D '$WORK/pgdata' -m fast stop)"; exit 2
fi
{
echo "about to delete:"
[ -z "$WORK" ] || { echo "  $WORK  ($(du -sh "$WORK" 2>/dev/null | cut -f1))"; ls -1 "$WORK" | sed 's/^/      /'; }
[ -z "$SRC" ] || [ ! -d "$SRC" ] || echo "  $SRC  ($(du -sh "$SRC" 2>/dev/null | cut -f1))"
if [ "$YES" != 1 ]; then printf 'type yes to delete: '; read -r ans; [ "$ans" = yes ] || { echo "cancelled; nothing deleted"; exit 1; }; fi
[ -z "$WORK" ] || rm -rf "$WORK"
[ -z "$SRC" ] || [ ! -d "$SRC" ] || rm -rf "$SRC"
echo "deleted. Still yours to delete after you have sent the result: the RETURN file (~/sunchaser-rehearsal-RETURN.txt, counts only) and any copy of the backup you downloaded by hand."
  exit 0
}
