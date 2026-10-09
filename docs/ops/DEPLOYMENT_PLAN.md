# Deployment plan for PR #111 (release candidate)

Status: **plan only. Nothing in this document has been run in production.** Every production step below needs the
owner's explicit approval at its gate. Merging to `main` deploys the CRM (Railway builds from `main`).

This file is public-safe: it names environment variables, consoles and files, never secret values. The list of which
real credentials are still active has to be established by the owner in each provider console.

## 1. What the release contains

| Area | Change | Needs a migration? |
|---|---|---|
| Smart Quote | Versioned, idempotent saving; anonymous quotes **never attach** to an existing lead; staff issue a signed link (or the customer's portal session) to add a version | Yes: `smart-quote-versions-schema.sql` (falls back to old behaviour without it) |
| Sessions | Absolute 30-day cap on every request, password change/reset revokes old tokens, refresh rate limit and rotation, **server-side logout, logout-all, admin revoke**, fail-closed on lookup errors | Yes: `session-revocation-schema.sql` (without it `/health` reports `sessionRevocationActive:false`; nothing else changes) |
| Payments | Per-invoice lock, request-id conflicts, strict amounts, legacy opening balances no longer reset, coded errors | Optional but **strongly recommended**: `invoice-payments-integrity.sql` (revision 2) |
| Account takeover | Password-reset and verification links are no longer returned to the caller; reserved staff usernames cannot be self-registered | No |
| Storage | Signed-link scope, rotation (`RAILWAY_OBJECT_PROXY_SECRET_PREVIOUS`), error handling, upload checks | No |
| Backup/restore | `scripts/backup/*` encrypted backup, restore into a second database, manifest comparison | No (tooling only) |
| Types and CI | 0 type errors; independent typecheck, build, test and Docker/database CI jobs | No |
| Android | Version 1.0.17 (code 20) | No |

Not in this release: the multi-company work (branch `claude/saas-pilot-multi-company`).

## 2. State of the evidence

Executed on disposable stacks (PostgreSQL 16, PostgREST 12.2.3, synthetic data) and on GitHub's runners. Nothing was
run against production, a real Railway bucket, PostgreSQL 17 or a physical Android device.

| Evidence | Result |
|---|---|
| `tsc --noEmit` | 0 errors (was a hidden 142: `@types/react` had never been installed) |
| Required suites (`npm run test:ci`) | 16 of 16 |
| Docker/database suites on GitHub (real Docker) | 13 of 14; the 14th (`marketplace-catalogue-manager-pg`) fails on code this release does not touch and is tracked |
| Smart Quote migration tests, run for real | 9 of 9 (apply twice, lock timeout, rollback, restore) |
| Combined release-candidate stack, independent verification (`final-verify.mjs`) | 54 of 54: expired, revoked, suspended, logged-out, password-reset sessions; shared phone numbers; concurrent retries; identical legitimate payments; failed requests leave balances intact |
| Logout journey `j9-logout.mjs` | 51 pass, 0 fail, 2 skipped (PostgREST restart scenarios) |
| Smart Quote link journey `j10` | 60 pass, 0 fail |
| Payment guard, two app instances, 40 rounds of 6 parallel payments | without guard: 13 overpaid rounds; with guard: 0 |
| Payment guard stress (agent-run, not re-run by me) | 2,430 mixed rounds, 0 deadlocks, 0 5xx, 0 invariant violations |

## 3. Known limits that remain (accepted or open)

| Limit | Effect | Status |
|---|---|---|
| Offline logout cannot revoke | A device that logs out with no connection keeps a valid token until it expires | Accepted; short `JWT_EXPIRES_IN` limits it |
| Rolling back session revocation revives logged-out tokens | Until they expire | Accepted; rotate `JWT_SECRET` if it matters |
| No refresh-token reuse detection | A thief and the owner each get a successor | Open |
| Concurrent full edits of one invoice from two instances can leave line total != header total (ledger stays correct) | Seen 1 in 450 three-instance rounds | Open (needs a transactional RPC) |
| `GET /api/admin/invoices` returns 500 at about 3,300 invoices | Unrelated to the release | Open: **check the production invoice count first** |
| `generatedAt` on the public quote is client-chosen | A stranger can pin their own lead to the top of the list | Open (clamp server-side) |
| Public rate limiter trusts the first `X-Forwarded-For` | Can be bypassed | Open (needs the proxy hop count) |
| Smart Quote link tokens are multi-use until expiry (max 30 days) | Staff-issued, scoped to one lead and its current phone | Accepted |
| Marketplace catalogue-manager database suite fails | Founding-company marketplace, not in this release | Tracked in CI |
| `confirmDuplicate` has no UI caller | Old API clients only | Informational |

## 4. Gates

| Gate | Needed before |
|---|---|
| G1 | Any production backup job |
| G2 | Any credential rotation or revocation (order and window agreed) |
| G3 | Any production migration (preflights passed on a restored copy) |
| G4 | Merging to `main` (deploys) |
| G5 | Any Play Console change, internal-testing upload or release |
| G6 | Any git history rewrite |

## 5. The plan, in order

### Step 0. Decisions only the owner can make
1. Merge order. **Recommended:** merge PR #112 first (the reset-link fix alone, no migration, closes the live takeover).
   PR #111 already contains #112's commit as an ancestor, so merging #111 afterwards does not conflict.
2. How many app replicas run in production? (If more than one, the payment guard migration is required, not optional.)
3. How many invoices exist? (Affects the list-page limit above.)
4. Backup method (section 5.2, option A recommended).

### Step 1. Close the live takeover (needs G4 for PR #112 only)
- Merge PR #112. Railway deploys it. No migration.
- Smoke: `POST /api/auth/forgot-password` for a known and an unknown address returns the same body with no link.
- Rollback: revert the commit or redeploy the previous Railway deployment.
- Afterwards: review recent password changes (`select username, role, updated_at from users order by updated_at desc limit 20`) and
  consider a Super Admin password change. Railway shows 0 requests to the reset endpoints in the 7 days before this review,
  which is reassuring but covers that window only.

### Step 2. Backup and a restore you have actually seen work (needs G1)
Tooling: `scripts/backup/` and `docs/ops/backup-restore.md`.
1. Choose the method. **Option A (recommended):** a one-off job service in the same Railway project runs `pg-backup.sh`, writes an
   age-encrypted dump with a checksum manifest to a private bucket prefix. No public database port.
   Option B: one manual Railway volume backup from the dashboard (plan eligibility not verified).
2. Restore the dump into a **second, empty PostgreSQL 17** database (`restore-verify.sh`): per-table row counts and checksums,
   constraints, triggers, policies, functions and sequences must match; start the app against it and run an authenticated smoke.
   The tooling is proven on PostgreSQL 16 only; the 17 drill is part of this step.
3. Keep the encryption private key outside the repo and outside Railway.
Exit criterion: a restored copy passes `restore-verify.sh` with zero mismatches. **No migration or rotation starts before this.**

### Step 3. Read-only preflights on the restored copy first, then production (needs G3)
Run, review and attach the output:
- `scripts/smart-quote-versions-preflight.sql`
- `scripts/session-revocation-preflight.sql`
- `scripts/invoice-payments-preflight.sql`  (any BLOCK row above zero stops the plan)
Also confirm: the role names PostgREST uses, `service_role` exists, no triggers on `invoices`/`invoice_payments`, no idle-in-transaction sessions, PostgreSQL version.
Run every migration, rollback and verify script on the **restored copy** before production (section 7).

### Step 4. Deploy the backend with no migrations (needs G4 for PR #111)
Merge PR #111. The code works without any of the three tables: Smart Quote falls back, `/health` shows `sessionRevocationActive:false`, payments use the application lock.
Verify: login, refresh, lead list, Smart Quote (anonymous), invoice list, one payment on a **test invoice**, document upload and download.
Watch Railway logs and HTTP error rate for 30 minutes. Rollback: redeploy the previous Railway deployment.

### Step 5. Apply the migrations, one at a time (needs G3), each followed by its verify step
| Order | Migration | Verify | Rollback |
|---|---|---|---|
| 5a | `smart-quote-versions-schema.sql` | `smart-quote-versions-verify.sql`; one synthetic quote; staff Proposals tab | `smart-quote-versions-rollback.sql` (copies rows to a backup table first) and `smart-quote-versions-restore.sql` |
| 5b | `session-revocation-schema.sql` | `/health` reports `sessionRevocationActive:true` within 15 s; log in, log out, reuse the token (must be 401) | `session-revocation-rollback.sql` (revived tokens: see limits) |
| 5c | `invoice-payments-integrity.sql` run twice | `invoice-payments-verify.sql` (all rows `ok`); one payment, one over-payment (must be refused); `j11-db-level.sql` on the copy | `invoice-payments-integrity-rollback.sql`; schema returns byte-identical on the test stack |

Each applies in milliseconds on a 100,000-invoice test database and fails safe on a lock timeout (5 s), changing nothing.
Window: any quiet 10 minutes, one migration at a time, no app restart. The payment guard requires the app commit from this release to be live (Step 4).

### Step 6. Credential remediation (needs G2)
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
| 6i | Remove tracked secrets and data from `HEAD` (`.env.production`, `sunchaser-crm.zip`, `database.json`, `backups/*.json`, the keystore) | Normal commit; a history purge is a separate, optional G6 step (see `docs/android/signing.md` once merged) | Does not substitute for 6b to 6h |

For every item: record who rotated it, when, and which service was restarted. Do not paste values into chat or tickets.

### Step 7. Android: signing and testing (needs G5 for any Play action)
Fact: all artifacts of the release-candidate build were signed with the committed keystore,
SHA-256 `F6:74:51:24:CD:66:E3:83:89:3A:C7:98:78:C0:8F:65:B5:4B:BA:B3:2C:A1:DB:24:B3:5D:0C:90:36:35:D8:94` (read from the build log).
The artifact **listing** (names, sizes, digests) is public without login; the repository is public, so treat the downloads as obtainable by any GitHub account.
1. In Play Console, App integrity: compare the **app signing** and **upload** certificate fingerprints with the value above. The decision tree is in
   the signing plan (`docs/android/signing.md` in the signing patch, kept in the working notes until applied).
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
- Re-run `final-verify.mjs` equivalents against production **only with synthetic test records that you then remove**, or skip and rely on staging.
- Keep the restored copy for 7 days.
- Monitor: HTTP 5xx rate, 401/403 spikes, payment 409/422 rates, `/health.sessionRevocationActive`.
- Schedule: the backup job, and a monthly restore drill.

## 6. Stop conditions (any one halts the plan)
- Restore drill shows any mismatch.
- Any preflight BLOCK row greater than zero.
- A migration fails or times out: do nothing further, review the error, roll back that migration only.
- After Step 4 the error rate rises or logins fail.
- Two replicas confirmed and the payment guard not yet applied: do not enable new payment traffic beyond the existing level.

## 7. Dry run on the restored copy (do this before production)
```bash
psql "$RESTORED_URL" -v ON_ERROR_STOP=1 -f scripts/invoice-payments-preflight.sql
psql "$RESTORED_URL" -v ON_ERROR_STOP=1 -f scripts/smart-quote-versions-preflight.sql
psql "$RESTORED_URL" -v ON_ERROR_STOP=1 -f scripts/session-revocation-preflight.sql
for f in smart-quote-versions-schema session-revocation-schema invoice-payments-integrity invoice-payments-integrity; do
  psql "$RESTORED_URL" -v ON_ERROR_STOP=1 -f scripts/$f.sql; done
psql "$RESTORED_URL" -f scripts/invoice-payments-verify.sql
psql "$RESTORED_URL" -f scripts/smart-quote-versions-verify.sql
# then each *-rollback.sql, and re-apply
```
Run the app against the copy with the production-like environment and repeat the Step 4 smoke before touching production.

## 8. Rollback summary
| What | How | Loses |
|---|---|---|
| Backend | Redeploy previous Railway deployment | Nothing (schema is additive) |
| Payment guard | `invoice-payments-integrity-rollback.sql` | Guard only; data untouched |
| Session revocation | `session-revocation-rollback.sql` | Revocation records; previously revoked tokens become valid until they expire |
| Smart Quote versions | `smart-quote-versions-rollback.sql` (backs rows up first) | Nothing; `...-restore.sql` brings history back |
| Credentials | There is no rollback for a revoked key; keep old values only as long as the overlap needs | n/a |
| Android | Do not publish; withdraw from the testing track | n/a |
