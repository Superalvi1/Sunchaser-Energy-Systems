#!/usr/bin/env bash
# Proves phase2e (plans, manual subscriptions, payment ledger, audit, LIMITS, atomic onboarding) on a DISPOSABLE database:
#   privileges -> limits (leads, staff, documents; tenant and service role; overrides; unlimited without a subscription; concurrency)
#   -> append-only ledger and audit -> atomic onboarding (all or nothing) -> usage -> rollback keeps the data, re-apply restores it.
#   E2E_ADMIN="-h /srv/s -p 55432 -U postgres" bash scripts/saas/tests/test-subscriptions.sh
set -euo pipefail
: "${E2E_ADMIN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; SAAS="$HERE/.."
DB="${SUB_DB:-t_sub_$$}"
bash "$HERE/mkdb.sh" "$DB" > /dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true' EXIT
P="psql $E2E_ADMIN -d $DB -q -v ON_ERROR_STOP=1"; Q="psql $E2E_ADMIN -d $DB -tA"
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }
as() { # role company sql -> prints the value or ERR:<message>
  psql $E2E_ADMIN -d "$DB" -tA -v ON_ERROR_STOP=1 -c "begin; set local role $1; select set_config('request.headers', case when '$2' = '' then '{}' else json_build_object('x-company-id','$2')::text end, true); $3; commit;" 2>&1 | grep -v -E '^(BEGIN|SET|COMMIT|INSERT [0-9]+ [0-9]+|UPDATE [0-9]+|DELETE [0-9]+|)$' | grep -v -E '^\{' | head -1 | sed -E 's/^ERROR:  /ERR:/; s/^psql:.*ERROR:  /ERR:/' | cut -c1-120
}
lead() { echo "insert into leads (id, name, email, phone, address, company_id) values ('$1','n','e@x','1','a','$2')"; }

$P -f "$SAAS/phase2-company-foundation.sql" > /dev/null 2>&1
$P -f "$SAAS/phase2d-company-settings.sql" > /dev/null 2>&1
$P -f "$SAAS/phase2e-subscriptions.sql" > /dev/null 2>&1; check "phase2e applies" "$?" "0"
$P -f "$SAAS/phase2e-subscriptions.sql" > /dev/null 2>&1; check "phase2e applies a second time (idempotent)" "$?" "0"
check "the placeholder 'pilot' plan exists" "$($Q -c "select id||':'||max_staff||':'||max_leads from saas_plans where id='pilot'")" "pilot:10:2000"
$P -c "insert into saas_plans (id, name, max_staff, max_leads, max_documents) values ('tiny','Tiny',2,3,2), ('open','Open',null,null,null)"
$P -c "insert into companies (id, slug, name, status) values ('co_t','co-t','Tiny Co','active'),('co_o','co-o','Open Co','active'),('co_n','co-n','No sub','active')"
$P -c "insert into saas_subscriptions (id, company_id, plan_id, status) values ('s-t','co_t','tiny','active'),('s-o','co_o','open','active')"

# privileges: the tenant role and the anonymous roles cannot touch platform tables or the platform functions
for t in saas_plans saas_subscriptions saas_payments saas_audit; do
  check "crm_tenant has no privilege on $t" "$($Q -c "select has_table_privilege('crm_tenant','public.$t','select') or has_table_privilege('crm_tenant','public.$t','insert') or has_table_privilege('crm_tenant','public.$t','update')")" "f"
done
check "crm_tenant cannot execute saas_usage or saas_create_company" "$($Q -c "select has_function_privilege('crm_tenant','public.saas_usage()','execute') or has_function_privilege('crm_tenant','public.saas_create_company(text,text,text,integer,jsonb,jsonb)','execute')")" "f"
check "the tenant role gets 'permission denied' reading saas_subscriptions" "$(as crm_tenant co_t "select count(*) from saas_subscriptions")" "ERR:permission denied for table saas_subscriptions"

# leads
for i in 1 2 3; do $P -c "$(lead L$i co_t)"; done
check "the 4th lead of a company with max_leads 3 is refused by the database" "$(as service_role '' "$(lead L4 co_t)")" "ERR:limit_exceeded:max_leads:3"
check "the same limit applies to the tenant role (row security does not hide the count from the trigger)" "$(as crm_tenant co_t "$(lead L5 co_t)")" "ERR:limit_exceeded:max_leads:3"
$P -c "update leads set deleted_at = now() where id = 'L1'"
check "a deleted lead frees one place" "$(as service_role '' "$(lead L6 co_t)")" ""
check "...and the company is full again" "$(as service_role '' "$(lead L7 co_t)")" "ERR:limit_exceeded:max_leads:3"
$P -c "update saas_subscriptions set limit_overrides = '{\"max_leads\": 5}' where company_id = 'co_t'"
check "a per-company override raises the limit" "$(as service_role '' "$(lead L8 co_t)")" ""
check "another company's leads do not count against this company (co_n has no subscription: unlimited)" "$(for i in 1 2 3 4 5 6; do as service_role '' "$(lead N$i co_n)"; done | sort -u | tr -d '\n')" ""
check "a plan without limits (open) is unlimited" "$(for i in 1 2 3 4; do as service_role '' "$(lead O$i co_o)"; done | sort -u | tr -d '\n')" ""
check "the founding company has no subscription and no limit" "$(as service_role '' "$(lead F1 sunchaser)")" ""

# staff seats
$P -c "insert into users (id, username, password, name, email, role) values ('u1','u1','x','U1','u1@x.test','Admin'),('u2','u2','x','U2','u2@x.test','Admin'),('u3','u3','x','U3','u3@x.test','Admin'),('u4','u4','x','U4','u4@x.test','Customer')"
mem() { echo "insert into company_memberships (id, company_id, user_id, role, status) values ('$1','co_t','$2','$3','$4')"; }
$P -c "$(mem m1 u1 Admin active)"; $P -c "$(mem m2 u2 Admin active)"
check "the 3rd active staff member is refused (max_staff 2)" "$(as service_role '' "$(mem m3 u3 Admin active)")" "ERR:limit_exceeded:max_staff:2"
check "an invited (not yet active) member is not counted" "$(as service_role '' "$(mem m3 u3 Admin invited)")" ""
check "activating that invited member would exceed the limit: refused" "$(as service_role '' "update company_memberships set status='active' where id='m3'")" "ERR:limit_exceeded:max_staff:2"
check "a portal customer membership is not staff and is not counted" "$(as service_role '' "$(mem m4 u4 Customer active)")" ""
check "changing the role of an already-counted member is allowed" "$(as service_role '' "update company_memberships set role='Sales Manager' where id='m1'")" ""
$P -c "update company_memberships set status='removed' where id='m2'"
check "removing a member frees a seat" "$(as service_role '' "update company_memberships set status='active' where id='m3'")" ""

# documents
$P -c "insert into customers (id, name, email, company_id) values ('cu1','C','c@x','co_t')"
doc() { echo "insert into customer_documents (id, customer_id, document_type, title, file_url, uploaded_by, company_id) values ('$1','cu1','other','t','u','x','co_t')"; }
$P -c "$(doc d1)"; $P -c "$(doc d2)"
check "the 3rd document is refused (max_documents 2)" "$(as service_role '' "$(doc d3)")" "ERR:limit_exceeded:max_documents:2"

# concurrency: one place left, eight writers at the same moment: exactly one wins
$P -c "update saas_subscriptions set limit_overrides = '{\"max_leads\": 6}' where company_id='co_t'"
$P -c "update leads set deleted_at = now() where company_id='co_t'"
for i in $(seq 1 8); do ( psql $E2E_ADMIN -d "$DB" -qc "$(lead C$i co_t)" > /dev/null 2>&1 || true ) & done; wait
check "8 simultaneous inserts with 6 places free: exactly 6 succeed, never more" "$($Q -c "select count(*) from leads where company_id='co_t' and deleted_at is null")" "6"

# ledger and audit are append-only
$P -c "insert into saas_payments (id, company_id, subscription_id, amount_pkr, method, reference, paid_at, recorded_by) values ('pay1','co_t','s-t',5000,'Bank transfer','REF1','2026-10-01','op')"
check "the service role has no UPDATE or DELETE privilege on payments (privilege level)" "$(as service_role '' "update saas_payments set amount_pkr = 1 where id='pay1'"; as service_role '' "delete from saas_payments where id='pay1'")" "$(printf 'ERR:permission denied for table saas_payments\nERR:permission denied for table saas_payments')"
check "even the table owner cannot edit a payment (trigger)" "$(psql $E2E_ADMIN -d $DB -tA -c "update saas_payments set amount_pkr = 1 where id='pay1'" 2>&1 | head -1 | sed -E 's/^ERROR:  /ERR:/')" "ERR:saas_payments is append-only: record a correction instead of changing or deleting a row"
check "even the table owner cannot delete a payment (trigger)" "$(psql $E2E_ADMIN -d $DB -tA -c "delete from saas_payments where id='pay1'" 2>&1 | head -1 | sed -E 's/^ERROR:  /ERR:/')" "ERR:saas_payments is append-only: record a correction instead of changing or deleting a row"
check "a negative payment without reversal_of is refused" "$(as service_role '' "insert into saas_payments (id, company_id, amount_pkr, method, paid_at, recorded_by) values ('bad','co_t',-5,'x','2026-10-01','op')" | grep -o 'violates check constraint "[a-z_]*"')" 'violates check constraint "saas_payments_check"' 
check "a reversal row (negative, reversal_of) is accepted" "$(as service_role '' "insert into saas_payments (id, company_id, amount_pkr, reversal_of, method, paid_at, recorded_by) values ('rev1','co_t',-5000,'pay1','Reversal','2026-10-02','op')")" ""
$P -c "insert into saas_audit (action, company_id) values ('test.row','co_t')"
check "the audit trail cannot be deleted from (owner: trigger)" "$(psql $E2E_ADMIN -d $DB -tA -c "delete from saas_audit" 2>&1 | head -1 | sed -E 's/^ERROR:  /ERR:/')" "ERR:saas_audit is append-only: record a correction instead of changing or deleting a row"

# atomic onboarding
USER='{"id":"u-new","username":"newadmin","name":"New Admin","email":"new@co.test","password_hash":"hash"}'
ACTOR='{"id":"op1","username":"operator"}'
R="$(as service_role '' "select public.saas_create_company('co_new','New Solar Co','pilot',14,'$USER'::jsonb,'$ACTOR'::jsonb)" || true)"
check "saas_create_company ran for the new company" "$($Q -c "select count(*) from companies where id='co_new'")" "1"
check "it created the company (trial), subscription (trial, pilot), first admin, membership, neutral branding, PDF settings and one audit row" "$($Q -c "select (select status from companies where id='co_new')||'/'||(select status||':'||plan_id from saas_subscriptions where company_id='co_new')||'/'||(select role||':'||account_status||':'||onboarding_completed from users where id='u-new')||'/'||(select role||':'||status from company_memberships where company_id='co_new')||'/'||(select count(*) from settings where key='co_new:company_branding')||'/'||(select count(*) from quote_pdf_settings where company_id='co_new')||'/'||(select count(*) from saas_audit where company_id='co_new' and action='company.created')")" "trial/trial:pilot/Admin:Approved:false/Admin:active/1/1/1"
check "a duplicate username fails the whole onboarding and leaves nothing behind" "$(as service_role '' "select public.saas_create_company('co_dup','Dup Co','pilot',14,'{\"id\":\"u-dup\",\"username\":\"newadmin\",\"name\":\"D\",\"email\":\"dup@co.test\",\"password_hash\":\"h\"}'::jsonb,'$ACTOR'::jsonb)" | cut -c1-50)" "ERR:duplicate key value violates unique constraint"
check "...nothing of it exists: no company, subscription, user, settings" "$($Q -c "select (select count(*) from companies where id='co_dup')+(select count(*) from saas_subscriptions where company_id='co_dup')+(select count(*) from users where id='u-dup')+(select count(*) from settings where company_id='co_dup')")" "0"
check "the founding company id cannot be used" "$(as service_role '' "select public.saas_create_company('sunchaser','X','pilot',1,'$USER'::jsonb,'$ACTOR'::jsonb)" | cut -c1-60)" "ERR:the founding company id cannot be used"
check "an unknown plan is refused" "$(as service_role '' "select public.saas_create_company('co_zz','Z','nope',1,'{\"id\":\"u-z\",\"username\":\"zz\",\"name\":\"Z\",\"email\":\"z@z.test\",\"password_hash\":\"h\"}'::jsonb,'$ACTOR'::jsonb)" | cut -c1-60)" "ERR:unknown or inactive plan nope"
check "the tenant role cannot call it" "$(as crm_tenant co_t "select public.saas_create_company('co_hx','H','pilot',1,'$USER'::jsonb,'$ACTOR'::jsonb)" | cut -c1-60)" "ERR:permission denied for function saas_create_company"

# usage
check "saas_usage reports staff, leads and documents per company" "$($Q -c "select staff||':'||leads||':'||documents from saas_usage() where company_id='co_t'")" "2:6:2"

# rollback keeps the data; limits stop applying; re-apply brings payments and audit back
A0="$($Q -c "select count(*) from saas_audit")"
$P -f "$SAAS/phase2e-subscriptions-rollback.sql" > /dev/null 2>&1; check "rollback applies" "$?" "0"
check "rollback removed the tables, triggers and functions" "$($Q -c "select (to_regclass('public.saas_payments') is null) and (to_regprocedure('app.enforce_company_limit()') is null) and not exists (select 1 from pg_trigger where tgname like 'company_limit_%')")" "t"
check "rollback kept a copy of the payments and the audit trail" "$($Q -c "select (select count(*) from app_rollback_backup.saas_payments)||':'||(select count(*) from app_rollback_backup.saas_audit)")" "2:$A0"
check "without the migration there is no limit any more" "$(as service_role '' "$(lead Z1 co_t)")" ""
RE="$($P -f "$SAAS/phase2e-subscriptions.sql" 2>&1 || true)"; echo "$RE" | grep -i " error" | head -3 || true; check "re-apply after rollback" "$(echo "$RE" | grep -ci " error" || true)" "0"
check "re-apply restored the payments and the audit trail" "$($Q -c "select (select count(*) from saas_payments)||':'||(select count(*) from saas_audit)")" "2:$A0"

echo; echo "subscription/limits tests: $ok passed, $bad failed"
[ "$bad" = 0 ]
