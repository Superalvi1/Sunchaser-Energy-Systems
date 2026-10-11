# Deployment plan for PR #111 (release candidate)

Status: **plan only. Nothing in this document has been run in production.** Every production step needs the owner's explicit approval at its gate.
Merging to `main` deploys the CRM (Railway builds `main`). Public-safe: variable names and files, never secret values.
Where things run: `docs/ops/PRODUCTION_TOPOLOGY.md`. Rehearsal evidence: `docs/ops/DEPLOYMENT_REHEARSAL.md`.

## 1. What the release contains

| Area | Change | Migration |
|---|---|---|
| Smart Quote | Versioned, idempotent saving; anonymous quotes never attach to an existing lead; staff issue a signed link (or the portal session) to add a version | M1 `smart-quote-versions-schema.sql` (falls back to old behaviour without it) |
| Sessions | 30-day absolute cap, refresh rotation, **server-side logout / logout-all / admin revoke**, fail-closed lookups | M2 `session-revocation-schema.sql` (without it `/health` shows `sessionRevocationActive:false`, logout says it could not revoke) |
| Payments | Per-invoice lock, request-id idempotency, strict amounts, database guard (revision 2) | M3 `invoice-payments-integrity.sql` (**needed once there is more than one replica**) |
| Invoice edits | Lines + header + ledger totals saved in **one transaction**, stale-version refusal (409), lines must reproduce the header | M4 `invoice-save-atomic.sql` (needs M3; app falls back to the old path without it) |
| Account takeover | Reset/verification links are no longer returned to the caller (also PR #112); reserved staff usernames cannot be self-registered | none |
| Storage | Signed-link scope, rotation support, upload checks | none |
| Backup tooling | `scripts/backup/*`, `scripts/rehearsal/*` | none (tooling) |
| Types / CI | 0 type errors; typecheck, build, tests, Docker/database suites on PostgreSQL 16 **and** 17 | none |
| Android | 1.0.17 (code 20) | none |

Not in this release: the multi-company branch.

## 2. Evidence, by who established it

**A. Independently executed by me in this session (isolated stacks, synthetic data; logs in the session scratchpad, results quoted in `DEPLOYMENT_REHEARSAL.md`)**

| What | Result |
|---|---|
| Typecheck; web build; `test:crm-repair` | 0 errors; builds; pass |
| Browser/API journeys on a **fresh PostgreSQL 17.11 stack with M1-M4 applied** (application code identical to `0fe1869`): Smart Quote 16, staff CRM 6, finance 8, portal link 1, documents 14, rename 7, sessions 8, WhatsApp 10, payment concurrency 11, quote links 69, independent verify 54, compatibility matrix 13 observations, edit consistency 300 rounds, two-instance payments 40 rounds | all pass; 0 overpaid, 0 inconsistent invoices |
| 17.11 -> 17.11 backup/restore/migration rehearsal (`run-rehearsal.sh`, 106 tables, 7,973 rows) | restore matched exactly; M1-M4 apply, verify, roll back (definitions identical), re-apply: 0 failures |
| Same rehearsal fed an archive in the **exact format of the existing production backup job** (`database.dump` + `globals.sql` in a `.tar.gz`) | 0 failures |
| Deploy-order matrix {old code, new code} x {old schema, new schema} | new code on old schema safe on one replica; old code on new schema breaks payments (500) |
| Concurrent invoice edits, 3 instances: previous path 112 of 400 invoices corrupted; new path 0 inconsistent in every run (400, 200, 200 and 300 rounds, PostgreSQL 16, 17.10, 17.11) | as stated |

**B. Reported by others / by CI, not re-run by me:** GitHub Actions results on the pushed head (see the PR); the owner's report of the 9 Oct accounts reset and of
the recovery copies in `crm_recovery`; Railway configuration and logs as read through the Railway API (read-only).

**C. Not tested:** the real production database and its real backup file (no access, section 5.2); a real Railway bucket; the production PostgREST version;
a physical Android device; the Play Console key roles; the credentials' current state in each provider console.

## 3. Known limits that remain

| Limit | Effect | Status |
|---|---|---|
| Clients that do not send `expectedUpdatedAt` (older Android builds, API callers) | Edits stay consistent, but the later save silently wins | Accepted; the current form sends it |
| New code on the old schema, two replicas | Payment over-payments possible (8 of 25 test rounds) | Do not run two replicas before M3 |
| Offline logout cannot revoke | Token valid until it expires | Accepted; keep `JWT_EXPIRES_IN` short |
| Rolling back M2 revives logged-out tokens | Until they expire | Accepted; rotate `JWT_SECRET` if it matters |
| No refresh-token reuse detection | A thief and the owner each get a successor | Open |
| `generatedAt` on the public quote is client-chosen | A stranger can pin their lead to the top | Open |
| Public rate limiter trusts the first `X-Forwarded-For` | Bypassable | Open (needs the proxy hop count) |
| Smart Quote link tokens are multi-use until expiry (max 30 days) | Scoped to one lead and its phone | Accepted |
| PostgREST image tag is `latest` | A restart can change the version under a tested release | **Pin before M1** (owner action) |
| Existing backup: unencrypted, probably same bucket/credentials as documents, no off-Railway copy, never restore-tested | Backups are less safe than they look | Closed only by Step 2 |
| `GET /api/admin/invoices` returns 500 at about 3,300 invoices | Irrelevant while the table is empty (post-reset) | Open, revisit when invoices grow |
| Marketplace suites: `marketplace-live-suppliers-phase1` fails (tracked); `startup-smoke` not run in CI (tracked); `marketplace-catalogue-manager-pg` was failing because its **test adapter** called the old RPC (fixed, needs a CI Docker run to be promoted) | Marketplace is outside this release; the catalogue-size theory was wrong | Tracked, listed in every CI report |

## 4. Gates

| Gate | Needed before |
|---|---|
| G1 | Any production backup action beyond the existing daily job (new job, download, restore drill on a real file) |
| G2 | Any credential rotation or revocation |
| G3 | Any production migration (M1-M4) |
| G4 | Merging to `main` (deploys) |
| G5 | Any Play Console change, testing upload or release |
| G6 | Any git history rewrite |

## 5. The plan, in order

### Step 0. Decisions only the owner can make
1. Merge order. **Recommended:** PR #112 (reset-link fix, no migration) first; PR #111 already contains its commit, so there is no conflict afterwards.
2. Pin the PostgREST image to the version running today (Railway deployment details show it). Needs a Railway change: G3-class, do it before M1.
3. Backup storage: separate bucket + credentials + encryption (adopt `pg-backup.sh` next to the existing job), or accept the current job as is.
4. Replicas: stay at 1 until M3 is live.
5. Confirm which Railway services are production (the project and several service names say "staging" / "smoke").

### Step 1. Close the live takeover (G4, PR #112 only)
Merge PR #112; Railway deploys it. Smoke: `POST /api/auth/forgot-password` for a known and an unknown address returns identical bodies and no link.
Rollback: redeploy the previous Railway deployment. Afterwards review recent password changes and consider a Super Admin password change.

### Step 2. A restore you have seen work, from the real daily backup (G1)
The daily job already produces `database-backups/<stamp>/sunchaser-postgres.tar.gz`. What is missing is a restore.
1. Download the **latest** archive to the owner's machine (bucket console or `aws s3 cp`, read-only credential; Step 5.2 lists the simplest secure ways). Keep it on an encrypted disk.
2. On a machine with PostgreSQL **17** client tools and a scratch PostgreSQL 17 server (never the production service):
   ```bash
   RESTORE_PGHOST=... RESTORE_PGPORT=... RESTORE_PGUSER=postgres RESTORE_PGPASSWORD=... \
   REHEARSAL_FROM_TARBALL=/path/sunchaser-postgres.tar.gz REHEARSAL_DIR=/safe/dir  bash scripts/rehearsal/run-rehearsal.sh
   ```
   It restores (single transaction, constraints validated), runs the three preflights on the **restored copy**, applies M1-M4 one by one with verify scripts, rolls them back in
   reverse order, re-applies, and compares every pre-existing table before/after. Exit status = number of failures.
3. Also start the application against the restored copy and repeat the Step 4 smoke (`docs/ops/DEPLOYMENT_REHEARSAL.md`, "Journeys").
4. Delete the downloaded archive and the restored copy afterwards (customer data).
**Exit criterion:** 0 failures. No migration, merge or rotation starts before this.

### Step 3. Read-only preflights on production (G3, read-only)
Run the three `*-preflight.sql` files against production (`PGOPTIONS='-c default_transaction_read_only=on'`), attach the output. Any BLOCKER stops the plan. Check the output for: role names PostgREST uses,
`service_role` present, no triggers on `invoices`/`invoice_payments`, no idle-in-transaction sessions, server version, and that `crm_recovery` is not in PostgREST's schema list.

### Step 4. Deploy the backend with no migrations (G4 for PR #111)
Merge PR #111. **Backend first**: old code on the new schema breaks payments (500), new code on the old schema is safe on one replica.
Expect `/health` -> `sessionRevocationActive:false` and logout saying it cannot revoke until M2. Smoke: login, refresh, lead list, one anonymous Smart Quote with a synthetic
phone (then delete the synthetic lead), invoice list, document upload and download. Watch Railway logs and error rate for 30 minutes.
Rollback: redeploy the previous Railway deployment (no schema change yet).

### Step 5. Migrations, one at a time, in this order (G3). Each: apply -> verify -> short smoke -> wait 5 minutes
| # | Apply | Verify | Rollback (undo in **reverse** order) |
|---|---|---|---|
| M1 | `smart-quote-versions-schema.sql` | `smart-quote-versions-verify.sql`; one synthetic quote; staff Proposals tab | `smart-quote-versions-rollback.sql` (+ `-restore.sql` to bring history back) |
| M2 | `session-revocation-schema.sql` | `/health` `sessionRevocationActive:true` within 15 s; log in, log out, reuse token = 401 | `session-revocation-rollback.sql` |
| M3 | `invoice-payments-integrity.sql` (run twice; second run must be a no-op) | `invoice-payments-verify.sql` all `ok`; a test invoice: payment ok, over-payment refused | `invoice-payments-integrity-rollback.sql` (**after** M4's rollback) |
| M4 | `invoice-save-atomic.sql` | function exists, not executable by anon/authenticated; edit one test invoice from two tabs: second save answers 409 | `invoice-save-atomic-rollback.sql` |
Each applies in milliseconds (largest measured 54 ms) and gives up after a 5 s lock timeout without changing anything. No restart is needed; the app notices M1, M2 and M4 by itself.

### Step 6. Credential remediation (G2) — the owner's private action sheet carries the console-by-console details and the tick-boxes
Do it after Step 5 so that a rotation problem is never confused with a deployment problem. Order matters:

| # | Item | How | Effect |
|---|---|---|---|
| 6a | Make the repository private (or keep it public and treat everything in it as burned) | GitHub settings | Does not revoke anything already copied |
| 6b | Supabase projects named in `.env.production` and the tracked archive | Revoke or rotate service-role and anon keys, JWT secrets and database passwords in every project that ever held them; delete projects that are no longer used | Kills any live copy of those keys |
| 6c | AI provider keys (Gemini, others) used by the CRM and in the archive | Revoke in each provider console; set new keys on Railway | AI features pause until set |
| 6d | `JWT_SECRET` | New value on the CRM service | **Every user must sign in again** (a feature here, not a fault) |
| 6e | `RAILWAY_OBJECT_PROXY_SECRET` | New value; put the old one in `RAILWAY_OBJECT_PROXY_SECRET_PREVIOUS` for a short overlap so existing signed document links keep working, then remove it | Links signed with the old secret stop working after the overlap |
| 6f | `PUBLIC_LEAD_API_KEY`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, Meta tokens | Rotate in Meta and Railway together | Short WhatsApp interruption |
| 6g | Railway S3 bucket and Postgres credentials | Rotate if any copy was shared | Brief reconnect |
| 6h | Accounts created by the old verification scripts, default staff accounts seeded from `database.json` | Check the production `users` table for usernames `admin`, `manager`, `sales`, `surveyor`, `installer`, `admin2`, `inventory`, `support`, `technician`, `allauddin`, `raza` and for the 3-character seed password; disable or reset any that exist | Closes known default-credential paths |
| 6i | Remove tracked secrets and data from `HEAD` (`.env.production`, `sunchaser-crm.zip`, `database.json`, `backups/*.json`, the keystore) | Normal commit; a history purge is a separate, optional G6 step (see the owner's private sheet) | Does not substitute for 6b to 6h |

For every item: record who rotated it, when, and which service was restarted. Do not paste values into chat or tickets.

### Step 7. Android: signing and testing (G5 for any Play action)
Fact: all artifacts of the release-candidate build were signed with the committed keystore,
SHA-256 `F6:74:51:24:CD:66:E3:83:89:3A:C7:98:78:C0:8F:65:B5:4B:BA:B3:2C:A1:DB:24:B3:5D:0C:90:36:35:D8:94` (read from the build log).
The artifact **listing** (names, sizes, digests) is public without login; the repository is public, so treat the downloads as obtainable by any GitHub account.
1. In Play Console, App integrity: compare the **app signing** and **upload** certificate fingerprints with the value above. The decision tree is in
   the signing plan (the owner's private signing notes in the signing patch, kept in the working notes until applied).
   - Likely case (repo wording suggests it): the committed key is the **upload** key. Recovery: create a new upload key, request an upload-key reset. Installed apps are unaffected.
   - If it is the **app signing** key, or the app is not on Play, or Play App Signing is off: stop and decide, those cases are materially worse.
2. Do not create a new listing or a new package name, and do not generate a new key without a Play-approved reset.
3. Move signing to GitHub environment secrets (fail-closed Gradle config in the signing plan) once the new upload key exists; delete the keystore from `HEAD`.
4. Test builds (internal testing track only, after the new upload key is accepted) on at least one physical Android 13+ device and one older device:
   open the app 3 times (stays signed in), sign out then reopen (must show sign-in), sign out offline (local state cleared), sign in as two roles,
   anonymous Smart Quote, staff link quote, create an invoice and record a payment twice with the same request (one row), upload and download a document,
   rotate the phone, kill the app mid-upload.
5. Release to production tracks only after Steps 1 to 6 and the device checklist pass (G5).

### Step 8. After deployment
Watch error rate and `/health`. Re-run `invoice-payments-verify.sql` after the first real invoices. Open items: Section 3.

## 6. Stop conditions
* Any migration fails or times out: stop, read the error, roll back that migration only.
* After Step 4 the error rate rises or logins fail: redeploy the previous deployment.
* A BLOCKER row in a preflight, or the Step 2 rehearsal shows any failure.
* Two replicas running while M3 is not applied.

## 7. Rollback summary (always newest change first)
| What | How | Loses |
|---|---|---|
| M4 atomic save | `invoice-save-atomic-rollback.sql` | Function only; edits revert to the non-atomic path |
| M3 payment guard | `invoice-payments-integrity-rollback.sql` | Guard only; data untouched |
| M2 session revocation | `session-revocation-rollback.sql` | Revocation records; revoked tokens valid again until they expire |
| M1 Smart Quote versions | `smart-quote-versions-rollback.sql` (backs rows up first) | Nothing; `-restore.sql` brings history back |
| Backend | Redeploy the previous Railway deployment | **Only after M4 and M3 are rolled back** if they were applied (old code returns 500 on payments with the guard in place) |
| Credentials | No rollback for a revoked key | n/a |
| Android | Do not publish; withdraw from the testing track | n/a |
