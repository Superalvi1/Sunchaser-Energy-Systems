# Evidence ledger (11 Oct 2026)

One place, one status per item. Nothing appears under two headings. Definitions:
**VERIFIED** = I ran it myself and read the output (isolated stack, synthetic data, never production).
**CI** = GitHub Actions ran it; I read the result but did not run it.
**REPORTED** = told to me by the owner, or read from the Railway / Docker Hub APIs; I did not witness the underlying fact.
**EXCLUDED** = a test that fails or is not run, kept out of every pass count.
**UNTESTED / UNKNOWN** = nobody has checked.

## Why an earlier report listed the logout journey as "untested" and also said 53/53

Two statements about two different things were merged into one table row. `j9-logout.mjs` (server-side logout, logout-all, refresh rotation, revocation table apply/restart scenarios)
**was run: 53 of 53 pass**, on PostgreSQL 17.11 with PostgREST 12.2.3 and again with PostgREST 16.4. Its two PostgREST-restart scenarios used to be skipped (51 pass, 2 skipped on PostgreSQL 16);
they are now executed. What is still untested is different: logout inside the Android WebView on a physical device, and logout against the real production database (migration M2 is not applied there).
The rows below keep these separate.

## A. VERIFIED by me (isolated, synthetic data)

| Item | Result | Where |
|---|---|---|
| Type check | 0 errors | repository |
| Server logout / logout-all / rotation / revocation journey (`j9-logout`) | 53 pass, 0 fail | PostgreSQL 17.11, PostgREST 16.4 (and 12.2.3) |
| Browser logout journey (web UI in desktop Chromium, `j9-logout-browser`) | 7 pass | PostgreSQL 17.11, PostgREST 16.4 |
| Smart Quote / staff CRM / finance / portal link / documents / rename / sessions / WhatsApp / payment concurrency | 16 / 6 / 8 / 1 / 14 / 7 / 8 / 10 / 11 pass | fresh stack, all four migrations, PostgreSQL 17.11, PostgREST 16.4 |
| Smart Quote link tokens incl. browser section; independent verification | 69 pass; 54 pass | same |
| Compatibility matrix (13 observations), concurrent invoice edits (300 rounds), two-instance payments (40 rounds) | 0 unsafe, 0 degraded; 0 inconsistent; 0 overpaid | same |
| 17.11 -> 17.11 encrypted backup, restore, migrate M1-M4, roll back, re-apply | 0 failures; 106 tables, 7,973 rows matched | scratch PostgreSQL 17.11 pair |
| Same rehearsal fed an archive in the exact format of the existing production backup job | 0 failures (34 PASS) | same |
| Mac-procedure logic: newest-object selection, path/virtual addressing fallback, SigV4 downloads, credential-free output, cleanup, local-only guard | worked end to end with a stub Railway CLI and a signature-verifying S3 stand-in | Linux, **not macOS, not the real CLI or bucket** |
| Guards: a backup that contains accounting rows is flagged FAIL; a non-local scratch server is refused | both behaved as designed | synthetic archives |
| Catalogue repository against the real v2 function with 1,100+ products | 67 of 67 | PostgreSQL 16 |
| PostgREST v16.4 binary: obtained from the registry bytes, layer and manifest digests checked, runs, serves | yes | sandbox |
| Compare of PostgREST 12.2.3 and 16.4 start-up wording | "Functions" vs "RPCs"; production's log says "RPCs" | logs |

## B. CI (GitHub Actions), not run by me

On commit `b4020c8`: typecheck, build, tests, crm-contract, listen-port, overlay checks, `docker-suites` on PostgreSQL 16 and 17 - all success. The head after this document has its own run (see the PR).

## C. REPORTED

| Item | Source |
|---|---|
| 9 Oct accounts reset (2 invoices, 13 items, 2 payments, 3 other payment records, 27 quotations, 1 archived ledger; users, contacts, leads, products, settings kept; copies in `crm_recovery.accounts_reset_20261009_*`) | Owner |
| Production topology, replica counts (1 each), service configuration, PostgreSQL 17.11 | Railway API, read-only |
| Daily backup job ran and read-back-verified every day 26 Sep - 10 Oct (latest 10 Oct 20:04 UTC, about 7.8 MB) | Railway logs |
| Tag/digest facts for PostgREST | Docker Hub web API and registry |
| Application's "paid_amount mismatch" warnings stop after 9 Oct 17:47 UTC | Railway logs (consistent with the reset, not proof) |

## D. EXCLUDED tests (failing or not run; not counted in any pass total)

| Suite | Status |
|---|---|
| `test:marketplace-live-suppliers-phase1` | fails (tracked; sync logic left unchanged pending owner decision) |
| `test:startup-smoke` | not run in CI (needs bundle + database credentials) |
| `test:marketplace-ws0` | failed once on the PostgreSQL 17 CI job, passed on retry and on later runs; **cause not established** |

(`test:marketplace-catalogue-manager-pg` is not excluded any more: its test adapter was wrong, fixed, and it passed in CI on PostgreSQL 16 and 17.)

## E. UNTESTED / UNKNOWN

| Item | Why |
|---|---|
| Restore of the real production backup file | no access from the sandbox; procedure in `MAC_RESTORE_REHEARSAL.md` |
| Real Railway bucket, real `railway run` behaviour, macOS execution of the scripts | not reachable from here |
| Version/digest actually running in production PostgREST | Railway does not expose it; inferred v16.4 (`POSTGREST_PIN.md`) |
| Whether Railway accepts an `image:tag@sha256:...` reference | unknown |
| M1-M4 on the real production schema; preflights on production | not run (read access needed) |
| Logout inside the Android WebView on a physical device; any physical-device test | no device |
| Play Console key roles; current state of every credential | owner consoles only |
| Whether `RAILWAY_POSTGREST_URL` points at `sunchaser-migration-job` | value not read; inferred |
| Whether the backup bucket is the same as the documents bucket | inferred from identical variable names |
| Cause of the single `marketplace-ws0` failure | log truncated |

## F. KNOWN LIMITS (design, not test gaps)

See section 3 of `DEPLOYMENT_PLAN.md`: offline logout cannot revoke, last writer wins for clients that send no invoice version, no refresh-token reuse detection, client-chosen `generatedAt`, trusting the first `X-Forwarded-For`, and the others listed there.
