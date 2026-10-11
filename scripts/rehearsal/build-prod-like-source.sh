#!/usr/bin/env bash
# Builds a PRODUCTION-LIKE SOURCE database on a scratch PostgreSQL 17 server from a synthetic PostgreSQL 16 test database, in the state the
# owner described after the 9 Oct 2026 accounts reset: accounting tables empty, recovery copies in schema crm_recovery (prefix
# accounts_reset_20261009_), every other table untouched. Synthetic data only; never point SRC at production.
#   SRC_DUMP_ARGS="-h /srv/e2e-rehearsal -p 55601 -U postgres -d sunchaser_pre" TGT_ARGS="-h /srv/pg17c-src-sock -p 55618 -U postgres" bash build-prod-like-source.sh
set -euo pipefail
: "${SRC_DUMP_ARGS:?}" "${TGT_ARGS:?}"
DB="${TGT_DB:-sunchaser_prod_like}"
psql $TGT_ARGS -d postgres -qc "drop database if exists $DB with (force)" -c "create database $DB"
# roles first: policies, grants and owners in the dump refer to them
psql $TGT_ARGS -d "$DB" -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
SQL
pg_dump $SRC_DUMP_ARGS | psql $TGT_ARGS -d "$DB" -q -v ON_ERROR_STOP=1 >/dev/null
psql $TGT_ARGS -d "$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
create schema crm_recovery;
create table crm_recovery.accounts_reset_20261009_invoices as table public.invoices;
create table crm_recovery.accounts_reset_20261009_invoice_items as table public.invoice_items;
create table crm_recovery.accounts_reset_20261009_invoice_payments as table public.invoice_payments;
create table crm_recovery.accounts_reset_20261009_party_ledger_archives as table public.party_ledger_archives;
revoke all on schema crm_recovery from public, anon, authenticated, service_role;
delete from public.invoice_payments; delete from public.invoice_items; delete from public.invoices;
SQL
psql $TGT_ARGS -d "$DB" -tAc "select 'invoices='||(select count(*) from public.invoices)||' items='||(select count(*) from public.invoice_items)||' payments='||(select count(*) from public.invoice_payments)||' leads='||(select count(*) from public.leads)||' users='||(select count(*) from public.users)||' recovery_invoices='||(select count(*) from crm_recovery.accounts_reset_20261009_invoices)"
