# SaaS pilot, round 3: pilot scope completed or honestly reported, and the acceptance checklist

Branch `claude/saas-pilot-multi-company` (PR #113, draft, stacked on #111). **Production is unchanged.** Nothing here was applied to production or to real data; no merge, tenant migration, deployment, credential change or app release was done; production schema and data were not read. Everything below ran on disposable local stacks (PostgreSQL 17.11, PostgREST 16.4, an S3 stand-in, Chromium) with synthetic data, and once more on GitHub's runners (PostgreSQL 17 service container, the pinned PostgREST image).

How to read this: **PASSED** = executed here and the result is in `docs/saas/evidence/round3/`. **FAILED** = executed and did not meet the requirement. **UNTESTED** = not executed (inspected, or not reachable). **NOT BUILT** = a decision to leave it out, stated. Nothing is called tested that was only inspected.

## 1. Pilot acceptance checklist

### Item 1: company-admin settings (branding, bank accounts, terms, prices, audit history)
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 1.1 | Administrator edits branding in a real browser; the header updates at once and survives a reload | PASSED | browser journey 19/19 (`browser-pilot-round3.txt`, screenshot `r3-04`) |
| 1.2 | Administrator adds and saves a bank account, terms, price settings from the screen | PASSED | same journey; API journey reads them back |
| 1.3 | Editing or deleting an EXISTING bank-account row from the screen | UNTESTED | the browser journey adds a row; replace-the-list semantics are tested through the API (`pilot-round3.txt` F) |
| 1.4 | Equipment price book per company | NOT BUILT | see item 2 |
| 1.5 | A non-administrator is refused every change and the history by the API (403), and nothing changes | PASSED | API journey F (10 checks) |
| 1.6 | A non-administrator sees the screen read-only in the browser (notice, disabled fields, no History tab) | UNTESTED | the screen implements it, but no role that is not an administrator reaches the Admin area in the seeded users; only the API refusal is proven |
| 1.7 | Every change writes an audit row (who, role, when, section, before and after) | PASSED | API journey F; DB test 16/16; browser history table shows 4 rows, newest first |
| 1.8 | The history is per company; one company never sees the other's | PASSED | API journey F |
| 1.9 | The history cannot be edited or deleted, even by the database owner | PASSED | `test-company-admin.sh` and API journey F |
| 1.10 | The screen shows before/after values | FAILED (gap) | the API returns them; the screen shows the one-line summary only |

### Item 2: AutoSizer
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 2.1 | AutoSizer presets (read and write), its PDF and saving an AutoSizer quote are refused by the API for a pilot company (404 / 403 `module_disabled`); a manual BOQ quote still works | PASSED | API journey C |
| 2.2 | The boot payload tells the interface the module is off; the Auto Sizer tab is not offered to a pilot company's sales user | PASSED | API journey C; browser journey |
| 2.3 | The "AutoSizer Presets" sub-tab of the admin settings is hidden for pilot companies | UNTESTED | hidden in code (`AdminApp.tsx`), not opened in the browser |
| 2.4 | The founding company keeps AutoSizer in the API; with the flag off nothing changes | PASSED | API journey C (founding 200); `flag-off.txt` |
| 2.5 | A company price book | NOT BUILT | **Decision:** the AutoSizer prices from Sunchaser's own rates; a price book is a larger design (price-list ownership, units, currency, versioning). The module is disabled for pilots instead, so Sunchaser prices are never used silently for another company. |
| 2.6 | Other places that use the static equipment catalogue (interactive proposals, Proposal Studio, Roof Studio, the public Smart Quote builder) | UNTESTED, NOT GATED | known gap: not audited or gated this round. The public builder is Sunchaser's own public page and runs as the founding company by design. |

### Item 3: branding
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 3.1 | Sign-in screen is the platform's ("Sunchaser Sync"): no Sunchaser company name, tagline, logo image or footer | PASSED | browser journey, screenshot `r3-01` |
| 3.2 | Company-selection screen says "Sunchaser Sync" and lists companies by their own names | PASSED | browser journey, screenshot `r3-02` |
| 3.3 | Inside a pilot company's workspace the header shows the company's own name (or the neutral words "Your company"), footer "Powered by Sunchaser Sync", no Sunchaser name or logo | PASSED | browser journey, screenshot `r3-03` |
| 3.4 | A company that HAS a logo shows it in the header | UNTESTED | no logo was set in the journey; the no-logo path (name only, never Sunchaser's logo) is tested |
| 3.5 | Every other screen a pilot company's staff or customers see is free of Sunchaser wording | FAILED / NOT AUDITED | known remaining: guest landing and public pages (Sunchaser's own, by design), the customer portal ("My Sunchaser Home Portal"), many component texts. Only the header, footer, navigation labels and the screens the journeys open are asserted. |
| 3.6 | The founding company's screens are unchanged (header, Learning Studio, WhatsApp, Project Delivery, "Sunchaser AI Assistant") and a flag-off deployment keeps the Sunchaser sign-in | PASSED | browser journey; `flag-off.txt` (`platform-info` says single-company) |

### Item 4: invoice issuance snapshot
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 4.1 | Migration `t6`: additive, idempotent, write-once (no set, replace or clear after insert), shape enforced, rollback keeps every invoice | PASSED | `test-invoice-snapshot.sh` 15/15 |
| 4.2 | A new invoice stores the bank accounts and company terms in force at creation; nothing of another company or Sunchaser is in it | PASSED | API journey A (both companies) |
| 4.3 | After the company changes its bank account and terms, the OLD invoice reprints with the old ones and a NEW invoice with the new ones | PASSED | API journey A |
| 4.4 | An invoice's own terms text still wins; editing an invoice keeps its snapshot byte-for-byte; the database refuses a change | PASSED | unit test, API journey A |
| 4.5 | Legacy invoices (created before): not back-filled; print from current settings and are labelled `legacy_current_settings` (response header and a comment in the HTML) | PASSED | DB test (stays NULL, cannot be filled later), API journey A. **Gap:** the label is not shown on the printed page or in the staff screen, by design (it would change every old invoice); it is for API and tooling. |
| 4.6 | The backend works on a database WITHOUT `t6`/`t7` (deploy order: backend before migration) | PASSED | `compat-before-t6-t7.txt` 9/9 (migrations rolled back, checked, re-applied) |
| 4.7 | Only bank accounts and terms are frozen on an invoice (not company name, address, logo, signature) | PASSED as scoped, GAP | as requested; the company identity on an invoice still follows the current settings |
| 4.8 | A FOUNDING-company invoice created with `t6` applied: the snapshot holds what the template prints today (the three default accounts) | PASSED (observed) | `flag-off.txt`: snapshot stored in single-company mode once `t6` is applied; the existing "second normalisation drops the accounts" behaviour is preserved, not fixed |

### Item 5: QR
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 5.1 | QR codes are generated locally (no third-party service) and decode to exactly the text, including non-ASCII | PASSED | `localQr.test.ts` 3/3. A first version failed to decode non-ASCII text (a company name in Urdu would have produced an unreadable QR); fixed with UTF-8 byte encoding. |
| 5.2 | Invoice, delivery challan, delivery certificate, delivery verification page and the review QR use the local generator; a test fails if any source references a QR service again | PASSED | unit tests; API journey B |
| 5.3 | The printed invoice references only one external host: Google Fonts (existing, unchanged) | PASSED (observed) | API journey B. The QR and its text never leave the server or browser; the fonts request still goes to Google. |
| 5.4 | A phone camera scanning a printed or on-screen QR | UNTESTED | decoded by an independent software reader (`jsQR`), not by a phone |
| 5.5 | The QR inside a Chromium-rendered invoice PDF | UNTESTED | the PDF journey renders quotations and invoices but does not decode the QR image |

### Item 6: delivery challans, warranties, handover, quote-editor defaults
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 6.1 | The four document layouts (challan, delivery certificate, warranty certificate, handover) carry no Sunchaser name, logo, link, policy text, and use the company's own name | PASSED | `documentLeak.test.ts` 5/5, with a negative control (the test fails on the previous code); the founding company's output is unchanged |
| 6.2 | Quote-editor defaults (company profile, CEO message, why-choose-us, vision, mission) make no Sunchaser claims for another company | PASSED | same test; those five blocks are a heading only for a pilot company |
| 6.3 | The delivery / warranty / handover flows work with two companies and keep their data apart | FAILED (not possible) | **Finding:** creating a delivery challan fails on a database built from this repository's own schema scripts: the code writes `delivery_challans.created_by_user_id`, a column no SQL file creates (production may or may not have it; the preflight does not check). The error had been reported as "tables are not ready" for any message naming the table; that masking is fixed. |
| 6.4 | The unfinished group (deliveries, challans, certificates, project completion and handover, customer warranties and claims, technician delivery routes) is refused by the API and hidden in the interface for pilot companies | PASSED | 17 endpoints all answer 404 `not_available` for both companies and none is refused for the founding company (API journey D); a unit test fails if a route with these words is added without being gated; browser journey (navigation) |
| 6.4b | The WhatsApp inbox API (`/api/inbox`, `/api/conversations`) is founding-only and its navigation entry hidden | PASSED for the rule (unit test) and the navigation (browser); the endpoints themselves were not called as a pilot company |
| 6.5 | Learning Studio, WhatsApp connection and marketplace entries hidden for pilot companies (their routes were already founding-only) | PASSED | browser journey |

### Item 7: subscription expiry and storage limits
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 7.1 | Expiry is enforced on every request, not by a job: past the end date plus a grace period (default 3 days, `SAAS_EXPIRY_GRACE_DAYS`) the company can read and print but every write is refused with 402 `subscription_expired`; nothing is written | PASSED | unit tests 14/14; API journey E |
| 7.2 | Inside the grace period everything works and the response says so (`X-Subscription-State: grace`); suspended or cancelled subscriptions are blocked | PASSED | unit tests; API journey E (blocking already existed through the company status) |
| 7.3 | The operator can renew an expired company and it works again within seconds, without a restart | PASSED | API journey E (5-second cache) |
| 7.4 | The founding company and a company with no subscription are never limited; staff can still sign in while expired | PASSED | API journey E |
| 7.5 | Read-only mode refuses writes by HTTP method; a POST that only reads would also be refused | KNOWN LIMIT | not enumerated |
| 7.6 | Storage limit (`saas_plans.max_storage_mb`, per-company override): a write that would exceed it is refused (402 `storage_limit_exceeded`) and leaves nothing behind; a fitting write is accepted; stored files and reading are never affected; limit 0 refuses every new write; raising the limit works | PASSED | API journey E (the stand-in store's files were counted from disk before and after) |
| 7.7 | The limit is a commercial control, not a security boundary: usage is cached for 60 s and reserved per write, it FAILS OPEN when the limit or the usage cannot be read, and concurrent uploads on different servers can overshoot by the size of the uploads in flight | KNOWN LIMIT | by design, documented in `server/saas/storageQuota.ts` |
| 7.8 | The guard sits in the single function every object write goes through; only the customer-document upload route was exercised end to end | PARTLY UNTESTED | the other write paths (generated PDFs, quote assets) are covered by the same function but not exercised; they would answer 500 with the message, not 402 |
| 7.9 | Usage shown to the operator | NOT BUILT | the console shows the limit, not the bytes used |

### Item 8: CI
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 8.1 | A CI job runs the main two-company journeys (10 journeys: API, PDF, restore, browser) on a real stack | PASSED | job `pilot-journeys` on `b185075`: all 10 journeys passed on GitHub's runner (PostgreSQL 17, pinned PostgREST image, Chromium) |
| 8.2 | `server.ts` typecheck, separately, with the existing errors recorded and reported | PASSED | `npm run typecheck:server`; **21** errors exist (see section 3); a NEW error fails the job |
| 8.3 | The PostgreSQL 16 variant of the journeys | UNTESTED | the journey job runs PostgreSQL 17; the DB suites run on 16 and 17 |
| 8.4 | Flag-off equivalence in CI | UNTESTED in CI | run locally (`flag-off.txt` 12/12 and 11/11); the CI stack runs the flag on |

### Item 9: unexplained intermediate CI failures
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 9.1 | Cause of runs 17 and 19 (both only the PostgreSQL 16 docker job) | PASSED (found) | **Docker on the runner failed to publish a container port** ("failed to set up container networking … driver failed programming external connectivity") when a marketplace suite started its own `postgres:16-alpine` container: run 17 in two suites, run 19 in a third. Not related to SaaS code. `ci-failures-runs-17-19-25.txt`. |
| 9.2 | Fix | PASSED (tested with a fake suite) | the suite runner re-runs a suite up to twice, loudly, ONLY on that exact error text; the first attempt's log is kept and the summary names the re-run; any other failure, and a repeated one, fails as before |
| 9.3 | Run 25 (`a7a5aee`) failed both docker jobs | PASSED (found and fixed) | my own new migrations changed the migration-runner test's expected lists (t5 → t7); fixed in `b185075`; not a flake |
| 9.4 | Reading the artifacts of those runs | UNTESTED | the artifact host is blocked by this session's network policy; the cause above comes from the job logs, which did show the suite output |

### Item 10: real-schema and SaaS migration rehearsal
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 10.1 | Rehearsal on a RESTORED PRODUCTION BACKUP | UNTESTED | no restored backup is available (`~/sunchaser-rehearsal-RETURN.txt` does not exist). The real `bills` definition and the owner's invoice-number floor were **not assumed**. |
| 10.2 | The rehearsal script covers all seven tenant migrations (t1 to t7), rolls them back to the identical state and applies them again | PASSED on a SYNTHETIC copy only | `saas-rehearsal-synthetic-t1-t7.txt`: 0 failures. The run found two things in the script (the fingerprint compared the new `invoices.issuance_snapshot` column and the new history table); both fixed. |

### Standing constraints
| # | Check | Status |
|---|---|---|
| S.1 | Production not changed: no deployment, tenant migration, merge, credential change, app release, or read of production data or schema | PASSED (nothing of the kind was done) |
| S.2 | No secrets committed; journeys generate throw-away secrets | PASSED (checked by `git status`/diff review; no secret scanner was run on the whole branch) |

## 2. Commits (this round)

| Commit | Items | What it does |
|---|---|---|
| `a1e2004` | 2, 5, 6 | Local QR generation (`qrcode-generator`, UTF-8, decode-tested, dev dependency `jsqr` for the test); AutoSizer disabled for pilot companies (API scope policy + handler + interface); challan, delivery certificate, warranty, handover and quote-editor defaults neutral; leak tests |
| `c6b3e45` | 4, 6 | `t6` invoice issuance snapshot; after-sales group disabled in API and interface; delivery "not ready" no longer hides other errors; journey (snapshot, QR, AutoSizer, gate) |
| `cfbf792` | 7 | Subscription expiry at request time; storage limit; `t7` (plan storage limit column, append-only settings history); journey 69/69 |
| `0ed8862` | 1, 3, 6 | Company settings screen and audit history API; "Sunchaser Sync" sign-in and company selection; company branding in the workspace; modules hidden in the interface; browser journey 19/19, API journey 89/89 |
| `a7a5aee` | 8, 9, 10 | CI job `pilot-journeys`, `server.ts` typecheck and baseline, Docker-networking re-run, rehearsal script for t1 to t7, deploy-order journey |
| `b185075` | 8, 9 | Runner-test expectations for t6/t7 (cause of both docker-suites failures at `a7a5aee`); journeys no longer depend on the scratch stack's secrets; reliable cleanup of the stack runner |

## 3. `server.ts` typecheck: the existing errors, reported honestly

`npm run typecheck` (`tsc --noEmit`) does not include `server.ts` (tsconfig lists `src/` and `server/` only). `tsconfig.server.json` now does, and `scripts/ci/check-server-typecheck.mjs` compares the result with the recorded baseline (`scripts/ci/server-typecheck-baseline.txt`, line and column numbers dropped). **21 errors exist; none was introduced by this round** (the same 21 at `3d1d4e6`). Round 2 said 17; that figure did not reproduce (measured 21 at both heads).

| Kind | Count | What it is |
|---|---|---|
| A field read on a union whose `ok: true` branch lacks it (`status`/`error`/`reason` on `AutoSizerPresetsAuthResult`, `WebsiteCatalogAuthResult`, `DesignSessionValidation*`, a signed-link result) | 12 | the narrowing is lost because the project is not in strict mode; probably harmless at run time, not proven for each |
| `Record<string, unknown>` / `Database` conversions | 3 | typing mismatch |
| `PgClient.end` missing on a type (`productionCleanupDb.ts`) | 2 | typing |
| `ExportAccessMode` not assignable to a narrower type | 1 | typing; includes `"deny"` |
| `number \| "archived" \| "draft"` passed as `number` | 1 | possibly a real defect (a status reaching a numeric parameter); not investigated |
| `archivePdf` not in `ProductionInboxWiringDeps` | 1 | excess property; possibly a real defect |
| comparison of `"manual" \| "preview"` with `"sizer"` | 1 | an unreachable branch |

Nothing was changed to make this look better; the job fails only on new errors.

## 4. Defects found by the new tests (reproduced first)

| Defect | Found by | Fix |
|---|---|---|
| A QR code for text containing non-ASCII characters (an Urdu company name) decoded to nothing | the decode test | UTF-8 byte encoding |
| The delivery module reported every error naming a delivery table as "tables are not ready" | the challan journey | only a missing table is reported that way |
| A delivery challan cannot be created on a database built from the repository's schema scripts (`created_by_user_id`) | the challan journey | module disabled for pilots; **owner to say whether production has that column** |
| The migration rehearsal fingerprint compared columns added by the new migrations | the rehearsal on the synthetic copy | the script ignores them |
| Journeys read a hard-coded scratch-stack file for the link secret; a cached limit from one journey leaked into the next; a stale server process survived a run | the first CI run and local runs | read from the environment; settle times; kill, wait, force; refuse a busy port |

One intermittent failure is **not explained**: in one full local run, `company-restore` failed its first checks (a document upload did not return an id); the next two runs, one of them a full run, passed. The journey now prints the HTTP status of a failed upload, so a recurrence will say why.

## 5. Evidence (all in `docs/saas/evidence/round3/`)

`journeys-summary.md` (10 journeys, from the final local run and the same on GitHub: two-company API 52, complete 79, company settings 57, PDF 37, onboarding 39, round-3 API 89, restore 45, deploy-order 9, browser selection 13, browser round 3 19) · the log of each journey · `db-tests.txt` (225 database checks across nine scripts, PostgreSQL 17; the `before the fix: FAIL` lines are negative controls) · `unit-tests-saas.txt` (`npm run test:saas`, 118 tests) · `typecheck-tsc.txt`, `typecheck-server.txt` · `flag-off.txt` · `saas-rehearsal-synthetic-t1-t7.txt` · `ci-failures-runs-17-19-25.txt` · screenshots `docs/saas/evidence/screens/r3-*.png`. The required-suite runner (`npm run test:ci`) passes 17 of 17.

## 6. Owner decisions this round needs

1. **Grace period** after the end date before a company becomes read-only (default 3 days) and whether an expired company should be read-only (now) or fully blocked.
2. **Storage limit**: the placeholder pilot plan is 2048 MB; plans you create have no storage limit until you set one.
3. **AutoSizer price book**: build it (what a company's price list is, units, currency, versioning), or keep the module off for pilots.
4. **Does production have `delivery_challans.created_by_user_id`** (and the other columns the delivery code writes)? Until answered, the delivery group stays off for pilots.
5. Still open from round 2: the invoice-number floor; the real `bills` definition; plan limits and prices; shared-database approval; re-printed founding invoices (frozen vs current bank details).

## 7. Remaining gaps (not claimed as done)

* A restored-backup rehearsal (item 10); a PostgreSQL 16 run of the journeys; flag-off equivalence in CI.
* Sunchaser wording outside the header, footer and navigation (item 3.5); the static equipment catalogue in interactive proposals and the studios (2.6).
* Company name, address, logo and signature on an invoice follow the current settings (4.7).
* The legacy-invoice label is not visible on the page or in the staff screen (4.5).
* Read-only history in the browser for a non-administrator (1.6); logo `<img>` path (3.4); phone scan of a QR (5.4).
* Storage guard exercised on one upload route only; no usage display (7.8, 7.9).
* The delivery, warranty and handover flows were never exercised with two companies (6.3).
* The artifacts of the failed CI runs could not be downloaded from this session (network policy); the cause was read from the job logs instead.
