#!/usr/bin/env bash
# Smoke hook for restore-verify.sh --smoke-cmd: starts a PostgREST and the CRM app against the RESTORED database ($RESTORED_DB on the scratch
# cluster) with the secrets of the demo stack, runs the authenticated smoke, and stops both. Scratch stack only.
set -uo pipefail
R="${E2E_RESTORE_DIR:-/srv/e2e-backup-restore}"; EVDIR="${SMOKE_EVIDENCE_DIR:-/tmp}"; REPO_MAIN="${APP_CHECKOUT:-/home/user/Sunchaser-Energy-Systems}"
HERE="$(cd "$(dirname "$0")" && pwd)"
stop() { [ -f "$1" ] && kill -9 "$(cat "$1")" 2>/dev/null; true; }
stop "$R/pgrst.pid"; stop "$R/app.pid"; sleep 1
sed -i "s#/restore_[a-z0-9_]*?#/${RESTORED_DB}?#" "$R/pgrst.conf"
(setsid nohup /tmp/claude-0/tools/postgrest/postgrest "$R/pgrst.conf" > "$R/pgrst.log" 2>&1 < /dev/null & echo $! > "$R/pgrst.pid")
sed -i "s#-d restore_[a-z0-9_]*#-d ${RESTORED_DB}#" "$R/env.sh"
( set -a; source "$R/env.sh"; set +a; cd "$REPO_MAIN" && (setsid nohup node dist/server.cjs > "$EVDIR/app-restored-hook.log" 2>&1 < /dev/null & echo $! > "$R/app.pid") )
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:3515/health && break; sleep 0.5; done
( source "$R/env.sh"; export TEST_PW SEED_IDS; cd "$HERE/../../.." && node scripts/backup/demo/smoke-restored.mjs ); rc=$?
stop "$R/app.pid"; stop "$R/pgrst.pid"
exit $rc
