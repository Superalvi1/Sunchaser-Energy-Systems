# Staging rehearsal runbook: the restored backup, the real storage, the real order of migrations

**Status: a procedure. It has not been executed on a staging environment (none exists to me). Every command below was checked against disposable stacks (PostgreSQL 16 and 17, PostgREST 16.4, an S3 stand-in); what only a real staging can show is listed in section 11.** Production is not touched by any step. No customer is onboarded: the only pilot company created here is a synthetic one.

This one document replaces, for the staging run, the separate pieces `DEPLOYMENT_PLAN.md`, `MAC_RESTORE_REHEARSAL.md`, `SAAS_REHEARSAL.md` and `COMBINED_DEPLOYMENT_AND_ROLLBACK.md` (which stay as the detail behind it). Where they disagree with this file, this file is newer.

## 0. Rules that never bend
1. **Staging has its own everything**: its own PostgreSQL server restored from the backup, its own PostgREST, its own backend, its own object-store **bucket**, its own freshly generated keys and secrets. Never the production database, bucket, service key, JWT secret or webhook endpoints. Outbound integrations (WhatsApp/Meta, payment, e-mail) are switched off by environment.
2. **An older backend never runs against a database that holds, or is marked to hold, pilot data.** "Older" means any build without migration `t1b` and the isolation guard, including the repair build of PR #111. The database refuses it (measured), but the rule is yours too: there is no step in this runbook that starts one after section 6. The only safe use of an older backend is against a database restored from before the marker was switched on.
3. **Recovery is by rebuilding from the backup, not by rolling back** once the marker is on (section 9). Schema rollback of `t1b` and `t1` is refused by design while any pilot company exists.
4. Run the steps **in order** and stop at the first failing check. Do not "fix and continue" past a failed gate: write down what failed, restore from the backup if needed, start again.
5. Keep the evidence (section 10). A result that is not written down did not happen.

## 1. Inputs and owner decisions needed first
| # | Input | Who | Why |
|---|---|---|---|
| I1 | The latest production backup set, and the age identity to decrypt it | owner | the "actual restored backup" |
| I2 | `FOUNDING_INVOICE_FLOOR`: the last invoice number ever issued this year | owner | `t3` refuses to run without it; the numbering never restarts at 0001 |
| I3 | A **staging** PostgreSQL server (same major version as production, 17), a **staging** PostgREST (the pinned image of `POSTGREST_PIN.md`), a staging backend service | owner/ops | section 0, rule 1 |
| I4 | A **staging** object-store bucket and credentials (same provider and region class as production) | owner/ops | real storage checks |
| I5 | Whether staging should hold copies of the production **files** (a read-only copy of the bucket into the staging bucket), or only new uploads | owner | documents restored from the backup point at objects that are not in an empty staging bucket; without a copy their download answers "not found" (expected, harmless) and only new uploads are tested |
| I6 | The storage limit and plan of the synthetic company (e.g. 50 MB) | owner | storage quota checks |
| I7 | Number of backend processes production will run (1 or more) | owner/ops | the cross-process quota was tested with two |

## 2. Build the exact candidate from a fresh checkout
```bash
git clone <repo> rc && cd rc && git checkout <SHA>        # the SHA the report names; git status must be clean
npm ci --ignore-scripts
VITE_API_BASE_URL="" npx vite build
npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs
sha256sum dist/server.cjs     # must equal the hash in the report; the frontend bundle embeds a build time and is not byte-reproducible
```
Deploy exactly this `dist/` to staging (step 6); never a build from a dirty tree.

## 3. Restore the actual backup into staging (verified)
```bash
bash scripts/backup/restore-verify.sh --backup-dir <DIR/STAMP> --identity <age private key> ...   # restores into the STAGING server, refuses to restore onto the source
```
Checks (the script prints them; all must pass): the dump decrypts and its checksums match; every table restored; row counts equal the manifest; the server is **not** the backup source. Then record a baseline you will compare against later:
```bash
psql "$STAGING_DB" -Atc "select relname, n_live_tup from pg_stat_user_tables order by 1" > evidence/baseline-rowcounts.txt
node --import tsx scripts/saas/company-backup.mjs export --company sunchaser --out evidence/founding-before --no-objects   # row-level baseline of the founding company
```
(`company-backup.mjs` needs `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` of staging and `--allow-remote` for a non-local host. Before `t1` there is no `companies` table, so the export of the founding company works only after step 5; take the table-level baseline now and the row-level one right after `t1`.)

## 4. Release A (the repair release) on staging: backend first, then M1 to M4
Order and reasons are in `DEPLOYMENT_PLAN.md`. In short: deploy the repair backend (PR #111), then apply `r1`, `r2`, `r3`, `r4` **one at a time** through the runner, with a smoke after each (login, lead, quotation, contract, invoice, payment, PDF, upload and download). Soak as long as the owner chooses. **Release B does not start before this has finished.**

## 5. Release B: migrations first, one at a time
```bash
export PGHOST=... PGPORT=... PGUSER=<owner> PGPASSWORD=... PGDATABASE=<staging db>
psql -c "insert into app.config (key, value) values ('document_floor.sunchaser.invoice.$(date -u +%Y)', '$FOUNDING_INVOICE_FLOOR')"
node scripts/migrations/run.mjs baseline --through r4-invoice-save-atomic --yes      # only if M1-M4 were applied by hand; the runner refuses a baseline whose effect is absent
for m in t1-company-foundation t1b-tenancy-barrier t2-ownership t3-document-numbering t4-company-settings t5-subscriptions t6-invoice-issuance-snapshot t7-company-admin t8-storage-reservations; do
  node scripts/migrations/run.mjs apply --to $m --yes && node scripts/migrations/run.mjs verify || break
  # smoke with the repair backend AND the new backend (flag off) after each
done
```
Run `scripts/rehearsal/run-saas-rehearsal.sh` against a **scratch copy** of the same backup first (it fingerprints every table before, applies, checks that nothing existing changed and every row belongs to the founding company, rolls everything back to the fingerprinted state and applies again). It is the dry run of this step; the staging run is the forward-only run of it.

Gates: `verify` clean after every step; row counts equal `baseline-rowcounts.txt` for every pre-existing table; the founding company's next invoice number is above the floor and above the highest existing number.

**PostgREST must pick up two things after `t1b`/`t8`**: the schema (`NOTIFY pgrst, 'reload schema'`, sent by the migrations) and the in-database configuration (`pgrst.db_pre_request`, `NOTIFY pgrst, 'reload config'`, also sent). If your PostgREST does not listen for notifications, **restart it**. Record `postgrest --version`/digest in the evidence.

## 6. The backend, the marker and the barrier (this is the order that leaves no window)
1. **Deploy the new backend with `MULTI_COMPANY_ENABLED` unset** (B3). It reports `tenantIsolation.paused:false` at `/health` (no other company exists, marker off). Smoke the founding company: unchanged behaviour.
2. **Stop everything else that talks to the database.** List every service with the database credentials (inventory: `DATABASE_WRITERS_INVENTORY.md`, section 6): only the new backend, PostgREST and the marketplace cron (global-only) may remain. Any older backend instance, worker or script runner is stopped now.
3. **Switch the marker on**: `psql -c "select app.tenancy_enable()"`. From this transaction on, every service-role request that does not declare multi-company mode is refused by the database.
4. **Prove the barrier over HTTP** (this is the step that answers "does this PostgREST really read in-database configuration?"):
   ```bash
   RAILWAY_POSTGREST_URL=<staging postgrest> SUPABASE_SERVICE_ROLE_KEY=<staging service key> CRM_TENANT_POSTGREST_KEY=<staging tenant key> \
   VERIFY_PSQL="-h ... -p ... -U <owner> -d <db>" node scripts/saas/verify-barrier.mjs --confirm
   ```
   All six checks must PASS and it must print `Recorded in the database: verified`. **If check 2 fails (a service-role request with no header is answered):** the pre-request function is not active. Do not continue. Check that PostgREST reads in-database configuration (`db-config = true`, and `db-pre-request` not set in its own file/env), send `NOTIFY pgrst, 'reload config'` or restart it, and run again. While it fails, no pilot company can be created (the database refuses the insert).
5. The new backend, still flag off, now reports `paused:true` (reason `tenancy_marker`): that is the intended state until the flag is switched on. The marketplace cron keeps working (`global-only`).
6. **Switch on** (B4): set `CRM_TENANT_POSTGREST_KEY` and `MULTI_COMPANY_ENABLED=true`, restart. The backend refuses to start if `t1b` is missing. `/health` reports not paused. The operator console signs in; the founding company's users are unaffected.

## 7. Real storage checks (against the STAGING bucket)
```bash
RAILWAY_S3_ENDPOINT=... RAILWAY_S3_BUCKET=<staging bucket> RAILWAY_S3_ACCESS_KEY_ID=... RAILWAY_S3_SECRET_ACCESS_KEY=... RAILWAY_S3_REGION=... \
STAGING_STORAGE_CONFIRM=<the same bucket name> PRODUCTION_S3_BUCKET=<the production bucket name> \
node --import tsx scripts/saas/staging/storage-check.mjs --objects 1100 --sequential 25
```
It refuses unless you retype the bucket name, and refuses the production bucket. It writes only under a throw-away prefix and deletes it. Required results:
| Check | Meaning | Required |
|---|---|---|
| C1/C1b | every object appears in the **very next** listing after its upload (read-after-write) | all pass. **If C1b fails the cross-process quota can be overshot by the lag; do not allow pilot uploads (set the limit low) until the provider's behaviour is understood** |
| C2 | overwrite and delete are visible at once | pass |
| C3 | a prefix of more than one page is listed completely, once each (also with a 100-key page) | pass |
| C4 | listing latency of that prefix well below the quota's 8 s guard | p95 below 4 s; otherwise uploads would be refused as "could not verify" |
| C5 | an unsigned request is not answered with the object | pass (the repository's S3 stand-in does not check signatures, so C5 **fails there on purpose**) |
| C6 | a 300 kB object comes back byte-identical | pass |
Record the observed lag and latencies (they are the numbers `PA3` of the checklist asks for). Then repeat a **two-process** upload burst at the limit of the synthetic company (section 8) with two backend instances if production will run more than one (I7).

## 8. Functional checks on staging (synthetic company only)
1. Create the synthetic company "Rehearsal Co" in the operator console with the storage limit of I6. (This is the first pilot record: it succeeds only because steps 6.3 and 6.4 are done.) Create two users.
2. As founding admin and as Rehearsal Co admin: lead -> quotation -> contract -> invoice -> payment -> invoice PDF -> upload a file -> download it. Each sees only its own data; each company's numbering is its own.
3. Cross-company: with the Rehearsal Co token request a founding invoice id and a founding document link: 404/403. With the founding token request the Rehearsal Co ones: 404/403. Search and export lists contain only the caller's company.
4. Storage: fill Rehearsal Co to its limit with two concurrent uploads from different backend processes; exactly the number that fit are accepted; the next is refused with the clear limit message; a failed upload frees its room.
5. **Fill parity and restore on real data**: `node --import tsx scripts/saas/company-backup.mjs export --company rehearsal_co --out evidence/rc-export`, damage the company on purpose (delete an invoice, edit a lead), `restore ... --company rehearsal_co --yes`, `verify`. The founding company's rows must be byte-identical before and after (compare `export --company sunchaser` before/after). Any mismatch, and any application log line containing `not saved`, is a **stop**.

## 9. Failure drills and the recovery plan
Run each drill once on staging and write down the observed result.
| Drill | Action | Expected |
|---|---|---|
| D1 flag off with pilot data | unset `MULTI_COMPANY_ENABLED`, restart | every data route answers 503 `tenant_isolation_unavailable`; `/health` says `paused`; nothing changes in the database; switch on again: sessions issued before work |
| D2 unreachable database | stop PostgREST for 30 s | requests fail closed (503), no data; resumes by itself |
| D3 hand-deleted company row | `delete from companies where id='rehearsal_co'` with the foreign keys bypassed (synthetic company only, `set session_replication_role = replica`) | a flag-off backend stays paused; an unaware service-role request is still refused; `select app.tenancy_disable()` is refused while its rows exist. Restore the row afterwards |
| D4 migration failure | n/a on staging: covered by the disposable runs; the runner stops and records the failure | |
| D5 barrier verification fails | misconfigure `db-config` | `verify-barrier.mjs` fails; the database refuses `insert into companies`; no pilot company can exist |

**Recovery plan (rule 2 and 3).**
| Situation | Do | Never do |
|---|---|---|
| Before the marker is on (sections 3 to 5) | roll back the failing migration only (`run.mjs rollback --to <id> --yes`), or restore the backup into a fresh staging database and start again | |
| Anything goes wrong **after** the marker is on, no pilot data yet | `select app.tenancy_disable()` is allowed (no other company, no other rows); then it is the same as the row above | |
| Pilot data exists and the new backend misbehaves | keep the marker; fix forward on the new build, or run the flag-off pause (D1) to **stop** while you decide; export the company with `company-backup.mjs` for safekeeping | start the repair build or any older build "just to get back"; switch the marker off by hand; delete companies rows |
| You must return to the state before the pilot | **restore the pre-change backup into a NEW database** and point the (then older or newer) backend at it; data created since is lost, so export the pilot companies first. **Restoring a company into any new database needs the same barrier steps first** (`select app.tenancy_enable()`, `verify-barrier.mjs --confirm` against that database's PostgREST); the database refuses to create the company row otherwise (journey `company-restore`, step 7) | roll the schema back in place |
| Offboarding a company | export it (encrypted), then remove its data. **There is no `remove` command yet (code fix F3)**; until it exists, offboarding is a database-level operation done with the owner's explicit approval, and the marker stays on while any other company exists | clear the marker before the data is gone (it refuses, and that is correct) |

## 10. Evidence to return (nothing else is needed)
`baseline-rowcounts.txt`; `runner status/verify` output after each migration; `postgrest --version`; `verify-barrier` output; `storage-check` output; the founding export before/after; the Rehearsal Co export/restore/verify output; the `/health` JSON in each drill; the application log with `grep -c "not saved"`; the observed timings (migration durations, longest lock). Keep them in `docs/saas/evidence/staging-<date>/` **without** personal data (row counts and hashes only).

## 11. What a real staging can show and these disposable runs could not
The production-sized lock times of `t1` to `t8`; the real PostgREST's handling of in-database configuration (step 6.4); the real object store's listing consistency, latency and signature checking (section 7); real backend-process count behaviour; whether the restored production data has shapes (long values, odd characters, the production-only table `bills`) that the synthetic data did not have; the real backup's restore time.

## 12. Go / no-go gates for the staging run
All of: section 5 gates; step 6.4 all PASS and recorded; section 7 C1b, C3, C4, C5, C6 pass; section 8.5 restore and fill parity clean with zero `not saved` lines; drills D1 to D3 behave as expected. Any other result is a **no-go** and is reported with the output, not explained away.
