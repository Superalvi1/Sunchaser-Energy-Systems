#!/usr/bin/env bash
# Builds the template database the SaaS database tests clone: a synthetic CRM schema from the tracked SQL, the API roles, and the four
# release migrations applied by the migration runner (so the runner's apply path is exercised on a clean schema too).
#   E2E_ADMIN="-h 127.0.0.1 -p 5432 -U postgres" bash scripts/saas/tests/build-base.sh        (creates database sc_base_template)
# Disposable servers only: refuses hosted-looking connections.
set -euo pipefail
: "${E2E_ADMIN:?psql connection arguments without -d}"
case "$E2E_ADMIN" in *railway*|*supabase*|*rlwy*) echo "Refusing: looks like a hosted database." >&2; exit 2;; esac
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
DB="${E2E_BASE_DB:-sc_base_template}"
psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" -c "create database $DB" 2>&1 | grep -v NOTICE || true
P="psql $E2E_ADMIN -d $DB -q"
$P -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create or replace function auth.role() returns text language sql stable as $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
create extension if not exists pgcrypto;
SQL
# The same file list the repair journeys use (production's schema is not fully reproducible from tracked SQL; these cover the product).
FILES="$(sed -n '/^SCHEMA_FILES="/,/"$/p' "$REPO/scripts/e2e-crm-repair/isolated-stack.sh" | sed 's/^SCHEMA_FILES="//; s/"$//')"
for pass in 1 2; do for f in $FILES; do $P -f "$REPO/$f" > /dev/null 2>&1 || true; done; done
$P -c "alter table public.invoices add column if not exists created_by_user_id text"
$P -c "grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant all on all functions in schema public to service_role;"
# The release migrations, through the runner.
HOSTARG="$(echo "$E2E_ADMIN" | sed -nE 's/.*-h ([^ ]+).*/\1/p')"; PORTARG="$(echo "$E2E_ADMIN" | sed -nE 's/.*-p ([^ ]+).*/\1/p')"; USERARG="$(echo "$E2E_ADMIN" | sed -nE 's/.*-U ([^ ]+).*/\1/p')"
PGHOST="$HOSTARG" PGPORT="${PORTARG:-5432}" PGUSER="${USERARG:-postgres}" PGDATABASE="$DB" node "$REPO/scripts/migrations/run.mjs" apply --to r4-invoice-save-atomic --yes
echo "built $DB: $(psql $E2E_ADMIN -d $DB -tAc "select count(*) from information_schema.tables where table_schema='public'") public tables, release migrations r1-r4 applied"
