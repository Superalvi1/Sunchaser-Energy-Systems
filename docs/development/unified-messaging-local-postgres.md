# Unified Messaging — Disposable Local PostgreSQL Harness

**Purpose:** Provide a local-only, disposable Postgres database for unified-messaging schema validation.

**Scope:** Docker Compose harness, baseline apply helpers, and live SQL validation. Does **not** touch production/hosted Supabase.

---

## Files

| Path | Role |
|------|------|
| `docker-compose.messaging-test.yml` | Isolated Compose definition |
| `scripts/messaging-test-db-start.sh` | Validate config, start, wait healthy |
| `scripts/messaging-test-db-exec.sh` | Run SQL file or `-c` statement locally |
| `scripts/messaging-test-db-stop.sh` | Stop and remove **only** this harness’s resources |
| `scripts/messaging-test-db-baseline-roles.sql` | Emulated `anon` / `authenticated` / `service_role` (not full Supabase) |
| `scripts/messaging-test-db-apply-baseline.sh` | Apply roles + WhatsApp schema chain |
| `scripts/test-unified-messaging-atomicity.sql` | Controlled DDL failure + rollback probe |
| `scripts/test-unified-messaging-postgres.sql` | Live catalog/constraint/privilege/history checks |
| `scripts/test-unified-messaging-postgres.sh` | Orchestrate start → atomicity → baseline → migrate → validate → rollback → reapply |
| `scripts/test-unified-messaging-rollback.sql` | **Test-only** drop of nine `messaging_*` tables (reverse dependency order) |

---

## Local connection (disposable)

| Setting | Value |
|---------|-------|
| Image | `postgres:16.6-alpine` (pinned official image; Apple Silicon / `aarch64` compatible) |
| Host bind | `127.0.0.1:55432` |
| Database | `messaging_test` |
| User | `messaging_test` |
| Password | `messaging_test_local_only` |
| Compose project | `sunchaser-messaging-test` |
| Container | `sunchaser-messaging-test-db` |
| Volume | `sunchaser-messaging-test-pgdata` |
| Network | `sunchaser-messaging-test-net` |

If Docker Hub DNS is unavailable, pull the same official image from the AWS Public ECR mirror and retag:

```bash
docker pull public.ecr.aws/docker/library/postgres:16.6-alpine
docker tag public.ecr.aws/docker/library/postgres:16.6-alpine postgres:16.6-alpine
```

These credentials are intentionally disposable and local-only. Do **not** reuse production secrets.

Host DSN:

```text
postgresql://messaging_test:messaging_test_local_only@127.0.0.1:55432/messaging_test
```

---

## Required baseline application order

Normalized messaging DDL has **no FKs** into `whatsapp_*` tables (history must survive Meta disconnect). Coexistence still requires the repository WhatsApp schema chain so live tests can prove:

- existing `whatsapp_*` objects remain present and unaltered by messaging DDL
- deleting a `whatsapp_connections` row does not erase normalized history

Apply in this order against the disposable database only:

1. `scripts/messaging-test-db-baseline-roles.sql` — emulated roles
2. `scripts/whatsapp-transport-schema.sql`
3. `scripts/whatsapp-inbox-schema.sql`
4. `scripts/whatsapp-hardening-rc124.sql`
5. `scripts/unified-messaging-normalized-schema.sql`

Or run:

```bash
./scripts/messaging-test-db-apply-baseline.sh
./scripts/messaging-test-db-exec.sh scripts/unified-messaging-normalized-schema.sql
```

### Emulated roles (limitations)

| Role | Purpose in harness |
|------|--------------------|
| `anon` | Emulated PostgREST anonymous role (`NOLOGIN`) |
| `authenticated` | Emulated PostgREST logged-in role (`NOLOGIN`) |
| `service_role` | Emulated trusted server role (`NOLOGIN`, `BYPASSRLS`) |

This proves real PostgreSQL `GRANT`/`REVOKE`, `SET ROLE`, and RLS-enabled-with-no-policies behaviour. It is **not** full Supabase/PostgREST/JWT parity.

---

## Live validation

```bash
# Full orchestrated pass (start, atomicity, baseline, migrate, validate, rollback, reapply)
./scripts/test-unified-messaging-postgres.sh

# Or pieces:
./scripts/messaging-test-db-start.sh
./scripts/messaging-test-db-exec.sh scripts/test-unified-messaging-atomicity.sql   # expect non-zero
./scripts/messaging-test-db-apply-baseline.sh
./scripts/messaging-test-db-exec.sh scripts/unified-messaging-normalized-schema.sql
./scripts/messaging-test-db-exec.sh scripts/test-unified-messaging-postgres.sql
./scripts/messaging-test-db-exec.sh scripts/test-unified-messaging-rollback.sql
./scripts/messaging-test-db-exec.sh scripts/unified-messaging-normalized-schema.sql
./scripts/messaging-test-db-stop.sh
```

### Failure-atomicity method

`test-unified-messaging-atomicity.sql` runs `BEGIN` → `CREATE TABLE messaging_contacts` → `RAISE EXCEPTION 'controlled_failure_atomicity_test'` → aborted transaction. Catalog proof:

```sql
SELECT count(*) FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'messaging_%';
-- must be 0
```

### Test-only rollback order

`messaging_audit_logs` → `messaging_outbox` → `messaging_conversation_assignments` → `messaging_status_events` → `messaging_attachments` → `messaging_messages` → `messaging_conversations` → `messaging_contact_identities` → `messaging_contacts`

Does **not** drop `whatsapp_*` objects. Not a production migration.

---

## Safety rules

- Postgres is bound to **localhost only** (`127.0.0.1`).
- `messaging-test-db-exec.sh` rejects hosts other than `localhost`, `127.0.0.1`, or the compose service name `messaging-test-db`.
- Hosted env vars (`SUPABASE_DB_URL`, `DATABASE_URL`, `SUPABASE_DB_PASSWORD`) are **ignored**, never used for connections.
- Cleanup removes only resources named for this harness project.
- Do not run against production or shared remote databases.

---

## What this does not do

- Does not modify `server/whatsappTransport/`
- Does not wire Meta, inbox, CRM, or AI
- Does not implement a repository, dual-write, adapter, or outbox worker
- Does not install npm packages
- Does not claim hosted Supabase verification
