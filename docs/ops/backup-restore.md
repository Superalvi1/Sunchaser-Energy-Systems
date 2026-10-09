# Backup and restore runbook (PROPOSED)

Status: proposed files, **nothing here has been applied to production**. Every step that touches production (creating a service,
variables, buckets, a database role, running a dump) needs the owner's explicit approval; see "Approvals" at the end.

Scope: the CRM PostgreSQL database (Railway PostgreSQL 17, service `postgres-staging`, fronted by PostgREST) and the object store
that holds customer documents and quotation PDFs. Secrets are never stored in this repository.

## 1. What a restorable backup consists of

| Part | Where it lives | Protected by |
|------|----------------|--------------|
| Database rows, schema, RLS policies, triggers, functions, sequences, ACLs, extensions | PostgreSQL | `scripts/backup/pg-backup.sh` (this runbook) |
| Cluster roles (`anon`, `authenticated`, `service_role`, `authenticator`, ...) without passwords | PostgreSQL cluster | `roles.sql` inside every backup set |
| Uploaded documents and quotation PDFs | Railway bucket `RAILWAY_S3_BUCKET` | **A separate bucket mirror (section 7).** A database dump does not contain them. |
| `RAILWAY_OBJECT_PROXY_SECRET` | Railway variables | **Password manager.** See the warning below. |
| `JWT_SECRET`, `WHATSAPP_TOKEN_ENCRYPTION_KEY`, PostgREST JWT secret / service key, database passwords | Railway variables | Password manager (never in a dump) |

**Warning - stored document links depend on `RAILWAY_OBJECT_PROXY_SECRET` (TESTED).** Every `file_url` stored in the database is a
signed link `/api/storage/object/<namespace>/<key>?sig=<HMAC(RAILWAY_OBJECT_PROXY_SECRET)>`. In the isolated restore, the same
database with a *different* secret returned HTTP 403 for every document and quotation PDF, although the objects were present. Therefore:
restore with the same secret, and treat rotating that secret as a data migration (re-sign stored links) rather than a variable change.
`APP_PUBLIC_URL`, when set, is also embedded in the stored links (INSPECTED, `buildRailwayObjectProxyUrl`).

## 2. Requirements

* A client **at least as new as the server major**. Production is PostgreSQL 17, so the job must use `pg_dump`/`pg_restore`/`psql` 17
  (`postgres:17-alpine` image, see `scripts/backup/Dockerfile`). A PostgreSQL 16 `pg_dump` is documented to refuse a 17 server (not run here: no 17 server), and a 16 `pg_restore`
  cannot read a newer archive (`unsupported version (1.xx) in file header`, simulated by patching the version bytes of a real 16 archive). The scripts check this before doing anything
  (exit code 5). *In the review sandbox `postgresql-client-17` was not installable (apt.postgresql.org is blocked by the egress proxy, Ubuntu
  noble ships 16 only, no Docker daemon), so the tooling was exercised PostgreSQL 16 -> 16; see section 9.*
* `age` (encryption), `curl` >= 7.76 (SigV4 upload), `bash` >= 4.4, coreutils, `flock`.
* A scratch PostgreSQL server of the **same major** for restore drills (a second Railway Postgres service in a *separate* project or environment,
  or a local container). Never restore onto the production service.

## 3. One-time setup (owner action, offline)

```bash
# On a trusted machine, NOT in this repository and NOT on the backup host:
age-keygen -o ~/sunchaser-backup-owner.key        # prints the public key (age1...)
age-keygen -o ~/sunchaser-backup-escrow.key       # second key, kept by a second person / safe
openssl genpkey -algorithm ed25519 -out ~/sunchaser-backup-sign.key   # optional signing key (kept in the job's secret store)
openssl pkey -in ~/sunchaser-backup-sign.key -pubout -out ~/sunchaser-backup-sign.pub
```

* The backup job receives only the **public** keys (`BACKUP_AGE_RECIPIENTS="age1owner...,age1escrow..."`). A stolen job or bucket cannot
  read old backups. Keep at least two private keys in two places; losing every private key loses every backup.
* Create a **separate, private bucket** for backups with its **own credentials** (Railway buckets are private and each has its own
  credentials). Do not reuse `RAILWAY_S3_*`: the CRM must not be able to read or delete backups and the job must not be able to touch documents.
* Create a second copy in a **different account/provider** (`BACKUP_OFFSITE_S3_*`), ideally with versioning or object lock and a
  write-only credential for the job. This is the only layer that survives deletion of the Railway project.

## 4. Configuration (environment of the backup job)

| Variable | Meaning |
|----------|---------|
| `PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE` | Database connection; on Railway reference the Postgres service variables over the **private** host (`*.railway.internal`). Alternatively `BACKUP_DATABASE_URL` (parsed in-process, never put on a command line). |
| `BACKUP_AGE_RECIPIENTS` / `BACKUP_AGE_RECIPIENTS_FILE` | age **public** recipients (required; a private key is rejected). |
| `BACKUP_SIGNING_KEY` | Ed25519 private key (PEM) used to sign `SHA256SUMS`. Strongly recommended: anyone holding only the *public* age key and bucket write access could otherwise forge a backup. |
| `BACKUP_S3_ENDPOINT` `_BUCKET` `_ACCESS_KEY_ID` `_SECRET_ACCESS_KEY` `_REGION` `_PREFIX` `_ADDRESSING` `_CACERT` | Backup bucket (`_ADDRESSING=virtual` default, `path` for older buckets). |
| `BACKUP_OFFSITE_S3_*` | Second destination, same variables. |
| `BACKUP_OUT_DIR`, `BACKUP_WORK_DIR` | Local set directory (must be outside any git checkout), and where plaintext is staged (`/dev/shm` keeps it off disk). |
| `BACKUP_KEEP_DAILY/WEEKLY/MONTHLY` | Local retention, default 14 / 8 / 12 (newest 3 are never pruned). |
| `BACKUP_MAX_SECONDS` | Safety cap for the snapshot session, default 1800. |

## 5. Taking a backup

```bash
bash scripts/backup/pg-backup.sh --out-dir /var/backups/sunchaser --prune     # exit 0 only if everything below succeeded
```

What it does, in order (all verified, any failure is non-zero and loud):

1. Checks client major >= server major, that no private key was passed, that the output is not inside the repository, takes a lock.
2. Opens **one** repeatable-read snapshot (`pg_export_snapshot`), writes the **manifest** in it and runs `pg_dump -Fc --snapshot` in it, so
   writes during the backup cannot cause false mismatches. (TESTED: with pgbench running ~1,550 write transactions/s, the manifest held the snapshot's 5,907 rows
   while the live table reached 13,887, and the restore matched the manifest.) The snapshot session ends with the script and has a server-side
   timeout; it never lingers.
3. `pg_dumpall --roles-only --no-role-passwords` plus database-level settings, so the PostgREST roles can be recreated.
4. Validates the archive (`pg_restore --list`, TOC size, one TABLE DATA entry per table), records the plaintext sha256.
5. Encrypts `db.dump`, `roles.sql`, `manifest.tsv` with age; wipes the plaintext; writes `backup-info.json` and `SHA256SUMS` (+ `.sig`).
6. Uploads every file to each configured destination and **reads it back and compares sha256**.
7. Prunes local sets (grandfather-father-son).

Dump options and why: `--format=custom --compress=6` (selective/parallel restore, compact); `--snapshot` (consistency); `--lock-wait-timeout=60s`
(never queue DDL-blocking locks for long); `--quote-all-identifiers` (safe across major versions); `--no-tablespaces` (managed hosting);
ownership and ACLs are **kept** (not `--no-owner`/`--no-privileges`) because `anon`/`authenticated`/`service_role` privileges and RLS are what PostgREST
relies on. Row-level security is not bypassed by accident: use `postgres` (superuser) or a role with `pg_read_all_data` **and** `BYPASSRLS`,
otherwise `pg_dump` fails loudly instead of silently omitting rows.

The manifest (`manifest.sql`) contains, per table, the row count and an order-independent hash of every row, plus hashes of all column, constraint,
index, trigger, policy, function, view and ACL definitions, sequence positions, extensions, roles and owners. It prints no row contents.

Exit codes: `1` precondition, `2` integrity (checksum/signature/decryption), `3` restored data differs from the manifest, `4` a dump/restore
command failed, `5` safety or version guard, `6` upload or read-back failed (the local set is intact).

## 6. Restore drill (monthly) and real restore

```bash
bash scripts/backup/fetch-backup.sh 20261009T064205Z ./restore-work          # same BACKUP_S3_* variables, read-only is enough
RESTORE_PGHOST=<scratch host> RESTORE_PGPORT=5432 RESTORE_PGUSER=postgres RESTORE_PGPASSWORD=... \
bash scripts/backup/restore-verify.sh --backup-dir ./restore-work/20261009T064205Z \
     --identity ~/sunchaser-backup-owner.key --signing-pub ~/sunchaser-backup-sign.pub \
     --keep --smoke-cmd 'bash my-smoke.sh'          # my-smoke.sh gets PGDATABASE/RESTORED_DB for the restored database
```

`restore-verify.sh` refuses to run unless the target database name matches `restore_[a-z0-9_]+`, the scratch server is not the backup's own
cluster (system identifier) and not the same host:port as `PGHOST`. It then: verifies `SHA256SUMS` and the signature, decrypts, checks the plaintext
sha256, checks versions and that required extensions exist on the scratch server, creates the database with the **source locale**, applies the
roles (never superuser/replication, never the connecting superuser), restores in **one transaction with `--exit-on-error`**, runs `ANALYZE`, builds
the manifest of the restored database and compares it with the source manifest. Any difference is exit 3 with the differing lines
(names, counts, hashes only). Sequences may only be equal or ahead.

A **real** disaster restore follows the same path with these additions: create a new PostgreSQL 17 service; run `restore-verify.sh --keep` against it
(use a database name that satisfies the guard, then rename it with `ALTER DATABASE`, or restore with the same commands by hand); set the passwords of
`authenticator` and the application role; point PostgREST (`db-uri`) at it with a **new** `jwt-secret` and issue a new service key for the CRM;
restore the bucket (section 7); restore the secrets from section 1 unchanged; start the CRM and run the smoke checklist.

Smoke checklist (automated in `scripts/backup/demo/smoke-restored.mjs`): staff login, lead list equals the database, Smart Quote versions with PDFs,
invoices equal their payment ledgers, a document and a quotation PDF download with the original sha256, a tampered signature is still refused, the
portal customer sees only their documents, a new write works and the identity sequence continues.

## 7. Object storage

A database backup does not contain files. Mirror the CRM bucket to the backup bucket after (or with) every database backup:
`rclone sync` / `aws s3 sync` with credentials that can read the CRM bucket and write the backup bucket, then verify counts and sizes, and for every
`customer_documents.storage_path`, `smart_quote_versions.pdf_storage_path` and invoice receipt path check the object exists (and for Smart Quote PDFs that its sha256
equals `pdf_sha256`). Keep object versions for 30 days so an accidental delete can be undone. `scripts/backup/demo/s3-mirror.mjs` shows the idea
against the local test store.

## 8. Retention, monitoring, drills

* Local: 14 daily / 8 weekly / 12 monthly (`--prune`). Remote: bucket lifecycle rules (the job credential should not be able to delete), versioning/object
  lock on the offsite copy. Suggested cadence: daily 02:00 UTC; extra backup immediately before any migration.
* Alert on a non-zero exit of the job (Railway deployment failure notification), and on "no new set for 26 hours" using an external heartbeat
  (e.g. ping a healthcheck URL after `BACKUP OK`).
* Monthly: `restore-verify.sh` with the smoke hook on a scratch server. Quarterly: also restore the bucket mirror and the secrets list.
* RPO = backup interval (24 h by default, plus a pre-migration backup). RTO for 50 MB is minutes plus the human steps in section 6.

## 9. What was and was not verified (review sandbox, 2026-10-09)

| Claim | Level |
|-------|-------|
| Backup, encrypt, sign, checksum, upload with read-back (SigV4 verified by an independent test store), fetch, verify, restore into a second cluster, manifest equality for 104 tables / 14,093 rows, authenticated app smoke on the restored DB (16 checks) | TESTED, PostgreSQL 16 -> 16 |
| Corruption detection: flipped byte, truncated file, re-checksummed corruption (age authentication), forged set (signature), forged set without signature (recorded sha256) | TESTED, all exit 2 |
| Data-loss detection: deleted row, changed value with equal row count, dropped policy/trigger, dump missing rows vs the manifest | TESTED, all exit 3 |
| Consistent manifest under concurrent writes | TESTED |
| Credential separation: CRM credentials cannot read the backup bucket; backup credentials cannot delete or touch the CRM bucket; altered body rejected | TESTED against a test store that enforces this policy; **real Railway bucket behaviour NOT_VERIFIED** (Railway documents per-bucket credentials, not per-prefix) |
| Version guard (PG16 client vs 17 server) | TESTED with simulated version output; a real PG17 server/client **NOT_VERIFIED** |
| `pg_dump` 17 / `postgres:17-alpine` image build / Alpine busybox behaviour of the scripts | NOT_VERIFIED (no PG17 binaries, no Docker daemon) |
| Restoring the real production schema (142 public tables, `*_backup_20260606` tables, production-only objects) | NOT_VERIFIED: no production access; only the tracked-SQL reconstruction (104 tables) was used |
| Locale/ICU: production collation and provider unknown | NOT_VERIFIED (the script refuses ICU-provider databases rather than guess) |

## 10. First production backup: options, risks, cost, approvals

Sources for Railway behaviour are web search summaries of docs.railway.com (the pages themselves could not be fetched from the sandbox), so confirm in the dashboard.

| Option | How | Risks | Cost | Approval needed |
|--------|-----|-------|------|-----------------|
| **A. Railway volume backup** (Backups tab of the Postgres service) | Manual backup now, plus daily/weekly/monthly schedules | Block-level snapshot of the data volume, not a logical dump; restores only into the *same project and environment* as a new volume; retained 6 days / 1 month / 3 months; does not survive project deletion; manual backups limited to 10/volume (per community answer); plan eligibility NOT_VERIFIED | Billed like volume storage, incremental (about 0.15-0.25 USD/GB-month; 50 MB is negligible) | Owner clicks in the dashboard; creating a schedule changes production configuration |
| **B. Cron job service in the same Railway project** running `pg-backup.sh` (image `scripts/backup/Dockerfile`) over the private network to a separate private bucket plus an offsite copy | New service with `PG*` references to the Postgres service, age public keys, bucket credentials | Job holds database credentials (use a dedicated read-only role with `pg_read_all_data` + `BYPASSRLS` after approval); misconfiguration fails silently without alerting; Railway skips a cron run if the previous is still running | Private network traffic is not billed; uploads from a service to a bucket count as service egress (50 MB: cents); buckets 0.015 USD/GB-month | **Yes: create a service and bucket in production, reference database credentials, optionally create a DB role** |
| C. Temporary TCP proxy + `pg_dump` from a workstation | Enable the public proxy on the Postgres service, dump with `DATABASE_PUBLIC_URL` | Exposes the database to the internet (even if briefly); password in transit and on a laptop; PII dump on a laptop; egress 0.05 USD/GB | negligible | **Yes: production networking change + rotate the DB password afterwards** |
| D. `railway connect postgres --tunnel-only` / `railway run` from the owner's machine | Owner-authenticated tunnel, local `pg_dump` 17 | No server change, but the dump lands on a personal machine (encrypt immediately with `pg-backup.sh`, which can run from there); needs PG17 client locally | none | Owner runs it himself; no production change |
| E. Third-party "PostgreSQL S3 Backups" template | Deploy a community template | Unreviewed code with database credentials; weaker verification | as B | Yes |

**Recommendation: B**, preceded by one click of A (a manual volume backup) immediately before the migration as a second, independent safety net. B is the only option
that gives encrypted, verified, offsite, repeatable logical backups without exposing the database publicly. If the owner does not want a new service yet,
use D for the single pre-migration backup (run `pg-backup.sh` on the owner's machine, which encrypts at once).

## 11. Approvals required before anything touches production

1. Creating the backup service / cron schedule and its variable references (option B), or enabling any Railway volume backup schedule (option A).
2. Creating the backup bucket(s) and credentials, and the offsite account.
3. Optionally creating the dedicated backup database role (`CREATE ROLE ... LOGIN; GRANT pg_read_all_data; ALTER ROLE ... BYPASSRLS`).
4. Running the first production dump (this tool only reads, but it holds a snapshot open for the duration of the dump).
5. Provisioning the scratch PostgreSQL 17 server for the restore drill.
