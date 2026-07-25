# Unified Messaging — Supabase SQL Editor Deployment Runbook

**Mechanism (selected for first deployment):** Manual Supabase SQL Editor  
**Canonical production DDL (only):** `scripts/unified-messaging-normalized-schema.sql`  
**Approved artifact SHA-256:**

```text
b65932bd6f90d2368b624d3b4938d6d2ebaba4079203b47a2808902281841bc4
```

**Do not** introduce Supabase CLI (`supabase/config.toml`, `supabase/migrations/`) for this deployment.  
**Do not** create a second production copy of the DDL.  
**Do not** apply `scripts/test-unified-messaging-rollback.sql` (or any test harness SQL) to hosted Supabase.

---

## Why this mechanism

- The repository historically applies production SQL via the Supabase SQL Editor (`DEPLOYMENT.md`, WhatsApp schema headers).
- Task 4D concluded CLI migrations are not yet authoritative here.
- The normalized schema was validated against disposable PostgreSQL; that is **not** full Supabase/PostgREST/JWT parity. Hosted preflight + post-deploy catalog checks remain mandatory.

---

## Updating the approved checksum (intentional DDL revision)

When a reviewed change to `scripts/unified-messaging-normalized-schema.sql` is approved:

1. Edit **only** that canonical file (no parallel migration copy).
2. Recompute: `shasum -a 256 scripts/unified-messaging-normalized-schema.sql`
3. Update the checksum in **this runbook** and in  
   `scripts/validate-unified-messaging-deployment-readiness.mjs` (`APPROVED_CANONICAL_DDL_SHA256`).
4. Re-run `npm run test:unified-messaging-deployment-readiness` and the disposable Postgres suite.
5. Record the reviewing commit SHA in the deployment log.

Unexpected checksum mismatches fail the automated readiness check.

---

## Project identity and environment

| Item | Repository evidence | Operator action |
|------|---------------------|-----------------|
| Production project ref (documented) | `xxtdfvgkurxabpbmjban` (`DEPLOYMENT.md`, Android release notes) | **Confirm in Supabase Dashboard** before any SQL |
| Staging project | **Not evidenced** in repository | Prefer creating/using staging; otherwise require explicit production-only exception |
| SQL session settings | Unreliable for project-ref proof | Never skip Dashboard confirmation |

**Production-only deployment** requires an explicit written exception, stronger dual approval, and confirmed PITR/backup before apply.

---

## Required operator sequence

1. **Confirm integration branch/commit under review**  
   Branch: `feature/unified-messaging-postgres-integration` (or approved merge commit).  
   Record `git rev-parse HEAD`.

2. **Confirm canonical DDL checksum**  
   ```bash
   shasum -a 256 scripts/unified-messaging-normalized-schema.sql
   npm run test:unified-messaging-deployment-readiness
   ```  
   Must match the approved SHA-256 above.

3. **Confirm exact Supabase organization, project name, and project ref in Dashboard**  
   Compare to intended target (documented production ref above only after human verification).

4. **Confirm the SQL Editor session is attached to that project**  
   Wrong-project stop: do not proceed.

5. **Confirm PITR or a recent restorable database backup**  
   Dashboard → Database → Backups / PITR.

6. **Record restore window and responsible operator**  
   Name, time zone, restore RPO/RTO note.

7. **Run read-only preflight**  
   Paste/run `scripts/unified-messaging-supabase-preflight.sql` in SQL Editor.  
   Required: `PASS: preflight — safe to seek human deployment approval`.  
   Any `STOP:` → halt.

8. **Save and review the preflight output**  
   Attach notices + inventory result sets to the change record.

9. **Obtain explicit human deployment approval**  
   Name, timestamp, target project ref.

10. **Avoid peak WhatsApp write periods**  
    Prefer low-traffic window for Meta inbound/outbound.

11. **Open a fresh SQL Editor query**  
    Do not reuse a dirty/partial editor buffer.

12. **Execute as one batch** (transaction wrapper **outside** the canonical file):

    ```sql
    BEGIN;

    -- Paste the EXACT unchanged body of:
    -- scripts/unified-messaging-normalized-schema.sql
    -- (do not edit; do not omit notify pgrst)

    COMMIT;
    ```

13. **If any statement fails before commit**  
    Issue `ROLLBACK;` and **stop**. Do not leave an open failed transaction.

14. **Do not retry blindly** if any target `messaging_*` objects appear  
    Re-run preflight/inventory; escalate shape/privilege mismatches.

15. **Run read-only post-deployment verifier**  
    `scripts/unified-messaging-supabase-postdeploy-verify.sql`  
    Required: `PASS: post-deploy verification`.

16. **Run application regression and Meta/inbox smoke**  
    At minimum:  
    `npm run test:unified-messaging-baseline`  
    `npm run test:whatsapp-transport`  
    `npm run test:whatsapp-inbox`  
    `npm run test:whatsapp-inbox-routes`  
    `npm run test:whatsapp-inbox-production-wiring`  
    Plus manual Connected/Disconnected inbox smoke if production traffic allows.

17. **Monitor**  
    API 5xx, webhook processing, outbound send failures, and PostgREST schema reload (`notify pgrst` in DDL).

18. **Record**  
    Deployment time (UTC), operator, project ref, commit SHA, checksum, preflight/postdeploy results, approval reference.

---

## Transaction handling

- `BEGIN` / `COMMIT` remain **outside** `scripts/unified-messaging-normalized-schema.sql`.
- They are **mandatory** in the SQL Editor execution batch for this deployment.
- On error before commit: `ROLLBACK` and stop.
- Do not wrap nested transactions inside the pasted DDL body.

---

## Failure handling

| Situation | Action |
|-----------|--------|
| Preferred recovery | **Roll-forward** (fix grants/policies/shape with reviewed SQL) |
| WhatsApp tables | **Do not** alter/drop/rename `whatsapp_*` |
| Empty unused normalized tables after botched empty deploy | May leave in place if runtime unwired; or emergency DROP only with approval |
| Emergency DROP | Explicit approval + proof all nine tables empty + unused; reverse dependency order only |
| After real business data | **Never** DROP normalized tables |
| Test rollback script | **Never** deploy `scripts/test-unified-messaging-rollback.sql` to hosted |
| Partial objects / privilege / policy / shape mismatch | Escalate; do not “fix forward” by guessing |

---

## Related assets

| Asset | Role |
|-------|------|
| `scripts/unified-messaging-normalized-schema.sql` | Canonical DDL |
| `scripts/unified-messaging-supabase-preflight.sql` | Read-only preflight |
| `scripts/unified-messaging-supabase-postdeploy-verify.sql` | Read-only post-deploy verify |
| `scripts/validate-unified-messaging-deployment-readiness.mjs` | Repo gate: checksum + package integrity |
| `docs/development/unified-messaging-local-postgres.md` | Disposable local Postgres (not hosted) |
| `scripts/test-unified-messaging-*.sql` | Local harness only — not for hosted |

---

## Remaining blockers (not cleared by this package alone)

- Staging project not evidenced — prefer staging before production.
- Hosted PITR/backup must be confirmed in Dashboard at deploy time.
- Hosted WhatsApp baseline must pass preflight on the real project.
- Plain PostgreSQL validation ≠ full Supabase parity.
- Unfinished provider-error work on other branches must not be mixed into this deploy package.
