# Unified Messaging — Normalized Persistence Schema

**Scope:** Task 3 additive schema + repository contracts only.  
**SQL:** `scripts/unified-messaging-normalized-schema.sql` (manual apply; do not auto-apply)  
**TS contract:** `server/unifiedMessaging/messagingRepository.ts`  
**Baseline contracts:** Task 2 (`server/unifiedMessaging/transportTypes.ts`)

---

## Table purposes and relationships

```
messaging_contacts
  └── messaging_contact_identities  (org+contact FK, unique per connection/provider identity)
  └── messaging_conversations       (org+contact FK; opaque connection_id)
        └── messaging_messages      (org+conversation FK; inbound/outbound idempotency)
              ├── messaging_attachments
              └── messaging_status_events
        └── messaging_conversation_assignments  (append-only history)
messaging_outbox                    (DB→worker; no worker in this task)
messaging_audit_logs                (immutable for normal app roles)
```

Composite foreign keys use `(organization_id, id)` unique keys on parents so relationships cannot cross organizations.

`connection_id` is an opaque transport connection reference (may equal `whatsapp_connections.id` later). There is **no** FK to `whatsapp_connections`, so disabling/deleting a Meta connection cannot cascade-erase normalized history.

---

## Tenant boundary

- Every business table has `organization_id text not null` (default `'sunchaser'`).
- This maps to the same placeholder scope as WhatsApp `company_id`; it is **not** yet an active membership RLS boundary.
- **Repository convention:** RLS ON, **no policies**, `revoke all … from anon, authenticated`. Access is via Node service-role API routes only (same as `whatsapp_*` tables).
- **Missing dependency:** There is no safe organization-membership SQL helper in this repository. This schema therefore does **not** invent `using(true)` or authenticated membership policies. Application-layer `organizationId` scoping is required when a gateway is wired.

---

## Idempotency constraints

| Path | Rule |
|------|------|
| Inbound | Unique `(organization_id, connection_id, transport_type, external_message_id)` **where** `external_message_id is not null` |
| Outbound | Unique `(organization_id, connection_id, client_idempotency_key)` **where** `client_idempotency_key is not null` |
| Status | Unique `(organization_id, message_id, external_status_id)` **where** `external_status_id is not null` |
| Outbox | Unique `(organization_id, idempotency_key)` |
| Identity | Unique `(organization_id, connection_id, transport_type, external_user_id)` |

Partial unique indexes ensure PostgreSQL nulls do not block legitimate rows lacking an external/client key.

Repository operations return explicit `created` vs `existing` outcomes (`IdempotentOutcome`).

---

## Retention / history behaviour

- Conversation assignment rows are append-only (`ended_at` closes a period; history is kept).
- Status events are append-only.
- Audit logs are append-only for application roles (no update/delete grants).
- Message/conversation rows use `ON DELETE RESTRICT` from parents — history is not casually wiped.
- Transport disconnect must not erase messages (no FK cascade from WhatsApp connections).

---

## Attachment privacy

- `messaging_attachments.object_key` stores a **private object storage key**.
- CHECK rejects `http://`, `https://`, and `//` prefixes.
- No permanent public URL columns; no binary content in-row.
- Not a public media bucket contract.

---

## Outbox ownership

- `messaging_outbox` is owned by backend workers (future).
- Statuses: `pending | processing | completed | failed | dead_lettered`.
- Claim-friendly index on `(status, available_at, created_at)` where `status = 'pending'`.
- **Not browser-writable** (RLS lockdown + revoke).
- **No worker implemented in this task.**

---

## Audit immutability

- Normal application roles (`anon`, `authenticated`) have zero grants.
- No update/delete policies exist.
- Service-role backend may insert; mutating audit rows is out of policy for app code.

---

## Compatibility with existing Meta tables

- This migration is additive and must not `DROP`/`ALTER`/`RENAME` any `whatsapp_*` object.
- Official Meta traffic continues to use `server/whatsappTransport/` and `whatsapp_*` tables.
- Normalized tables coexist until a compatibility façade dual-writes or migrates.

## Live disposable PostgreSQL validation

Against the local harness (`docs/development/unified-messaging-local-postgres.md`):

```bash
./scripts/test-unified-messaging-postgres.sh
```

Proves DDL apply, RLS/privilege posture, composite tenant FKs, CHECK alignment with Task 2 contracts, idempotency unique indexes, attachment privacy, history-preserving connection delete, outbox claim index via `EXPLAIN`, and rollback/reapply — without contacting hosted Supabase.

---

## Future compatibility-façade insertion point

1. Implement gateway services over `MessagingRepository`.
2. Add Supabase-backed repository implementation (service role).
3. Introduce `OfficialMetaAdapter` that emits normalized events.
4. Dual-write or backfill from `whatsapp_*` → `messaging_*` without cutting Meta traffic mid-flight.
5. Only then switch inbox reads.

---

## What is intentionally not wired yet

- No production DB client for `MessagingRepository`
- No Meta adapter / webhook changes
- No inbox read/write changes
- No CRM lead creation
- No AI behaviour
- No outbox worker
- No QR connector
- No membership-based RLS policies

---

## Rollback approach

Forward-only additive DDL. Rollback (manual, destructive) would be:

```sql
-- ONLY if no production data depends on these tables:
drop table if exists public.messaging_audit_logs;
drop table if exists public.messaging_outbox;
drop table if exists public.messaging_conversation_assignments;
drop table if exists public.messaging_status_events;
drop table if exists public.messaging_attachments;
drop table if exists public.messaging_messages;
drop table if exists public.messaging_conversations;
drop table if exists public.messaging_contact_identities;
drop table if exists public.messaging_contacts;
```

Do **not** roll back by altering WhatsApp tables. Prefer leaving unused tables in place until a planned cutover.

---

## CHECK vs ENUM

Repository convention uses `text` + `CHECK (... in (...))` (optionally `NOT VALID` then `VALIDATE`), not PostgreSQL `ENUM` types. Values are aligned with Task 2 TypeScript unions via `SQL_ALIGNED_ENUMS`.

---

## Verification

- Static: `node scripts/validate-unified-messaging-schema.mjs`
- Tests: `npm run test:unified-messaging-schema` (static only; no live DB required)
