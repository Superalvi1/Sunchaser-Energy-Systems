#!/usr/bin/env bash
# Task 5B runtime wiring tests (fakes + local only; never hosted Supabase / real Meta).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"
export PLAYWRIGHT_BROWSERS_PATH=0
npx tsx server/unifiedMessaging/messagingRuntime.test.ts
