#!/usr/bin/env bash
# Proves the company-scoped settings keys (phase2d) on a DISPOSABLE database:
#   founding keys unchanged -> other companies must use "<company>:<key>" -> no company can write another's key -> isolation -> rollback/re-apply.
#   E2E_ADMIN="-h /srv/s -p 55432 -U postgres" bash scripts/saas/tests/test-settings.sh
set -euo pipefail
: "${E2E_ADMIN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; SAAS="$HERE/.."
DB="${SET_DB:-t_set_$$}"
bash "$HERE/mkdb.sh" "$DB" > /dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true' EXIT
P="psql $E2E_ADMIN -d $DB -q -v ON_ERROR_STOP=1"; Q="psql $E2E_ADMIN -d $DB -tA"
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }
# one statement as a role with the company header; prints the value or ERR:<first words of the message>
as() { # role company sql
  psql $E2E_ADMIN -d "$DB" -tA -v ON_ERROR_STOP=1 -c "begin; set local role $1; select set_config('request.headers', case when '$2' = '' then '{}' else json_build_object('x-company-id','$2')::text end, true); $3; commit;" 2>&1 | grep -v -E '^(BEGIN|SET|COMMIT|INSERT [0-9]+ [0-9]+|UPDATE [0-9]+|DELETE [0-9]+|)$' | grep -v -E '^\{' | head -1 | sed -E 's/^ERROR:  /ERR:/; s/^psql:.*ERROR:  /ERR:/' | cut -c1-110
}
refused() { case "$1" in ERR:*"violates check constraint"*) echo refused;; ERR:*) echo "other:$1";; *) echo allowed;; esac; }

$P -f "$SAAS/phase2-company-foundation.sql" > /dev/null 2>&1
$P -c "insert into companies (id, slug, name) values ('co_a','co-a','Company A'),('co_b','co-b','Company B'),('a_b','a-b','Underscore') on conflict do nothing"
$P -c "insert into settings (key, value) values ('global','{\"who\":\"founding\"}'), ('company_branding','{}')"   # existing founding rows, before the migration

$P -f "$SAAS/phase2d-company-settings.sql" > /dev/null 2>&1; check "phase2d applies on a database with founding settings rows" "$?" "0"
$P -f "$SAAS/phase2d-company-settings.sql" > /dev/null 2>&1; check "phase2d applies a second time (idempotent)" "$?" "0"
check "no founding row was rewritten" "$($Q -c "select count(*) from settings where company_id='sunchaser' and key in ('global','company_branding')")" "2"

# founding company keeps its plain keys
check "founding company can still write the plain key 'global'" "$(refused "$(as service_role '' "insert into settings (key, value, company_id) values ('quote_pdf_global_watermark','{}','sunchaser')")")" "allowed"
check "founding company (tenant role) can still upsert 'global'" "$(refused "$(as crm_tenant sunchaser "insert into settings (key, value) values ('global','{\"who\":\"founding2\"}') on conflict (key) do update set value = excluded.value")")" "allowed"

# other companies: scoped key only
check "company A may not write the plain key 'global'" "$(refused "$(as service_role '' "insert into settings (key, value, company_id) values ('plain_a','{}','co_a')")")" "refused"
check "company A (tenant role) writes 'co_a:global'" "$(refused "$(as crm_tenant co_a "insert into settings (key, value) values ('co_a:global','{\"who\":\"A\"}')")")" "allowed"
check "company B (tenant role) writes 'co_b:global'" "$(refused "$(as crm_tenant co_b "insert into settings (key, value) values ('co_b:global','{\"who\":\"B\"}')")")" "allowed"
check "company A may not write company B's key 'co_b:x'" "$(refused "$(as service_role '' "insert into settings (key, value, company_id) values ('co_b:x','{}','co_a')")")" "refused"
check "underscore is not a wildcard: company 'a_b' may not write 'axb:k'" "$(refused "$(as service_role '' "insert into settings (key, value, company_id) values ('axb:k','{}','a_b')")")" "refused"
check "company 'a_b' writes 'a_b:k'" "$(refused "$(as service_role '' "insert into settings (key, value, company_id) values ('a_b:k','{}','a_b')")")" "allowed"
check "a company cannot take over an existing plain key by upsert (tenant role, plain 'global'): refused" "$(refused "$(as crm_tenant co_a "insert into settings (key, value) values ('global','{\"who\":\"A-takeover\"}') on conflict (key) do update set value = excluded.value")")" "refused"
check "the founding 'global' row is unchanged after the attempt" "$($Q -c "select value->>'who' from settings where key='global'")" "founding2"

# website_content follows the same rule
check "company A may not write the plain key 'global' in website_content" "$(refused "$(as service_role '' "insert into website_content (key, value, company_id) values ('global','{}','co_a')")")" "refused"
check "company A writes 'co_a:global' in website_content" "$(refused "$(as crm_tenant co_a "insert into website_content (key, value) values ('co_a:global','{}')")")" "allowed"

# isolation of reads
check "company A sees only its own settings rows" "$(as crm_tenant co_a "select string_agg(key, ',' order by key) from settings")" "co_a:global"
check "company B sees only its own settings rows" "$(as crm_tenant co_b "select string_agg(key, ',' order by key) from settings")" "co_b:global"

# rollback and re-apply
$P -f "$SAAS/phase2d-company-settings-rollback.sql" > /dev/null 2>&1; check "rollback applies" "$?" "0"
check "after rollback the constraints are gone" "$($Q -c "select count(*) from pg_constraint where conname in ('settings_company_key_scope','website_content_company_key_scope')")" "0"
check "rollback left every row in place" "$($Q -c "select count(*) from settings")" "6"
$P -f "$SAAS/phase2d-company-settings.sql" > /dev/null 2>&1; check "re-apply after rollback" "$?" "0"
check "constraints present again" "$($Q -c "select count(*) from pg_constraint where conname in ('settings_company_key_scope','website_content_company_key_scope')")" "2"

echo; echo "settings migration tests: $ok passed, $bad failed"
[ "$bad" = 0 ]
