# Phase 2: company foundation

Status: **built and proven on a disposable database. Not run in production. Not pilot-ready** (see section 6).
Branch `claude/saas-pilot-multi-company`, stacked on pull request #111.

## 1. What this phase adds

| Piece | Where |
|---|---|
| `companies`, `company_memberships`, `users.is_platform_admin`, role `crm_tenant`, `app.*` functions | `scripts/saas/phase2-company-foundation.sql` (generated from `scripts/saas/table-classification.json`) |
| Rollback | `scripts/saas/phase2-company-foundation-rollback.sql` |
| Read-only preflight for the real database | `scripts/saas/phase2-preflight.sql` |
| Company context, tenant database client, resolver, scope policy | `server/saas/*`, `dbManager.ts`, `server/middleware/authorization.ts` |
| Company in the session token, `POST /api/auth/select-company` | `server/auth/jwt.ts`, `server.ts` |
| Tenant key tool (owner runs it offline) | `scripts/saas/make-tenant-key.mjs` |

Behaviour is controlled by `MULTI_COMPANY_ENABLED` (default off). With the flag off the CRM behaves as before.

## 2. How isolation works

1. Every tenant table gets `company_id` (existing rows are labelled `sunchaser`; no row is rewritten).
2. The CRM server talks to PostgREST as the non-bypass role `crm_tenant` and sends `x-company-id` on every request.
   Row-level policies compare `company_id` with that header; column defaults take it from the same header.
3. The server chooses the header only from the caller's **active membership** (staff) or **customer record** (portal).
   The token's company claim can only select among memberships the user really has. Request bodies, query strings and
   client headers are never used.
4. A trigger rejects any row that points at another company's parent (row security cannot see this).
5. Legacy policies open to everyone (`using (true)`) are dropped on tenant tables, because Postgres ORs permissive policies.
6. Tables of unscoped modules (marketplace, learning studio, unofficial WhatsApp Web, unified messaging) and `users` are
   invisible to `crm_tenant`; the tenant role also loses EXECUTE on application functions (SECURITY DEFINER bypasses row security).
7. Routes follow a fail-closed scope table (`server/saas/companyScopePolicy.ts`); a route nobody classified is refused.

**Stated limit.** Because the CRM server picks the header, this stops *forgotten filters and coding mistakes*; it does not
stop someone who controls the CRM server or holds the tenant key. Keep the key in the CRM service only and rotate it with
`make-tenant-key.mjs`.

## 3. Deploying (after approval; nothing here has been run in production)

Order, with the gate it needs:

| Step | Action | Gate |
|---|---|---|
| 1 | Backup + restore proof (Phase 1) | G1 |
| 2 | Run `phase2-preflight.sql` on production (read-only); resolve every BLOCKER; decide every WARN | G3 |
| 3 | Owner mints the tenant key: `PGRST_JWT_SECRET=... node scripts/saas/make-tenant-key.mjs`; store it as `CRM_TENANT_POSTGREST_KEY` on the CRM service (do not enable the flag yet) | G3 |
| 4 | Apply `phase2-company-foundation.sql` in a maintenance window (single transaction, `lock_timeout` 15 s, fails safe) | G3 |
| 5 | Deploy the code with `MULTI_COMPANY_ENABLED` **unset**. Run the flag-off smoke (`single-company-smoke.mjs`) against production-like data | G3 |
| 6 | Keep the flag off until Phases 3 to 5 pass. Turning it on is its own gate | G4 |

Code can be deployed before or after the SQL: the new code with the flag off does not touch the new tables; the SQL with old code is additive.

**Rollback.** Flag off, redeploy the previous release if needed, then run `phase2-company-foundation-rollback.sql`
(it refuses while any company other than `sunchaser` exists; it restores dropped policies, row-security flags, defaults and
function privileges from `app.original_state`, and keeps copies of the new tables in schema `app_rollback_backup`).

## 4. Proofs and how to rerun them (disposable database only)

```bash
E2E_PSQL="-h /srv/stack -p 55432 -U postgres -d sunchaser_test" bash scripts/saas/test-phase2-migration.sh        # 18 checks
CRM_TENANT_POSTGREST_KEY=... PGRST_URL=http://127.0.0.1:54321 node scripts/saas/tenant-isolation-matrix.mjs       # every tenant table
TEST_PW=... npx tsx scripts/saas/e2e/seed-two-companies.mjs && TEST_PW=... node scripts/saas/e2e/two-company-api.mjs   # server in multi-company mode
TEST_PW=... node scripts/saas/e2e/single-company-smoke.mjs                                                          # server with the flag off
npm run test:saas                                                                                                   # 41 unit tests
```

| Proof | Result (this stack) | Kind |
|---|---|---|
| Migration: apply, apply again, structure checks, rollback to identical schema and data, apply again | 18 / 18 | tested |
| Attack matrix: seed both companies in every tenant table, attack through PostgREST (read, update, delete, upsert, forge, hand over, reference the other company's parent, no header) | 87 of 87 present tables isolated; `bills` is production-only and absent here | tested |
| Matrix negative controls: an opened policy and a disabled reference trigger each made the matrix fail on that table | both detected | tested |
| Two-company journey on the real server (sign-in, company selection, leads, boot state, quotes, invoices, payments, PDFs, documents, forged tokens and headers, suspended membership and company, not-yet-scoped features hidden) | 52 / 52 | tested |
| Flag off: the same server and database behave as before | 12 / 12 | tested |
| Unit tests (scope policy including every route in `server.ts`, resolver, context, middleware, client selection, classification) | 41 / 41 | tested |
| `tsc` | same 5 pre-existing errors, none new | tested |

## 5. Defects found by these proofs (all fixed here)

| Found by | Defect |
|---|---|
| Spike | Legacy `using (true)` policies make row security meaningless on 45 tables; the migration drops them (**check production grants with the preflight**) |
| Matrix | Foreign keys allowed a company to attach rows to another company's parent; reference trigger added |
| Matrix | The first trigger never fired (`EXECUTE ... INTO` does not set `FOUND`); positive control caught it |
| Rollback diff | Rollback dropped two pre-existing indexes and reset two defaults; it now undoes only what the migration recorded |
| Journey | `service_role` lacked USAGE on schema `app` and privileges on the new tables, which would have broken every legacy write and every login |
| Boot in multi-company mode | Two WhatsApp repositories captured a client at start-up; they now resolve it per call |
| Journey | The salesperson resolver searched users across all companies; it now returns only active members of the caller's company |
| Journey | The quotation-versions endpoint answered 200 with an empty list for a lead the caller cannot see; now 404 |

## 6. Not done, so this is **not** SaaS-ready

* Only leads, boot state, quotations, invoices, payments, PDFs and documents were attacked through real routes. The other
  ~250 routes are covered by the table-level matrix and the scope table, not by per-route tests (Phase 3).
* Settings, PDF settings, bank accounts, terms and templates are still one row per database (Phase 4). A second company's boot
  state works but cannot save its own settings yet.
* WhatsApp: inbound webhooks and the sales agent run as the founding company; per-company routing is Phase 5. AI usage is not yet metered.
* Business unique keys (quote number, invoice number, plan code, customer code) are still global: another company could collide
  or probe them (`phase2-preflight.sql` section 6 lists them).
* User administration, roles and customer-account tools are founding-company only; company members are managed in Phase 6.
* `inv_foundation_*` and other SECURITY DEFINER functions are closed to the tenant role until reviewed (inventory is therefore unavailable to other companies).
* The real production schema has not been read (`bills` and `invoices.created_by_user_id` are known drift). The preflight must pass first.
* Storage links are still non-expiring bearer links, and storage keys are not yet company-prefixed (Phase 3).

## 7. Completion checklist

- [x] Migration generated from the classification, idempotent, additive, rollback proven to restore schema and data
- [x] Read-only preflight written and run on a pre-migration database
- [x] Tenant role and row-level policies on all 88 tenant tables (87 present in the test database)
- [x] Same-company reference enforcement
- [x] Company context, tenant client, fail-closed behaviour outside a context
- [x] Memberships, company selection, per-company role, suspension of a membership or a company
- [x] Fail-closed route scope table with a completeness test
- [x] Flag-off equivalence for the founding company
- [ ] Preflight run and accepted on the real production database (needs owner access)
- [ ] Tenant key minted by the owner and stored on the CRM service
- [ ] Migration applied in production (needs approval G3)
- [ ] Per-route isolation tests for every company-scoped module (Phase 3)
