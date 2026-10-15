# SaaS pilot, round 2: what was built, what was proven, what is still open

Branch `claude/saas-pilot-multi-company` (PR #113, draft, stacked on #111). **Nothing here was applied to production or to real data**; no merge, migration, deployment, credential change or release was done. Production schema was not read. Pricing, hosting and legal terms are undecided. Sections 1-4 are separate on purpose; section 4 is the list of what is NOT done.

## 1. Completed work (commit by commit)

| Commit | Request item | What it does |
|---|---|---|
| `dc9adfb` | CI | PR check failure on PostgreSQL 17: root cause was `pg_dump 16` against a 17 server in the schema-comparison test; replaced by catalogue queries. PG16 and PG17 docker jobs, typecheck, tests, build all green on `b651e45` (6 of 6 checks). |
| `3c055ef` | 5 | Application-level company ownership guard on core routes (second barrier beside row-level security); proven with the database policies deliberately opened. |
| `b651e45` | 4 | Company-prefixed object keys, expiring signed links (expiry is signed), authorised file route, old permanent links limited to Sunchaser's existing keys. |
| `ef303f0` | 1 | Per-company branding, bank accounts, quotation terms, price settings (`/api/company/settings`, company administrators only); settings stored per company (`<company>:<key>`, database-enforced by `t4`); a quotation freezes identity, bank accounts, terms and price defaults when first saved and keeps them when settings or prices change later; other companies never fall back to a Sunchaser value. |
| `3cc65f8` | 2 | Real Chromium PDFs per company; amounts, bank accounts, logo, terms read back from the PDF bytes; leakage and cross-company download tests; neutral equipment/payment/file-name defaults. |
| `c8c6106`, `2fa8866` | 3 | Company export and restore including documents (operator tool), restore guard that refuses to commit if another company's row count changed. |
| `44703d4`, `6cdc649` | 6 | Plans, manual subscriptions, append-only payment ledger and audit, plan limits (staff, leads, documents) enforced by database triggers, atomic onboarding, operator API, plan-limit pre-check (HTTP 402). |
| `cc11728` | 6 | Company-selection screen, "Switch company", operator console, in a real browser. |
| `141c0fb` | 7 | Separate tenant-migration rehearsal for a restored production copy (script and runbook); `bills` described and classified provisionally. |

### Defects found and fixed on the way (all reproduced first; none reachable in production today because the tenant code is not deployed)
| Defect | Found by | Fix |
|---|---|---|
| A company could change a product of the shared local copy (Sunchaser seed) through `/api/admin/products` and copy it into its own table | settings journey against the previous head (38 failures) | Other companies get their own empty in-memory copy; they never read or write `database.json`. |
| Boot state generated Sunchaser's default package catalogue (36 packages) for any company | same | Skipped for other companies. |
| `/api/state` and autosizer presets could write another company's settings under the founding key | same | Company-scoped keys. |
| Simulated "Delivered" WhatsApp log entries carried Sunchaser's name and portal link; lead notes named Sunchaser; quotations defaulted to Jinko 580W / Knox 10kW / Lahore | same and PDF review | Neutral defaults / no entry for other companies. |
| Token renewal (`/api/auth/refresh`) dropped the company claim and `/api/auth/me` returned the global role | real-browser journey | Company claim and company role kept. |
| Invoice bank accounts: for the founding company the template normalises the account list twice, the second pass drops it and the three default accounts print | PDF journey | **Not changed for the founding company** (flag-off behaviour must stay identical; production data is believed to equal the defaults, unverified). Fixed for other companies. Owner should look. |
| Pre-existing: `invoicePdf.ts` imported a type that does not exist; `server.ts` is not covered by `npm run typecheck` (17 baseline errors) | typecheck review | The import was fixed; `server.ts` coverage is a gap (4.8). |

## 2. Exact evidence (all executed here, disposable PostgreSQL 17.11 + PostgREST 16.4 + S3 stand-in + Chromium, synthetic data; files in `docs/saas/evidence/`)

| Proof | Result |
|---|---|
| Unit tests (`npm run test:saas`) | 86 / 86 |
| Typecheck (`npm run typecheck`; does not cover `server.ts`) | 0 errors |
| Database suites on PG17 (migration 18, ownership 10, numbering 40, settings 22, subscriptions/limits 45, company restore 15, runner 44) | all pass (`db-tests.txt`) |
| Two-company journey: lead, quotation, invoice, payments, documents, files, attacks, canary sweep | 79 / 79; with row-level policies opened 75 / 75 |
| Two-company API journey | 52 / 52 |
| Company settings journey (branding, bank, terms, prices, history, local-copy isolation) | 57 / 57; the same journey on the previous head: 38 failures |
| Chromium PDF journey | 37 / 37 (PDFs and text in `evidence/pdf/`) |
| Company export / restore journey (alpha exported, damaged, restored; beta and founding byte-identical; refusals; encrypted round trip; empty-target restore) | 45 / 45; negative control: a restore whose delete ignores the company filter is refused by the guard |
| Onboarding, subscriptions, limits journey | 39 / 39 |
| Real-browser journey (selection screen, switch, reload, operator console, new company sign-in) | 13 / 13 (screenshots in `evidence/screens/`) |
| Attack matrix over every tenant table via PostgREST | 87 of 87 present tables (`bills` absent in this database) |
| Flag-off smoke with all tenant migrations applied | 12 / 12 (an earlier report said 13/13: the script has 12 checks; the "first number 0009" check is in the numbering DB test) |
| SaaS rehearsal script on a synthetic prod-like copy (incl. a synthetic `bills`) | 0 failures; rollback returns every table and the schema to the before state |
| CI on GitHub at the final head | see PR checks; at `b651e45` all 6 passed. The newest head's jobs had not reported when this was written. |

An incident worth stating: after the negative-control run an old server process kept port 3151, so four journeys re-run afterwards (and committed in `ef303f0`) had hit the old bundle. They were all re-run on the correct bundle (commit `3cc65f8`), and every journey was re-run once more on the final bundle before `cc11728`.

## 3. Owner decisions needed
Real Sunchaser invoice-number floor; approval of the shared-database model; plan names, limits and prices (the `pilot` plan is a placeholder); whether a re-printed invoice should show the company's current bank accounts (today) or the ones at issue; what to do about the founding invoice bank-account behaviour above; the real definition of `bills`; hosting and legal terms.

## 4. Remaining gaps (not hidden)
1. **Production schema not read; the SaaS rehearsal has not run on a real backup copy.** Only on a synthetic copy. `bills` keeps a global unique `bill_number`.
2. **Price lists.** Equipment prices of the CRM's own quotations come from the company's rows and the saved quotation. The AutoSizer's built-in default rates (`src/lib/autoSizer/generateRecommendedBoq.ts`) and the static price list `src/lib/solarEquipmentCatalog.ts` are Sunchaser's and ship in the browser bundle to every user. AutoSizer should be disabled for pilot companies or fed a company price book before a pilot.
3. **App shell branding.** The landing page, login hub and header are Sunchaser-branded for everyone. No company-administrator screen exists yet for branding, bank accounts, terms and price settings (the API exists and is tested).
4. **Documents not leak-tested:** delivery challans, warranty certificates, handover, design-studio proposals; the quote editor's default content library and the "LESCO" wording are Pakistan/Sunchaser-specific. Invoice QR codes send invoice number, total and balance to a third-party QR service (pre-existing).
5. **Invoices** use the company's current branding and bank accounts when re-printed; only quotations are frozen.
6. **Founding-only features** (public intake, WhatsApp, AI, learning, marketplace, smart-quote archive names) are refused or founding-scoped, not company-aware.
7. **Operator tool limits.** Export/restore is a CLI, not an API or screen; the founding company's documents are exported only by the keys its rows reference; archives hold customer data (optional AES-256 encryption); restore does not create missing users. No support-access session, no automatic expiry job (overdue is shown, suspension is manual), temporary passwords are handed over by the operator, no e-mail invitation, no MFA. Limits cover staff, leads and documents only (no storage size).
8. **CI typecheck does not cover `server.ts`** (17 baseline errors, none introduced here). Journeys are not in CI (they need the stack); the DB suites and unit tests are.
9. **Environment notes.** The S3 stand-in does not verify signatures; the sandbox needed a symlink so Playwright found the installed Chromium; `.env.production` bakes the production API URL into a default SPA build (a local stack must build with `VITE_API_BASE_URL=` empty); journeys that run the app in the repository directory rewrite the tracked `database.json` (restored before each commit).
10. Still true from round 1: a compromised CRM server is not contained by row security (header trust); about 250 routes are covered by the table matrix and the scope table rather than per-route journeys.
