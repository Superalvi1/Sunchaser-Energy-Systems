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
| B4 | Switch on: set `CRM_TENANT_POSTGREST_KEY` and `MULTI_COMPANY_ENABLED=true`, restart | needs t1 to t8 all applied (below) | the operator console signs in; the founding company's users are unaffected |
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

Each cell is: login, lead, quotation, contract to invoice, payment, invoice PDF, document upload and byte-identical download, state read. The log of the run is `docs/saas/evidence/round5/deploy/`. **Limits, stated plainly:** the REPAIR column is run locally (CI has no build of that commit; CI runs the NEW column on PostgreSQL 16 and 17); the flag-**on** states are covered by the journeys on the fully migrated schema and by `compat-before-t6-t7` (flag on, t6 to t8 absent: invoices, settings and the operator overview work, pilot uploads fail closed, the founding company is unaffected); the production schema was not rehearsed (PA1).

Not covered by any state: **the old production build (before PR #111) on a schema that has M3 or M4** breaks payments (existing rule, `DEPLOYMENT_PLAN.md`); this is why rolling a backend back never goes past the repair build once M3/M4 are applied.

## 4. Rollback (newest change first)

| What went wrong | Undo | Proven | What it keeps or loses |
|---|---|---|---|
| A pilot company misbehaves, or anything about the multi-company code | **Switch off**: suspend the company in the console, or unset `MULTI_COMPANY_ENABLED` and the tenant key and restart | `single-company-smoke`, `flag-off-round3`, matrix NEW column | nothing is lost; no schema change |
| The new backend must go | Redeploy the repair build (PR #111) | matrix REPAIR column at every t-state | nothing lost. **Pre-check:** the invoice numbering has no gap (`select count(*), max(substring(invoice_number from '[0-9]+$')::int) from invoices where company_id='sunchaser' and invoice_number like 'INV-<year>-%'`; equal means no gap). With a gap the repair build cannot create invoices (shown in the matrix's last row, it is how the old build always counted): switch off instead |
| t8 must go | `run.mjs rollback --to t8-storage-reservations` | `rollback-files-quota` part 1 | **Every stored file, every document row, and every download are untouched. The quota still counts the files** (usage is measured from the object store, not from t8). Reservations (transient) are dropped. Until t8 is applied again, pilot uploads are refused (503, retryable); founding unaffected. After re-applying, the boundary is exactly where it was |
| t7 down to t2 must go | `run.mjs rollback --to t2-ownership` | `rollback-files-quota` part 2 | files, document rows and invoices intact; issuance snapshots kept and restored on re-apply; the storage limit survives |
| t1 must go | **Refused while any company other than the founding one exists** ("Rollback refused ... export or remove their data first"). That is a data-safety guard, not a bug: after the pilot starts, schema rollback stops at t2 and the switch (first row) is the rollback | `rollback-files-quota` part 2 | export a company with `scripts/saas/company-backup.mjs` first; restore is tested (`company-restore`) |
| Release A | unchanged, `DEPLOYMENT_PLAN.md` section 7 (M4, M3, M2, M1 in reverse; the backend last) | earlier rounds | |

Order of any rollback: the switch, then the backend, then the t-series newest first, then (if ever) the M-series newest first. The backend is rolled back **after** the migrations that it needs gone, never before, except for the repair-build rollback in the second row (proven).

## 5. Stop conditions
* A migration fails or times out: stop, read the error, roll back that migration only.
* After B3 the error rate rises or logins fail: redeploy the previous backend (second row).
* After B4 anything about a pilot company is wrong: switch off (first row) before investigating.
* Two backends running while the numbering has a gap (the numbering pre-check above).
* PostgREST was not reloaded after B1 (pilot uploads answer 503 `storage_unverified`; the backend log names `saas_storage_reserve ... missing`).

## 6. What this plan does not do
It does not apply anything, change production, rotate credentials or decide the commercial terms. The rehearsal on a restored production backup (PA1), the production object store's listing behaviour (PA3), and the owner's decisions (PA7, PA8, PA9) remain open in `PILOT_ACCEPTANCE_CHECKLIST.md`.
