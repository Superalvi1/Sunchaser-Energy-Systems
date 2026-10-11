# Production topology (as read from the Railway API on 11 Oct 2026, read-only)

Public-safe: service names, images, schedules and counts only. No variable values, hostnames of private services, keys or customer data.
Nothing here was changed. "INSPECTED" = read from service configuration or logs; "INFERRED" = concluded, not read.

## 1. What runs where

All of it is one Railway project whose name says "Staging" but whose only environment is called `production` and whose custom domains are the
live ones. The names of several services do not describe what they do.

| Railway service name | What it really is | Evidence |
|---|---|---|
| `sunchaser-crm-private-smoke` | **The CRM** (Express app + web UI, serves `crm.sunchaserenergy.co`), builds `main` of this repository, health check `/health`, **1 replica**, region sfo | INSPECTED |
| `sunchaser-migration-job` | **PostgREST** (image `postgrest/postgrest:latest`, **unpinned**), restart policy always, no public domain, 1 replica, schema `public` only | INSPECTED (configuration and start-up logs) |
| `postgres-staging` | **The production database**: `postgres:17-alpine` (logs: PostgreSQL 17.11), 1 GB volume, 1 replica, no public domain | INSPECTED |
| `sunchaser-schema-bootstrap-2` | **The daily database backup job** (cron `0 20 * * *` UTC, runs `backup.sh` from the `Sunchaser-Marketing-Website` repository, folder `ops/railway-db`) | INSPECTED (configuration, logs, script read) |
| `sunchaser-quote-railway` | Smart Quote site (`smartquote` / `quote` domains) | INSPECTED |
| `sunchaser-staging` | Marketing website (`sunchaserenergy.co`) | INSPECTED |
| `superalvi1-whatsapp-ceo-agent` | WhatsApp agent service | INSPECTED (not examined further) |
| `sunchaser-marketplace-daily-price-sync-railway` | Daily marketplace price-sync cron | INSPECTED |

Suggested (owner's choice, no technical urgency): rename `sunchaser-migration-job` to `postgrest`, `sunchaser-schema-bootstrap-2` to `db-backup`, `postgres-staging` to
`postgres`, and the CRM to `crm`. A wrong name caused this review to look for PostgREST in the wrong place.

## 2. The database adapter

```
browser / Android WebView
        |  HTTPS
        v
CRM service  (server.ts, dbManager.ts -> supabase-js client, service-role key)
        |  every "/rest/v1/..." call is rewritten to RAILWAY_POSTGREST_URL      (dbManager.ts, railwayPostgrestFetch)
        v
PostgREST service  (sunchaser-migration-job, private network, port 3000)
        |  PGRST_DB_URI, schema "public", connection pool 10
        v
PostgreSQL 17.11  (postgres-staging)
```

* The CRM never talks SQL to the database: all data access is PostgREST over the private network (INSPECTED in `dbManager.ts`). Two documented exceptions
  use `pg` directly (marketplace auto-import, unified-messaging factory).
* The variable `RAILWAY_POSTGREST_URL` exists on the CRM service (INSPECTED, name only). I did **not** read its value (the variable list is shown with all
  secrets), so that it points at `sunchaser-migration-job` is INFERRED from the single PostgREST service in the project and from the start-up log that shows
  that service connected to `postgres-staging`.
* PostgREST exposes schema `public` only (INSPECTED in its log: `db-schemas=public`). Schemas such as `crm_recovery` are therefore not reachable through the API.
* PostgREST logged "166 Relations, 65 RPCs" when it last started (9 Oct 05:21 UTC, before the accounts reset). It reloads its schema cache on the `notify pgrst`
  that every migration in this release sends.
* **Risk:** the image tag is `latest`. Every redeploy or restart may pull a different PostgREST version. This release was tested with 12.2.3. Pin the tag to the
  version that is running today (Railway deployment details show the image digest) before the migrations are applied.

## 3. The existing backup job (this corrects earlier statements that no production backup existed)

* Runs daily at 20:00 UTC; the logs show a verified run every day from 26 Sep to 10 Oct 2026 (latest `database-backups/20261010T200439Z/…`, about 7.8 MB).
* `backup.sh`: `pg_dump --format=custom` (client from the `postgres:17-alpine` image) plus `pg_dumpall --globals-only --no-role-passwords`, tarred into
  `sunchaser-postgres.tar.gz`, uploaded to the Railway bucket, **read back and byte-compared** with the upload, 14-day retention. It refuses a database host that is
  not on the Railway private network.
* Because it uses `pg_dump` without a schema filter, the dump includes every schema, including `crm_recovery` (INFERRED from the script, not from a restore).

What it does **not** give you (all INSPECTED in the script, none changed):

| Gap | Why it matters |
|---|---|
| Never restored anywhere | A readable upload is not a working restore. The drill in `DEPLOYMENT_REHEARSAL.md` proves the procedure on a backup of the same format; it has not been run on a real production file |
| Not encrypted | The archive holds customer names, phones, quotations and (in `crm_recovery`) the cleared accounting records |
| Same variable names as the CRM's document storage (`RAILWAY_S3_*`) | INFERRED to be the same bucket and credentials. If so, a compromise of the CRM or of its storage key can delete the backups, and backups sit beside customer documents |
| No off-Railway copy | Deleting the project or the bucket deletes the backups too |
| Does not copy the document bucket | Uploaded documents and quotation PDFs are not part of any backup |
| Alerts | Failure of the job is only visible in logs |

`scripts/backup/pg-backup.sh` (age-encrypted, signed manifest, separate bucket credentials, offsite copy) closes the encryption/credential/offsite gaps. Running it in
addition to the existing job, rather than replacing the job, is the lowest-risk way to adopt it.

## 4. Who is affected by the accounts reset (reported by the owner on 11 Oct 2026; not independently verified by me)

The owner reports that on 9 Oct 2026 the accounting tables (2 invoices, 13 items, 2 invoice payments, 3 other payment records, 27 quotations, 1 archived party
ledger) were emptied with approval, with recovery copies in schema `crm_recovery` (tables prefixed `accounts_reset_20261009_`). Users, contacts, leads, products
and settings were kept. This repository does not restore those records and no step in the plan reads or writes `crm_recovery`.

Consequences for the plan: the invoice-payments preflight and the guard migration act on empty tables (the two invoices that disagreed with their payments are gone and are
no longer a blocker); the invoice-list size limit (about 3,300 invoices) is irrelevant for now; the first invoices created after deployment are protected by the guard from the
start. What I could verify from outside: the application's own "paid_amount mismatch" warnings stop after 9 Oct 17:47 UTC in the production logs, which is consistent with, but not proof of, the reset.
