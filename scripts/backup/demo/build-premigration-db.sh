#!/usr/bin/env bash
# Builds a database that looks like production BEFORE the Smart Quote migration (tracked schema files replayed, plus the known
# production-only column invoices.created_by_user_id) on a scratch cluster. Usage: build-premigration-db.sh <db name>
# Env: E2E_STACK_DIR (socket dir), E2E_PG_PORT. Never point this at a real server.
set -euo pipefail
DB="${1:?db name}"; [[ "$DB" =~ ^[a-z0-9_]+$ ]] || { echo "bad db name"; exit 2; }
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
STACK="${E2E_STACK_DIR:?}"; PORT="${E2E_PG_PORT:?}"
case "$STACK" in /srv/e2e-*) ;; *) echo "refusing: E2E_STACK_DIR must be a /srv/e2e-* scratch directory"; exit 2;; esac
PSQL="psql -h $STACK -p $PORT -U postgres"
$PSQL -tAc "select 1 from pg_database where datname='$DB'" | grep -q 1 && { echo "$DB already exists"; exit 3; }
$PSQL -qc "create database $DB"
P="$PSQL -d $DB -q"
$P <<'SQL'
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create or replace function auth.role() returns text language sql stable as $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
create extension if not exists pgcrypto;
SQL
FILES="$(sed -n '/^SCHEMA_FILES="/,/"$/p' "$REPO/scripts/e2e-crm-repair/isolated-stack.sh" | sed -e 's/^SCHEMA_FILES="//' -e 's/"$//' | tr '\n' ' ')"
for pass in 1 2; do for f in $FILES; do $P -f "$REPO/$f" > /dev/null 2>&1 || true; done; done
$P -c "alter table public.invoices add column if not exists created_by_user_id text"
$P -c "grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant all on all functions in schema public to service_role;"
echo "built $DB: $($P -tAc "select count(*) from pg_tables where schemaname='public'") public tables; smart_quote_versions exists: $($P -tAc "select to_regclass('public.smart_quote_versions') is not null")"
