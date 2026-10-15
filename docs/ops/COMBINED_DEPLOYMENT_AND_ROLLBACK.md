# Combined deployment and rollback plan: two separate releases

Status: **plan only. Nothing in this document has been run in production.** Every production step needs the owner's explicit approval at its gate (`DEPLOYMENT_PLAN.md` section 4). Evidence below is from disposable stacks with synthetic data (PostgreSQL 16 and 17, PostgREST 16.4, an S3 stand-in, real Chromium).

## 1. Two releases, deliberately kept apart

| | Release A: **repair** (PR #111) | Release B: **SaaS pilot** (PR #113, stacked on #111) |
|---|---|---|
| Migrations | M1 `r1-smart-quote-versions`, M2 `r2-session-revocation`, M3 `r3-invoice-payments-integrity`, M4 `r4-invoice-save-atomic` | t1 `company-foundation`, t2 `ownership`, t3 `document-numbering`, t4 `company-settings`, t5 `subscriptions`, t6 `invoice-issuance-snapshot`, t7 `company-admin`, **t8 `storage-reservations`** |
| Rule for the order | **Backend first**, then M1 to M4 one at a time (the old backend on the new schema breaks payments; `DEPLOYMENT_PLAN.md` step 4 and 5) | **Migrations first, then the backend, then the switch.** See 2 |
| What stays the same | | a database with t1 to t8 applied and the multi-company flag **off** behaves as today for the single company (matrix below) |
| Done when | M1 to M4 verified and a soak period the owner chooses | the first pilot company is onboarded and working |

**Release B does not start until release A is finished and has soaked.** They are never interleaved: the rule "backend first" (A) and the rule "migrations first" (B) are about different schema series and would contradict each other if mixed. PR #113 contains PR #111, so #111 is merged and deployed first (release A), and #113 is rebased on the result before release B.

## 2. Release B in order

| Step | What | Why this place | Check before continuing |
|---|---|---|---|
| B0 | Owner decisions: pilot companies, storage limit each, grace days, read-only, whose privacy policy (`PILOT_ACCEPTANCE_CHECKLIST.md` PA7, PA8). The restored-backup rehearsal and the invoice-number floor (PA1) | the code needs them; t3 refuses to run without the floor | rehearsal clean |
| B1 | Apply **t1, t2, t3, t4, t5, t6, t7, t8** one at a time through the runner (`node scripts/migrations/run.mjs apply --to <id>`), with the **repair backend still running** | additive; both builds work in every prefix (matrix). Applying them first means nothing can be refused later | after each: `verify`; the single-company smoke (login, lead, quotation, contract, invoice, payment, PDF, upload and download) |
| B2 | Let PostgREST notice the new objects: t8 sends `NOTIFY pgrst, 'reload schema'`; if your PostgREST does not listen for it, **restart it** | PostgREST caches the schema; without this the new functions look "missing" and pilot uploads are refused (retryable) | `select to_regprocedure('public.saas_storage_reserve(text,bigint,bigint,bigint,bigint,integer,integer)')` is not null, and a call through the API answers |
| B3 | Deploy the new backend with `MULTI_COMPANY_ENABLED` **unset** and no tenant key | the single-company deployment as it is today, on the migrated schema | same smoke; `/health` |
| B4 | **First confirm that no process of any older backend (the repair build or earlier) is still running** (a finished rolling deployment, no stray instance, no cron service using the same database and service key). Then switch on: set `CRM_TENANT_POSTGREST_KEY` and `MULTI_COMPANY_ENABLED=true`, restart | needs t1 to t8 all applied (below). An older backend has **no isolation** (section 4, measured): the moment a pilot company exists, every such process shows its data to founding staff | `/health` of every instance reports `tenantIsolation.paused:false` or runs with the flag on; the operator console signs in; the founding company's users are unaffected |
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
| after t1, t2, t3, t4, t5, t6, t7, t8 | pass (9/9) each | pass (9/9) each |

Each cell is: login, lead, quotation, contract to invoice, payment, invoice PDF, document upload and byte-identical download, state read. **The matrix runs on a database that holds the founding company only.** The REPAIR column therefore proves compatibility *before the first pilot company exists*; it says nothing in favour of running that build afterwards (section 4: it has no isolation). The log of the run is `docs/saas/evidence/round5/deploy/`. **Limits, stated plainly:** the REPAIR column is run locally (CI has no build of that commit; CI runs the NEW column on PostgreSQL 16 and 17); the flag-**on** states are covered by the journeys on the fully migrated schema and by `compat-before-t6-t7` (flag on, t6 to t8 absent: invoices, settings and the operator overview work, pilot uploads fail closed, the founding company is unaffected); the production schema was not rehearsed (PA1).

Not covered by any state: **the old production build (before PR #111) on a schema that has M3 or M4** breaks payments (existing rule, `DEPLOYMENT_PLAN.md`); this is why rolling a backend back never goes past the repair build once M3/M4 are applied.

## 4. Rollback, and where it stops

### The boundary, in one paragraph
**The feature flag is a switch for the application, not a rollback, and it is no longer able to expose data.** Earlier versions of this build, with the flag off, ran the single-company code path, which has no company filter: while pilot data existed, founding staff could read it (measured). That is closed: **company isolation no longer depends on the flag** (`server/saas/tenantIsolationGuard.ts`). A process that is not in multi-company mode asks the database, at start and every 5 seconds, whether any company other than the founding one exists. If one does, **or if it cannot find out**, it serves nothing: every `/api` and `/uploads` route (sign-in, reads, searches, exports including the whole-database backup, PDFs, file downloads, writes, the WhatsApp webhook) answers `503 tenant_isolation_unavailable` with `Retry-After`, the database client itself refuses to hand out the unfiltered service key (so background jobs cannot read across companies either), and `/health` and `/api/maintenance-status` say why. It never falls back to unfiltered access and never to the local JSON file. When the other companies' data is removed, the same process resumes by itself within seconds, without a restart. **Consequences, plainly:** switching the flag off while pilot companies exist **stops the founding company too**; it is a stop, not a way back to the single-company product. The ways forward are: switch on again (isolated), or export each pilot company (`scripts/saas/company-backup.mjs`) and remove it, after which the single-company build serves again and t1 can be rolled back.

### What each step proves
| Level | Action | What is proven (journey) | What it keeps, loses or exposes |
|---|---|---|---|
| 0 | **Stop the pilot without leaving the multi-company build**: suspend the pilot companies in the console (and their users) | existing console and subscription journeys | nothing lost; the data is still there; isolation unchanged (row-level policies) |
| 1 | **Switch off** (`MULTI_COMPANY_ENABLED` unset, tenant key removed, restart) while pilot companies exist | `tenant-isolation-guard` (30 checks) and `feature-disable-reenable` (8 checks): 100+ requests (founding administrator, pilot administrator, pilot portal customer, and no session; sessions issued earlier included) all answered 503 with no company data in any body; row counts and every stored object identical afterwards; restart changes nothing; unreachable database also pauses | **Nothing is exposed and nothing is served** (founding company included). Files, rows and quota untouched; switched on again, earlier sessions work, each company sees only its own data, files download byte-identical, the quota boundary is where it was |
| 2 | **An older backend** (the repair build of PR #111, or anything before it) against a database that holds a pilot company | `tenant-isolation-guard` step H, **measured**: the repair build showed the pilot company's lead to a founding administrator | **NOT SUPPORTED, no isolation. Do not do this**, not even briefly, until every pilot company has been exported and removed. The code guard only exists in this build and later ones; the database cannot enforce it (the service role bypasses row-level security by design). With no pilot data the REPAIR column of the matrix applies (section 3) |
| 3 | Roll **t8** back (`run.mjs rollback --to t8-storage-reservations`) | `rollback-files-quota` part 1 | **Every stored file, document row and download untouched; the quota still counts the files** (usage is measured from the object store, not from t8). Reservations (transient) are dropped. Until t8 is applied again, pilot uploads are refused (503, retryable); founding unaffected; after re-applying the boundary is exactly where it was |
| 4 | Roll **t7 .. t2** back (`--to t2-ownership`) | `rollback-files-quota` part 2; `tenant-isolation-guard` step G (flag-off process stays paused with t8..t3 rolled back) | files, document rows and invoices intact; invoice issuance snapshots kept and restored on re-apply; the storage limit survives; the operator can onboard a company again afterwards. The `companies` table stays, so the guard still pauses a flag-off process |
| 5 | Roll **t1** back | `rollback-files-quota` part 2; `tenant-isolation-guard` step G | **Refused while any company other than the founding one exists** ("Rollback refused ... export or remove their data first"). This is also what keeps the guard's signal in place: after the pilot starts, schema rollback stops at t2 |
| - | Release A | unchanged: `DEPLOYMENT_PLAN.md` section 7 (M4, M3, M2, M1 in reverse; the backend last) | |

Order of any rollback: suspend the pilot, then (if leaving the multi-company build at all) **export and remove every pilot company first**, then switch off or redeploy the older backend, then the t-series newest first, then (if ever) the M-series newest first. While a pilot company exists the only supported states are: this build with the flag on, or this build paused. The backend goes back to the repair build only after the pilot data is gone, and never to the build before PR #111 once M3 or M4 is applied.

### What the guard does not cover (stated, not hidden)
* It protects **processes of this build and later**. Any other process that connects with the service key (an older backend, a script, the separate marketplace cron service, an operator's SQL client) has no check. They must not run against a tenant-populated database for anything that reads or writes company data.
* The signal is "a `companies` row other than `sunchaser` exists". Pilot rows left behind after their `companies` row was deleted by hand would not be noticed. Use the export/remove procedure, which removes both.
* Detection takes up to one interval (5 s) after the first pilot company is created by another process; a stalled or failing check turns into a pause after 4 intervals (20 s). Onboarding itself needs the flag on, so this window only matters for a flag-off process that is still running during B5 (see B4).
* The maintenance error is a JSON 503; the web app shows the server's message but has no dedicated maintenance screen.

### Two further defects the rollback journey found, both fixed with regression tests
* Re-applying t5 restored the operator audit rows but left their id sequence at 1, so the next audit insert collided and **the operator could not onboard a company** (HTTP 409 `duplicate`; first seen as the browser journey failing after the rollback journey). The migration now sets the sequence past the restored rows. `test-subscriptions.sh` now proves it through **rollback, re-apply, new audit insert, a second rollback and re-apply, another insert**, plus a negative control (the migration without the repair collides with `duplicate key`), 51/51; `rollback-files-quota` also onboards a company after the full cycle.
* Re-applying t6 lost the issuance snapshots (see 2).

## 5. Stop conditions
* A migration fails or times out: stop, read the error, roll back that migration only.
* After B3 the error rate rises or logins fail: redeploy the previous backend (only legitimate while no pilot company exists; the repair build is the previous one, section 4 level 2).
* After B4 anything about a pilot company is wrong: **suspend the company and its users (level 0)** before investigating. Switching the flag off is a full stop for every company, the founding one included (level 1); an older backend is not an option (level 2).
* `/health` reports `tenantIsolation.paused:true` on a process that should be serving: read `reason` (`tenant_data_present`: another company exists and this process is not in multi-company mode; `unverified`: the database could not be asked). Fix the cause; do not work around it.
* An older backend process is still running when the first pilot company is created (B4/B5).
* Two backends running while the numbering has a gap (the numbering pre-check in section 2).
* PostgREST was not reloaded after B1 (pilot uploads answer 503 `storage_unverified`; the backend log names `saas_storage_reserve ... missing`).

## 6. What this plan does not do
It does not apply anything, change production, rotate credentials or decide the commercial terms. The rehearsal on a restored production backup (PA1), the production object store's listing behaviour (PA3), and the owner's decisions (PA7, PA8, PA9) remain open in `PILOT_ACCEPTANCE_CHECKLIST.md`.
