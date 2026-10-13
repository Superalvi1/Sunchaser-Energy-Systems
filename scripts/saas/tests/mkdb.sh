#!/usr/bin/env bash
# Creates a DISPOSABLE database from a release-schema dump (M1-M4 applied) for the SaaS database tests.
#   E2E_ADMIN="-h /srv/saas-c1 -p 55651 -U postgres" E2E_BASE_DUMP=/srv/saas-c1/release.dump bash mkdb.sh <new db name>
set -euo pipefail
: "${E2E_ADMIN:?psql connection arguments without -d}" "${E2E_BASE_DUMP:?custom-format dump of a database with the release migrations applied}"
case "$E2E_ADMIN" in *railway*|*supabase*|*rlwy*) echo "Refusing: looks like a hosted database." >&2; exit 2;; esac
name="${1:?database name}"
case "$name" in sc_*|t_*) ;; *) echo "Refusing: disposable database names start with sc_ or t_" >&2; exit 2;; esac
psql $E2E_ADMIN -d postgres -qc "drop database if exists $name with (force)" -c "create database $name"
pg_restore $E2E_ADMIN -d "$name" --no-owner "$E2E_BASE_DUMP" > /dev/null 2>&1 || true
psql $E2E_ADMIN -d "$name" -tAc "select 'created $name: ' || count(*) || ' public tables' from information_schema.tables where table_schema='public'"
