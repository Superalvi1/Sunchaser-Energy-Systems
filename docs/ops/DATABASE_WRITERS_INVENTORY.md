# Inventory of every database writer, script and cron service

Status: **repository inventory, made by reading the code and by running the checks named in the last column. Nothing here was run against production.** What the repository cannot show is listed at the end under "Not visible from the repository" and is an owner action.

## The rule this inventory serves
Once a second company exists, a process that reads or writes company data **without keeping companies apart** is a leak. Three layers now stand between such a process and the data (migration `t1b-tenancy-barrier`, `server/saas/tenantIsolationGuard.ts`):

| Layer | What it stops | Where it lives | Window |
|---|---|---|---|
| **Database barrier** (persistent marker + PostgREST pre-request) | every process that talks to the database **through PostgREST with the service key** and does not declare `x-isolation-mode: multi` (older backends, scripts, flag-off processes of the new build) | in the database | none: starts in the transaction that sets the marker (measured: 135 requests in the first 3 s after the marker was switched on, all refused, 0 served) |
| **Isolation guard** | a flag-off process of the new build; the database client itself throws | in the new build | up to 5 s (the database barrier covers it meanwhile) |
| **Code restrictions** | direct PostgreSQL connections (which PostgREST never sees) and one-off routes | in the code | none |

What none of them can stop: a human or program with a **direct PostgreSQL connection as a privileged role** (`psql`, a connection string) that does not run one of the checked scripts, and anyone holding the service key who sends `x-isolation-mode: multi` without keeping companies apart. Those are access-control questions (who holds the credentials), listed under "Not visible from the repository".

Marker lifecycle: `select app.tenancy_enable();` (operator, before the first pilot company) -> `node scripts/saas/verify-barrier.mjs --confirm` (proves the barrier over HTTP, records it) -> the first pilot company can be created -> `select app.tenancy_disable();` is the only way back and it refuses while any other company or any other company's row exists. Deleting a `companies` row clears nothing.

## 1. The web server (`server.ts` and its modules)
| Path | Reaches the database by | Company data? | Control | Evidence |
|---|---|---|---|---|
| Every API route | `getSupabase()` (one factory in `dbManager.ts`): flag on = a tenant client bound to the company (role `crm_tenant`, row-level security); `runAsSystem` = the service client, header `multi`. Flag off = the service client, header `single`, guard armed | yes | row-level security + ownership guard + route scope table (every route has a scope; unmatched = refused) + the three layers above | `tenant-isolation-matrix` (every tenant table), `two-company-*`, `tenant-isolation-guard` (47 checks), `dbClientSelection.test.ts`, route-scope test |
| Background timers in `server.ts`: sales-agent drain (5 s), daily backup file (24 h) | founding-company context | founding only | skipped while the guard is closed; with the flag on they run as the founding company (tenant client) | `tenantIsolationGuard.test.ts`, journey step B |
| `POST /api/admin/maintenance/production-backup-20260606` and `.../production-cleanup-20260606` (`productionCleanupDb.ts`) | **direct `pg` connection** (all companies, no row-level security) plus the service client | would be | **404 whenever the multi-company flag is on**; scope `founding_only`; the direct connection refuses a database whose marker is on. They were `company` scope before this round: a pilot company's Super Admin could have reached them | scope policy; `productionCleanupDb.ts`; journey H/B (flag-off processes are paused) |
| Object storage (`railwayObjectStorage.ts`) | S3 API, not the database; keys are `c/<company>/...`; quota reserved in the database (`t8`) | yes | company-prefixed keys, signed links, quota | `storage-*`, `two-company-complete` |
| Marketplace / learning / WhatsApp-agent routes | `getSupabase()` | **no** (`sunchaser_only` tables, no pilot data possible) | scope `founding_only`: a pilot user gets 404 before any handler runs | `disabled-modules` (17/17) |
| Unified messaging pool (`messagingProductionFactory.ts`, `UNIFIED_MESSAGING_POSTGRES_ENABLED`) | **direct `pg` pool** on `DATABASE_URL` | no (`messaging_*` are `dormant`, Sunchaser WhatsApp only) | off by default; the routes that feed it are founding-only; keep it **off** during the pilot (owner action O6) | classification; `disabled-modules` |
| Marketplace CEO auto-import (`server/marketplace/autoImport/autoImportPg*.ts`) | **direct `pg` connection with its own role** | no (`mp_auto_import_*` only) | the role's privileges are limited to those tables (tested) | `test:marketplace-ceo-auto-import-privileges` (CI, PostgreSQL 16 and 17) |

## 2. Cron services
| Service | Entry | Reaches the database by | Company data? | Control |
|---|---|---|---|---|
| Marketplace daily price sync (`Dockerfile.railway-marketplace-cron`, `npm run marketplace:price-sync:daily`) | `scripts/marketplace-daily-price-sync.ts` | the service client (PostgREST) | **no**: `mp_*` tables only | the script now calls `declareGlobalOnlyProcess(...)`; the database lets a global-only job reach `mp_*` / `learning_*` paths **and nothing else**, so it keeps working after the first pilot company exists and cannot read pilot data. Verified: `verify-barrier.mjs` step 5, `test-tenancy-barrier.sh` |
| Any other scheduler | none found in the repository (`setInterval` in `server.ts` only) | | |

The Railway/Render cron configuration itself is outside the repository: confirm the list of services (owner action O5).

## 3. Operator scripts that can write (`scripts/`)
| Script | Reaches the database by | Control after this round |
|---|---|---|
| `execute-production-cleanup-20260606.mjs` | direct `pg` | **refuses** a database whose tenancy marker is on or that holds another company (`scripts/lib/assertSingleCompanyDatabase.mjs`) |
| `sync-users-supabase.mjs` | direct `pg` (DDL) and PostgREST | same check on the direct part; the PostgREST part is refused by the barrier |
| `cleanup-demo-leads.mjs`, `run-cleanup-direct.mjs`, `verify-login.mjs`, `verify-client-portal.mjs`, `verify-supabase.ts`, `productionCleanupDb.ts` (as a library) | PostgREST with the service key, **no header** | refused by the database barrier while the marker is on (HTTP 503 `tenant isolation barrier`); unchanged before the first pilot company |
| `scripts/verify-*-local.mjs`, `verify-delivery-*.mjs`, `verify-project-delivery-dashboard.mjs`, `verify-auto-costing-from-contract.mjs` | local JSON mode (they delete the service key) | no database |
| `scripts/migrations/run.mjs` (the migration runner) | `psql` as the owner | the runner is the tool; `t1b`'s rollback is refused while the marker is on |
| `scripts/saas/company-backup.mjs` (export / restore of ONE company) | direct `pg` as the owner | tenant-aware by design; refuses a non-local host without `--allow-remote`; **there is no `remove` command** (code fix F3) |
| `scripts/saas/make-tenant-key.mjs`, `verify-barrier.mjs` | none / read-only HTTP (+ one `psql` call with `--confirm`) | |
| `scripts/backup/pg-backup.sh`, `restore-verify.sh` | `pg_dump` (read-only) / restore into a scratch server (refuses to restore onto the source) | read-only on the source |
| `scripts/rehearsal/*.sh` | read-only on the source, writes only into a scratch server (refuses non-local scratch) | |

## 4. Test and harness code (disposable databases only)
`scripts/e2e-crm-repair/*`, `scripts/saas/e2e/*`, `scripts/saas/tests/*`, `scripts/saas/ci/*`, `scripts/saas/tenant-isolation-matrix.mjs`, `scripts/backup/demo/*`, `scripts/messaging-test-db-exec.sh`, `scripts/test-unified-messaging-postgres.sh`, `scratch/*`. The saas harness refuses a database that looks hosted (`railway`, `supabase`, `rlwy`, `amazonaws`) or non-local. `scratch/*` and `verify-supabase.ts` are ad hoc and take a service key from the environment: they are covered by the barrier like any other PostgREST client, and must not be given a production key (owner action O4).

## 5. Other trees in the repository
| Tree | What it is | Status |
|---|---|---|
| `sunchaser-crm/` | an old nested copy of the application (own `server.ts`, `dbManager.ts`, a service-key client). Not referenced by the root build, `package.json`, the Dockerfile or CI | **must not be deployed.** If a service were built from it, the barrier would still refuse its service-role requests once the marker is on (it declares nothing), but it must not run at all (owner action O7: confirm which directory each hosted service builds from). Code fix F5 proposes deleting it |
| `learning-studio/` | its own service and database (`TARGET_DATABASE_URL`) | a different database; not part of this one |
| `android/`, `ios/`, `src/` | clients of the HTTP API | no database access |

## 6. Not visible from the repository (owner / operations)
* Which services exist on the hosting provider and from which directory each is built (the old `sunchaser-crm/` copy, extra workers, a second web service, a cron I have not seen).
* Who holds `SUPABASE_SERVICE_ROLE_KEY`, the PostgreSQL owner/superuser password and `DATABASE_URL` (the barrier does not stop a privileged direct connection). Pre-deploy item 1 (credential rotation) is still open.
* Whether the production PostgREST reads in-database configuration (`db-config`, default on) and has no `db-pre-request` in its own configuration file: **`verify-barrier.mjs` answers this**, on staging first.
* Any SQL console, BI tool, analytics export or backup job connected to the database.
