# Deployment rehearsal: results and decision

Status: **rehearsal on synthetic data and disposable stacks. Nothing was applied to production, and the real production backup file has not been restored yet (no access, section 6).** Updated 11 Oct 2026. Everything below is labelled
EXECUTED (a command ran and its output was read), INSPECTED (read, not run) or NOT VERIFIED. Customer figures and invoice numbers are
deliberately not written here (public repository); they were given to the owner privately.

## 1. Concurrent invoice edits: fixed and proved

**Reproduced (EXECUTED).** Three app instances on one database, each applying a different full edit to the same invoice
(`scripts/e2e-crm-repair/j12-atomic-edit.mjs`, 400 rounds): **112 of 400 invoices ended with a header but no lines at all** on the
previous save path (lines were upserted, then "everything else" was deleted, by each edit in turn). Production runs one replica, where the
in-process lock hides this; it is live during a rolling deploy overlap and the moment a second replica is added.

**Fix.** `scripts/invoice-save-atomic.sql` adds one function, `invoice_save_atomic`, that saves lines, header and ledger-derived totals in
**one transaction**: row lock (same strength as the payment guard), optional stale-version refusal (`expectedUpdatedAt`, HTTP 409
`INVOICE_CONFLICT`; the invoice form now sends it), verification inside the transaction that the stored lines reproduce the header (else
everything rolls back), refusal of a line id that belongs to another invoice, and the same "never lower the total below payments" rule as
the guard. The application falls back to the previous path when the function does not exist.

| Run | Result |
|---|---|
| EXECUTED, previous path, 3 instances, 400 rounds | 112 inconsistent invoices |
| EXECUTED, new function, PostgreSQL 16, 3 instances, 400 rounds (mix / edit+payment / same-version race / stale) | **0 inconsistent**; same-version race: 1 winner and the rest `409 INVOICE_CONFLICT` (100 / 200); stale edit refused 100 / 100 and nothing written |
| EXECUTED, new function, restored copy on **PostgreSQL 17.10**, 2 instances, 200 rounds | **0 inconsistent** |
| EXECUTED, `server/finance/invoiceSaveAtomic.pg.test.ts`, 7 tests (consistency, stale version, foreign id, inconsistent header rolls back, total vs payments, 10 concurrent connections, privileges + rollback + re-apply) | 7/7 on PostgreSQL 16.15 and on 17.10; now in the CI `docker-suites` group, run on PostgreSQL 16 **and** 17 |

Limit: a client that sends no `expectedUpdatedAt` (older Android builds, API callers) is serialised and stays consistent, but the later
save silently wins. The conflict is only reported to forms that send the version.

## 2. Does the new backend work safely before the migrations? (EXECUTED, matrix J13)

Same 13 observations (`j13-compat-matrix.mjs`) against {old production code `d19e99e`, new code} x {schema before, schema after}, two
instances each, synthetic data.

| Observation | OLD code / old schema (today) | NEW code / old schema | NEW code / new schema | OLD code / new schema |
|---|---|---|---|---|
| Payment retry, same request id | **duplicate recorded** | one row | one row | **duplicate recorded** |
| Two legitimate payments of the same value | both recorded | both recorded | both recorded | both recorded, one answered **500** |
| Over-payment | **accepted** | 422 | 422 | **500** |
| Edit lowering total below payments | **accepted** | 422 | 422 | **500** |
| 6 parallel payments, ONE instance | **14/15 rounds overpaid**, 18 5xx | 0 overpaid | 0 | 0 overpaid, 45 5xx |
| 6 parallel payments, TWO instances | **24/25 overpaid** | **8/25 overpaid** | 0 | 0 overpaid, 75 5xx |
| Logout then reuse token | endpoint missing (404), token valid | `revoked:false`, token valid (honest) | 401 on both instances | 404, token valid |
| `logout-all` | 404 | clear 503 | 200 | 404 |
| Anonymous quote twice, same name+phone | 2 leads | 2 leads | 2 leads | 2 leads |
| Invoice delete with payments | refused | refused | refused | refused |

Reading the evidence:

* New code on the old schema **never corrupts or 5xx's**. Two protections are absent, and the tests show exactly which: server-side logout cannot revoke
  (the app says so), and payments are only protected inside one process (8 of 25 two-instance rounds over-paid). With one replica that is acceptable for the
  short window between steps 4 and 5; it is not acceptable with two.
* Old code on the new schema **breaks payments** (500 for legitimate and refused payments). Migrating first is therefore unsafe, and a backend rollback after the
  guard is applied needs the guard rolled back first (now in the plan).
* Table row "OLD code / old schema" is the production behaviour today and is the reason the release is worth shipping.

**Order chosen from this evidence: backend first (no migrations), then 5a smart-quote-versions, 5b session-revocation, 5c payment guard, 5d atomic invoice save.**
The anonymous-quote row is not conclusive for the old code (the old code creates a lead per quote by design; the matching defect needs an existing lead matched by
phone, covered by `j10-smartquote-link.mjs`, 60/60).

## 3. Backup, restore and migration rehearsal on PostgreSQL 17.11 (EXECUTED)

Toolchain: PostgreSQL **17.11** server, `pg_dump`, `pg_restore`, `psql` (conda-forge build; the same version production reports in its PostgREST log). Earlier runs used a 16-to-17 stand-in; they are superseded.

`scripts/rehearsal/build-prod-like-source.sh` builds the source in the state the owner described after the 9 Oct accounts reset: accounting tables empty (0 invoices, 0 items,
0 payments), recovery copies in schema `crm_recovery` (prefix `accounts_reset_20261009_`), leads, users and the rest untouched. Synthetic data only.

`scripts/rehearsal/run-rehearsal.sh`, source = that PostgreSQL 17.11 database, scratch = a second PostgreSQL 17.11 server: **0 FAIL**.
* three read-only preflights: 0 BLOCKER rows;
* encrypted backup (two age recipients, no plaintext dump left on disk) restored: `MANIFEST MATCH: 106 tables, 7973 rows, every definition hash and sequence position verified`;
* one changed cell in the restored copy is detected; a repeat restore is clean;
* M1, M2, M3, M4 applied one by one (13 to 54 ms each), each verified; row counts and row hashes of all pre-existing tables unchanged after each;
* all four rolled back in reverse order: every table, definition and (normalised) ACL equals the restored state; re-applied: identical to the first forward run.

Same script in **tarball mode** (`REHEARSAL_FROM_TARBALL=...`), fed an archive in the exact format the existing daily production job writes (`database.dump` from `pg_dump --format=custom`
plus `globals.sql`, tarred): restore, preflights on the restored copy, M1-M4 apply/verify/rollback/re-apply: **0 FAIL**. This is the procedure for the real file (plan, Step 2);
the real file itself has not been restored.

Findings the drill produced, all fixed in the tooling or recorded:
1. A source with an orphan payment row cannot be restored (`pg_restore` stops on the foreign key; the target stays empty). The restore fails closed.
2. `manifest.sql` compared raw ACL text, so an owner-only ACL stored as NULL (restored) differed from the same ACL stored explicitly (source) after a `REVOKE` (seen on `crm_recovery`). It now compares effective ACLs.
3. 16-to-17 restores differ only by PostgreSQL 17's MAINTAIN privilege letter; the 16-to-17 mode accepts that and nothing else. Not needed for 17-to-17.
4. A first version of the cross-major ACL check passed vacuously because of a SQL typo; it now requires a non-empty hash.
5. The Smart Quote verify script has one environmental row ("PostgREST is listening for schema reloads") that needs PostgREST attached; the app journeys below cover it.

### Journeys (EXECUTED, fresh PostgreSQL 17.11 stack with M1-M4 applied, S3 stand-in, two app instances)

Run with `scripts/rehearsal/run-journeys.sh`, once with PostgREST 12.2.3 (the version used for most earlier testing) and once with **PostgREST 16.4**, the version production most probably runs (`POSTGREST_PIN.md`). Both: 0 failing journeys.

| Journey | Result on 16.4 (all except the browser logout line were also run with 12.2.3 with identical counts) |
|---|---|
| Smart Quote: new client, edit, save, PDF, revision, lost response, mobile double tap (`j1-smartquote`) | 16 pass |
| Staff CRM: lead list, saved versions, PDF download (`j1-staff-crm`) | 6 pass |
| Quotation -> invoice -> partial payment, retries, over-payment, audit (`j6-finance`) | 8 pass |
| Portal user linked to a client (`link-portal`) | 1 pass |
| Document upload, rejected types, interrupted/retried uploads, refresh, re-login, cross-customer (`j3-documents`) | 14 pass |
| Client rename keeps invoices, documents and portal (`j5-rename`) | 7 pass |
| Sessions: reopen, expiry, suspension, logout (`j7-session`) | 8 pass |
| WhatsApp inbound -> no automatic lead -> explicit conversion (`j4-whatsapp`) | 10 pass |
| Parallel payments, retries, edit/delete races (`j8-payment-concurrency`) | 11 pass |
| Smart Quote link tokens incl. browser section (`j10-smartquote-link`) | 69 pass |
| Independent verification (`final-verify`) | 54 pass |
| **Server-side logout / logout-all / rotation / revocation incl. the PostgREST-restart scenarios (`j9-logout`)** | **53 pass, 0 fail** (earlier on PostgreSQL 16: 51 pass, 2 skipped; the two skipped scenarios are now executed) |
| Browser logout, web UI in desktop Chromium (`j9-logout-browser`) | 7 pass |
| Compatibility matrix (`j13`) | 13 observations, 0 unsafe, 0 degraded |
| Concurrent invoice edits, 300 rounds (`j12`) | 0 inconsistent |
| Two instances x 40 rounds x 6 parallel payments | 0 overpaid, 0 header/ledger mismatch |

Not run: logout inside the Android WebView on a physical device, and any other physical-device test. (An earlier attempt to run the browser journeys on a *restored copy*, and a first run against 16.4 on a re-used stack, failed for harness reasons - used data, a rate-limit
override - not code reasons; a fresh stack passes. Listed so those failures are not mistaken for passes.)

The status of every claim, with its evidence class, is in `EVIDENCE_LEDGER.md`.

## 4. Production facts established read-only

See `docs/ops/PRODUCTION_TOPOLOGY.md`. In short: 1 CRM replica; PostgREST is the service named `sunchaser-migration-job` (image tag `latest`); PostgreSQL 17.11; a daily
backup job exists and has produced a verified upload every day since 26 Sep; the accounting tables were emptied on 9 Oct (reported by the owner), so the two invoices that
disagreed with their payments are no longer a blocker and the invoice count is zero for the accounting tables.

## 5. Failing or excluded suites, reported separately from the passing checks

| Suite | Group | Status | Cause / note |
|---|---|---|---|
| `test:marketplace-live-suppliers-phase1` | default, tracked | **FAILS** | `pageFingerprint()` uses ids only, so a second page with the same ids but newer content looks repeated; the test expects both pages. Production sync logic left unchanged pending an owner decision. |
| `test:startup-smoke` | default, tracked | **NOT RUN in CI** | needs a built bundle and database credentials |
| `test:marketplace-catalogue-manager-pg` | docker, **now required** | **FIXED and promoted** (CI Docker run passed on PostgreSQL 16 and 17 on the pushed head `d777463`) | The earlier explanation ("fails at >= 1100-product pagination") was wrong. The error is `list row shape invalid`: the repository calls `mp_public_catalogue_list_v2`, the test's adapter ran the older `mp_public_catalogue_list` (different row shape) and node-pg returns `bigint` totals as strings. Reproduced locally, adapter corrected (it now runs the real v2 function), then **67 of 67 checks pass against a real PostgreSQL 16 with more than 1,100 products, in pages of 500**. CI then ran it for real in Docker on both PostgreSQL versions and it passed, so it is no longer excluded. |
| `test:marketplace-ws0` | docker, required | **Failed once on the PostgreSQL 17 CI job (earlier head), passed on retry and on the next two CI runs; cause NOT established** | It starts its own `postgres:16-alpine` container, so the CI service version is not involved. It was the first suite in that job to pull that image. The runner printed only the last 6 lines of output (an exception object). The runner now prints 40 lines, and the job pre-pulls the image with retries, so the next occurrence names its cause. Treat as unexplained until then. |

**Does the catalogue-size failure affect the current catalogue? No.** (1) The failure was in the test, not in the repository. (2) The repository pages 500 at a time and stops on a short page; the v2 SQL returns a
sentinel row when a page is empty, so an exact multiple of 500 products is also safe (INSPECTED; 1,100 products EXECUTED). (3) The last catalogue size seen was 768 products (a 25 Sep log line), below 1,000. (4) The v2 functions are a
manual-apply contract (`marketplace-ws1-public-rpc-contract.sql`) with zero products activated; whether production has them depends on the owner's marketplace work, which this release does not touch.

## 6. Access still missing, and the simplest secure way to supply it

| Missing | Why I cannot proceed | Simplest secure next step |
|---|---|---|
| The actual production backup file | The Railway bucket host is blocked by this sandbox's egress policy; bucket credentials would also have to pass through this session | Owner downloads the latest `database-backups/<stamp>/sunchaser-postgres.tar.gz` to an encrypted disk of their own machine and runs `run-rehearsal.sh` in tarball mode against a local `postgres:17` container (plan Step 2). They send back only the PASS/FAIL lines and the preflight verdict table (no row values) |
| A PostgreSQL 17 scratch server on the owner's side | none here for production data | `docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=... postgres:17-alpine` on the owner's machine, deleted afterwards |
| Production PostgREST version / image digest | the variable list and logs do not print it | Railway dashboard, service `sunchaser-migration-job`, latest deployment details; pin the tag to it |
| Whether `RAILWAY_POSTGREST_URL` points at that service | I did not read variable values (they sit next to secrets) | Owner reads the one variable in the dashboard, or confirms the service-to-service reference |
| Play Console and provider consoles (private sheet) | owner-only | see the private action sheet |

## 7. Decision

| Question | Answer |
|---|---|
| Merge / migrate / rotate / release now? | **NO.** Gates G1-G6 are all still closed, and the one verification that matters most (restoring the real backup) has not been possible. |
| Is the code ready for the owner-run restore rehearsal and then for the staged deployment? | **YES, subject to the Step 2 result.** All four migrations apply, verify, roll back and re-apply on PostgreSQL 17.11; every executed journey passes on PostgreSQL 17.11; order and rollback order are fixed by evidence. |
| What turns this into a GO for production | Step 2 with 0 failures on the real archive; PostgREST pinned; owner approval at G3 and G4 for each step in `DEPLOYMENT_PLAN.md`. |
