#!/usr/bin/env bash
# Disposable SECOND PostgreSQL cluster used only to demonstrate/verify restores (never production). Usage: restore-cluster.sh start|stop|reset
set -euo pipefail
DIR="${E2E_RESTORE_DIR:-/srv/e2e-backup-restore}"; PORT="${E2E_RESTORE_PG_PORT:-55515}"; PGBIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
case "${1:-}" in
  start)
    mkdir -p "$DIR"; chown postgres:postgres "$DIR"
    [ -d "$DIR/data" ] || su postgres -c "$PGBIN/initdb -D $DIR/data -U postgres --auth=trust --locale=C.UTF-8 --encoding=UTF8" > "$DIR/initdb.log"
    su postgres -c "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/pg.log -w start" ;;
  stop) su postgres -c "$PGBIN/pg_ctl -D $DIR/data stop -m fast" ;;
  reset) su postgres -c "$PGBIN/pg_ctl -D $DIR/data stop -m fast" 2>/dev/null || true; rm -rf "$DIR" ;;
  *) echo "usage: $0 start|stop|reset" >&2; exit 2 ;;
esac
