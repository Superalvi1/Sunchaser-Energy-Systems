#!/usr/bin/env bash
# One command, on YOUR computer (macOS or Linux): download the newest production backup (read-only), restore it into a THROW-AWAY local PostgreSQL 17
# server that listens on a private unix socket only, run the migration rehearsal on that copy and write a short RETURN file. NOTHING is deleted
# automatically: the downloaded backup and the restored copy stay in the work folder until you have reviewed the result and run cleanup-rehearsal.sh.
#
#   bash scripts/rehearsal/mac-run.sh                    # downloads through the Railway CLI (you must be logged in: `railway login`)
#   bash scripts/rehearsal/mac-run.sh --tarball FILE     # use a backup file you already downloaded (dashboard)
#
# What it never does: write to production, connect to the production database, restore anything into production, copy crm_recovery rows anywhere
# (the recovery schema is restored into the throw-away copy only, so the rehearsal can prove it is preserved and untouched), or print a credential.
# The only production contact is one read-only LIST and one GET of the newest backup object, with the bucket credentials injected by
# `railway run` into that single download process.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RW_PROJECT_ID="${RW_PROJECT_ID:-11d4acc0-4f19-4c05-a41c-fa20d3b235af}"       # Railway project "Sunchaser Railway Staging" (holds production)
RW_ENVIRONMENT_ID="${RW_ENVIRONMENT_ID:-a3fcb877-f02b-44b5-af5c-f03fac71f05b}" # environment "production"
RW_BACKUP_SERVICE="${RW_BACKUP_SERVICE:-sunchaser-schema-bootstrap-2}"         # the daily backup job: it carries the bucket variables
PORT="${REHEARSAL_PG_PORT:-55432}"
TARBALL=""
while [ $# -gt 0 ]; do case "$1" in --tarball) TARBALL="$2"; shift 2;; -h|--help) sed -n '2,13p' "$0"; exit 0;; *) echo "unknown argument: $1"; exit 2;; esac; done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d /private/tmp/sunchaser-rehearsal.XXXXXX 2>/dev/null || mktemp -d "${TMPDIR:-/tmp}/sunchaser-rehearsal.XXXXXX")" || { echo "cannot create a work directory"; exit 1; }
chmod 700 "$WORK"
RETURN_FILE="${RETURN_FILE:-$HOME/sunchaser-rehearsal-RETURN.txt}"   # fixed name; an older file is moved to ...RETURN.previous.txt
STARTED_PG=0
say() { printf '\n== %s\n' "$*"; }
cleanup() {
  local rc=$?
  say "stop (nothing is deleted automatically)"
  if [ "$STARTED_PG" = 1 ] && [ -n "${PGBIN:-}" ]; then "$PGBIN/pg_ctl" -D "$WORK/pgdata" -m fast stop >/dev/null 2>&1 && echo "scratch PostgreSQL stopped (its data stays in the work folder)"; fi
  echo "work folder (holds the downloaded backup and the restored copy = customer data):"
  echo "    $WORK"
  [ -f "$RETURN_FILE" ] && echo "RETURN file (counts and PASS/FAIL lines only):  $RETURN_FILE"
  echo "After the result has been reviewed, remove everything with:"
  echo "    bash '$REPO/scripts/rehearsal/cleanup-rehearsal.sh' '$WORK' '$REPO'"
  if [ -d "$WORK/pgdata" ] && [ -n "${PGBIN:-}" ]; then
    echo "To look at the restored copy again before that:"
    echo "    '$PGBIN/pg_ctl' -D '$WORK/pgdata' -o \"-p $PORT -k $WORK/sock -c listen_addresses=''\" -l '$WORK/pg.log' -w start && '$PGBIN/psql' -h '$WORK/sock' -p $PORT -U postgres -d restore_rehearsal"
  fi
  exit $rc
}
trap cleanup EXIT INT TERM

say "0. prerequisites"
PGBIN="${PG17_BIN:-}"
if [ -z "$PGBIN" ]; then for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do [ -x "$d/pg_restore" ] && PGBIN="$d" && break; done; fi
[ -n "$PGBIN" ] || { echo "PostgreSQL 17 tools not found. Install: brew install postgresql@17   (or set PG17_BIN=/path/to/bin)"; exit 1; }
export PATH="$PGBIN:$PATH"
for t in psql pg_restore pg_dump initdb pg_ctl perl curl tar; do command -v "$t" >/dev/null || { echo "missing tool: $t"; exit 1; }; done
major() { "$1" --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/'; }
[ "$(major psql)" = 17 ] && [ "$(major pg_restore)" = 17 ] || { echo "psql/pg_restore must be version 17 (found $(psql --version), $(pg_restore --version))"; exit 1; }
echo "tools: $(psql --version | head -1) | $(pg_restore --version | head -1) | $(curl --version | head -1 | cut -d' ' -f1-2)"
COMMIT="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"; echo "repository commit: $COMMIT"
if [ -n "${EXPECTED_COMMIT:-}" ] && [ "$COMMIT" != "$EXPECTED_COMMIT" ]; then echo "STOP: this checkout is $COMMIT but the tested commit is $EXPECTED_COMMIT. Nothing was downloaded."; exit 1; fi
[ -z "$(git -C "$REPO" status --porcelain 2>/dev/null)" ] || echo "WARNING: the working tree has local changes; the rehearsal is only comparable if the commit is clean"

say "1. get the newest production backup (read-only)"
if [ -n "$TARBALL" ]; then
  [ -f "$TARBALL" ] || { echo "no such file: $TARBALL"; exit 1; }
  mkdir -p "$WORK/dl"; cp "$TARBALL" "$WORK/dl/sunchaser-postgres.tar.gz"; chmod 600 "$WORK/dl/sunchaser-postgres.tar.gz"
  SHA="$( (sha256sum "$WORK/dl/sunchaser-postgres.tar.gz" 2>/dev/null || shasum -a 256 "$WORK/dl/sunchaser-postgres.tar.gz") | cut -d' ' -f1)"
  printf 'key=(supplied file)\nstamp=(unknown)\nbytes=%s\nsha256=%s\n' "$(wc -c < "$WORK/dl/sunchaser-postgres.tar.gz" | tr -d ' ')" "$SHA" > "$WORK/dl/download.info"
  tar -tzf "$WORK/dl/sunchaser-postgres.tar.gz" | grep -qx database.dump && tar -tzf "$WORK/dl/sunchaser-postgres.tar.gz" | grep -qx globals.sql || { echo "the file is not a sunchaser-postgres.tar.gz (needs database.dump and globals.sql)"; exit 1; }
else
  command -v railway >/dev/null || { echo "Railway CLI not found. Install: brew install railway ; then: railway login   (or download the file in the Railway dashboard and use --tarball FILE)"; exit 1; }
  railway whoami >/dev/null 2>&1 || { echo "Not logged in to Railway. Run: railway login   (opens your browser; no password is typed into this terminal)"; exit 1; }
  railway run -p "$RW_PROJECT_ID" -e "$RW_ENVIRONMENT_ID" -s "$RW_BACKUP_SERVICE" bash "$REPO/scripts/rehearsal/fetch-latest-production-backup.sh" "$WORK/dl" || { echo "download failed (see message above)"; exit 1; }
fi
cat "$WORK/dl/download.info"

say "2. throw-away PostgreSQL 17 server (private unix socket, no network port, trust auth inside $WORK)"
mkdir -p "$WORK/sock"
if [ "${SCRATCH_SERVER:-own}" = external ]; then
  : "${RESTORE_PGHOST:?}" "${RESTORE_PGPORT:?}" "${RESTORE_PGUSER:?}"
else
  initdb -D "$WORK/pgdata" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null || { echo "initdb failed"; exit 1; }
  pg_ctl -D "$WORK/pgdata" -o "-p $PORT -k $WORK/sock -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null || { echo "could not start the scratch server (see $WORK/pg.log)"; exit 1; }
  STARTED_PG=1
  export RESTORE_PGHOST="$WORK/sock" RESTORE_PGPORT="$PORT" RESTORE_PGUSER=postgres
fi
echo "scratch server: $(psql -h "$RESTORE_PGHOST" -p "$RESTORE_PGPORT" -U "$RESTORE_PGUSER" -d postgres -qAt -c 'show server_version')"

say "3. restore rehearsal"
export REHEARSAL_FROM_TARBALL="$WORK/dl/sunchaser-postgres.tar.gz" REHEARSAL_DIR="$WORK/rehearsal"
bash "$REPO/scripts/rehearsal/run-rehearsal.sh" 2>&1 | tee "$WORK/rehearsal.out"
FAILS="$(grep -c '^FAIL' "$WORK/rehearsal.out" || true)"; PASSES="$(grep -c '^PASS' "$WORK/rehearsal.out" || true)"

say "4. RETURN file"
[ -f "$RETURN_FILE" ] && mv -f "$RETURN_FILE" "${RETURN_FILE%.txt}.previous.txt"
{
  echo "=== SUNCHASER RESTORE REHEARSAL - RETURN BLOCK (contains no customer values) ==="
  echo "run (UTC):        $STAMP"
  echo "repo commit:      $COMMIT"
  echo "host:             $(uname -srm)"
  echo "tools:            $(psql --version | head -1)"
  echo "scratch server:   $(psql -h "$RESTORE_PGHOST" -p "$RESTORE_PGPORT" -U "$RESTORE_PGUSER" -d postgres -qAt -c 'show server_version' 2>/dev/null)"
  sed 's/^/backup:           /' "$WORK/dl/download.info"
  echo "result:           $PASSES PASS, $FAILS FAIL"
  echo
  echo "--- PASS/FAIL lines (verbatim) ---"
  grep -E '^(PASS|FAIL|NOTE)' "$WORK/rehearsal.out"
  echo
  echo "--- invoice-payments preflight verdict (counts only) ---"
  sed -n '/=== 1. VERDICT ===/,/=== 2/p' "$WORK/rehearsal.out" | grep -v '^=== 2' | cut -c1-200
  echo
  echo "--- crm_recovery tables (name, row count) ---"
  [ -f "$WORK/rehearsal/crm-recovery-counts.tsv" ] && cat "$WORK/rehearsal/crm-recovery-counts.tsv"
  echo
  echo "--- cleared accounting tables: base name, recovered rows, public rows now, recovered rows back in public ---"
  [ -f "$WORK/rehearsal/six-tables.tsv" ] && cat "$WORK/rehearsal/six-tables.tsv"
  echo
  echo "--- all schemas / table count in the restored copy ---"
  grep -E '^(restored:|restored copy:)' "$WORK/rehearsal.out"
  echo "=== END ==="
} > "$RETURN_FILE"
chmod 600 "$RETURN_FILE"
echo "written: $RETURN_FILE   ($PASSES PASS, $FAILS FAIL)"
echo "copy it to the clipboard (Mac):  pbcopy < '$RETURN_FILE'"
[ "$FAILS" = 0 ]
