# SYNC-14C-A — Contact identity `name_source` release sequencing

**Status:** Review-only release pack. **Do not apply SQL** until human approval.  
**Base application tip:** `40dd436` (PR #12 — contact identity upgrades).  
**Scope:** Expand `public.whatsapp_contacts.name_source` check constraint to allow `whatsapp_verified` and `whatsapp_legacy`.  
**Out of scope:** LID→phone durable mapping (Agent 2), optional legacy backfill apply, production deploy/restart.

---

## Artifacts

| Step | File | Mode |
|------|------|------|
| Preflight | `scripts/sync14c/sync14c-name-source-preflight.sql` | Read-only |
| Forward | `scripts/sync14c/sync14c-name-source-forward-migration.sql` | DDL (constraint only) |
| Post-verify | `scripts/sync14c/sync14c-name-source-post-verify.sql` | Ephemeral conbin proof (add/drop reference check only); RAISE EXCEPTION on failure |
| Rollback | `scripts/sync14c/sync14c-name-source-rollback.sql` | DDL (constraint only) |
| Optional backfill | `scripts/sync14c/sync14c-name-source-backfill-optional-DISABLED.sql` | **Disabled** |
| Static check | `scripts/validate-sync14c-name-source-migration-pack.mjs` | Local Node |
| PR #12 review-only precursor | `scripts/whatsapp-web-contact-name-source-sync14b-migration.sql` | Superseded for apply |

Mechanism: manual Supabase SQL Editor (repository convention). No Supabase CLI migration directory for this change.

---

## Schema findings (repository)

From `scripts/whatsapp-transport-schema.sql` + `scripts/whatsapp-web-contact-history-sync-migration.sql`:

- `whatsapp_contacts` has unique `(company_id, phone_e164)`.
- History sync adds `name_source`, `wa_jid`, `is_business_contact`, `last_synced_at`.
- Current check (pre-expansion): `NULL` or `manual | whatsapp_saved | whatsapp_push | whatsapp_short | phone`.
- Unique partial index: `(company_id, wa_jid) WHERE wa_jid IS NOT NULL`.
- RLS enabled; anon/authenticated DML revoked; backend via `service_role`.
- This pack does **not** change RLS, grants, indexes, or tenant columns.

---

## Required operator sequence

```text
preflight
  → backup/checkpoint
  → forward migration
  → post-verify
  → code merge (PR #12 / this pack as approved)
  → deployment
  → smoke test
  → (rollback triggers if needed)
```

### 1. Preflight

1. Confirm Supabase org / project name / project ref in Dashboard (do not trust SQL session identity).
2. Confirm PITR or restorable backup.
3. Run `scripts/sync14c/sync14c-name-source-preflight.sql`.
4. Require NOTICE: `PASS: SYNC-14C-A preflight`.
5. Review result sets: constraint def, value counts, invalid values, null-source rows, phone-like names, duplicate risks.
6. Any `STOP:` → halt.

### 2. Backup / checkpoint

1. Record operator, UTC time, project ref, git SHA under review.
2. Confirm restore path (PITR window or snapshot).
3. Do not proceed without restorable checkpoint.

### 3. Forward migration

1. Apply **only** `scripts/sync14c/sync14c-name-source-forward-migration.sql`.
2. Expect NOTICE: `PASS: SYNC-14C-A forward migration complete` (or already-expanded no-op).
3. Do **not** apply the disabled backfill script.

### 4. Post-migration verification

1. Run `scripts/sync14c/sync14c-name-source-post-verify.sql`.
2. Require NOTICE: `PASS: SYNC-14C-A post-verify` (any failure **RAISE EXCEPTION** / aborts).
3. Confirm conbin equals the exact forward reference predicate, `convalidated=true`, temp/ref names gone, RLS still on, no anon/authenticated DML grants.

### 5. Code merge

1. Merge approved SYNC-14B application changes (PR #12) only after DB allow-list is expanded (or in a controlled window where writers cannot race a rollback).
2. Preferred: **DB forward first**, then merge/deploy app that persists `whatsapp_verified`.

### 6. Deployment

1. Deploy application build that includes ranked contact identity writers.
2. No WhatsApp sync / send / media / AI enablement as part of this migration pack itself.
3. Keep feature flags / operator runbooks unchanged unless separately approved.

### 7. Smoke test (post-deploy)

1. Confirm contact upsert with verified/saved name does not error on `name_source`.
2. Confirm manual CRM names remain protected (app-level).
3. Confirm inbox still masks phone privacy fallbacks.
4. Confirm no RLS/policy regressions on contacts API routes.

### 8. Rollback triggers

Roll back **application first** if writers already emit `whatsapp_verified`, then consider SQL rollback.

SQL rollback (`scripts/sync14c/sync14c-name-source-rollback.sql`) is allowed only when:

- zero rows have `name_source in ('whatsapp_verified','whatsapp_legacy')`;
- operator accepts restoring the narrower allow-list;
- post-rollback verification shows the old constraint definition.

If expanded values already exist in data, SQL rollback **fails closed** — requires a separate data plan (not in this pack).

---

## Idempotency / fail-closed (SYNC-14C-A-R2)

- Forward, rollback, and post-verify prove the **complete CHECK predicate** via `pg_constraint.conbin` equality against an ephemeral exact reference constraint (not regex/set-only matching).
- Constraints that merely contain `IS NULL`, `IN`/`ANY`, and the expected values — but add `AND`/`OR` clauses, other columns, functions, or other shapes — are **not proven**.
- Temporary mismatches **STOP fail-closed**. Unproven canonical ⇒ **rebuild** (never no-op/promote).
- Final no-op / PASS require `convalidated = true` and conbin proof.
- Post-verify **RAISE EXCEPTION** on failure (not NOTICE-only).
- Repeat forward / repeat rollback are idempotent no-ops only after conbin-proven validated equality.

---

## Lock / downtime risks

| Step | Lock / impact | Notes |
|------|----------------|-------|
| `ADD CONSTRAINT … NOT VALID` | Short `ACCESS EXCLUSIVE` for catalog | No full table rewrite |
| `VALIDATE CONSTRAINT` | `SHARE UPDATE EXCLUSIVE` | Concurrent reads/writes typically continue; avoids long exclusive rewrite |
| `DROP` / `RENAME CONSTRAINT` | Brief `ACCESS EXCLUSIVE` | Catalog-only, usually milliseconds |
| Data rewrite | **None** in forward path | Forward migration does not UPDATE rows |
| RLS/grants | **None** | Not modified |

Expected downtime: **none** for a small/medium `whatsapp_contacts` table. Validate may take longer on very large tables but should not require a maintenance window for this allow-list expansion.

---

## Backfill recommendation

- **Do not run** `sync14c-name-source-backfill-optional-DISABLED.sql` in SYNC-14C-A.
- Application already treats nonempty `profile_name` + `name_source IS NULL` as effective `whatsapp_legacy`.
- Optional stored provenance backfill is a later, separately approved data rewrite with batching and its own verification.

---

## Static validation (local)

```bash
node scripts/validate-sync14c-name-source-migration-pack.mjs
# or
npm run test:sync14c-name-source-migration-pack
```

This does **not** connect to production and does **not** apply SQL.
