# Sunchaser Sync: commercialisation plan for 2-3 paying solar-company pilots

Status: **plan only.** Written 13 Oct 2026 against release commit `6969943` (PR #111) and the unmerged branch `claude/saas-pilot-multi-company`. Nothing here moves production data, runs a tenant migration, changes a credential or touches the live CRM. Evidence labels: **VERIFIED** (I ran or counted it), **CI**, **REPORTED** (owner or a document says so), **ESTIMATE** (my judgement), **UNKNOWN**.

> Readiness statement: the product is **not** multi-company ready. No sentence saying "ready for pilots" may be used until Phase C7 passes on two synthetic companies and a restore test.

Companion files: `APPENDIX_A_SHARED_TABLES.md` (every table and its tenancy class), `APPENDIX_B_HARDCODED_VALUES.md` (every hard-coded Sunchaser value), `PHASED_PLAN.md` and `PHASE2.md` (earlier plan and the built-but-unmerged foundation, on the saas branch).

## 1. Release gates first (state at 13 Oct 2026)

I cannot complete these myself: each needs an owner action, an owner approval or access I do not have. Nothing was merged, migrated or changed.

| Gate | State | Evidence | Needs |
|---|---|---|---|
| Code, tests, CI on `6969943` | **Done** | CI: all 9 checks green (tests, typecheck, build, PostgreSQL 16 and 17 docker suites, crm-contract, listen-port, overlay) | nothing |
| Mac restore rehearsal of the real backup | **Open** | procedure verified on Linux against stand-ins (41 PASS); `~/sunchaser-rehearsal-RETURN.txt` not yet received | owner runs it |
| Record running PostgREST, then pin v16.4 | **Open** | `postgrest-record.sh` written and tested with simulated versions; running version/digest still inferred, not read | owner runs the record command, then approves the change |
| Hotfix PR #112 (reset-link leak) | **Open, draft** | tested on a test stack; not merged | owner approval (merging deploys) |
| Release PR #111 (4 migrations, backend first) | **Open, draft** | mergeable, CI green | owner approval after the rehearsal, pin and preflights |
| Read-only preflights on production | **Open** | scripts exist; not run | owner access |
| M1 to M4 on production | **Not started** | rehearsed on restored-format copies only | approval after merge |
| Credentials, Android signing key roles | **Open** | private sheet written; actions not done | owner |
| SaaS branch up to date with the release | **Out of date** | merging the saas branch into `6969943` conflicts in 5 files (`server.ts`, `server/auth/jwt.ts`, `server/middleware/actor.ts`, `userAuthDb.ts`, `package.json`); the classification checker would fail on `revoked_sessions` and `smart_quote_versions_rollback_backup` | rebase after #111 is merged (Phase C1) |

Everything in the commercial phases that touches production waits behind the first six rows. Planning, repository work and tests on synthetic data do not.

## 2. What exists and what the inspection found

| Area | Finding | Evidence |
|---|---|---|
| Isolation foundation | Built on the saas branch: `companies`, `company_memberships`, non-bypass role `crm_tenant`, RLS from a request header, same-company reference trigger, scope table for routes, company in the session token, flag `MULTI_COMPANY_ENABLED` (default off). Proofs on a disposable database: migration 18/18, attack matrix 87 of 87 present tables, two-company journey 52/52, flag-off equivalence 12/12, 41 unit tests | VERIFIED earlier; not run in production; not re-run on current code |
| Tables | 142 tracked tables: 64 `tenant`, 14 `tenant_existing_company_id`, 10 `tenant_config`, 1 `identity`, 2 `role_template`, 12 `dormant`, 38 `sunchaser_only`, plus 2 new unclassified from #111 | VERIFIED (counted, Appendix A). Production schema **not read**; `bills` exists in code only |
| Hard-coded values | Brand, contact, domains, singletons, locale, numbering, price catalogue, WhatsApp env credentials, storage namespaces | VERIFIED (counts, Appendix B) |
| New release code vs tenancy | `invoice_save_atomic` (M4) and the M3 guard triggers are `SECURITY DEFINER`, so they ignore row-level security. The foundation revokes EXECUTE on application functions from the tenant role, so atomic invoice save would stop working for companies, and it does not yet verify the caller's company | VERIFIED by reading the SQL and the foundation description |
| Invoice numbers | `INV-<year>-<row count + 1>`, not atomic, not company-aware | VERIFIED (`invoiceDb.ts` lines 270 to 282) |
| Migrations | 99 SQL scripts in `scripts/`, 6 rollbacks, **no migration ledger or runner**; applied by hand | VERIFIED |
| Storage | 2 namespaces, keys not company-prefixed, non-expiring links | VERIFIED |
| Current load (one company) | 7-day averages: PostgreSQL 0.17 GB RAM, 0.001 vCPU, 0.21 GB disk; PostgREST 0.36 GB RAM; CRM 0.15 GB RAM | VERIFIED (Railway metrics, read-only) |

## 3. Decision analysis: shared database or one database per company

**Situation.** One Railway project: CRM (Express), PostgREST, PostgreSQL 17 on a 1 GB volume. 142 tables, one company. Two to three paying pilots, same market, probably similar size to Sunchaser.

**Options.** (A) one shared database, `company_id` on every tenant row, enforced in the application and by row-level security; (B) one PostgreSQL + PostgREST pair per company, a shared CRM that routes by company; (C) hybrid: A now, with export/import tooling that lets a company move to B later.

**Infrastructure cost (Railway list prices read from docs.railway.com on 13 Oct 2026: RAM $10/GB-month, CPU $20/vCPU-month, volume $0.15/GB-month, egress $0.05/GB; plan fee $20 Pro or $5 Hobby is a fixed cost that does not change between options).** Using the measured idle-ish averages above:

| Item (per month) | A: shared, marginal cost of one more company | B: dedicated PostgreSQL + PostgREST per company |
|---|---|---|
| RAM | about 0.0 to 0.05 GB extra: **under $0.50** (ESTIMATE) | 0.17 + 0.36 = 0.53 GB: **about $5.3** |
| CPU | negligible | about $0.06 |
| Volume | rows only (Sunchaser's whole database is 0.21 GB): about $0.03 | 1 GB provisioned: $0.15 (or more) |
| Backup job and monitoring | shared | one extra scheduled job and alert per company |
| **Total (ESTIMATE)** | **well under $1** | **about $5.5 to $6**, more under real load |
| For 3 pilots | under $3 | about $17 |

Reading: infrastructure is not the deciding factor in either direction; the numbers are small and rest on one company's load. Variable cost that matters more is AI usage (not metered today) and WhatsApp conversation fees.

| Criterion | A: shared + RLS | B: database per company |
|---|---|---|
| Strength of isolation | Row-level policies plus application checks. Protects against forgotten filters; **does not** protect against a compromised CRM server (it chooses the header). Weak spot: `SECURITY DEFINER` functions (M3, M4, inventory) bypass RLS and each needs an explicit company check | A SQL bug or missing filter cannot cross companies. A compromised CRM server still holds every connection, so the server remains the shared trust point |
| Blast radius of a bad migration or lock | All companies at once | One company at a time; can stage rollouts |
| Migration complexity | **One run per release.** The release just prepared (4 migrations: preflight, apply, verify, rollback) is done once | **N runs**, N preflights, N rollbacks. Needs a migration ledger and runner that do not exist today (99 hand-applied scripts) and a way to keep schemas identical |
| Per-company backup / restore / export | Hard: restoring one company from a shared backup means export-by-company and a careful import (tooling must be built; Phase C3) | Easy: `pg_dump` and `pg_restore` of one database |
| Application changes | Most are built on the saas branch (about 3,000 lines, unmerged) | Connection router for N PostgREST URLs and keys (the code has a single process-wide client, `getSupabase()`), provisioning automation, per-company PostgREST pin and restart |
| Onboarding a company | Insert rows (seconds) | Create two services, volume, variables, run schema, health check (minutes, automation untested) |
| Noisy neighbour | Possible; mitigated by limits, connection pool 10 shared | None |
| Cross-company reporting for the platform | Simple | Needs a fan-out |
| Contractual/regulatory demand for a dedicated database | Cannot meet | Can meet |
| Reversibility | Can move a company out later if export/import exists (C) | Moving into shared later is harder |

**Best logical choice: C.** Build A for the pilots and build company-level export and import as a first-class feature (it is needed for offboarding and recovery anyway), so a company that later demands a dedicated database can be moved there. Do not build B's provisioning and routing now: it adds a migration runner, a router and N-fold operations before any customer has asked for it.

**Switch to a dedicated database for a company if any of these happens:** a signed contract or regulation requires it; one company's load degrades another's (measured, not assumed); the isolation certification (C7) cannot be passed after the `SECURITY DEFINER` review; or a company's data exceeds what a shared 1 GB-class volume can hold comfortably.

**Risks of the recommendation.** A mistake in a policy or a definer function exposes every company (mitigation: attack matrix on every tenant table in CI, canary sweeps, no definer function exposed to the tenant role without an in-function company check); a bad release hits everyone (mitigation: flag, staged deploy, tested rollback); the shared server remains one trust boundary (stated honestly to pilots).

## 4. Phased plan

Order matters: C0 is the gate list above. C1 can start in the repository now, but nothing is applied anywhere until the owner approves. "Sunchaser stays the first company" means: company id `sunchaser`, existing rows labelled by a constant column default (no row rewrite), `MULTI_COMPANY_ENABLED` off by default, flag-off behaviour proven equal.

| Phase | Deliverable | Depends on |
|---|---|---|
| **C0** | Release gates in section 1 | owner |
| **C1 Rebase and harden the foundation** | After #111 is merged: rebase the saas branch (5 conflict files); classify `revoked_sessions` (global identity: recommended) and the rollback artefact; make `invoice_save_atomic` and the M3 guard company-aware (reject a header whose `company_id` differs from the request company; grant the tenant role EXECUTE only on those) ; add migration ledger table and a small runner for the tenant scripts; re-run all earlier proofs on the merged code | C0 rows 1 to 5 |
| **C2 Core modules isolated and proven** | Leads, customers, Smart Quote and quotations, invoices, payments, ledger, customer portal, documents, activity logs, exports and PDFs: per-route tests for every verb on another company's ids; unique keys made per company (quote, invoice, customer code, plan code); deterministic ids include the company | C1 |
| **C3 Files, export, backup and recovery** | Company-prefixed storage keys and expiring signed links; `export-company` (tenant tables in foreign-key order plus files, manifest of counts and hashes, secrets and platform tables excluded); `import-company` into a scratch database or a new company id; single-company recovery runbook; encrypted platform backup (existing tool) with a restore test; offboarding: export, retention period, deletion proof | C2 |
| **C4 Company settings** | Per-company branding (name, logo, colours, contacts, signature, offices), bank accounts, terms, quote templates, document number formats with an atomic per-company counter, versioned price book (Sunchaser's seeded from the static catalogue, results identical on a fixed corpus), staff, roles and permissions per company membership, portal and quote links by company | C2 |
| **C5 WhatsApp, AI, jobs** (optional for pilots) | Phone-number id globally unique, webhook routed by it, per-company encrypted tokens, one metering gateway with per-company budget and kill switch, jobs run inside an explicit company context | C2, C4 |
| **C6 Onboarding and subscription** | Operator-created company and owner invitation (expiring hashed token), onboarding checklist, plan, status (trial, active, past due, suspended, cancelled), limits (users, storage, leads, AI credit), **manual** payment records (append-only, voidable), suspended = read-only plus export, support access that the company grants for a limited time and that is audited | C4 |
| **C7 Demo and certification** | Synthetic multi-company demo; the full isolation suite; restore test on a multi-company dataset; Sunchaser equality before and after on a production-shaped copy; pass/fail report. Production tenant migration and flag switch each need their own approval (G3, G4, G5) | C2 to C4 and C6 |

### Acceptance criteria

| Phase | Pass condition (measurable) |
|---|---|
| C1 | Merged code builds; typecheck no new errors; classification checker passes for every tracked table; earlier proofs (migration 18/18 or more, attack matrix on every tenant table, flag-off equivalence) pass on the merged code; a company-B caller invoking atomic invoice save on a company-A invoice is refused and changes nothing; Sunchaser flag-off journeys (the existing 12 and the release journeys) still pass |
| C2 | For each company-scoped route and verb: company B using A's id gets 404 with a body identical to a non-existent id; list, search, count, export and PDF endpoints return zero A rows to B (canary sweep); two companies can hold the same quote/invoice/customer number; no business unique key probes across companies; suspended member or company is refused on every route |
| C3 | Export of company A contains zero B canaries and no password hashes, tokens or platform tables; import into a scratch database reproduces A's row counts and hashes; deleting A and restoring from its export leaves B unchanged; a restore of the platform backup passes the existing rehearsal with two companies; a storage key or signed link of A returns 403/404 for B and expires |
| C4 | Sunchaser quotes and invoices are byte-for-byte or total-for-total identical to before on a fixed corpus; changing B's prices, terms or branding never alters A's documents; historical quotes keep their stored lines; invoice numbers follow each company's format and never repeat under concurrent creation (a new concurrent-creation test, modelled on the existing concurrent-edit and payment tests, run for two companies) |
| C5 | Captured-prompt test: no A data in B's prompts; a webhook for a number routes to exactly one company, an unknown number is rejected; a company at its AI budget is stopped with a clear message; every background loop runs under an explicit company context |
| C6 | An operator can create a company, invite an owner and reach a first test quote without a developer; limits block creation at the limit and never block reading or export; payment records are idempotent and voidable; support access ends at its expiry and every use is in the audit log |
| C7 | Full suite passes on two synthetic companies including documents, exports, jobs and (if enabled) WhatsApp and AI retrieval; restore test passes; no known cross-company read or write; written report lists tested versus not tested. Only then may the sentence "ready for pilots" be used |

### Tests that prove one company cannot read or modify another

| Layer | Test | Exists today |
|---|---|---|
| Database | Attack matrix over every tenant table through PostgREST: read, update, delete, upsert, forge `company_id`, attach to the other company's parent, no header; negative controls (an opened policy and a disabled trigger must make it fail) | Yes (saas branch; 87 of 87 present tables) |
| Definer functions | Every `SECURITY DEFINER` function is either closed to the tenant role or proven to check the caller's company; a test enumerates them and fails on a new one | New (C1) |
| API | Per-route, per-verb cross-company attempts generated from the route scope table, plus enumeration of list endpoints, search, aggregates, exports and PDFs | Partly (leads, quotes, invoices, payments, documents: 52 checks); C2 completes it |
| Canary sweep | Each company's rows carry unique canary strings in every text column; every API response, export and PDF produced for A is scanned for B's canaries | New |
| Identity | Forged or stale tokens, header injection, removed or suspended membership, company switching, revoked sessions | Partly |
| Files | Cross-company key guessing, expired or foreign signed links, upload into another company's prefix | New (C3) |
| Jobs and WhatsApp | Loop iterates companies with context; webhook routing by number; unknown number | New (C5) |
| AI | Captured prompts and retrieval results for A contain no B data | New (C5) |
| Export/restore | A's export contains no B data; import reproduces A; deletion of A leaves B untouched | New (C3) |
| Concurrency | Same invoice/quote/customer number created by two companies at the same moment | New (C4) |
| Regression | Sunchaser equality before and after, flag-off journeys | Yes (12/12 flag-off; release journeys) |

### Demo with synthetic data (Phase C7, built from the existing seed scripts)

* A seed script creates three obviously fictional companies (for example "Demo Solar A", "B" and "C"), each with staff of different roles, leads, customers, a price book, quotations, invoices with payments, documents and (stubbed, no Meta account) WhatsApp threads. Passwords are generated and printed once to the operator, never committed.
* Runs only against an isolated stack (the same stack used by the journeys); a guard refuses any database host that is not local or labelled demo; a reset command rebuilds it.
* Scripted walkthrough: operator creates a company, owner accepts the invite, onboarding checklist, branding, prices, first Smart Quote, invoice and payment, company export, then live proof that Company B receives 404 for A's records, plus screenshots from the existing browser journeys.
* No Sunchaser customer data is used, copied or anonymised for the demo.

## 5. Smallest version suitable for 2-3 paying pilots

Include (all must pass C7): C1; C2 for leads, customers, Smart Quote and quotations, invoices and payments, customer portal, documents; C3 export, company recovery runbook and encrypted backup; C4 branding, bank accounts, terms, document numbering, price book (a simple versioned table edited by staff; no import wizard), staff and permissions; C6 in its minimum form (operator-created company, manual subscription record with status and expiry, suspend = read-only plus export, support contact, no self-service signup, no card payments); C7 demo and certification.

Defer: WhatsApp (pilots handle customer chat outside the product, or one pilot at a time on the single configured number under explicit approval), AI features (switch off by default per company; metering comes with C5), inventory and its definer functions, projects/delivery/after-sales beyond what the core flow needs, marketplace and learning studio (Sunchaser only), dedicated databases, SSO, custom domains, self-serve billing, a second country or currency, white-label mobile builds (one Android app, company branding applied after login; the app name and icon stay generic).

ESTIMATE (low confidence, depends on how much of the saas branch merges cleanly): the minimum version is the largest part of the first four phases; a realistic order of magnitude is **two to three months of focused work**, excluding the time the owner needs for approvals, the Mac rehearsal, credential work and the gate decisions. Treat this as a planning number, not a commitment.

## 6. Open decisions for the owner

1. Approve option C (shared database now, company export/import designed in from the start).
2. Pilot scope: is WhatsApp or AI required by any pilot? If yes, which one first, and who pays for the conversation and AI costs?
3. Data location: the project runs in one Railway region (sfo per the earlier inspection); confirm pilots accept that, or choose another region.
4. Product naming and Android strategy (single multi-company app recommended).
5. Contracts: terms of service, data-processing terms, privacy policy naming the correct controller, retention and deletion period. These need a lawyer; engineering only supplies the technical facts.
6. Invoice number policy for Sunchaser after the 9 Oct reset (continue at 0001, or continue after the highest number ever issued including the recovery copies).
7. Subscription price and plan limits (the infrastructure cost per company is small; AI use and support effort drive the price).

## Simple Summary
* The release gates are not finished: CI is green, but the Mac restore result, the PostgREST record/pin, the preflights, the merges and the migrations all wait for you.
* A multi-company foundation already exists on a separate branch; it is out of date against the release (5 conflicting files, 2 unclassified tables) and does not yet cover the new atomic-invoice function.
* Shared database with row-level isolation is recommended for 2-3 pilots; a database per company costs only about $5 to $6 per month each in infrastructure but multiplies migrations, backups and operations by N.
* The smallest pilot product is the core CRM flow, per-company settings and numbering, export/recovery, operator-led onboarding and manual subscriptions, proved by a cross-company test suite; WhatsApp, AI and everything else wait.
* Nothing in this plan moves production data or applies a tenant migration.
