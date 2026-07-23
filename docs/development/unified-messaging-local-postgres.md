# Unified Messaging — Disposable Local PostgreSQL Harness

**Purpose:** Provide a local-only, disposable Postgres database for unified-messaging schema validation.

**Scope:** Docker Compose harness + helper scripts only. Does **not** apply `scripts/unified-messaging-normalized-schema.sql` automatically. Does **not** touch production/hosted Supabase.

---

## Files

| Path | Role |
|------|------|
| `docker-compose.messaging-test.yml` | Isolated Compose definition |
| `scripts/messaging-test-db-start.sh` | Validate config, start, wait healthy |
| `scripts/messaging-test-db-exec.sh` | Run SQL file or `-c` statement locally |
| `scripts/messaging-test-db-stop.sh` | Stop and remove **only** this harness’s resources |

---

## Local connection (disposable)

| Setting | Value |
|---------|-------|
| Image | `postgres:16.6-alpine` (pinned official image; Apple Silicon / `aarch64` compatible) |

If Docker Hub DNS is unavailable in your environment, pull the same official image from the AWS Public ECR mirror and retag:

```bash
docker pull public.ecr.aws/docker/library/postgres:16.6-alpine
docker tag public.ecr.aws/docker/library/postgres:16.6-alpine postgres:16.6-alpine
```
| Host bind | `127.0.0.1:55432` |
| Database | `messaging_test` |
| User | `messaging_test` |
| Password | `messaging_test_local_only` |
| Compose project | `sunchaser-messaging-test` |
| Container | `sunchaser-messaging-test-db` |
| Volume | `sunchaser-messaging-test-pgdata` |
| Network | `sunchaser-messaging-test-net` |

These credentials are intentionally disposable and local-only. Do **not** reuse production secrets.

Host DSN:

```text
postgresql://messaging_test:messaging_test_local_only@127.0.0.1:55432/messaging_test
```

---

## Commands

From any working directory (scripts resolve the repository root):

```bash
# Start + wait healthy
./scripts/messaging-test-db-start.sh

# Execute SQL
./scripts/messaging-test-db-exec.sh -c "SELECT version();"
./scripts/messaging-test-db-exec.sh path/to/file.sql

# Stop and delete this harness container/network/volume only
./scripts/messaging-test-db-stop.sh
```

Optional timeout override for start:

```bash
MESSAGING_TEST_DB_HEALTH_TIMEOUT_SEC=120 ./scripts/messaging-test-db-start.sh
```

---

## Safety rules

- Postgres is bound to **localhost only** (`127.0.0.1`).
- `messaging-test-db-exec.sh` rejects hosts other than `localhost`, `127.0.0.1`, or the compose service name `messaging-test-db`.
- Hosted env vars (`SUPABASE_DB_URL`, `DATABASE_URL`, `SUPABASE_DB_PASSWORD`) are **ignored**, never used for connections.
- Cleanup removes only resources named for this harness project.
- Do not run against production or shared remote databases.

---

## What this does not do

- Does not apply WhatsApp or normalized messaging migrations by default
- Does not modify `server/whatsappTransport/`
- Does not wire Meta, inbox, CRM, or AI
- Does not install npm packages

---

## Next step (separate task)

After the harness is available, a later task may apply prior schema scripts and `scripts/unified-messaging-normalized-schema.sql` inside this disposable database for live constraint/RLS validation.
