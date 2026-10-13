#!/usr/bin/env bash
# Proves phase2f (invoice issuance snapshot) on a DISPOSABLE database: additive and idempotent, legacy rows stay NULL (no back-fill), the
# snapshot is write-once (no set, replace or clear after insert), the shape is enforced, and the rollback keeps every invoice.
#   E2E_ADMIN="-h /srv/s -p 55432 -U postgres" bash scripts/saas/tests/test-invoice-snapshot.sh
set -euo pipefail
: "${E2E_ADMIN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; SAAS="$HERE/.."
DB="${SNAP_DB:-t_snap_$$}"
bash "$HERE/mkdb.sh" "$DB" > /dev/null
trap 'psql $E2E_ADMIN -d postgres -qc "drop database if exists $DB with (force)" > /dev/null 2>&1 || true' EXIT
P="psql $E2E_ADMIN -d $DB -q -v ON_ERROR_STOP=1"; Q="psql $E2E_ADMIN -d $DB -tA"
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; ok=$((ok+1)); else echo "FAIL: $1 (expected '$3', got '$2')"; bad=$((bad+1)); fi; }
err() { psql $E2E_ADMIN -d "$DB" -tA -v ON_ERROR_STOP=1 -c "$1" 2>&1 | grep -m1 -E 'ERROR' | sed -E 's/^.*ERROR:  //' | cut -c1-200; }

$P -f "$SAAS/phase2-company-foundation.sql" > /dev/null 2>&1
# an invoice that exists BEFORE the migration (a legacy invoice)
$P -c "insert into invoices (id, invoice_number, customer_name) values ('legacy-1','INV-OLD-0001','Old Customer')"
$P -f "$SAAS/phase2f-invoice-issuance-snapshot.sql" > /dev/null 2>&1; check "phase2f applies" "$?" "0"
$P -f "$SAAS/phase2f-invoice-issuance-snapshot.sql" > /dev/null 2>&1; check "phase2f applies a second time (idempotent)" "$?" "0"
check "the legacy invoice has no snapshot (not back-filled)" "$($Q -c "select issuance_snapshot is null from invoices where id='legacy-1'")" "t"

SNAP='{"version":1,"capturedAt":"2026-10-13T00:00:00Z","bankAccounts":[{"bankName":"B1","accountTitle":"T","accountNumber":"1","iban":"PK00"}],"companyTerms":"Pay in 7 days."}'
$P -c "insert into invoices (id, invoice_number, customer_name, issuance_snapshot) values ('new-1','INV-NEW-0001','New Customer','$SNAP'::jsonb)"
check "a new invoice stores its snapshot at insert" "$($Q -c "select issuance_snapshot->>'companyTerms' from invoices where id='new-1'")" "Pay in 7 days."

check "the snapshot cannot be replaced" "$(err "update invoices set issuance_snapshot = '{\"version\":1,\"capturedAt\":\"x\",\"bankAccounts\":[],\"companyTerms\":\"changed\"}'::jsonb where id='new-1'")" "invoices.issuance_snapshot is written once, when the invoice is created, and cannot be changed"
check "the snapshot cannot be cleared" "$(err "update invoices set issuance_snapshot = null where id='new-1'")" "invoices.issuance_snapshot is written once, when the invoice is created, and cannot be changed"
check "a legacy invoice cannot be given a snapshot later (no invented history)" "$(err "update invoices set issuance_snapshot = '$SNAP'::jsonb where id='legacy-1'")" "invoices.issuance_snapshot is written once, when the invoice is created, and cannot be changed"
check "other columns of an invoice with a snapshot can still be edited" "$($P -c "update invoices set customer_name='Renamed' where id='new-1'" >/dev/null 2>&1; echo $?)" "0"
check "the snapshot survives that edit unchanged" "$($Q -c "select issuance_snapshot->>'companyTerms' from invoices where id='new-1'")" "Pay in 7 days."

check "a snapshot of the wrong shape is refused (bankAccounts not a list)" "$(err "insert into invoices (id, invoice_number, customer_name, issuance_snapshot) values ('bad-1','INV-BAD-1','x','{\"version\":1,\"capturedAt\":\"x\",\"bankAccounts\":{},\"companyTerms\":\"\"}'::jsonb)")" 'new row for relation "invoices" violates check constraint "invoices_issuance_snapshot_shape"'

$P -f "$SAAS/phase2f-invoice-issuance-snapshot-rollback.sql" > /dev/null 2>&1; check "rollback applies" "$?" "0"
check "rollback keeps every invoice" "$($Q -c "select count(*) from invoices where id in ('legacy-1','new-1')")" "2"
check "rollback removes the column" "$($Q -c "select count(*) from information_schema.columns where table_name='invoices' and column_name='issuance_snapshot'")" "0"
$P -f "$SAAS/phase2f-invoice-issuance-snapshot.sql" > /dev/null 2>&1; check "re-apply after rollback works" "$?" "0"
check "after re-apply the old invoices have no snapshot (rollback is not a back-fill)" "$($Q -c "select count(*) from invoices where issuance_snapshot is not null")" "0"

echo; echo "invoice issuance snapshot: $ok passed, $bad failed"; [ "$bad" = 0 ]
