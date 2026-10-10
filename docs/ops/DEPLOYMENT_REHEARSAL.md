# Deployment rehearsal: results and decision

Status: **rehearsal on synthetic data and a disposable stack. Nothing was applied to production.** Everything below is labelled
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

## 3. PostgreSQL 17 backup/restore drill and migration rehearsal (EXECUTED on a stand-in, see limits)

`scripts/rehearsal/run-rehearsal.sh`: read-only preflights on the source, encrypted backup with the repository tooling (two age recipients, no plaintext dump
left on disk), restore into a **real PostgreSQL 17.10 server**, manifest comparison, deliberate-corruption detection, the four migrations one by one with their verify
scripts and a before/after comparison of every pre-existing table, all rollbacks in reverse order, re-apply. Last run: **32 PASS, 0 FAIL** (source: 906 synthetic
invoices incl. 49 overpaid-legacy and 2 header/ledger mismatches).

Findings the drill produced (each fixed in the tooling or recorded):

1. **A source with an orphan payment row cannot be restored** (`pg_restore` stops on the foreign key; the target stays empty - the tool fails closed). The invoice
   preflight reports orphans as REVIEW; for the backup/restore plan an orphan count above 0 on a foreign-keyed table is a blocker until the owner decides about the row.
2. **Cross-major restore (16 to 17) shows one manifest difference:** relation ACL text, because PostgreSQL 17 adds the MAINTAIN privilege letter and stores owner-only
   ACLs as NULL. The script accepts exit 3 only when that is the sole difference **and** the ACLs are identical after normalisation (a first version of that check passed
   vacuously because of a SQL typo; it now requires a non-empty hash and was re-run). A 17-to-17 restore, the production case, needs no such tolerance.
3. A single changed cell in the restored copy is detected (`public.users` row hash). Rows and hashes of all pre-existing tables are identical after each migration (the
   `users` hash changes by design: session-revocation adds a column). Rollback returns every table, definition and (normalised) ACL to the restored state; re-apply
   reproduces the first forward result. Every migration ran in under 60 ms on this data.
4. The Smart Quote verify script has one environmental row ("PostgREST is listening for schema reloads") that cannot pass without PostgREST attached; the app smoke covers it.

App smoke on the migrated PostgreSQL 17 copy (EXECUTED): J13 all 13 observations safe, 0 unsafe, 0 degraded; J12 200 rounds, 0 inconsistent.

NOT VERIFIED here: a dump taken **from** a PostgreSQL 17 server (the sandbox has no `pg_dump` 17 and no Docker daemon; apt.postgresql.org is blocked). The source was
PostgreSQL 16.15 with a 16 client; the scratch server is the official PostgreSQL 17.10 server binaries from the `@embedded-postgres` npm package (a third-party
repackaging, not the `postgres:17-alpine` image). The tooling's version guard refuses a 16 client for a 17 source (tested with simulated versions only). The CI
`docker-suites` job now runs on `postgres:17` for the SQL itself.

## 4. Replica and invoice counts from read-only discovery

| Fact | How found | Result |
|---|---|---|
| CRM replicas | Railway read-only API (`describe-service`, `environment-status`) | **1 configured, 1 running, 0 crashed** (region sfo). Service `sunchaser-crm-private-smoke` serves `crm.sunchaserenergy.co`, builds `main` of this repository, health check `/health`. |
| Database | same | `postgres-staging`, image `postgres:17-alpine`, 1 replica, 1 GB volume, no public domain |
| Names | same | The project is called "Sunchaser Railway **Staging**" and the services "staging" / "private-smoke", yet they serve the production domains. Worth the owner confirming that this IS production. |
| PostgREST | same | No PostgREST service appears in this project (the CRM has `RAILWAY_POSTGREST_URL` set). Where it runs is **not established**. The project "Sunchaser Railway Data" has no services. |
| Invoice count | **not obtainable read-only with the access available**: the Railway API has no SQL, the sandbox cannot reach the production host (proxy 403), and the app API needs a login (credentials stay on hold) | The invoice preflight prints it (`invoices (total rows)`). A lower bound can be inferred from numbering in production logs (invoice numbers up to the single digits for 2026) - an inference, not a count. |
| Existing data issue | production service logs (read-only) | The application itself logs `[PartyLedger] paid_amount mismatch` for **two real invoices** whose stored paid amount differs from the sum of their payment rows (one by a factor of ten). The payment guard does not rewrite them until a money field is next written; the owner must decide per invoice which figure is right **before** the guard goes live. |

## 5. Failing suites, reported separately from the passing checks

Passing checks (EXECUTED in CI on the pushed commit, and locally): typecheck, web build, `test:crm-repair` and the other required suites, 13 of 14 Docker suites (now plus the new
`test:invoice-atomic-pg`, 7/7 on 16 and 17).

**Excluded and failing - not counted as passed anywhere above:**

| Suite | Group | Status | Reason (from `scripts/ci/suites.json`) |
|---|---|---|---|
| `test:marketplace-catalogue-manager-pg` | docker, tracked | **FAILS** on a real Docker run | `CATALOGUE_RESPONSE_INVALID` in `catalogueRepository.listProducts` (>= 1100-product pagination). No marketplace file is touched by this release; marketplace is outside it. Needs its own investigation. |
| `test:marketplace-live-suppliers-phase1` | default, tracked | **FAILS** | `pageFingerprint()` uses ids only; production sync logic left unchanged pending an owner decision. |
| `test:startup-smoke` | default, tracked | **NOT RUN in CI** | needs a built bundle and database credentials. |

These do not exercise any code changed by this release. They remain visible in every CI report; the release is not "green" in the sense of having no failing suite.

## 6. Exact access and approvals needed to run the rehearsal against production data

| # | What | Why | Gate |
|---|---|---|---|
| 1 | Owner decision on the backup method (plan section 2: A to D), ideally D: the owner's own machine with `railway connect postgres` and a **PostgreSQL 17** client | the only way to take a 17-to-17 dump and see the real invoice count | G1 |
| 2 | A read-only database login (or the owner running the three `*-preflight.sql` files and sending back the output) | invoice count, orphan rows, header/ledger disagreements, role names, idle transactions | G3 (read-only) |
| 3 | A scratch PostgreSQL 17 server (second Railway Postgres in a separate project, or a local `postgres:17` container) | the restore target; never the production service | G1 |
| 4 | age public keys for two recipients (private keys stay with the owner) | encrypted backup | G1 |
| 5 | Confirmation that `crm-private-smoke` / `postgres-staging` are the production services, and where PostgREST runs | replica/volume facts above were read from these | none |
| 6 | Owner decision per mismatched invoice (section 4) | the guard will rewrite the stored paid amount from the ledger on the next money write | before 5c |

Not requested and not needed for the rehearsal: any credential rotation, merge, production write, migration or Android action.

## 7. Decision

| Question | Answer |
|---|---|
| Deploy PR #111 (+ new commits) to production now? | **NO-GO.** No production backup exists and no restore from production data has been seen to work; the invoice count and two mismatched invoices are undecided; the leaked-key and credential items are untouched; the sandbox cannot take a PostgreSQL 17 dump. |
| Is the code ready for the owner-run rehearsal? | **GO.** Order is fixed by evidence, all four migrations apply, verify, roll back and re-apply cleanly on a restored copy on PostgreSQL 17, and the app passes the compatibility matrix on it. |
| What turns NO-GO into GO for production | Items 1 to 4 and 6 of section 6, a clean `run-rehearsal.sh` against a copy of the real data, then the owner's approval at gates G1, G3 and G4. |
