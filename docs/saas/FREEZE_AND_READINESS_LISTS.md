# Feature freeze and readiness: remaining code fixes, owner actions, operational requirements

**Freeze.** Feature development is frozen at `accf97c` (the head reported on 2026-10-15). Everything committed after it is one of: a **safety fix** that closes a hole found in review (the persistent tenancy marker and database barrier, `t1b`), an **investigation or document**, or a **test/verification tool** needed to rehearse the release. No new product feature, no new module, no production change, no customer onboarded. Commits after the freeze: see `git log accf97c..HEAD`.

The three lists are kept apart on purpose: only the first is work for engineering; the second needs a decision or access only the owner has; the third are things that must be true when the system runs, whoever does the work.

## A. Remaining code fixes (engineering, in this repository)
| # | Fix | Why | Blocks |
|---|---|---|---|
| F1 | Close the rest of the **silent-loss class**: clock-only ids (checklist CG15: payments `pay-<ms>`, `wa-`, `PO-`, `ORD-`, `NT-`, `WAR-`, `CLM-`, `lead-manual-`, the `pd-`/`dch-`/`fin-`/`role-` families, `dbManager.ts` 25 more) and the roughly 60 `insert`/`upsert` call sites whose answer is not captured at the call (heuristic scan: `dbManager.ts` 45, `server.ts` 9, `projectDeliveryDb.ts` 5, `warrantyProvisionDb.ts` 2, `roleManagementDb.ts` 1; not individually reviewed) | a collision in one millisecond drops a row with HTTP 200 and no log line; proven for three tables, closed for those; the rest is unproven either way | not the pilot's flows (they use the closed paths); matters for modules switched on later and for production code |
| F2 | Backport the three proven silent-loss fixes (activity-log, project, vault-document ids, with the answer checked and logged) to the production code | production has the defect today; PR #114 (invoice ids) and #115 (customer code) do **not** include them | owner decision O8 |
| F3 | **Company removal (offboarding) command**: `company-backup.mjs remove --company <id>` that refuses unless a verified export exists, deletes in foreign-key order (tenant tables, objects, memberships, platform rows, orphaned users), reports counts, and prints the `app.tenancy_disable()` precondition | there is an export and a restore but **no supported way to remove a company**; without it the only exit from multi-company mode is a manual database operation | the exit path from the pilot; **not** the staging rehearsal |
| F4 | A **maintenance screen** in the web app for the 503 `tenant_isolation_unavailable` / `storage_unverified` answers (today the app shows the server's message) | clarity for users during a pause | no |
| F5 | Delete or archive the old nested copies **`sunchaser-crm/`** and **`scratch/`** | they contain their own service-key clients; the barrier refuses them, but unproven writers should not exist | no (owner action O7 is the safety net) |
| F6 | Harden the declaration: mint the backend's service key with a claim (e.g. `isolation: multi`) and have the pre-request function check the **claim** instead of the header | the header is an assertion; a claim in a separately issued key is only held by processes that were given it | no (hardening; needs a key rotation, so do it together with pre-deploy item 1) |
| F7 | Let the automated journeys target a **hosted staging** (they refuse hosted-looking databases by design) behind an explicit confirmation, or keep the manual checklist | today staging checks are scripted tools plus a manual list (`STAGING_REHEARSAL_RUNBOOK.md` section 8) | no |
| F8 | Least-privilege database roles per service (cron, messaging pool, auto-import already has one; the rest use the owner/service key) | direct PostgreSQL connections are outside the barrier | no |
| F9 | Reproducible frontend build (the bundle embeds a build time) | reports name the server bundle hash only | no |

### Operational limitation kept outside this verification round: company removal
There is an export and a restore of one company (`scripts/saas/company-backup.mjs`) but **no supported command to remove a company** (F3). Consequences, stated plainly:
* Once a pilot company holds data, **the environment cannot be taken back to single-company mode in place.** The tenancy marker stays on, `t1b` and `t1` refuse to roll back, `app.tenancy_disable()` refuses while another company or its rows exist, and an older backend is refused by the database. This is a flexibility limit, **not a safety risk**: every refusal fails closed.
* The ways out that exist today: keep running in multi-company mode (isolated); or, for staging, discard the database and rebuild it from the backup (runbook section 9); or, for production, export the pilot companies, restore the pre-change backup into a **new** database and point the application at it (data created since is lost, which is why the export comes first).
* `scripts/saas/e2e/seed-two-companies.mjs --cleanup` removes companies, but it is a **test tool for disposable databases** (it refuses hosted-looking databases) and is not an offboarding procedure. Do not use it, or hand-written SQL, to remove a company from a database that matters.
* Offboarding a real pilot company before F3 exists is therefore a decision for the owner with engineering, taken case by case, with a verified export first.

## B. Owner actions (decisions, access, accounts)
| # | Action | Needed for |
|---|---|---|
| O1 | Provide the latest production backup set and the age identity to the person running the rehearsal (never in the repository) | staging restore |
| O2 | Confirm the **invoice-number floor** (the last number ever issued this year; the reported cleared invoices were INV-2026-0007 and 0008, the true value is yours) | migration `t3` refuses to run without it |
| O3 | Decide whether the staging bucket gets a read-only **copy of production files**, or only new uploads | documents restored from the backup otherwise answer "not found" in staging |
| O4 | Create the **staging** PostgreSQL, PostgREST (pinned image), backend and bucket with freshly generated keys; never give staging (or `scratch/`, `verify-supabase.ts`, ad hoc scripts) a production key | the rehearsal |
| O5 | List every service on the hosting provider that holds database credentials (web, workers, cron, SQL consoles, BI tools, backup jobs) and which directory each builds from | the inventory's "not visible" list; old `sunchaser-crm/` must not be deployed (O7) |
| O6 | Keep `UNIFIED_MESSAGING_POSTGRES_ENABLED` off during the pilot (its pool is a direct connection to founding-only tables) | inventory |
| O7 | Confirm no hosted service builds from `sunchaser-crm/` | inventory |
| O8 | Decide: review and merge backport PRs #114 and #115; and whether to prepare the third backport (silent-loss class, F2) | production defect exposure today (independent of the SaaS release) |
| O9 | Credential rotation and the Android signing key actions (pre-deploy item 1 and the private action sheet) | holders of the service key sit outside the barrier |
| O10 | Commercial and legal decisions of the checklist's Part C (PA7 to PA9: storage limits per company, grace days, read-only policy, whose privacy policy, price) | onboarding any customer |
| O11 | Approve running the staging rehearsal and, afterwards, decide go / no-go on the evidence | the next gate |
| O12 | Confirm (or have ops confirm) how PostgREST is configured in production: `db-config` on, no `db-pre-request` in its own file | the barrier; `verify-barrier.mjs` proves it on staging first |

## C. Operational requirements (must be true while it runs)
| # | Requirement | How it is checked |
|---|---|---|
| R1 | The marker order of `STAGING_REHEARSAL_RUNBOOK.md` section 6 is followed: stop every older process, `tenancy_enable`, `verify-barrier --confirm`, then the flag | the runbook's gates; the database refuses a pilot company otherwise |
| R2 | PostgREST reloads its schema and configuration after `t1b` and `t8` (notification or restart), and runs the pinned version | `verify-barrier.mjs`; `postgrest --version` in the evidence |
| R3 | **Standing checks**, at least daily and after every deployment: `select public.saas_isolation_status(true)` (mode, other companies, tenant rows); `/health` of every backend instance (`tenantIsolation.paused`); the application log for `[tenant-isolation]`, `not saved`, `storage_unverified`; the 503 rate | alert on any `paused:true` of a process that should serve, any `not saved`, any sustained 503 |
| R4 | A fresh, **verified** backup before every migration and before the marker is switched on; a restore test of it | `restore-verify.sh`; the runbook's recovery table depends on it |
| R5 | No older backend, script or worker is started against a database that holds pilot data; no human uses a privileged SQL console on it except through a documented step | inventory section 6; access list (O5) |
| R6 | The marketplace cron keeps its `global-only` declaration (the script calls `declareGlobalOnlyProcess`); any new cron declares what it touches or is refused | the database refuses undeclared service-role requests |
| R7 | Backend process count is known and tested (the cross-process quota was tested with two) | I7 of the runbook; two-process burst on staging |
| R8 | The pre-request function adds a small query to every API request: measure latency and error rate on staging before and after `t1b` | staging evidence |
| R9 | Offboarding or return to the pre-pilot state follows the recovery table (export, then a new database from the pre-change backup), never an in-place schema rollback | runbook section 9 |
| R10 | The evidence of any incident includes the output of `saas_isolation_status(true)` and the `/health` JSON | |

## What is unresolved and stays listed as such
* **Restore-journey run 8**: unresolved, narrowed to a lost activity-log or document row (`RESTORE_DEFICIT_INVESTIGATION.md`). Release implication: not a pilot blocker on the closed paths; the production code still has the defect (F2/O8); restore of a real backup is untested until the staging rehearsal.
* The earlier "document upload did not return an id" failure: not shown to be related.
* Everything in `PILOT_ACCEPTANCE_CHECKLIST.md` Part C (production access needed).
