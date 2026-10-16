#!/usr/bin/env bash
# A legacy schema without the durable creator column, and a schema where it already exists.
set -euo pipefail
: "$E2E_ADMIN"
HERE="$(cd "$(dirname "$0")" && pwd)"; SAAS="$HERE/.."; DB="t_creator_$$"
bash "$HERE/mkdb.sh" "$DB" >/dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists t_creator_$$ with (force)" >/dev/null 2>&1 || true' EXIT
P="psql $E2E_ADMIN -d $DB -q -v ON_ERROR_STOP=1"; Q="psql $E2E_ADMIN -d $DB -tA -v ON_ERROR_STOP=1"
ok=0; bad=0
check(){ if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }
$P -c "alter table invoices drop column if exists created_by_user_id cascade" >/dev/null 2>&1
$P -f "$SAAS/phase2-company-foundation.sql" >/dev/null 2>&1
$P -c "insert into invoices(id,invoice_number,customer_name) values('creator_legacy','TEST-LEGACY','Synthetic legacy client')" >/dev/null
check "negative control: durable creator field is missing" "$($Q -c "select count(*) from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='created_by_user_id'")" "0"
BEFORE="$($Q -c "select md5(to_jsonb(i)::text) from invoices i where id='creator_legacy'")"
$P -f "$SAAS/phase2l-invoice-creator.sql" >/dev/null 2>&1
$P -f "$SAAS/phase2l-invoice-creator.sql" >/dev/null 2>&1
check "creator migration adds nullable text" "$($Q -c "select data_type||':'||is_nullable from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='created_by_user_id'")" "text:YES"
check "idempotent migration preserves every original invoice field" "$($Q -c "select md5((to_jsonb(i)-'created_by_user_id')::text) from invoices i where id='creator_legacy'")" "$BEFORE"
check "historical ownership is not guessed" "$($Q -c "select created_by_user_id is null from invoices where id='creator_legacy'")" "t"
check "company and creator lookup has a composite index" "$($Q -c "select position('(company_id, created_by_user_id)' in indexdef)>0 from pg_indexes where schemaname='public' and indexname='invoices_company_creator_idx'")" "t"
$P -c "insert into users(id,username,password,name,email,role) values('creator-fixture','syn_creator','s1:fixture','Synthetic creator','creator@example.test','Admin'); insert into invoices(id,invoice_number,customer_name,created_by_user_id) values('creator_new','TEST-NEW','Synthetic new client','creator-fixture')" >/dev/null
check "new invoices retain the authenticated creator id" "$($Q -c "select created_by_user_id from invoices where id='creator_new'")" "creator-fixture"
$P -c "insert into companies(id,slug,name) values('co_creator_other','co-creator-other','Synthetic other company')" >/dev/null
OTHER="$($Q -c "begin; set local role crm_tenant; select set_config('request.headers','{\"x-company-id\":\"co_creator_other\"}',true); select count(*) from invoices where id='creator_new'; commit" | grep -E '^[0-9]+$' | head -1)"
check "new creator attribution does not weaken company isolation" "$OTHER" "0"
OUT="$($P -f "$SAAS/phase2l-invoice-creator-rollback.sql" 2>&1 || true)"
check "rollback refuses to erase recorded attribution" "$(echo "$OUT" | grep -c 'rollback refused: invoice creator values exist')" "1"
check "the refused rollback leaves the value intact" "$($Q -c "select created_by_user_id from invoices where id='creator_new'")" "creator-fixture"
$P -c "delete from invoices where id='creator_new'" >/dev/null
$P -f "$SAAS/phase2l-invoice-creator-rollback.sql" >/dev/null 2>&1
check "safe rollback removes only the column it created" "$($Q -c "select count(*) from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='created_by_user_id'")" "0"
check "safe rollback keeps the legacy invoice unchanged" "$($Q -c "select md5(to_jsonb(i)::text) from invoices i where id='creator_legacy'")" "$BEFORE"
$P -f "$SAAS/phase2l-invoice-creator.sql" >/dev/null 2>&1
check "creator migration re-applies" "$($Q -c "select created_by_user_id is null from invoices where id='creator_legacy'")" "t"
$P -f "$SAAS/phase2l-invoice-creator-rollback.sql" >/dev/null 2>&1
$P -c "alter table invoices add column created_by_user_id text; update invoices set created_by_user_id='preexisting-owner' where id='creator_legacy'" >/dev/null
$P -f "$SAAS/phase2l-invoice-creator.sql" >/dev/null 2>&1
$P -f "$SAAS/phase2l-invoice-creator-rollback.sql" >/dev/null 2>&1
check "a pre-existing creator column and its value survive rollback" "$($Q -c "select created_by_user_id from invoices where id='creator_legacy'")" "preexisting-owner"
echo "$ok passed, $bad failed"; [ "$bad" = 0 ]
