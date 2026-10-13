#!/usr/bin/env bash
# Creates a DISPOSABLE database for a SaaS database test by cloning the template built by build-base.sh (release schema, M1-M4 applied).
#   E2E_ADMIN="-h /srv/saas-c1 -p 55651 -U postgres" [E2E_BASE_DB=sc_base_template] bash mkdb.sh <new db name>
set -euo pipefail
: "${E2E_ADMIN:?psql connection arguments without -d}"
case "$E2E_ADMIN" in *railway*|*supabase*|*rlwy*) echo "Refusing: looks like a hosted database." >&2; exit 2;; esac
name="${1:?database name}"
case "$name" in sc_*|t_*) ;; *) echo "Refusing: disposable database names start with sc_ or t_" >&2; exit 2;; esac
base="${E2E_BASE_DB:-sc_base_template}"
psql $E2E_ADMIN -d postgres -qc "drop database if exists $name with (force)" -c "create database $name template $base" 2>&1 | grep -v NOTICE || true
psql $E2E_ADMIN -d "$name" -tAc "select 'created $name: ' || count(*) || ' public tables' from information_schema.tables where table_schema='public'"
