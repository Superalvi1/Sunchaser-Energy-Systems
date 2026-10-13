# SaaS pilot foundation: what is built, what was proven, what is not

Branch `claude/saas-pilot-multi-company`, stacked on the repair release (PR #111, `81327ff`). **Nothing here has been applied to production or to any real data.** Pricing, hosting acceptance and legal terms are undecided. Not pilot-ready (section 5).

Decisions taken as the working defaults: shared database with company isolation; company export/restore; core solar CRM; operator-led onboarding; manual subscriptions; one shared Android app. Deferred: WhatsApp, AI, learning, marketplace (they are invisible to other companies: routes refused, tables closed to the tenant role).

## 1. What this branch adds on top of the release

| # | Item | Where |
|---|---|---|
| 1 | Release merged into this branch; 5 conflicts resolved (company claim carried through sign-in, refresh and company selection while keeping the release's session family, epoch and revocation; global identity tables always read with the system client) | merge `a8802f2` |
| 2 | Table inventory re-checked against the merged schema: 146 classified tables (the original 141 plus `revoked_sessions`, the rollback artefact, `companies`, `company_memberships`, `document_counters`), 0 unclassified, 0 stale; new classes `rollback_artefact`, `tenant_system`, `platform`; `revoked_sessions` is global identity | `scripts/saas/table-classification.json`, `docs/saas/APPENDIX_A_SHARED_TABLES.md` (earlier snapshot) |
| 3 | **Company ownership inside the invoice definer paths** (`phase2b-ownership.sql`, generated from the release scripts, rollback restores the released bodies byte for byte) | `scripts/saas/phase2b-ownership*.sql` |
| 4 | **Atomic per-company invoice numbers** (`phase2c-document-numbering.sql`): counter table, `next_document_number()`, operator floor tool, invoice number unique per company; the application reserves numbers through it | `scripts/saas/phase2c-*.sql`, `invoiceDb.ts` |
| 5 | **Versioned migration runner**: manifest with order and dependencies, SHA-256 per file, insert-only hash-chained ledger, advisory lock, dry run by default, local-server guard, baseline for hand-applied migrations, dependency-ordered rollback | `scripts/migrations/` |
| 6 | **Two-company journey** and attacks (section 3) | `scripts/saas/e2e/two-company-complete.mjs` |
| 7 | CI: required suite `test:saas`; Docker suite `test:saas-db` on PostgreSQL 16 and 17 | `scripts/ci/suites.json`, `package.json` |

### Defects found in the released functions by the new tests (all reproduced before the fix, none reachable today because the tenant role cannot call them)

| Defect | Before the fix | After |
|---|---|---|
| A payment of company B naming company A's invoice | B's request took A's row lock, waited 10 s for A's other writers, then answered `invoice_busy` (proves the invoice exists) | answers at once, no lock taken |
| Same payment, when A's invoice is free | the overpayment message quoted **A's invoice total, balance and paid amount** | no figure of A's invoice appears |
| Foreign vs missing id | different errors (existence oracle) | byte-identical FK error for both, for the tenant role and for the service role |
| `invoice_save_atomic` | no notion of company: any caller allowed to execute it could edit any invoice | acts for one company; foreign id = "not found"; lines always carry the invoice's company; a `company_id` in the payload is ignored |
| Tenant role with no company header | would have acted as the founding company | refused (`company_context_required`) |
| Invoice numbers | `INV-<year>-<count + 1>`: repeats after deletions or the 9 Oct reset, not atomic | counter that never moves down, seeded from history |

## 2. Preserving Sunchaser (the first company)

* Company id `sunchaser`, existing rows labelled by a constant column default (no row rewritten), `MULTI_COMPANY_ENABLED` off by default.
* **Numbering never restarts at 0001.** `phase2c` refuses to run when the founding company has no invoice number this year and no floor was set by the owner: `insert into app.config (key, value) values ('document_floor.sunchaser.invoice.<year>', '<last number ever issued>')`. The migration never reads or touches the recovery schema. **The real floor is an owner decision** (the reported cleared invoices were INV-2026-0007 and 0008; the tests use a synthetic floor of 8). Counters survive rollback and re-apply (copy in `app_rollback_backup`).
* With the tenant migrations applied and the flag off: flag-off smoke 13/13 (including "first invoice continues at 0009 after floor 8"), concurrent invoice edits 60 rounds x 2 instances 0 inconsistent, two-instance payments 30 rounds 0 overpaid.

## 3. Evidence (all executed here on a disposable PostgreSQL 17.11 + PostgREST 16.4 + local S3 stand-in, synthetic data; files in `docs/saas/evidence/`)

| Proof | Result | File |
|---|---|---|
| Two companies each complete lead -> quotation -> contract -> invoice -> atomic edit -> payment (partial, replay, over-payment refused, final) -> printable documents -> document upload -> file download, at the same time; then each attacks the other's records, documents and files; canary sweep over everything each company can read | **67 / 67** | `two-company-complete.txt` |
| Same journey with the database policies of leads, customers, documents and quotations deliberately opened (negative control) | **11 failures**, including both canary sweeps: the journey is not vacuous | `two-company-complete-negative-control.txt` |
| Earlier two-company journey (sign-in, selection, forged tokens, suspension, hidden modules) on the merged code | 52 / 52 | `two-company-api.txt` |
| Attack matrix over every tenant table through PostgREST (read, update, delete, upsert, forge, hand over, reference the other company's parent with the answer compared to a missing parent) | **87 of 87 present tables**; `bills` is production-only and absent | `attack-matrix.txt` |
| Matrix negative controls (opened policy on `leads`, disabled reference trigger on `invoice_payments`) | 8 failures, as they must | `attack-matrix-negative-control.txt` |
| Ownership tests of the definer paths (cross-company ids; tenant, service, anon, authenticated roles; no header; strict mode; lock side channel) | 32 checks; 13 fail on the released functions, 0 after; rollback restores the released bodies and the tests fail again | `db-tests.txt` |
| Numbering: history, floor refusal, per-company independence, deletion never reuses, 2 x 640 concurrent numbers all distinct and consecutive, privileges, rollback and re-apply | 40 / 40 | `db-tests.txt` |
| Migration runner: order, checksums, drift, failure recording, rollback order, dry run, lock, tamper detection, remote refusal; real manifest baseline, apply, rollback, re-apply | 44 / 44 | `db-tests.txt` |
| Foundation migration: apply, apply again, structure, rollback to identical schema and data, re-apply | 18 / 18 | `db-tests.txt` |
| Unit tests (scope policy incl. every route, resolver, classification, generated SQL up to date, manifest) | 46 / 46 | `unit-tests.txt` |
| Typecheck | 0 errors | `typecheck.txt` |
| All CI suites of the default group on the merged code | required 17 / 17; tracked 2 not passing (the same two as on the release: `marketplace-live-suppliers-phase1`, `startup-smoke`) | `ci-suites-merged.txt` |

## 4. How to rerun

```bash
E2E_ADMIN="-h 127.0.0.1 -p 5432 -U postgres" PGPASSWORD=... npm run test:saas-db      # database tests (disposable server only)
npm run test:saas                                                                      # unit tests
# journeys need a stack: scripts/e2e-crm-repair/isolated-stack.sh, then
#   node scripts/migrations/run.mjs baseline --through r4-invoice-save-atomic --yes ; ... apply --yes   (set the floor first, see above)
#   node scripts/saas/e2e/seed-two-companies.mjs ; node scripts/saas/e2e/two-company-complete.mjs
```

## 5. Remaining gaps (not hidden; none was needed for the proofs above)

| Gap | Consequence | Planned |
|---|---|---|
| Production schema not read; `phase2-preflight.sql` not run; `bills` and `invoices.created_by_user_id` are production-only | the migrations are proven on a synthetic schema only | read-only preflight with owner access (gate G3) |
| The Mac restore rehearsal of the real backup does not include the tenant migrations | tenant migrations never ran on a real backup copy | extend the rehearsal after the release rehearsal passes |
| Settings, branding, bank accounts, terms, quote templates are one row per database | both companies' documents still show the Sunchaser brand, bank details and terms (shown by the journey) | commercial phase C4 |
| Price catalogue is static code | every company quotes Sunchaser's prices | C4 |
| Other business unique keys (quote number, customer code, plan code) are still global; invoice numbers are fixed to `INV-<year>-nnnn` (prefix not yet a company setting) | possible collisions / probing outside invoices | C2/C4 |
| Files: links are non-expiring bearer links (HMAC); storage keys not company-prefixed; no per-company export or restore yet | a leaked link stays valid; a company's files cannot be listed or exported by prefix | C3 |
| Binary PDF rendering needs Chromium, not present on the test stack | the proof covers the server-rendered HTML documents (what the app prints), not the rendered PDF bytes | run once on a stack with the engine |
| For several routes the **database policy is the only barrier** (the negative control shows a company could change another's lead when the policy was open) | a policy mistake would be a real leak; the matrix and CI guard it | keep the matrix required; add application-level company checks where cheap |
| Row security trusts the header the CRM server sets | a compromised CRM server is not contained | stated limit of the shared model |
| About 250 other routes are covered by the table matrix and the route scope table, not by per-route journeys | | C2 |
| No user interface for company selection, no platform admin console, no subscription records, no limits, no support access | operator-led onboarding is by script; a user in two companies cannot choose in the app | C4/C6 |
| Imported invoice numbers above the counter, and numbers consumed by a failed save, are not reconciled | gaps and rare collisions | `document_counter_set_floor` after imports |
| WhatsApp, AI, background jobs, marketplace, learning: not company-scoped | refused for other companies by design | deferred |
| New CI jobs have not yet run on GitHub | local evidence only until the PR checks finish | PR checks |

## 6. Deployment order when approved (nothing is approved)

Release PR #112, rehearsal, PostgREST pin, release migrations M1-M4 (`docs/ops/DEPLOYMENT_PLAN.md`); then, as separate gates: read-only preflight; owner sets the numbering floor; mint the tenant key; `run.mjs baseline --through r4-invoice-save-atomic`, `apply` t1 to t3 in a maintenance window; deploy this code with the flag off; flag on only after the pilot checks. Rollback: flag off, then `run.mjs rollback --to t1-company-foundation --yes`.
