## Pilot journeys

Stack: PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), PostgREST (`binary`), built SPA + server bundle, MULTI_COMPANY_ENABLED=true.

| Journey | Result | Seconds | What it proves |
|---|---|---|---|
| `two-company-api` | pass — 52 passed, 0 failed | 16 | two companies run lead to quotation to invoice to payment; every cross-company read, write and PDF attempt is refused |
| `two-company-complete` | pass — 79 passed, 0 failed | 4 | whole flow for two companies at the same time, attacks on each other's records, PDFs and files, canary sweep, database integrity |
| `company-settings` | pass — 57 passed, 0 failed | 3 | per-company branding, bank accounts, terms and prices; quotations keep the settings they were saved with |
| `pdf-render` | pass — 62 passed, 0 failed | 23 | real Chromium PDFs per company, read back as bytes (text, logo, amounts), no other company or Sunchaser identity |
| `platform-onboarding` | pass — 42 passed, 0 failed | 14 | operator onboarding, manual subscriptions, enforced plan limits, operator audit trail |
| `pilot-round3` | pass — 80 passed, 0 failed | 52 | invoice issuance snapshot and legacy label, local QR, AutoSizer and after-sales refused, subscription expiry at request time, storage limit, settings permissions and history |
| `disabled-modules` | pass — 17 passed, 0 failed | 3 | every disabled module (AutoSizer, after-sales, WhatsApp inbox, design tools, AI) answers 404 to the real pilot users - administrators, sales, portal customers - before any handler runs |
| `storage-quota` | pass — 47 passed, 0 failed | 61 | storage limit: concurrent uploads at the boundary, every upload route, usage that cannot be verified (fail closed, retryable), no limit set |
| `concurrent-contracts` | pass — 6 passed, 0 failed | 9 | 72 contracts of two companies at the same instant: every one succeeds and provisions its own invoice (row ids no longer collide on the clock; found by the restore journey) |
| `company-restore` | pass — 45 passed, 0 failed | 19 | company restore leaves every other company and the founding company byte-identical |
| `compat-before-t6-t7` | pass — 9 passed, 0 failed | 8 | deploy order: the new backend keeps working on a database where migrations t6 and t7 are not applied yet (they are rolled back, checked, re-applied) |
| `browser-company-ui` | pass — 14 passed, 0 failed | 27 | company selection and Switch company in a real browser |
| `browser-pilot-round4` | pass — 78 passed, 0 failed | 60 | settings screen: bank account edit and delete with confirmation, history with the values before and after, a non-administrator read-only; customer portal and welcome guide with and without logo/phone/review link (no Sunchaser identity); unfinished modules not offered |
| `browser-pilot-round3` | pass — 19 passed, 0 failed | 15 | Sunchaser Sync on sign-in and company selection, company branding in the workspace, settings screen and history, hidden modules, founding company unchanged |
| `single-company-smoke` | pass — 12 passed, 0 failed | 1 | flag off (single-company mode) on the migrated database: login, lead, quotation, contract, invoice, payment, PDF as before; no company fields in any response |
| `flag-off-round3` | pass — 18 passed, 0 failed | 1 | flag off: no module flags, no identity mark, AutoSizer, after-sales, WhatsApp inbox and design tools all available as before, Sunchaser sign-in kept, uploads unmetered |
All journeys passed.
