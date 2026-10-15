# Pilot acceptance checklist (frozen, v1.1)

**Version 1.1, FROZEN 2026-10-15 after the verification below completed.** This is the single checklist for the limited multi-company pilot. It replaces the status tables of `PILOT_ROUND3_REPORT.md` (kept as history). Version 1.0 is kept unchanged in `PILOT_ACCEPTANCE_CHECKLIST_v1.0.md`; a later change to code or to this file creates version 1.2 with a dated change list. The change list from 1.0 is at the end of this file.

| | |
|---|---|
| Branch / PR | `claude/saas-pilot-multi-company`, draft PR #113 (stacked on #111) |
| Code tested | `f6aff156c0cc9a86170c8e30938cbd941e1d153e`, verified **from a fresh clone with no uncommitted files**: `npm ci --ignore-scripts` from the lockfile, then built there. `dist/server.cjs` sha256 `61ed3c6f609bb8dd7ed19ed4b1312bdefca4bdb6c28c0d38444ec1bada9bb05f` (identical to the bundle of the working tree used earlier; the frontend bundle embeds a build timestamp and is not byte-reproducible). Every journey, repeat and unit result below is at this commit. Later commits: `b521ad0` changes one database test script only (`test-storage-reservations.sh`, a negative control made deterministic; the DB tests were re-run from a fresh clone at that commit: PostgreSQL 16 3 of 3 and 17 3 of 3, exit 0), then documents and evidence only (checked with `git diff --name-only`) |
| Frozen at | the commit that contains this file (its SHA is in the PR description) |
| Frozen on | 2026-10-15 (v1.0: 2026-10-14) |
| Scope | the existing limited pilot only; no new module was added. Round 5 closed five reliability gaps (see the change list) |
| Production | **unchanged**: no deployment, migration, merge, credential change, app release, and no read of production data or schema |

## How to read it

| Status | Meaning |
|---|---|
| **PASSED** | executed on a disposable stack (or in CI) and the result is in `docs/saas/evidence/round4/` or `round5/` |
| **FAILED** | executed and did not meet the requirement |
| **UNTESTED** | not executed (inspected, or not reachable from here); never counted as tested |
| **NOT BUILT** | a stated decision to leave it out |
| **UNRESOLVED** | observed, cause not established |

Every executed result ran on synthetic data: PostgreSQL 17 (and 16, see 8.3), PostgREST 16.4, an S3 stand-in with fault injection, real Chromium. Nothing ran against a hosted service.

Two lists follow the checklist and are kept apart on purpose: **Part B, code gaps** (work that could still be done in this repository) and **Part C, production-access gaps** (what cannot be closed without a production backup, production facts, real devices or accounts, or an owner decision).

## Pilot defaults (proposed, not final commercial terms)

These are defaults for the pilot. No price, plan, contract or commercial limit is decided by them.

| Default | Where it is set | Status | Evidence |
|---|---|---|---|
| Three-day grace after the subscription end date | `SAAS_EXPIRY_GRACE_DAYS` (default 3) | PASSED | unit tests; journey `pilot-round3` (grace, past grace, renewal) |
| Read-only after expiry (reads and prints work, every write is refused with 402 `subscription_expired`) | request-time check, `server/saas/subscriptionAccess.ts` | PASSED | same |
| AutoSizer and the delivery group (after-sales) disabled for pilot companies | `server/saas/moduleGate.ts` | PASSED | journey `disabled-modules` (17 checks, 200+ calls), unit tests |
| An explicit storage limit is required when a company is onboarded; there is no unlimited default | `cleanCompanyInput`, console form, upload guard | PASSED | journeys `platform-onboarding`, `browser-company-ui`, `storage-quota`; unit tests |

## Part A. The checklist

### 1. Storage limit: fail closed, retryable, downloads preserved (`docs/saas/STORAGE_LIMITS.md`)

| # | Check | Status | Evidence |
|---|---|---|---|
| 1.1 | If usage or the limit cannot be verified (listing down, listing never answering, limit unreadable) a new upload is refused with **503 `storage_unverified`**, `retryable: true`, `Retry-After`, a plain message that nothing was lost; nothing is stored | PASSED | `storage-quota` B (4 routes), unit tests; a listing that hangs is refused within 8 s |
| 1.2 | The same upload succeeds when the store is back, with no restart | PASSED | `storage-quota` B |
| 1.3 | Existing files stay and authorised downloads still work (byte-identical) at the limit, at 0 MB, and while usage cannot be measured; the application still reads normally | PASSED | `storage-quota` A, B, D |
| 1.4 | No limit set (plan without one, or no subscription row) is refused with 403 `storage_limit_not_set`; the operator's fix works at once | PASSED | `storage-quota` C |
| 1.5 | **Concurrent uploads at the boundary, one process**: 14 simultaneous uploads when exactly 5 fit: 5 accepted, 9 refused with 402, bucket within the limit, rows and objects match | PASSED | `storage-quota` A; unit tests (25 concurrent writes with room for 7 accept exactly 7 at three timings; mixed sizes never exceed the limit; a failed write gives its room back) |
| 1.5a | **Atomic across server processes** (round 5): the decision is made by the database (`saas_storage_reserve`, migration **t8**) under a per-company advisory lock. **Two real server processes**: 24 mixed-route uploads race over both at the boundary, exactly as many are accepted as fit; a deleted file frees exactly its room (not counted twice); failed writes through both processes leave no reservation and use no room; a database that refuses the function makes both fail closed (503, retryable) and recover without a restart; a process **killed with SIGKILL mid-upload** leaves a pending reservation that blocks while it lives and stops blocking after it expires | PASSED | journey `storage-two-instances` (32 checks). **Against the previous per-process design the same journey fails: 10 of 24 uploads accepted for a limit that fits 5, 1.9 MB stored against 1 MB** (`round5/storage/BEFORE-...`). SQL: `test-storage-reservations.sh` 42 checks (40 simultaneous sessions for 10 units, 5 rounds: exactly 10 each; **without its lock the same function admits more**; privileges: service role only). Unit: `storageReservations.test.ts` (several simulated processes, randomised, negative control) |
| 1.6 | **Every enabled upload route** is metered and refused over the limit and accepted with room: customer documents, payment receipts, watermark/logo images, `/api/upload` | PASSED | `storage-quota` A (each route both ways; a refused receipt records no payment) |
| 1.7 | `/api/upload` no longer writes a pilot company's file to the shared public folder: images only, in the company's key space, metered; the founding company's behaviour is unchanged | PASSED | `storage-quota` A; flag-off journey |
| 1.8 | A write the store rejects after it was accepted does not use up the quota | PASSED | `storage-quota` B |
| 1.9 | The browser shows the server's refusal on an upload: at the limit (plain refusal, nothing stored, the earlier file still listed and downloadable) and with the store unreachable (retryable message, **Retry upload** saves the file exactly once after recovery) | PASSED (round 5) | journey `browser-pilot-round5` A (real uploader in Chromium; screenshots `round5/screens/r5-01..03`). Note: the 402 message also shows a Retry button, which cannot succeed until space is freed (cosmetic) |
| 1.10 | Usage shown to the operator | NOT BUILT | the console shows limits, not bytes used |

### 2. Interactive proposals, Proposal Studio, Roof Studio: off in UI and API

| # | Check | Status | Evidence |
|---|---|---|---|
| 2.1 | Their API paths (`/api/interactive-proposals*`, `/api/leads/:id/design-session`, `/api/export/pdf/design-studio-proposal*`) answer 404 `not_available` to real pilot users before any handler; the founding company still reaches them | PASSED | `disabled-modules`; unit test that fails if a route with these words is added ungated |
| 2.2 | The module flag reaches the interface; the staff workspace shows no Proposal Studio, Roof Studio or interactive-link entry on its first screens | PASSED | `browser-pilot-round4` part 4 |
| 2.3 | The same controls inside a lead, for one lead and quotation: a pilot administrator's and a pilot sales user's client workspace and Proposals tab, and the sales quotation workspace: no interactive-link button, no Roof Studio / Proposal Studio, and the page **never calls** a design-tool endpoint; the founding sales user on the **same build** does have the interactive-link button, Roof Studio and Auto Sizer (so absence is the module switch); the API answers 404 `not_available` to pilot administrator and sales user for that lead and quotation (a portal customer is refused 403) | PASSED (round 5) | journey `browser-pilot-round5` B. **Found by it and fixed:** the pilot sales quotation workspace still showed "Download Auto Sizer PDF" and "Copy Auto Sizer" although the module is off |
| 2.4 | The AI assistant (tab and floating widget) and the portal "solar sizing wizard", which speak as Sunchaser, use Sunchaser's catalogue and submit leads to the founding company's intake, are off for pilot companies (API `/api/ai`, `/api/gemini`; interface) | PASSED | `disabled-modules`, `browser-pilot-round4`, `browser-pilot-round3` |
| 2.5 | A company price book / company-specific proposal pricing | NOT BUILT | these tools stay off until pricing and isolation are proven |

### 3. Company branding throughout the enabled customer portal

| # | Check | Status | Evidence |
|---|---|---|---|
| 3.1 | A customer can fetch their own company's public details (name, address, phones, e-mail, website, logo, review link) and nothing else (no terms, signature, bank-accounts picture); another company's customer cannot get them; staff and anonymous callers are refused. **Found this round:** a customer could not call `/api/branding` at all, so a pilot portal could never show its company | PASSED | `disabled-modules` (new endpoint) |
| 3.2 | Company **with** name, logo, phone, review link: header shows the name and the company's own logo; WhatsApp and Call go to the company's number and greet it by name; nothing says Sunchaser (text, links, images) | PASSED | `browser-pilot-round4` part 3 |
| 3.3 | Company with **nothing set**: no name, no image, **no WhatsApp or Call button** (Sunchaser's number is never substituted), no review prompt | PASSED | same |
| 3.4 | Every portal screen reachable by tab or service tile (dashboard, proposals, payments, support, account, service requests, service history, energy monitor, savings, care plans, my solar system) says nothing of Sunchaser for both companies | PASSED | same (9 screens read per company) |
| 3.5 | Nothing is drawn before the company's branding is known and a failed load falls back to nothing, not to Sunchaser; single-company mode keeps its existing look | PASSED | `browser-pilot-round4`; `portalBranding.test.ts`; flag-off journey |
| 3.6 | Welcome guide (staff, first sign-in) names the company, or a neutral phrase, never Sunchaser | PASSED | `browser-pilot-round4` |
| 3.7 | **Actual PDFs, company with and without a logo**: quotation and invoice for a company with a logo (own logo embedded, none of the other's), a company with a name but no logo, and a company with nothing set: real Chromium PDFs read back as bytes; no Sunchaser logo/signature/bank picture (by image size), no Sunchaser text, no other company's text or logo; amounts present | PASSED | `pdf-render` |
| 3.8 | The customer downloads their own invoice through the portal handler: real PDF, company identity, bank accounts, amount, own logo, nothing of the other company or Sunchaser; cannot download the other company's invoice | PASSED | `pdf-render` |
| 3.9 | The privacy-policy and account-deletion links in the portal and in every workspace footer point to Sunchaser-hosted pages | **OPEN, owner decision** | left as they are on purpose: which policy applies to a pilot company's customers is not a code question (Part C, D4) |
| 3.10 | A company with no contact details prints bare icons in the invoice header | KNOWN, cosmetic | seen in `beta-bare-invoice.pdf` |
| 3.11 | Sunchaser wording on staff screens beyond header, footer, navigation and the screens above | **FAILED (known)** | the crawl reached only 8 screens and found 3 places: the Accounts workspace ("Sunchaser Accounts", "Sunchaser Energy Systems") and the Sales Advisor deck heading ("SUNCHASER CRM & GENERATIVE PROPOSAL DECK"); `sunchaser-wording-audit.md`. Not a proof about unopened screens (CG5) |

### 4. Settings screen: bank accounts, non-administrators, history values

| # | Check | Status | Evidence |
|---|---|---|---|
| 4.1 | Edit an existing bank account in the browser (unsaved warning, discard, save, survives a reload, the database holds it) | PASSED | `browser-pilot-round4` part 1 |
| 4.2 | Delete a bank account in the browser: asks first (names the account, says issued invoices keep their copy), "Keep" leaves it, "Remove" removes it only on screen, save applies it; the database holds exactly the remaining account | PASSED | same |
| 4.3 | **Non-administrator in a browser** (a Sales Manager of the company): can open the screen, sees the read-only notice, every field disabled, no Save, no add/remove/discard, no History tab; the API refuses the same user's changes and the history (403) and nothing changed | PASSED | same part 2 |
| 4.4 | **Before and after values in the history**: "Show values" on an edit shows the field with old and new value in separate columns; on a removal shows the removed account in full; on a branding change shows old and new name and the removed logo as `[embedded image, N KB]`, never image data; the one-line summary names counts and fields, never values | PASSED | same part 1; `settingsDiff.test.ts` (7 tests) |
| 4.5 | Terms and prices before/after in the browser | PARTLY | the same component shows them; verified by unit tests, not by a browser step |
| 4.6 | The history is per company, append-only, written for every change; non-administrators refused; the history cannot be altered even by the database owner | PASSED | `pilot-round3` F; `test-company-admin.sh` |
| 4.7 | Two administrators saving at once (the list is replaced as a whole, no version check) | KNOWN LIMIT | last save wins (Part B, CG10) |

### 5. Disabled modules called as real pilot users

| # | Check | Status | Evidence |
|---|---|---|---|
| 5.1 | AutoSizer, after-sales, WhatsApp inbox and connection, design tools, AI: every path, for a company administrator, a sales user and a portal customer of two companies: 200 calls, all refused before any handler (404 `not_available`; a portal customer on a staff-only path gets the earlier 403) with the gate's exact body | PASSED | `disabled-modules` |
| 5.2 | WhatsApp inbox in particular (`/api/inbox*`, `/api/conversations*`, `/api/admin/whatsapp*`, `/api/whatsapp-agent*`) | PASSED | same |
| 5.3 | An AutoSizer quote cannot be saved by a pilot administrator (403 `module_disabled`), no row written, a manual BOQ quote on the same lead works | PASSED | same |
| 5.4 | The boot payload (staff) and the portal payload (customer) switch every module off for a pilot company and on for the founding company | PASSED | same |
| 5.5 | The Meta webhook (`/api/whatsapp/*`) is public and belongs to the founding company by design | NOT A PILOT FEATURE | not exercised as a pilot user |

### 6. Flag-off regression in CI

| # | Check | Status | Evidence |
|---|---|---|---|
| 6.1 | With `MULTI_COMPANY_ENABLED` unset, on a database that has the migrations applied **and holds the founding company only** (with any other company present the process pauses, section 9), the application behaves as before: login, lead, quotation, contract, invoice, payment, PDF; no company fields; no module flags; AutoSizer, after-sales, inbox, design tools and AI reachable; the image upload still writes to the public folder; no storage refusal | PASSED | `single-company-smoke` (12/12), `flag-off-round3` (18/18); run by the CI job `pilot-journeys` on a second instance of the same build |
| 6.2 | The same in GitHub's CI | PASSED | job `pilot-journeys` on the exact head `f2fffb7` (also green at `6a71cb9`), on PostgreSQL 16 and 17: `single-company-smoke` and `flag-off-round3` pass |

### 7. Intermittent restore-journey failure (`docs/saas/evidence/round4/restore-repeat/SUMMARY.md`)

| # | Check | Status | Evidence |
|---|---|---|---|
| 7.1 | The journey recorded the HTTP response of every failing step, and was repeated 15 times on one stack before any fix | PASSED (done) | 2 of 15 runs failed (7 and 9); in three runs beta ended with fewer rows than alpha |
| 7.2 | **Cause of the failures seen in runs 7 and 9** | **ESTABLISHED** | the contract step builds the invoice id as `inv-<ms>` and line-item ids as `item-<ms>-<n>`; two contracts built in the same millisecond collide and the second request answers **HTTP 500 `duplicate key value violates unique constraint "invoices_pkey"` / `"invoice_items_pkey"`**. The stack's log holds exactly those two errors. Reproduced on demand: 14 of 72 simultaneous contracts failed with that body (`concurrent-contracts-BEFORE-fix.txt`) |
| 7.3 | Fix: the invoice id, the line-item ids and the invoice-created customer id carry a random 48-bit suffix | PASSED | `concurrent-contracts` (now 10 checks: also one activity-log row, one project row and one vault document per contract): 72 of 72 simultaneous contracts succeed, every invoice exists once with its items, none crosses a company. **A defect in code that production also runs: backport PR #114 (draft, not merged)** |
| 7.4 | The restore journey repeated after the fix, at the final commit | PASSED | 15 of 15 (`restore-repeat-final/`), plus 15 of 15 of `concurrent-contracts`; before the fix 2 of 15 restore runs failed. 15 clean runs do not prove the absence of other collisions (7.6, 7.7) |
| 7.5 | That the single failure of the **previous** round ("a document upload did not return an id") was this same collision | **UNRESOLVED** | its HTTP response was not recorded; plausible, not shown; none of the 100+ concurrent fills run this round reproduced it |
| 7.6 | One row missing in run 8 without any failed check, and no matching error line | **EXPLAINED BY A REPRODUCED MECHANISM; run 8 itself not proven** | `round5/row-loss/README.md`. The verification compared digests before/after a restore, which were sound; **nothing checked the fill**. The activity-log (`log-<ms>`), project (`project-<ms>`) and invoice-vault document (`doc-<ms>`) inserts used clock-only ids and **ignored the database's answer**, so a same-millisecond clash dropped the row with HTTP 200 and no log line (a lost project also loses its `payments` row). Hunt: 30 simultaneous-fill rounds on the previous build: **10 table mismatches** (payments 3, projects 3, activity_logs 2, customer_documents 2); 72 simultaneous contracts x3 lost 5, 8 and 7 rows silently. After the fix: 40 rounds **0 mismatches**, 5 x 72 contracts nothing lost. Which table run 8 lacked was not recorded, so that run stays unproven |
| 7.6a | **Restore verification at row level** (round 5): primary keys and a content hash of every row of every table, and every object, before the damage / after the damage / after the restore, for alpha, beta and the founding company; a missing, added or changed row fails and is named; the two identically filled companies must hold equal row counts in every table; content checks of what the fill wrote; negative controls (one changed, one deleted, one added row of beta are each named) | PASSED | `company-restore` (61 checks incl. `ROW-COMPARE` lines), `companyRowSnapshot.test.ts`. Original failing evidence kept in `round4/restore-repeat/` |
| 7.7 | **Customer-code collision** (HTTP 500 `duplicate key ... "customers_customer_code_idx"`): codes are random; the check ran through the company-restricted client, which cannot see other companies' customers, while the unique index spans all companies | FIXED | existence check uses the unrestricted client (round 4, `customer-code-collision.txt`) **and, since round 5, the insert itself is collision-safe**: on exactly that unique violation a new code is drawn and the insert retried, at most 5 attempts (`insertWithUniqueCustomerCode`, every customer insert; registration no longer inserts a customer without a code on a duplicate message). **Proof with forced real collisions** (a trigger in the scratch database rewrites the code to one another company owns): journey `customer-code-collisions` 19/19 - 1, 2 and 4 forced collisions succeed with a new code and exactly n+1 attempts; more than the bound fails in a controlled way (HTTP 409) after exactly 5 attempts with no orphan row; **30 simultaneous requests of two companies** each forced 1-3 times all succeed with 30 distinct codes; the invoice route too. **Against the previous bundle: 6 of 19 pass** (`round5/customer-code/`). Unit: 6 tests incl. 40 simultaneous callers |
| 7.8 | **CI failure, not a flake**: `browser-pilot-round4` failed the same check on PostgreSQL 16 and 17 at `2cc47bf` ("warning gone" after saving a bank account) while two local runs passed | FIXED, reproduced | the settings screen said "saved" before it re-read the list, so the "unsaved changes" warning showed beside it; reproduced by making the re-read slow (the check failed), fixed by re-reading first (passes); the journey now asserts it at the moment the notice appears |

| 7.9 | Other silent row losses of the same class | FIXED for the three found; others REMAIN | see CG15 for the full list of clock-only ids still in the code |

### 8. Carried over from round 3 (statuses re-checked on this head)

| # | Check | Status | Evidence |
|---|---|---|---|
| 8.1 | Invoice issuance snapshot (bank accounts and terms frozen at issue; reprints preserve them; legacy invoices labelled, not back-filled; backend works before `t6`/`t7`) | PASSED | `pilot-round3` A, `compat-before-t6-t7`, DB test 15/15 |
| 8.2 | Local QR codes (no third-party service), decode-tested | PASSED | `localQr.test.ts`; phone scan and QR inside a Chromium PDF remain UNTESTED |
| 8.3 | The two-company journeys on **PostgreSQL 16** | PASSED | all 16 journeys locally on 16.15 (`postgres16/`) and in CI on 16 and 17 on the exact head `f2fffb7` |
| 8.4 | Subscription expiry enforced on every request (not by a job); renewal effective within seconds | PASSED | `pilot-round3` E |
| 8.5 | Delivery, warranty and handover documents carry no Sunchaser identity; quote-editor defaults neutral | PASSED | `documentLeak.test.ts` |
| 8.6 | Delivery / warranty / handover **flows** with two companies | FAILED (not possible) | the code writes `delivery_challans.created_by_user_id`, which no SQL in the repository creates; group disabled for pilots (Part C, PA2) |
| 8.7 | `server.ts` typecheck with a recorded baseline | PASSED | 21 existing errors, none new (`npm run typecheck:server`) |
| 8.8 | Real-schema / SaaS migration rehearsal on a restored production backup | **UNTESTED** | no restored backup (Part C, PA1). Synthetic rehearsal of t1 to t7: 0 failures |
| 8.9 | Operator onboarding, manual subscriptions, plan limits, operator audit | PASSED | `platform-onboarding` |
| 8.10 | Company export/restore leaves every other company and the founding company byte-identical | PASSED | `company-restore` |

### 9. Isolation independent of the feature flag (round 6; `docs/saas/evidence/round5/final-rc/`)

Found by round 5's own measurement: with the flag off and pilot data present, the single-company code path (no company filter) let founding staff read the pilot's data. Closed by `server/saas/tenantIsolationGuard.ts`: a process that is not in multi-company mode asks the database at start and every 5 s whether any company other than the founding one exists; if one does, or if it cannot find out, it serves nothing (503 `tenant_isolation_unavailable`) and the unfiltered database client is not handed out.

| # | Check | Status | Evidence |
|---|---|---|---|
| 9.1 | Flag off + pilot data present: 100+ requests by a founding administrator, a pilot administrator, a pilot portal customer and no session (sessions issued earlier by the flag-on process included): reads, searches, exports incl. the whole-database backup, PDFs, file downloads (signed link, authorised route, /uploads), writes, sign-in, the WhatsApp webhook: **every one answered 503, no body contained any company's data** | PASSED | `tenant-isolation-guard` (30/30), `feature-disable-reenable` (8/8) |
| 9.2 | Nothing was read or written while paused: row counts of eight tables and a hash of every stored object are identical afterwards; no write probe exists | PASSED | same |
| 9.3 | Application restart with the flag still off: earlier founding and pilot sessions are still refused | PASSED | same, step C |
| 9.4 | Flag on again: sessions issued before the pause work; each company sees only its own leads; writes land in the right company; PDF and file download work; cross-company read refused | PASSED | same, step D |
| 9.5 | Cannot verify (database unreachable) => paused, `reason: unverified`; no unfiltered query, no local-file fallback | PASSED | same, step E; `tenantIsolationGuard.test.ts` (throwing, hanging, stale probe) |
| 9.6 | Schema rollback t8..t3 with pilot data present: a flag-off process is still paused; rolling back t1 is refused | PASSED | same, step G; `rollback-files-quota` |
| 9.7 | Removing the pilot companies: the same running flag-off process resumes by itself; the founding administrator's earlier session works and shows founding data only; the removed company's session does not | PASSED | same, step F |
| 9.8 | **Missing company context never falls back to unrestricted queries**: flag on without a company context throws; flag off with a closed guard throws even for a founding-company context; "database configured" stays true so nothing falls back to the local JSON file | PASSED | `dbClientSelection.test.ts` (6/6) |
| 9.9 | **An older backend against a tenant-populated database: MEASURED, no isolation** (the repair build showed the pilot company's lead to a founding administrator). Not a supported state; not recommended | PASSED (as a measurement) | `tenant-isolation-guard` step H, `OBSERVED:` line |
| 9.10 | **Limits, not covered**: processes without the guard (older backends, scripts, the marketplace cron service, SQL clients); a pilot whose `companies` row was deleted by hand; up to 5 s (20 s if checks fail) between a first pilot company appearing and a running flag-off process noticing; no dedicated maintenance screen in the web app | KNOWN LIMIT | `docs/ops/COMBINED_DEPLOYMENT_AND_ROLLBACK.md` section 4 |
| 9.11 | t5 audit sequence: rollback, re-apply, new audit insert; again a second time; **negative control** (migration without the repair collides with `duplicate key`) | PASSED | `test-subscriptions.sh` 51/51 on PostgreSQL 17 and 16; `rollback-files-quota` onboards a company after the full cycle |

### Final verification (fresh clone of `f6aff15`)

| Run | Result |
|---|---|
| Focused flag-off isolation journeys (PG17) | `feature-disable-reenable` 8/8, `tenant-isolation-guard` 30/30, `single-company-smoke` 12/12, `flag-off-round3` 18/18 |
| Unit tests (`test:saas`) / server typecheck | 169/169 / no new errors |
| Full journeys PostgreSQL 17 / 16 | 22 of 22 pass / 22 of 22 pass |
| Deployment matrix, 13 states x 2 backends (invoice-numbering regression included) | PG17 and PG16 pass; every cell 9/9; the informational gap row: NEW 9/9, REPAIR 4/9 (the old counting rule; documented) |
| DB tests (migrations, numbering, snapshot, subscriptions, reservations, runner) | PG17 and PG16 exit 0 (runner test 44/44) |
| Repeats on PG17 | company-restore 15/15, concurrent-contracts 15/15, customer-code-collisions 15/15, storage-two-instances 15/15, rollback-files-quota 5/5, tenant-isolation-guard 5/5 |
| The original unexplained restore deficit (run 8) | **Listed separately and unchanged: UNRESOLVED.** Explained by a reproduced mechanism (clock-based ids), not proven to be the cause of that run; the 15/15 repeat above is not evidence about run 8 |

A defect found on the way, in tests only: an interim full run (on `adb2337`) failed in `rollback-files-quota` because the seed cleanup left payment-ledger rows naming removed companies, and the t5 re-apply then failed on the foreign key. Cleanup fixed (`f6aff15`); the run above is after the fix. CI at the exact head is recorded in the PR description.

## Part B. Code gaps (could still be done in this repository)

Closed in v1.1: **CG1** (the storage decision is now atomic across processes), **CG3** (browser steps for the limit and the per-lead design tools exist), **CG16** (the customer-code insert is retried). Their rows are removed; see the change list.

| # | Gap | Why it matters |
|---|---|---|
| CG2 | Images embedded as text in database records (quotation page images, installation-photo rows) are not counted | each request is bounded by the 15 MB body limit, the total is not |
| CG4 | A company restore bypasses the storage guard (it restores what the company had) | intended, but means usage can exceed a lowered limit afterwards |
| CG5 | Sunchaser wording on pilot staff screens. **Found so far (exact strings):** the Accounts workspace ("Sunchaser Accounts", "Sunchaser Energy Systems"; for a Sales Manager also "Sunchaser Central Accounting: Excel Integration Enabled"); the quotation workspace heading "SUNCHASER CRM & GENERATIVE PROPOSAL DECK" and the template name "Sunchaser Official Proposal Template"; the default quotation line label "Drafted Sunchaser Quote" shown on a lead | the portal and the welcome guide are done; the crawl is shallow, so this is a floor, not a full list |
| CG6 | Invoice company name, address, logo and signature follow current settings; only bank accounts and terms are frozen | as requested, a known limit |
| CG7 | No company price book; AutoSizer and the design tools are off instead | pilot companies cannot quote with the AutoSizer |
| CG8 | The legacy-invoice label is not visible on the page or in the staff screen | by design, for tooling only |
| CG9 | No usage display for the operator | |
| CG10 | Settings are saved as a whole list with no version check | two simultaneous editors: last save wins |
| CG11 | 21 pre-existing `server.ts` type errors (classified in the round-3 report) | none introduced here |
| CG12 | Guest landing and public pages remain Sunchaser's (public intake is the founding company by design) | a visitor of the platform's address sees Sunchaser's public site and "Solar Consultant Wizard" |
| CG13 | `CustomerPortal.tsx` (not imported anywhere) still has Sunchaser text; the customer "View welcome guide" button does nothing (existing behaviour) | dead or inert code, left alone |
| CG14 | A company with no contact details prints bare icons in the invoice header | cosmetic |
| CG15 | **Other row ids are built from the clock alone and were not changed** (the three that were proven to lose rows, and the invoice/line/customer ids, are fixed). Remaining, by file: `server.ts` `wa-<ms>`, `PO-<last 4 digits>`, `project-<ms>` (accept-quote path), `ORD-`/`NT-`/`WAR-` (last 6 digits), `CLM-` (last 4), `lead-manual-<ms>`; `inventoryFoundationDb.ts` `inv-<ms>`, `SKU-<ms>`; `projectFinanceDb.ts` `fin-`, `wa-`; `projectDeliveryDb.ts` `pd-`, `inst-pd-`, `cw-pd-`, `pie-`, `pip-`, `pdu-`; `deliveryManagementDb.ts` `dch-`, `dcp-`; `projectCompletionDb.ts` `pcm-`; `roleManagementDb.ts` `role-`; `dbManager.ts` 25 more (`wc-`, `ticket-`, `svc-req-`, `care-`, `visit-`, `eq-`, `asl-`, `tju-`, ...); `internalCostingDb.ts` `cost-`, `invr-`, `pur-`; `userAuthDb.ts` `u-<ms>`; payments `pay-<ms>` / `pay-init-<ms>` in `invoiceDb.ts` | the same collision, and for inserts that ignore the database's answer the same **silent loss**, is possible wherever two are built in one millisecond; the 4- and 6-digit ones repeat every 10 seconds / 17 minutes. Most are staff-run one at a time or in modules that are off for pilots, so none was exercised. Whether any of them also ignores the insert's answer was not checked |
| CG17 | The 402 "over the limit" message in the uploader also offers **Retry upload**, which cannot succeed until space is freed | cosmetic |
| CG18 | The pilot quotation workspace, pilot logins and other screens were opened for the checks above only; no full crawl of every screen of every role | what is listed as PASSED is what the journeys opened |

## Part C. Production-access gaps and owner decisions (cannot be closed from here)

| # | Gap | What closes it |
|---|---|---|
| PA1 | **Rehearsal on a restored production backup** (item 10): the real `bills` definition and the owner's invoice-number floor were not assumed | the owner returns a restored backup (`~/sunchaser-rehearsal-RETURN.txt`) and states the floor |
| PA2 | Whether production has `delivery_challans.created_by_user_id` and the other columns the delivery code writes | read-only query by the owner or a production-schema dump |
| PA3 | Behaviour against the **production object store**: signature checking, listing page size, latency, the real timeout of the 8-second listing guard, and **whether its listing includes every object whose write has completed** (the cross-process storage accounting assumes read-after-write listing; a lagging listing could let a burst overshoot by the lag window); and the real number of server processes (the accounting is now correct for any number, but only two were tested) | a staging run with production-like credentials and topology |
| PA3a | **Migration t8 must be applied before the backend that needs it** (otherwise pilot-company uploads are refused as retryable "could not verify"); the migration sends `NOTIFY pgrst, 'reload schema'`, and a PostgREST that does not listen for it needs a restart (found when a stale schema cache made the function "missing") | the deployment, in order: t8, then the backend |
| PA3b | **Backports to production**: PR #114 (invoice, line and invoice-customer ids) and PR #115 (customer-code insert retry), both draft and **not merged**; production has both defects in its code today. Whether either has ever happened in production is unknown (no production data read). A third candidate is described in 7.6 / CG15 (silent loss of activity-log, project and vault-document rows) | the owner's decision to review and merge |
| PA4 | PostgREST / tenant-key / environment rollout on the real platform, and the PostgreSQL version actually in production (CI covers 16 and 17) | the deployment, which is not part of this work |
| PA5 | Real devices: a phone scanning the printed QR; the Android/iOS app with a multi-company sign-in | a device test |
| PA6 | Real WhatsApp (Meta), Google review, e-mail delivery | accounts that were not used |
| PA7 | The plan: grace days (default 3), read-only versus blocked after expiry, **storage limit values**, plan limits and prices | owner decision |
| PA8 | **Whose privacy policy and account-deletion page** apply to a pilot company's customers (D4) | owner / legal decision |
| PA9 | Shared-database approval, the AutoSizer price book decision, the re-printed founding invoices decision (frozen versus current bank details) | owner decisions carried from round 2 |

## Evidence

`docs/saas/evidence/round5/` (this version): `customer-code/` (the forced-collision journey before and after), `storage/` (the two-process journey after, and before = the per-process design), `row-loss/` (README, before/after logs of the silent row loss, the 30-round and 40-round parity hunts), `screens/` (browser journey screenshots), and the final runs `final-pg17/`, `final-pg16/`, `repeats/` (15 restore, 15 concurrent-contracts, 15 customer-code, 5 two-process storage). `docs/saas/evidence/round4/` is unchanged (including the original failing restore runs `restore-repeat/`).

## Shortest path to a paid pilot

Nothing below is a new feature. Order matters; the first three are the only ones that can stop a launch.

| Step | Who | What | Closes |
|---|---|---|---|
| 1 | Owner | Return a restored production backup and state the invoice-number floor; the rehearsal (t1 to t8 apply, roll back, re-apply, journeys on the restored copy) is then one command | PA1, 8.8 |
| 2 | Owner | Answer whether production has `delivery_challans.created_by_user_id`; if not, the delivery group simply stays off for the pilot | PA2 |
| 3 | Owner | Decide the pilot terms the code now needs: storage limit per company, grace days, read-only versus blocked, whose privacy policy applies, who the pilot companies are | PA7, PA8 |
| 4 | Owner | Review and merge the two backport PRs (#114, #115) on their own, and decide about the third class (silent row loss, CG15) | PA3b |
| 5 | Engineering (small) | Replace "Sunchaser" in the places listed in CG5 | CG5 |
| 6 | Owner + engineering | A staging run with production-like credentials, apply t8 before the backend, check the production object store's listing behaviour, then the same journeys against it | PA3, PA3a, PA4 |
| 7 | Owner | Take payment manually (the platform records manual payments and enforces expiry; no payment gateway is built or needed for a first pilot) and onboard the first company through the operator console, which requires a storage limit | |

Not on the path, deliberately: a company price book, the delivery flows, the design tools and the AI assistant (all stay off for pilots), a usage display for the operator.

## Change list: v1.0 (2026-10-14) to v1.1 (2026-10-15)

| Item | Change |
|---|---|
| 1.5a (new), CG1 closed | storage decision atomic across server processes (migration t8); two real processes tested; the previous design fails the same journey |
| 1.9, 2.3, CG3 closed | browser + API journey for the storage limit and the per-lead design tools; two Auto Sizer controls found and gated |
| 7.6 | from UNRESOLVED to "explained by a reproduced mechanism" (silent row loss: log, project, vault document, payments); run 8 itself still not proven |
| 7.6a (new) | restore verification at row level, with negative controls |
| 7.7, CG16 closed | customer-code insert is collision-safe, proven with forced real collisions and 30 simultaneous requests |
| 7.9, CG15 | list of the clock-only ids that remain, by file |
| PA3, PA3a, PA3b (new) | listing consistency assumption; t8 before backend and PostgREST reload; backport PRs #114 and #115 |
| CG5, CG17, CG18 (new/extended) | wording found, retry button on a refusal, crawl depth |
| Version 1.0 | kept unchanged as `PILOT_ACCEPTANCE_CHECKLIST_v1.0.md` |

### Round 6 additions (same version 1.1, before the freeze)
* Section 9 (isolation independent of the flag) added; **the feature flag is a switch, not a rollback**, and with pilot data present switching it off pauses the founding company too (`COMBINED_DEPLOYMENT_AND_ROLLBACK.md` section 4 rewritten). An older backend on a tenant-populated database is not a supported state.
* Fixed: CI typecheck failure on `1d2acd4` (a narrowing error in `storageQuota.ts`); quota double-count re-measure; t5 audit-sequence proof with negative control; seed cleanup of platform ledger rows.
* CI on `b1b37fd` failed one job (`docker-suites (PostgreSQL 16)`, suite `test:saas-db`) while PostgreSQL 17 passed on the same code. Cause, reproduced locally (1 run in 3 on PostgreSQL 16): the negative control of `test-storage-reservations.sh` ("without the lock the same race admits more than the limit") depended on process start-up timing and sometimes saw no race. It tested nothing about the function under test, which is unchanged. The control now sleeps between check and insert so the race is certain (40 of 40 admitted in every run). Not a product defect; it had passed in earlier CI runs by luck.
