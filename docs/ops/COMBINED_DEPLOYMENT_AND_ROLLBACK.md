# Combined deployment and rollback plan: two separate releases

Status: **plan only. Nothing in this document has been run in production.** Every production step needs the owner's explicit approval at its gate (`DEPLOYMENT_PLAN.md` section 4). Evidence below is from disposable stacks with synthetic data (PostgreSQL 16 and 17, PostgREST 16.4, an S3 stand-in, real Chromium).

## 1. Two releases, deliberately kept apart

| | Release A: **repair** (PR #111) | Release B: **SaaS pilot** (PR #113, stacked on #111) |
|---|---|---|
| Migrations | M1 `r1-smart-quote-versions`, M2 `r2-session-revocation`, M3 `r3-invoice-payments-integrity`, M4 `r4-invoice-save-atomic` | t1 `company-foundation`, **t1b `tenancy-barrier`**, t2 `ownership`, t3 `document-numbering`, t4 `company-settings`, t5 `subscriptions`, t6 `invoice-issuance-snapshot`, t7 `company-admin`, **t8 `storage-reservations`** |
| Rule for the order | **Backend first**, then M1 to M4 one at a time (the old backend on the new schema breaks payments; `DEPLOYMENT_PLAN.md` step 4 and 5) | **Migrations first, then the backend, then the switch.** See 2 |
| What stays the same | | a database with t1 to t8 applied and the multi-company flag **off** behaves as today for the single company (matrix below) |
| Done when | M1 to M4 verified and a soak period the owner chooses | the first pilot company is onboarded and working |

**Release B does not start until release A is finished and has soaked.** They are never interleaved: the rule "backend first" (A) and the rule "migrations first" (B) are about different schema series and would contradict each other if mixed. PR #113 contains PR #111, so #111 is merged and deployed first (release A), and #113 is rebased on the result before release B.

## 2. Release B in order

| Step | What | Why this place | Check before continuing |
|---|---|---|---|
| B0 | Owner decisions: pilot companies, storage limit each, grace days, read-only, whose privacy policy (`PILOT_ACCEPTANCE_CHECKLIST.md` PA7, PA8). The restored-backup rehearsal and the invoice-number floor (PA1) | the code needs them; t3 refuses to run without the floor | rehearsal clean |
| B1 | Apply **t1, t1b, t2, t3, t4, t5, t6, t7, t8** one at a time through the runner (`node scripts/migrations/run.mjs apply --to <id>`), with the **repair backend still running** | additive; both builds work in every prefix (matrix). Applying them first means nothing can be refused later | after each: `verify`; the single-company smoke (login, lead, quotation, contract, invoice, payment, PDF, upload and download) |
| B2 | Let PostgREST notice the new objects: t8 sends `NOTIFY pgrst, 'reload schema'`; if your PostgREST does not listen for it, **restart it** | PostgREST caches the schema; without this the new functions look "missing" and pilot uploads are refused (retryable) | `select to_regprocedure('public.saas_storage_reserve(text,bigint,bigint,bigint,bigint,integer,integer)')` is not null, and a call through the API answers |
| B3 | Deploy the new backend with `MULTI_COMPANY_ENABLED` **unset** and no tenant key | the single-company deployment as it is today, on the migrated schema | same smoke; `/health` |
| B4 | **Order that leaves no window** (details in `STAGING_REHEARSAL_RUNBOOK.md` section 6): (1) stop every older backend, script runner and worker; (2) `select app.tenancy_enable();` (the database now refuses every service-role request that does not declare multi-company mode: older backends, scripts, flag-off processes, with no polling window); (3) `node scripts/saas/verify-barrier.mjs --confirm` (proves it over HTTP and records it; without that record the database refuses to create a pilot company); (4) set `CRM_TENANT_POSTGREST_KEY` and `MULTI_COMPANY_ENABLED=true`, restart (the backend refuses to start if t1b is missing) | needs t1 to t8 all applied. An older backend has **no isolation code**; the database barrier is what stops it, and only if PostgREST reads in-database configuration, which step 3 proves | `/health` of the new backend is not paused; the operator console signs in; the founding company's users are unaffected |
| B5 | Onboard the first company through the operator console (it requires a storage limit) | | the company's own sign-in, one lead, one invoice, one upload |

### What t8 does and does not require
* **t8 must be applied before any pilot company uploads a file.** Without it a pilot company's upload is refused as "could not verify storage" (HTTP 503, retryable, nothing written; `compat-before-t6-t7` and `rollback-files-quota` prove it). That is deliberate: no silent fallback to a weaker check.
* The founding company and single-company mode **never** use t8 and are unaffected in every combination (matrix).
* So t8 is "before enabling the switch (B4) and before onboarding (B5)", and in this plan it is applied in B1, before the backend swap, which is the stricter reading of "migration before backend".

### Two real hazards found by the matrix and the rollback journey (both fixed, both with regression tests)
1. **Invoice numbers issued outside the counter.** The old backend numbers invoices by counting; from t3 the new backend uses a counter. While both run (a rolling deployment) or after a backend rollback and a roll-forward, the counter used to be behind the invoices and the next number already existed (HTTP 500 `invoices_company_invoice_number_key`). `next_document_number()` now starts every call from the higher of its own value and the highest number the company holds (t3; `test-numbering.sh` 42/42; the matrix failed from t4 on before the fix and passes 26/26 after).
2. **t6 rollback lost the invoice issuance snapshots.** Rolling t6 back and applying it again dropped the write-once record of the bank accounts and terms each invoice was issued with. The rollback now keeps them in `app_rollback_backup.invoice_issuance_snapshot` and the migration restores them (`test-invoice-snapshot.sh` 19/19; `rollback-files-quota`).

## 3. Compatibility of every intermediate state (proven)

`scripts/saas/ci/run-deploy-matrix.sh` walks one database through the schema before M1, then M1, M2, M3, M4, t1 ... t8, **one migration at a time**, and after every step runs the same single-company workflow against **both** backends that can be running (they write to the same database alternately, which is also the rolling-deployment overlap):

* **NEW**: this build, multi-company flag off. Column "backend first".
* **REPAIR**: the build of PR #111 (`81327ff`). Column "migrations first".

| State | NEW backend | REPAIR backend |
|---|---|---|
| before M1 | pass (9/9) | pass (9/9) |
| after M1, M2, M3, M4 | pass (9/9) each | pass (9/9) each |
| after t1, t1b, t2, t3, t4, t5, t6, t7, t8 | pass (9/9) each | pass (9/9) each |
| **marker on** (`select app.tenancy_enable()`, as before the first pilot company) | sign-in refused (HTTP 503, the guard) | sign-in refused (the database refuses it; the old app shows HTTP 500) |

Each cell is: login, lead, quotation, contract to invoice, payment, invoice PDF, document upload and byte-identical download, state read. **The matrix runs on a database that holds the founding company only.** The REPAIR column therefore proves compatibility *before the first pilot company exists*; it says nothing in favour of running that build afterwards (section 4: it has no isolation). The log of the run is `docs/saas/evidence/round5/deploy/`. **Limits, stated plainly:** the REPAIR column is run locally (CI has no build of that commit; CI runs the NEW column on PostgreSQL 16 and 17); the flag-**on** states are covered by the journeys on the fully migrated schema and by `compat-before-t6-t7` (flag on, t6 to t8 absent: invoices, settings and the operator overview work, pilot uploads fail closed, the founding company is unaffected); the production schema was not rehearsed (PA1).

Not covered by any state: **the old production build (before PR #111) on a schema that has M3 or M4** breaks payments (existing rule, `DEPLOYMENT_PLAN.md`); this is why rolling a backend back never goes past the repair build once M3/M4 are applied.

## 4. Rollback, and where it stops

### The boundary, in one paragraph
**The feature flag is a switch for the application, not a rollback, and it can no longer expose data.** Isolation does not depend on the flag any more; it rests on a **persistent marker in the database** (migration t1b). Before the first pilot company the operator switches the marker on (`select app.tenancy_enable()`) and proves over HTTP that the database barrier works (`node scripts/saas/verify-barrier.mjs --confirm`); the `companies` table refuses a pilot company until that proof is recorded. From the moment the marker is on, **the database itself** refuses (HTTP 503, `tenant isolation barrier`) every service-role request that does not declare that its process keeps companies apart: older backends, scripts, and flag-off processes of the new build, **with no polling window** (measured: 135 requests in the 3 seconds after the marker was switched on, all refused, none served, none with data). A flag-off process of the new build also pauses itself (every `/api` and `/uploads` route answers 503 `tenant_isolation_unavailable`, the unfiltered database client throws, background jobs skip), and it keeps pausing **across restarts and after a `companies` row is deleted by hand**, because it reads the marker and, every minute, the tenant rows themselves. The marker is cleared only by `select app.tenancy_disable()`, which refuses while any other company or any other company's row exists; nothing resumes by itself. **Consequences, plainly:** switching the flag off while pilot companies exist **stops the founding company too**; it is a stop, not a way back to the single-company product. The ways forward are: switch on again (isolated), or export each pilot company (`scripts/saas/company-backup.mjs`), remove its data (**there is no supported `remove` command yet, code fix F3**), then clear the marker.

### What each step proves
| Level | Action | What is proven (journey) | What it keeps, loses or exposes |
|---|---|---|---|
| 0 | **Stop the pilot without leaving the multi-company build**: suspend the pilot companies in the console (and their users) | existing console and subscription journeys | nothing lost; the data is still there; isolation unchanged (row-level policies) |
| 1 | **Switch off** (`MULTI_COMPANY_ENABLED` unset, tenant key removed, restart) while pilot companies exist | `tenant-isolation-guard` (47 checks) and `feature-disable-reenable` (8): founding, pilot and earlier sessions, reads, searches, exports, PDFs, file downloads, writes, sign-in, webhook: all 503, no company data in any body; row counts and every stored object identical afterwards; restart changes nothing; unreachable database also pauses | **Nothing is exposed and nothing is served** (founding company included). Files, rows and quota untouched; switched on again, earlier sessions work, each company sees only its own data, files download byte-identical, the quota boundary is where it was |
| 2 | **An older backend** (the repair build of PR #111, or anything before it) against a database that holds a pilot company | `tenant-isolation-guard` step H and the deployment matrix row "marker on": the repair build cannot sign in, and 27 direct service-key requests without the declaration are refused by the database | **Refused by the database, but still NOT a supported step and never recommended**: it works only if the PostgREST in front of the database reads the in-database configuration (proved by `verify-barrier.mjs`, not assumed), and it does not stop a direct PostgreSQL connection. Do not start an older build against a database that holds pilot data. The only safe use of an older backend is against a database restored from **before** the marker was switched on |
| 3 | Roll **t8** back (`run.mjs rollback --to t8-storage-reservations`) | `rollback-files-quota` part 1 | **Every stored file, document row and download untouched; the quota still counts the files** (usage is measured from the object store, not from t8). Reservations (transient) are dropped. Until t8 is applied again, pilot uploads are refused (503, retryable); founding unaffected; after re-applying the boundary is exactly where it was |
| 4 | Roll **t7 .. t2** back (`--to t2-ownership`) | `rollback-files-quota` part 2; `tenant-isolation-guard` step G (flag-off process stays paused; barrier stays) | files, document rows and invoices intact; invoice issuance snapshots kept and restored on re-apply; the storage limit survives; the operator can onboard a company again afterwards. t1 and t1b stay |
| 5 | Roll **t1b** or **t1** back | `tenant-isolation-guard` step G; `test-tenancy-barrier.sh` | **Refused** while the marker is on or any other company or tenant row exists ("Rollback refused"). After the pilot starts, schema rollback stops at t2 |
| - | Release A | unchanged: `DEPLOYMENT_PLAN.md` section 7 (M4, M3, M2, M1 in reverse; the backend last) | |

**Recovery never runs an older backend against pilot data.** Returning to the state before the pilot means: export the pilot companies, restore the pre-change backup into a **new** database, point the application at it. See `STAGING_REHEARSAL_RUNBOOK.md` section 9 for the full table.

Order of any rollback: suspend the pilot; export and remove every pilot company; `select app.tenancy_disable()`; then switch off or redeploy an older backend; then the t-series newest first (t1b before t1); then (if ever) the M-series newest first. While a pilot company exists the only supported states are: this build with the flag on, or this build paused.

### What the barrier and the guard do not cover (stated, not hidden)
* **The barrier lives in PostgREST.** A client that connects to PostgreSQL directly (psql, a connection string) is not stopped by it. Such paths are inventoried in `DATABASE_WRITERS_INVENTORY.md`; the scripts that use one now check the marker themselves.
* **The declaration is an assertion, not a credential.** Anyone holding the service key who sends `x-isolation-mode: multi` without keeping companies apart is not stopped. Who holds the key is an access-control matter (pre-deploy item 1, credential rotation, still open).
* **It needs PostgREST to read in-database configuration** (`db-config`, default on; `db-pre-request` must not be set in its own configuration file). `verify-barrier.mjs` is the proof and is required before the first pilot company.
* The signal for a flag-off process is the marker, the companies and, every minute, the tenant rows (platform tables that merely record pilot companies are not counted). Detection by the process itself takes up to 5 s; the database refuses it in that time anyway.
* The maintenance error is a JSON 503; the web app shows the server's message but has no dedicated maintenance screen.
* `/api/admin/maintenance/production-*-20260606` (one-off direct-database operations) answer 404 whenever the multi-company flag is on and are founding-only otherwise.

### Two further defects the rollback journey found, both fixed with regression tests
* Re-applying t5 restored the operator audit rows but left their id sequence at 1, so the next audit insert collided and **the operator could not onboard a company** (HTTP 409 `duplicate`; first seen as the browser journey failing after the rollback journey). The migration now sets the sequence past the restored rows. `test-subscriptions.sh` now proves it through **rollback, re-apply, new audit insert, a second rollback and re-apply, another insert**, plus a negative control (the migration without the repair collides with `duplicate key`), 51/51; `rollback-files-quota` also onboards a company after the full cycle.
* Re-applying t6 lost the issuance snapshots (see 2).

## 5. Stop conditions
* A migration fails or times out: stop, read the error, roll back that migration only.
* After B3 the error rate rises or logins fail: redeploy the previous backend (only legitimate while the marker is off and no pilot company exists; the repair build is the previous one).
* After B4 anything about a pilot company is wrong: **suspend the company and its users (level 0)** before investigating. Switching the flag off is a full stop for every company, the founding one included (level 1); an older backend is not an option (level 2).
* `/health` reports `tenantIsolation.paused:true` on a process that should be serving: read `reason` (`tenancy_marker`: the persistent marker is on and this process is not in multi-company mode; `tenant_data_present`: another company or another company's rows exist and this process is not in multi-company mode; `unverified`: the database could not be asked). Fix the cause; do not work around it.
* An older backend, worker or script runner is still running when the marker is switched on (B4): stop it first; the database will refuse it, but it must not be left running.
* `verify-barrier.mjs` fails: do not create a pilot company (the database refuses the insert anyway); fix PostgREST's configuration first.
* Two backends running while the numbering has a gap (the numbering pre-check in section 2).
* PostgREST was not reloaded after B1 (pilot uploads answer 503 `storage_unverified`; the backend log names `saas_storage_reserve ... missing`).

## 6. What this plan does not do
It does not apply anything, change production, rotate credentials or decide the commercial terms. The rehearsal on a restored production backup (PA1), the production object store's listing behaviour (PA3), and the owner's decisions (PA7, PA8, PA9) remain open in `PILOT_ACCEPTANCE_CHECKLIST.md`.
