## Pilot journeys

Stack: PostgreSQL 17.11, PostgREST (`binary`), built SPA + server bundle, MULTI_COMPANY_ENABLED=true.

| Journey | Result | Seconds | What it proves |
|---|---|---|---|
| `feature-disable-reenable` | pass — 8 passed, 0 failed | 5 | the switch OFF while pilot companies exist (a flag-off process of the same build) PAUSES: founding and pilot sessions are refused with the maintenance error, nothing is read or written; the pilot's files, rows and quota are untouched and served again when it is switched on |
| `tenant-isolation-guard` | pass — 30 passed, 0 failed | 66 | isolation independent of the flag: with pilot data present a flag-off process serves nothing (reads, searches, exports, PDFs, file downloads, writes, sign-in, webhook; founding, pilot and earlier sessions), across a restart, after schema rollback t8..t3, and when the database cannot be reached; flag-on sessions issued before still work isolated; resumes by itself once the pilot data is removed |
| `single-company-smoke` | pass — 12 passed, 0 failed | 1 | flag off (single-company mode) on the migrated database: login, lead, quotation, contract, invoice, payment, PDF as before; no company fields in any response |
| `flag-off-round3` | pass — 18 passed, 0 failed | 1 | flag off: no module flags, no identity mark, AutoSizer, after-sales, WhatsApp inbox and design tools all available as before, Sunchaser sign-in kept, uploads unmetered |
All journeys passed.
