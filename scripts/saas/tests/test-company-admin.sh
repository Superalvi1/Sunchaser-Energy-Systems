#!/usr/bin/env bash
# Proves phase2g (plan storage limit column, append-only settings history) on a DISPOSABLE database: additive and idempotent, the tenant role
# has no access, updates and deletes are refused for every role, the rollback keeps a copy that re-apply restores.
#   E2E_ADMIN="-h /srv/s -p 55432 -U postgres" bash scripts/saas/tests/test-company-admin.sh
set -euo pipefail
: "${E2E_ADMIN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; SAAS="$HERE/.."
DB="${ADM_DB:-t_adm_$$}"
bash "$HERE/mkdb.sh" "$DB" > /dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true' EXIT
P="psql $E2E_ADMIN -d $DB -q -v ON_ERROR_STOP=1"; Q="psql $E2E_ADMIN -d $DB -tA"
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }
as() { psql $E2E_ADMIN -d "$DB" -tA -v ON_ERROR_STOP=1 -c "begin; set local role $1; $2; commit;" 2>&1 | grep -E 'ERROR|^[^A-Z]' | head -1 | sed -E 's/^.*ERROR:  //' | cut -c1-120; }

$P -f "$SAAS/phase2-company-foundation.sql" > /dev/null 2>&1
$P -f "$SAAS/phase2d-company-settings.sql" > /dev/null 2>&1
$P -f "$SAAS/phase2e-subscriptions.sql" > /dev/null 2>&1
$P -f "$SAAS/phase2g-company-admin.sql" > /dev/null 2>&1; check "phase2g applies" "$?" "0"
$P -f "$SAAS/phase2g-company-admin.sql" > /dev/null 2>&1; check "phase2g applies a second time (idempotent)" "$?" "0"
check "the placeholder pilot plan got a storage limit" "$($Q -c "select max_storage_mb from saas_plans where id='pilot'")" "2048"
$P -c "insert into saas_plans (id, name) values ('mine','Operator plan')"
check "a plan the operator created is left unlimited (NULL)" "$($Q -c "select max_storage_mb is null from saas_plans where id='mine'")" "t"
check "a negative storage limit is refused" "$(as service_role "insert into saas_plans (id, name, max_storage_mb) values ('neg','Neg',-1)")" 'new row for relation "saas_plans" violates check constraint "saas_plans_max_storage_mb_check"'

$P -c "insert into companies (id, slug, name, status) values ('co_a','co-a','A','active')"
$P -c "insert into company_settings_audit (id, company_id, section, actor_username, summary, before_value, after_value) values ('a1','co_a','bank_accounts','admin','Bank accounts replaced','[]','[{\"bankName\":\"B\"}]')"
check "service role can read the history" "$(as service_role "select count(*) from company_settings_audit")" "1"
check "the tenant role has no access to the history" "$(as crm_tenant "select count(*) from company_settings_audit")" "permission denied for table company_settings_audit"
check "the history cannot be updated" "$($P -c "update company_settings_audit set summary='x' where id='a1'" 2>&1 | grep -c 'append-only')" "1"
check "the history cannot be deleted" "$($P -c "delete from company_settings_audit where id='a1'" 2>&1 | grep -c 'append-only')" "1"
check "an unknown section is refused" "$($P -c "insert into company_settings_audit (id, company_id, section, actor_username, summary) values ('a2','co_a','nonsense','x','x')" 2>&1 | grep -c 'violates check constraint')" "1"
check "a company that does not exist is refused" "$($P -c "insert into company_settings_audit (id, company_id, section, actor_username, summary) values ('a3','nope','terms','x','x')" 2>&1 | grep -c 'violates foreign key')" "1"

$P -f "$SAAS/phase2g-company-admin-rollback.sql" > /dev/null 2>&1; check "rollback applies" "$?" "0"
check "rollback removes the table and the column" "$($Q -c "select (to_regclass('public.company_settings_audit') is null) and not exists (select 1 from information_schema.columns where table_name='saas_plans' and column_name='max_storage_mb')")" "t"
check "rollback keeps a copy of the history" "$($Q -c "select count(*) from app_rollback_backup.company_settings_audit")" "1"
$P -f "$SAAS/phase2g-company-admin.sql" > /dev/null 2>&1; check "re-apply after rollback works" "$?" "0"
check "re-apply restores the history" "$($Q -c "select summary from company_settings_audit where id='a1'")" "Bank accounts replaced"

echo; echo "company admin (phase2g): $ok passed, $bad failed"; [ "$bad" = 0 ]
