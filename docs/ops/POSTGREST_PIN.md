# PostgREST image pin (prepared 11 Oct 2026 - NOT applied; production was not changed)

The PostgREST service (named `sunchaser-migration-job`, see `PRODUCTION_TOPOLOGY.md`) runs `postgrest/postgrest:latest`. A floating tag means every restart,
redeploy or Railway-side move can silently change the version that sits between the CRM and the database. This page fixes one version to pin to, shows how it was verified,
what was tested against it, and how to change it back.

## 1. The version to pin and how it was verified

| Item | Value | How it was established |
|---|---|---|
| Version | **PostgREST 16.4** | Docker Hub tag list: tags `v16.4` and `latest` have the same digest; the binary was extracted from the image and reports `PostgREST 16.4` |
| Image reference to use | `postgrest/postgrest:v16.4@sha256:d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df` (tag form without digest: `postgrest/postgrest:v16.4`) | Digest of the multi-architecture index |
| linux/amd64 manifest | `sha256:bee9e1efe9d90d8f6be359f756e039dbb6e1972474bc271b7c49c5a495911a41` | Fetched and hashed; the SHA-256 of the bytes equals the digest |
| linux/arm64 manifest | `sha256:c3638ac25258ede665db66a4052b6fd30db4f22789327dce84599409136da35f` | From the index |
| Image content | single static binary, `CMD ["/bin/postgrest"]`, port 3000, image created 2026-08-02, tags pushed 2026-09-24 05:32 UTC | Image config read from the registry |
| Two independent channels | Docker Hub web API (digest shown for `latest` and `v16.4`) and the registry bytes served by `mirror.gcr.io` (hashed locally) agree on `d155c6718ed9...` | Both read on 11 Oct 2026; Docker Hub's anonymous registry was rate-limited that day, which is why the mirror was used for the bytes |
| Binary tested | extracted from the verified layer (`sha256:9d7a4870f477...`, digest checked against the manifest) | Run in the journeys below |

**What is running in production now is INFERRED, not read.** Railway's deployment record shows only the reference `postgrest/postgrest:latest`. The current deployment was created on
9 Oct 2026 05:21 UTC; `latest` has pointed at v16.4 since 24 Sep 05:32 UTC; so the running image should be v16.4. Supporting evidence: its start-up log says
"Schema cache loaded ... 65 RPCs", the wording PostgREST 16.4 produced here (PostgREST 12.2.3, the version used for most earlier testing, says "Functions"). Contradicting evidence: none found.
It cannot be excluded that Railway reused a cached older image.

**Record before changing (step 1 of section 3; read-only, needs your Railway login).** The PostgREST root document reports its own version, and `scripts/rehearsal/postgrest-record.sh`
asks it through the CRM container (the service key is expanded inside the container and never shown), looks the version tag up on Docker Hub and writes `~/postgrest-current-image-record.txt`:
```bash
bash scripts/rehearsal/postgrest-record.sh        # from the pinned checkout used for the restore rehearsal
```
Honest limit: PostgREST can tell its **version** but not its **image digest**. The digest in the record is Docker Hub's current digest for that version tag; the dashboard's deployment details
are the only other place to look (write down the active deployment id). If the script prints `STOP`, do not change anything and send me the message. (`railway ssh` syntax was not tested.)

## 2. Compatibility checks (EXECUTED where stated)

| Check | Result |
|---|---|
| Configuration keys production sets (`PGRST_DB_URI`, `PGRST_DB_SCHEMAS`, `PGRST_DB_ANON_ROLE`, `PGRST_JWT_SECRET`, `PGRST_SERVER_HOST`, `PGRST_SERVER_PORT`) | All still valid; v16.4 started and served with the equivalent file-config keys. No `jwt-role-claim-key` is set (the only removed syntax in the v16 changelog concerns it) |
| PostgreSQL 17.11 | v16.4 connected, listened on the `pgrst` channel and loaded the schema cache against PostgreSQL 17.11 |
| Whole journey suite against **v16.4** on a fresh PostgreSQL 17.11 stack with all four migrations (`scripts/rehearsal/run-journeys.sh`) | 0 failing journeys: Smart Quote 16, staff CRM 6, finance 8, portal link 1, documents 14, rename 7, sessions 8, WhatsApp 10, payment concurrency 11, quote links 69, independent verify 54, **server logout 53** (including the two scenarios that restart PostgREST), compatibility matrix 0 unsafe / 0 degraded, concurrent edits 0 inconsistent, two-instance payments 0 overpaid |
| Browser logout journey (web UI, desktop Chromium) | 7 of 7 |
| Schema reload on v16.4 | `j9-logout.mjs` applies the session-revocation migration (twice) against the running app and checks that revocation activates without a restart (check `M2`), then stops and restarts PostgREST for the lookup-failure scenarios (`G4/G5`); all passed on 16.4 |
| Same suite against PostgREST 12.2.3 (the earlier version) | passed earlier on PostgreSQL 16 and on 17.11 |
| A first attempt to run the browser journeys against v16.4 failed | Cause: journeys were re-run on a database the first run had already used, and one rate-limit override clashed with a test that expects the default. It is a harness issue, not a PostgREST difference; a fresh stack passes everything |

Not tested: the real production database, the Railway private network, the real service key/role setup, Railway's handling of the `@sha256` form (see section 3).

## 3. How to apply it (after your approval - gate G3; one change, in a quiet window)

1. **Record first.** Run `bash scripts/rehearsal/postgrest-record.sh`. Required outcome: `OK: this is exactly the image the release was tested with (v16.4, sha256:d155...)` and exit 0. Keep the file
   `~/postgrest-current-image-record.txt`: it is the **only** source for the rollback in section 4. If the version is not 16.4, or the script cannot read it, **stop**: nothing below applies.
   Also write down the active deployment id from the Railway dashboard (service `sunchaser-migration-job` -> Deployments).
2. Railway dashboard -> project "Sunchaser Railway Staging" -> service `sunchaser-migration-job` -> Settings -> Source -> Image:
   enter `postgrest/postgrest:v16.4@sha256:d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df`.
   If Railway rejects the `@sha256` form, use `postgrest/postgrest:v16.4` (a version tag is far more stable than `latest`; the digest is the extra guarantee). Whether Railway accepts the digest form is NOT tested.
3. Deploy. PostgREST restarts in seconds; the CRM's database calls fail during that window, so do it in a quiet minute.
4. Verify immediately:
   * the new deployment's log shows `Schema cache loaded N Relations, N Relationships, N RPCs` with the same N as before the change (166 / 112 / 65 on 9 Oct; the numbers will differ once you add objects), and `Successfully connected to PostgreSQL 17.x`;
   * `bash scripts/rehearsal/postgrest-record.sh` again now prints version 16.4;
   * `https://crm.sunchaserenergy.co/health` answers `ok`; log in; open the lead list; create and then delete one synthetic lead;
   * `railway logs -s sunchaser-crm-private-smoke` shows no burst of 5xx or `PGRST` errors.
5. Write down the date and the reference you set.

## 4. Rollback (only to the exact image recorded in step 1)

The rollback target is the line `ROLLBACK REFERENCE:` in `~/postgrest-current-image-record.txt` and nothing else. **Never** roll back to `postgrest/postgrest:latest` (it floats and may differ from what was recorded),
and never to a version that was not recorded as running (an earlier suggestion of `v16.3` is withdrawn: it was never run with this application).

| Situation | Action | Time |
|---|---|---|
| The pinned deployment fails or CRM errors rise | Settings -> Source -> Image: enter the `ROLLBACK REFERENCE` from the record file exactly and deploy. If it equals the pin (the running version was already 16.4) this changes nothing in the software, so first look for a different cause (logs, database) | about a minute |
| You want the exact previous deployment | Deployments -> the deployment id you wrote down in step 1 -> Redeploy / Rollback. Caveat: that deployment's image setting was `latest`, so a redeploy may pull whatever `latest` is at that moment, which can differ from the record; prefer the line above | about a minute |
| The record file is lost | Do not guess. Re-run `postgrest-record.sh` only while the old image still runs; otherwise ask me (the verified fallback is v16.4 with the digest in section 1, which is what the release was tested with) | n/a |
| After migrations M1-M4 are applied | The migrations do not depend on the PostgREST version; rolling PostgREST back does not require rolling the migrations back (they were also verified on 12.2.3) | n/a |

Do not change the pin and a migration in the same window: if something breaks, the cause must be obvious.
