# CRM repair journeys (isolated, synthetic data)

Browser and API journeys used to verify the October 2026 repairs (`docs/audit/2026-10-crm-repair-audit.md`).
They run against a disposable stack only — never against production. Every browser request to a host other
than `127.0.0.1`/`localhost` is aborted by `lib.mjs`.

## Stack

```bash
export TEST_PW='<any synthetic password>'
sudo -E POSTGREST_BIN=/path/to/postgrest bash scripts/e2e-crm-repair/isolated-stack.sh   # run without piping its output
VITE_API_BASE_URL= npx vite build                       # empty value: the UI calls the local server
npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs
source /srv/sunchaser-e2e/env.sh && node dist/server.cjs
```

The stack is PostgreSQL 16 + PostgREST + `s3-mock.mjs` (an HTTPS S3 stand-in that does not verify request
signatures). WhatsApp is inbound-only: no access token is configured, so nothing can be sent.

## Journeys

```bash
export E2E_ENV_FILE=/srv/sunchaser-e2e/env.sh E2E_STATE_DIR=/tmp/sunchaser-e2e
source "$E2E_ENV_FILE"
node scripts/e2e-crm-repair/j1-smartquote.mjs   # new client → edit → save → PDF; revision; lost response; mobile double tap
node scripts/e2e-crm-repair/j1-staff-crm.mjs    # CRM lead list, saved versions, PDF download, version 1 preview
node scripts/e2e-crm-repair/j2-price-change.mjs # see header: needs a temporary catalogue price change and rebuild
node scripts/e2e-crm-repair/j6-finance.mjs      # quotation → invoice → partial payment, retries, overpayment, audit
node scripts/e2e-crm-repair/link-portal.mjs     # links the synthetic portal user to the j6 client
node scripts/e2e-crm-repair/j3-documents.mjs    # uploads: rejected types, interrupted/lost-response retries, refresh, re-login, cross-customer
node scripts/e2e-crm-repair/j5-rename.mjs       # rename client; invoices, documents and portal stay linked
node scripts/e2e-crm-repair/j7-session.mjs      # reopen keeps session (renewed); expiry, suspension, logout
node scripts/e2e-crm-repair/j4-whatsapp.mjs     # signed inbound enquiry → no automatic lead → explicit conversion
```

Each script prints `PASS`/`FAIL` lines, writes `<journey>-results.json` and screenshots under `$E2E_STATE_DIR`,
and exits non-zero on any failure. Session checks run the web code that the Android WebView loads; they are
not a physical-device test.
