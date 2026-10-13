## Pilot journeys

Stack: PostgreSQL 17.11, PostgREST (`binary`), built SPA + server bundle, MULTI_COMPANY_ENABLED=true.

| Journey | Result | Seconds | What it proves |
|---|---|---|---|
| `two-company-api` | pass — 52 passed, 0 failed | 16 | two companies run lead to quotation to invoice to payment; every cross-company read, write and PDF attempt is refused |
| `two-company-complete` | pass — 79 passed, 0 failed | 3 | whole flow for two companies at the same time, attacks on each other's records, PDFs and files, canary sweep, database integrity |
| `company-settings` | pass — 57 passed, 0 failed | 3 | per-company branding, bank accounts, terms and prices; quotations keep the settings they were saved with |
| `pdf-render` | pass — 37 passed, 0 failed | 12 | real Chromium PDFs per company, read back as bytes (text, logo, amounts), no other company or Sunchaser identity |
| `platform-onboarding` | pass — 39 passed, 0 failed | 14 | operator onboarding, manual subscriptions, enforced plan limits, operator audit trail |
| `pilot-round3` | pass — 89 passed, 0 failed | 100 | invoice issuance snapshot and legacy label, local QR, AutoSizer and after-sales refused, subscription expiry at request time, storage limit, settings permissions and history |
| `company-restore` | pass — 45 passed, 0 failed | 18 | company restore leaves every other company and the founding company byte-identical |
| `compat-before-t6-t7` | pass — 9 passed, 0 failed | 8 | deploy order: the new backend keeps working on a database where migrations t6 and t7 are not applied yet (they are rolled back, checked, re-applied) |
| `browser-company-ui` | pass — 13 passed, 0 failed | 26 | company selection and Switch company in a real browser |
| `browser-pilot-round3` | pass — 19 passed, 0 failed | 13 | Sunchaser Sync on sign-in and company selection, company branding in the workspace, settings screen and history, hidden modules, founding company unchanged |
All journeys passed.
