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
# The six accounting tables the owner reported clearing on 9 Oct 2026, with the same row counts: 2 invoices, 13 invoice items, 2 invoice payments,
# 3 "other payment" records (public.payments), 27 quotations, 1 archived party ledger. Synthetic rows; recovery copies in crm_recovery.
psql $TGT_ARGS -d "$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
insert into public.quotations (id, lead_id, system_size_kw, panel_count, panel_type, inverter_type, total_cost, federal_tax_credit, net_cost, estimated_annual_savings, payback_period_years)
  select 'q-reset-' || g, (select id from public.leads order by id limit 1), 5, 10, 'synthetic', 'synthetic', 1000, 0, 1000, 100, 5 from generate_series(1, 27) g;
insert into public.payments (lead_id) select id from public.leads order by id limit 3;
insert into public.party_ledger_archives (party_key, archived_by) values ('synthetic-party', 'synthetic');
create schema crm_recovery;
create table crm_recovery.accounts_reset_20261009_invoices as select * from public.invoices order by id limit 2;
create table crm_recovery.accounts_reset_20261009_invoice_items as select * from public.invoice_items order by id limit 13;
create table crm_recovery.accounts_reset_20261009_invoice_payments as select * from public.invoice_payments order by id limit 2;
create table crm_recovery.accounts_reset_20261009_payments as table public.payments;
create table crm_recovery.accounts_reset_20261009_quotations as table public.quotations;
create table crm_recovery.accounts_reset_20261009_party_ledger_archives as table public.party_ledger_archives;
revoke all on schema crm_recovery from public, anon, authenticated, service_role;
delete from public.invoice_payments; delete from public.invoice_items; delete from public.invoices;
delete from public.payments; delete from public.quotations; delete from public.party_ledger_archives;
SQL
if [ "${NEW_RECORDS:-0}" = 1 ]; then
  # legitimate records created AFTER the reset (not in the recovery copy)
  psql $TGT_ARGS -d "$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
insert into public.invoices (id, invoice_number, customer_name, subtotal, grand_total, balance_due) values ('inv-after-reset-1', 'NEW-0001', 'Synthetic After Reset', 5000, 5000, 5000);
insert into public.invoice_items (id, invoice_id, description, qty, rate, line_total) values ('item-after-reset-1', 'inv-after-reset-1', 'Synthetic', 1, 5000, 5000);
SQL
fi
psql $TGT_ARGS -d "$DB" -tAc "select 'invoices='||(select count(*) from public.invoices)||' items='||(select count(*) from public.invoice_items)||' payments='||(select count(*) from public.invoice_payments)||' leads='||(select count(*) from public.leads)||' users='||(select count(*) from public.users)||' recovery_invoices='||(select count(*) from crm_recovery.accounts_reset_20261009_invoices)||' recovery_quotations='||(select count(*) from crm_recovery.accounts_reset_20261009_quotations)"
