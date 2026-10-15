## Pilot journeys

Stack: PostgreSQL 17.10, PostgREST (`binary`), built SPA + server bundle, MULTI_COMPANY_ENABLED=true.

| Journey | Result | Seconds | What it proves |
|---|---|---|---|
| `two-company-api` | pass — 52 passed, 0 failed | 17 | two companies run lead to quotation to invoice to payment; every cross-company read, write and PDF attempt is refused |
| `two-company-complete` | pass — 79 passed, 0 failed | 4 | whole flow for two companies at the same time, attacks on each other's records, PDFs and files, canary sweep, database integrity |
| `company-settings` | pass — 57 passed, 0 failed | 4 | per-company branding, bank accounts, terms and prices; quotations keep the settings they were saved with |
| `pdf-render` | pass — 62 passed, 0 failed | 23 | real Chromium PDFs per company, read back as bytes (text, logo, amounts), no other company or Sunchaser identity |
| `platform-onboarding` | pass — 42 passed, 0 failed | 14 | operator onboarding, manual subscriptions, enforced plan limits, operator audit trail |
| `pilot-round3` | pass — 80 passed, 0 failed | 51 | invoice issuance snapshot and legacy label, local QR, AutoSizer and after-sales refused, subscription expiry at request time, storage limit, settings permissions and history |
| `disabled-modules` | pass — 17 passed, 0 failed | 3 | every disabled module (AutoSizer, after-sales, WhatsApp inbox, design tools, AI) answers 404 to the real pilot users - administrators, sales, portal customers - before any handler runs |
| `storage-quota` | pass — 47 passed, 0 failed | 62 | storage limit: concurrent uploads at the boundary, every upload route, usage that cannot be verified (fail closed, retryable), no limit set |
| `storage-two-instances` | pass — 32 passed, 0 failed | 44 | storage limit across TWO server processes: 24 uploads of mixed routes at the boundary race over both, failed writes give their room back, a deleted file frees exactly its room, a database refusal fails closed, a process killed mid-upload stops counting after its reservation expires |
| `concurrent-contracts` | pass — 10 passed, 0 failed | 8 | 72 contracts of two companies at the same instant: every one succeeds and provisions its own invoice (row ids no longer collide on the clock; found by the restore journey) |
| `customer-code-collisions` | pass — 19 passed, 0 failed | 13 | customer codes at insert time: forced real unique-index collisions (1, 2, 4, and more than the bound), 30 simultaneous requests of two companies, the invoice route; bounded retry, no orphan rows |
| `company-restore` | pass — 61 passed, 0 failed | 29 | company restore leaves every other company and the founding company byte-identical |
| `compat-before-t6-t7` | pass — 10 passed, 0 failed | 8 | deploy order: the new backend keeps working on a database where migrations t6 and t7 are not applied yet (they are rolled back, checked, re-applied) |
| `rollback-files-quota` | pass — 25 passed, 0 failed | 39 | rollback keeps files and quota accounting: t8 alone (fails closed meanwhile, boundary identical after re-apply) and every tenant migration t8..t1 (objects, document rows and invoices byte-identical, limit and downloads intact after re-apply) |
| `browser-company-ui` | pass — 14 passed, 0 failed | 26 | company selection and Switch company in a real browser |
| `browser-pilot-round4` | pass — 78 passed, 0 failed | 58 | settings screen: bank account edit and delete with confirmation, history with the values before and after, a non-administrator read-only; customer portal and welcome guide with and without logo/phone/review link (no Sunchaser identity); unfinished modules not offered |
| `browser-pilot-round5` | pass — 27 passed, 0 failed | 93 | storage limit in the browser (refusal at the limit, retryable message with Retry upload when the store cannot be checked, earlier files still download) and the per-lead design tools for one lead and quotation: absent in the pilot UI and never called, present for the founding company, 404 not_available from the API |
| `browser-pilot-round3` | pass — 19 passed, 0 failed | 14 | Sunchaser Sync on sign-in and company selection, company branding in the workspace, settings screen and history, hidden modules, founding company unchanged |
| `feature-disable-reenable` | pass — 8 passed, 0 failed | 5 | the switch OFF while pilot companies exist (a flag-off process of the same build) PAUSES: founding and pilot sessions are refused with the maintenance error, nothing is read or written; the pilot's files, rows and quota are untouched and served again when it is switched on |
| `tenant-isolation-guard` | pass — 47 passed, 0 failed | 90 | isolation independent of the flag: with pilot data present a flag-off process serves nothing (reads, searches, exports, PDFs, file downloads, writes, sign-in, webhook; founding, pilot and earlier sessions), across a restart, after schema rollback t8..t3, and when the database cannot be reached; flag-on sessions issued before still work isolated; resumes by itself once the pilot data is removed |
| `single-company-smoke` | pass — 12 passed, 0 failed | 1 | flag off (single-company mode) on the migrated database: login, lead, quotation, contract, invoice, payment, PDF as before; no company fields in any response |
| `flag-off-round3` | pass — 18 passed, 0 failed | 1 | flag off: no module flags, no identity mark, AutoSizer, after-sales, WhatsApp inbox and design tools all available as before, Sunchaser sign-in kept, uploads unmetered |
All journeys passed.
