#!/usr/bin/env bash
# Proves the Phase 2 migration on a DISPOSABLE database (never production):
#   seed -> schema snapshot -> up -> up (idempotent) -> structural checks -> rollback -> schema + data identical -> up again
# Usage: E2E_PSQL="-h /srv/stack -p 55432 -U postgres -d sunchaser_test" bash scripts/saas/test-phase2-migration.sh
set -euo pipefail
: "${E2E_PSQL:?Set E2E_PSQL to the psql arguments of a disposable database}"
case "$E2E_PSQL" in *railway*|*supabase*|*rlwy*) echo "Refusing: looks like a hosted database." >&2; exit 2;; esac
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
P="psql $E2E_PSQL -q -v ON_ERROR_STOP=1"
Q="psql $E2E_PSQL -tA"
DUMP_ARGS=$(echo "$E2E_PSQL" | sed -E 's/-d ([^ ]+)/\1/')   # pg_dump takes the db name positionally
dump() { pg_dump ${DUMP_ARGS} --schema-only --no-owner --no-privileges --exclude-schema=app_rollback_backup | grep -v -E '^--|^\\(un)?restrict|^$'; }
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }

# Re-runnable: if a previous run left the migration applied, undo it first so the snapshot is the true original.
if [ "$($Q -c "select count(*) from pg_namespace where nspname='app'")" != "0" ]; then
  if ! $P -f "$REPO/scripts/saas/phase2-company-foundation-rollback.sql" > "$W/pre-rollback.log" 2>&1; then
    echo "Could not undo the previous migration run on this database:"; grep -iE "refused|error" "$W/pre-rollback.log" | head -3
    echo "Remove other companies (or use a fresh database) and rerun."; exit 3
  fi
fi
$P -c "drop schema if exists app_rollback_backup cascade" > /dev/null 2>&1

$P <<'SQL'
insert into customers (id,name,email) values ('mig-c1','Mig Customer','mig@example.test') on conflict do nothing;
insert into leads (id,name,phone,email,address,status,customer_id) values
  ('mig-l1','Mig Lead 1','03001112233','l1@example.test','Road 1','New','mig-c1'),
  ('mig-l2','Mig Lead 2','03004445566','l2@example.test','Road 2','New',null) on conflict do nothing;
SQL
dump > "$W/schema.before"
$Q -c "select md5(string_agg(t::text,'|' order by id)) from (select * from leads) t" > "$W/leads.before"
$Q -c "select md5(string_agg(to_jsonb(t)::text,'|' order by id)) from (select * from leads) t" > "$W/leads.before.json"
$Q -c "select count(*) from pg_policies where schemaname='public' and roles='{public}' and qual='true'" > "$W/open.before"
USERS=$($Q -c "select count(*) from users where role <> 'Customer'")

$P -f "$REPO/scripts/saas/phase2-company-foundation.sql" > /dev/null 2>&1
$P -f "$REPO/scripts/saas/phase2-company-foundation.sql" > /dev/null 2>&1
check "up applied twice without error (idempotent)" "$?" "0"
check "founding company exists" "$($Q -c "select count(*) from companies where id='sunchaser'")" "1"
check "every non-customer user became a member of sunchaser" "$($Q -c "select count(*) from company_memberships where company_id='sunchaser'")" "$USERS"
check "no legacy open policy remains on a tenant table" "$($Q -c "select count(*) from pg_policies p where schemaname='public' and roles && array['public','anon','authenticated']::name[] and qual='true' and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=p.tablename and c.column_name='company_id' and exists (select 1 from pg_policies q where q.tablename=p.tablename and q.policyname like 'tenant_%'))")" "0"
check "every tenant table has company_id NOT NULL" "$($Q -c "select count(*) from app.original_state where kind='created_column'") $($Q -c "select count(*) from information_schema.columns c where c.table_schema='public' and c.column_name='company_id' and c.is_nullable='YES' and c.table_name not in ('roles','role_permissions') and exists (select 1 from pg_policies q where q.tablename=c.table_name and q.policyname like 'tenant_%')")" "$($Q -c "select count(*) from app.original_state where kind='created_column'") 0"
check "existing rows kept company_id sunchaser" "$($Q -c "select count(*) from leads where company_id <> 'sunchaser'")" "0"
check "tenant role holds no privilege on marketplace tables" "$($Q -c "select count(*) from information_schema.role_table_grants where grantee='crm_tenant' and table_name like 'mp\\_%' escape '\\'")" "0"
check "tenant role holds no privilege on users" "$($Q -c "select count(*) from information_schema.role_table_grants where grantee='crm_tenant' and table_name='users'")" "0"
check "tenant role cannot execute application functions" "$($Q -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') and has_function_privilege('crm_tenant', p.oid, 'execute')")" "0"
check "service role can still execute application functions" "$($Q -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') and not has_function_privilege('service_role', p.oid, 'execute')")" "0"
check "service role can read and write the new identity tables" "$($Q -c "set role service_role; select count(*) from company_memberships; update companies set name = name where id='sunchaser'" 2>&1 | grep -E '^[0-9]+$|ERROR|denied' | head -1 | sed -E 's/^[0-9]+$/ok/')" "ok"
# Legacy single-company writes (service role, no company context) must still work: the column default is evaluated by that role.
SR_OUT=$($Q -c "set role service_role; insert into leads (id,name,phone,email,address,status) values ('mig-sr1','SR Lead','03009990000','sr@example.test','Road','New') returning company_id" 2>&1 | grep -E '^sunchaser$|ERROR|denied' | head -1)
check "service role inserts without a company default to sunchaser" "$SR_OUT" "sunchaser"
$P -c "delete from leads where id='mig-sr1'" > /dev/null 2>&1 || true
$Q -c "select md5(string_agg((to_jsonb(t)-'company_id')::text,'|' order by id)) from (select * from leads) t" > "$W/leads.mid"
check "row data unchanged apart from the new column" "$(cat "$W/leads.mid")" "$(cat "$W/leads.before.json")" 

$P -f "$REPO/scripts/saas/phase2-company-foundation-rollback.sql" > /dev/null 2>&1
check "rollback applied" "$?" "0"
dump > "$W/schema.after"
check "schema after rollback is identical to the original" "$(diff "$W/schema.before" "$W/schema.after" | grep -c '^[<>]' || true)" "0"
if ! diff -q "$W/schema.before" "$W/schema.after" >/dev/null; then diff "$W/schema.before" "$W/schema.after" | head -20; fi
check "legacy policies restored" "$($Q -c "select count(*) from pg_policies where schemaname='public' and roles='{public}' and qual='true'")" "$(cat "$W/open.before")"
check "row data identical after rollback" "$($Q -c "select md5(string_agg(t::text,'|' order by id)) from (select * from leads) t")" "$(cat "$W/leads.before")"
$P -f "$REPO/scripts/saas/phase2-company-foundation.sql" > /dev/null 2>&1
check "up re-applies after a rollback" "$?" "0"

echo; echo "$ok passed, $bad failed"; [ "$bad" = 0 ]
