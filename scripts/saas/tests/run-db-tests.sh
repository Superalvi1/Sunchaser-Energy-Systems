#!/usr/bin/env bash
# Runs every SaaS database test against a DISPOSABLE PostgreSQL server (CI: the service container; locally any scratch server).
#   E2E_ADMIN="-h 127.0.0.1 -p 5432 -U postgres" PGPASSWORD=... bash scripts/saas/tests/run-db-tests.sh
set -uo pipefail
: "${E2E_ADMIN:?psql connection arguments without -d}"
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$HERE/../../.."
bash "$HERE/build-base.sh" || { echo "FAIL: could not build the base database"; exit 1; }
rc=0
for t in "$HERE/../test-phase2-migration.sh" "$HERE/test-ownership.sh" "$HERE/test-numbering.sh" "$HERE/test-settings.sh" "$HERE/test-subscriptions.sh" "$HERE/test-invoice-snapshot.sh" "$HERE/test-company-restore.sh" "$REPO/scripts/migrations/test-runner.sh"; do
  echo; echo "=== $(basename "$t")"
  if [[ "$(basename "$t")" == test-phase2-migration.sh ]]; then
    bash "$HERE/mkdb.sh" t_mig > /dev/null
    E2E_PSQL="$E2E_ADMIN -d t_mig" bash "$t"; r=$?
    psql $E2E_ADMIN -d postgres -qc "drop database if exists t_mig with (force)" > /dev/null 2>&1
  else
    bash "$t"; r=$?
  fi
  [ $r = 0 ] || { echo "FAILED: $(basename "$t")"; rc=1; }
done
exit $rc
