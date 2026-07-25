#!/usr/bin/env bash
# Apply the disposable baseline required before normalized messaging validation.
# Order mirrors repository manual-apply WhatsApp schema chain + emulated roles.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXEC="${SCRIPT_DIR}/messaging-test-db-exec.sh"

echo "Applying emulated Supabase role bootstrap..."
"${EXEC}" "${REPO_ROOT}/scripts/messaging-test-db-baseline-roles.sql"

echo "Applying WhatsApp PR-1 transport schema..."
"${EXEC}" "${REPO_ROOT}/scripts/whatsapp-transport-schema.sql"

echo "Applying WhatsApp PR-2 inbox schema..."
"${EXEC}" "${REPO_ROOT}/scripts/whatsapp-inbox-schema.sql"

echo "Applying WhatsApp RC-1.2.4 connections/hardening schema..."
"${EXEC}" "${REPO_ROOT}/scripts/whatsapp-hardening-rc124.sql"

echo "OK: baseline schema applied (roles + whatsapp_* coexistence tables)"
