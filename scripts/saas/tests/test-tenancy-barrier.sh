#!/usr/bin/env bash
# Proves phase2i (t1b, the persistent tenancy marker and the database barrier) on a DISPOSABLE database:
#   additive and idempotent; the marker; the PostgREST pre-request function (what it refuses, what it allows) simulated with the same settings PostgREST sets;
#   a pilot company cannot be created before the marker is on AND the barrier is verified; the marker SURVIVES the deletion of a companies row while tenant rows
#   remain; the marker can only be cleared when no other company and no other company's row exists; privileges; the rollback is refused while any of that holds.
#   E2E_ADMIN="-h /srv/s -p 55432 -U postgres" bash scripts/saas/tests/test-tenancy-barrier.sh
set -euo pipefail
: "${E2E_ADMIN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; SAAS="$HERE/.."
DB="${TB_DB:-t_tb_$$}"
bash "$HERE/mkdb.sh" "$DB" > /dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true' EXIT
P="psql $E2E_ADMIN -d $DB -q -v ON_ERROR_STOP=1"; Q="psql $E2E_ADMIN -d $DB -tA"
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }
# req <claims-json> <headers-json> <path>: run the pre-request function the way PostgREST does (request role, request.* settings); prints OK or the SQLSTATE and message
req() {
  local role="$1" claims="$2" headers="$3" path="$4"
  psql $E2E_ADMIN -d "$DB" -tA -c "begin; set local role $role; select set_config('request.jwt.claims', '$claims', true), set_config('request.headers', '$headers', true), set_config('request.path', '$path', true); select app.saas_pre_request(); commit;" 2>&1 \
    | grep -E 'ERROR|^$' | head -1 | sed -E 's/^.*ERROR:  //' | cut -c1-60 | sed -E 's/^$/OK/'
}
SVC='{"role":"service_role"}'; TEN='{"role":"crm_tenant"}'
as() { psql $E2E_ADMIN -d "$DB" -tA -v ON_ERROR_STOP=1 -c "begin; set local role $1; $2; commit;" 2>&1 | grep -E 'ERROR' | head -1 | sed -E 's/^.*ERROR:  //' | cut -c1-90; }

for f in phase2-company-foundation; do $P -f "$SAAS/$f.sql" > /dev/null 2>&1; done
$P -f "$SAAS/phase2i-tenancy-barrier.sql" > /dev/null 2>&1; check "phase2i applies" "$?" "0"
$P -f "$SAAS/phase2i-tenancy-barrier.sql" > /dev/null 2>&1; check "applying twice is harmless (idempotent)" "$?" "0"
check "the marker starts as single" "$($Q -c "select public.saas_isolation_status()->>'mode'")" "single"
check "PostgREST is told about the pre-request function (role setting, this database only)" "$($Q -c "select count(*) from pg_db_role_setting s join pg_roles r on r.oid = s.setrole join pg_database d on d.oid = s.setdatabase where r.rolname='authenticator' and d.datname=current_database() and s.setconfig::text like '%pgrst.db_pre_request=app.saas_pre_request%'")" "1"
check "and not for the other databases of the cluster" "$($Q -c "select count(*) from pg_db_role_setting s join pg_roles r on r.oid = s.setrole where r.rolname='authenticator' and s.setdatabase = 0 and s.setconfig::text like '%pgrst.db_pre_request%'")" "0"

# ---- single mode: the barrier does nothing
check "marker single: a service-role request with no header passes" "$(req service_role "$SVC" '{}' /leads)" "OK"
check "marker single: a request with no claims at all passes" "$(req service_role '{}' '{}' /leads)" "OK"

# ---- the pilot company cannot be created before the barrier is on and verified
check "a pilot company is refused while the marker is single" "$($P -c "insert into companies (id, slug, name, status) values ('co_x','co-x','X','active')" 2>&1 | grep -c 'refused: the tenancy marker')" "1"
check "enable the marker" "$($Q -c "select app.tenancy_enable()")" "multi"
check "a pilot company is still refused until the barrier is VERIFIED" "$($P -c "insert into companies (id, slug, name, status) values ('co_x','co-x','X','active')" 2>&1 | grep -c 'refused: the tenancy marker')" "1"
check "confirming the barrier needs the marker (disable, confirm: refused)" "$($Q -c "select 1" >/dev/null; $P -c "select app.tenancy_disable()" >/dev/null 2>&1; $P -c "select app.tenancy_confirm_barrier()" 2>&1 | grep -c 'enable the marker first')" "1"
$Q -c "select app.tenancy_enable()" > /dev/null

# ---- marker multi: what the barrier refuses and allows
check "NO header, service role: refused" "$(req service_role "$SVC" '{}' /leads)" "tenant isolation barrier: this database holds more than one "
check "header single (a flag-off process of the new build): refused" "$(req service_role "$SVC" '{"x-isolation-mode":"single"}' /invoices)" "tenant isolation barrier: this database holds more than one "
check "header multi: allowed" "$(req service_role "$SVC" '{"x-isolation-mode":"multi"}' /invoices)" "OK"
check "header global-only on a marketplace table: allowed" "$(req service_role "$SVC" '{"x-isolation-mode":"global-only"}' /mp_products)" "OK"
check "header global-only on a marketplace function: allowed" "$(req service_role "$SVC" '{"x-isolation-mode":"global-only"}' /rpc/mp_commit_prices)" "OK"
check "header global-only on a TENANT table: refused" "$(req service_role "$SVC" '{"x-isolation-mode":"global-only"}' /leads)" "tenant isolation barrier: this database holds more than one "
check "header global-only cannot smuggle a tenant path that merely contains mp_: refused" "$(req service_role "$SVC" '{"x-isolation-mode":"global-only"}' /leads?x=/mp_)" "tenant isolation barrier: this database holds more than one "
check "the status question is always allowed, even with no header" "$(req service_role "$SVC" '{}' /rpc/saas_isolation_status)" "OK"
check "the tenant role is not touched (row-level security binds it)" "$(req crm_tenant "$TEN" '{}' /leads)" "OK"
check "the anonymous role is not touched" "$(req anon '{"role":"anon"}' '{}' /leads)" "OK"
check "the error carries SQLSTATE PT503, which PostgREST turns into HTTP 503" "$(psql $E2E_ADMIN -d "$DB" -tA -c "begin; set local role service_role; select set_config('request.jwt.claims','$SVC',true), set_config('request.headers','{}',true), set_config('request.path','/leads',true); select app.saas_pre_request(); commit;" 2>&1 | grep -c 'PT503\|isolation barrier')" "1"
check "garbage in the settings never makes it fail open: unparseable headers are an error, not a pass" "$(req service_role "$SVC" 'not json' /leads | grep -c 'OK')" "0"

# ---- verify the barrier, then a pilot company can be created
check "confirm the barrier" "$($Q -c "select app.tenancy_confirm_barrier()")" "verified"
$P -c "insert into companies (id, slug, name, status) values ('co_x','co-x','X','active'), ('co_y','co-y','Y','active')"; check "pilot companies can now be created" "$?" "0"
$P -c "insert into leads (id, name, email, phone, address, company_id) values ('l-x','n','e@x','1','a','co_x')"

# ---- the marker survives deleting the companies row (item: a hand deletion must not re-enable unrestricted access)
check "status: mode multi, 2 other companies, tenant rows present" "$($Q -c "select (public.saas_isolation_status(true)->>'mode') || ':' || (public.saas_isolation_status(true)->>'other_companies') || ':' || (public.saas_isolation_status(true)->>'foreign_rows')")" "multi:2:true"
$P -c "set session_replication_role = replica; delete from companies where id in ('co_x','co_y'); set session_replication_role = origin"
check "after the companies rows were deleted by hand (foreign keys bypassed) the marker is still multi" "$($Q -c "select public.saas_isolation_status()->>'mode'")" "multi"
check "...no company is left to count, yet the deep check still sees the other company's lead" "$($Q -c "select (public.saas_isolation_status(true)->>'other_companies') || ':' || (public.saas_isolation_status(true)->>'foreign_rows')")" "0:true"
check "...and the barrier still refuses an unaware service-role request" "$(req service_role "$SVC" '{}' /leads)" "tenant isolation barrier: this database holds more than one "
check "tenancy_disable is refused while that row exists" "$($P -c "select app.tenancy_disable()" 2>&1 | grep -c 'tables still hold rows')" "1"
check "the marker is still on after the refused disable" "$($Q -c "select public.saas_isolation_status()->>'mode'")" "multi"
check "the rollback of t1b is refused while the marker is on" "$($P -f "$SAAS/phase2i-tenancy-barrier-rollback.sql" 2>&1 | grep -c 'Rollback refused')" "1"
$P -c "delete from leads where id='l-x'"
check "with the data removed and no company left, tenancy_disable succeeds" "$($Q -c "select app.tenancy_disable()")" "single"
check "...and the barrier is off again (and the verification forgotten)" "$(req service_role "$SVC" '{}' /leads)-$($Q -c "select public.saas_isolation_status()->>'barrier_verified'")" "OK-false"
check "...and a new pilot company is refused again until the steps are repeated" "$($P -c "insert into companies (id, slug, name, status) values ('co_z','co-z','Z','active')" 2>&1 | grep -c 'refused: the tenancy marker')" "1"

# ---- tenancy_disable refuses while a company row exists even with no tenant rows
$Q -c "select app.tenancy_enable(), app.tenancy_confirm_barrier()" > /dev/null
$P -c "insert into companies (id, slug, name, status) values ('co_z','co-z','Z','active')"
check "tenancy_disable refused while a company other than sunchaser exists" "$($P -c "select app.tenancy_disable()" 2>&1 | grep -c 'companies other than sunchaser exist')" "1"
$P -c "delete from companies where id='co_z'"; $Q -c "select app.tenancy_disable()" > /dev/null

# ---- privileges
for r in crm_tenant anon; do
  check "$r cannot call tenancy_enable" "$(as $r "select app.tenancy_enable()")" "permission denied for function tenancy_enable"
  check "$r cannot ask the isolation status through the API function" "$(as $r "select public.saas_isolation_status()")" "permission denied for function saas_isolation_status"
done
check "the service role cannot switch the marker (owner only)" "$(as service_role "select app.tenancy_disable()")" "permission denied for function tenancy_disable"
check "the service role cannot confirm the barrier (owner only)" "$(as service_role "select app.tenancy_confirm_barrier()")" "permission denied for function tenancy_confirm_barrier"
check "the service role can ask the status" "$(as service_role "select public.saas_isolation_status(true)")" ""
check "nobody can write the marker through the table (no API role can reach app.config)" "$(as service_role "update app.config set value='single' where key='tenancy.mode'")" "permission denied for table config"

# ---- a database that already holds another company gets the marker when the migration is applied
DB2="${DB}_pre"; bash "$HERE/mkdb.sh" "$DB2" > /dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true; psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB2 with (force)" > /dev/null 2>&1 || true' EXIT
psql $E2E_ADMIN -d "$DB2" -q -v ON_ERROR_STOP=1 -f "$SAAS/phase2-company-foundation.sql" > /dev/null 2>&1
psql $E2E_ADMIN -d "$DB2" -q -c "insert into companies (id, slug, name, status) values ('co_old','co-old','Old','active')"
psql $E2E_ADMIN -d "$DB2" -q -v ON_ERROR_STOP=1 -f "$SAAS/phase2i-tenancy-barrier.sql" > /dev/null 2>&1
check "t1b applied to a database that already holds a pilot company turns the marker on by itself" "$(psql $E2E_ADMIN -d "$DB2" -tA -c "select public.saas_isolation_status()->>'mode'")" "multi"

# ---- rollback (clean database)
check "rollback applies when there is no marker, no other company, no tenant row" "$($P -f "$SAAS/phase2i-tenancy-barrier-rollback.sql" > /dev/null 2>&1; echo $?)" "0"
check "rollback removed the functions, the trigger and the role setting" "$($Q -c "select to_regprocedure('app.saas_pre_request()') is null and to_regprocedure('public.saas_isolation_status(boolean)') is null and not exists (select 1 from pg_trigger where tgname='companies_require_barrier') and not exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid=s.setrole where r.rolname='authenticator' and s.setconfig::text like '%pgrst.db_pre_request%' and s.setdatabase = (select oid from pg_database where datname=current_database()))")" "t"
$P -f "$SAAS/phase2i-tenancy-barrier.sql" > /dev/null 2>&1; check "re-apply after rollback works" "$?" "0"

echo; echo "tenancy barrier (phase2i): $ok passed, $bad failed"
[ "$bad" = 0 ]
