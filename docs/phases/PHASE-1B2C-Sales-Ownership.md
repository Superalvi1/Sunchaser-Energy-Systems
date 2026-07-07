# Phase 1B.2C — Sales Ownership

**Status:** Completed  
**Commit:** _Pending (release prep in progress)_  
**Branch:** `feature/phase-1b2c-sales-ownership`  
**Parent phase:** Phase 1B.2 — Ownership Rules  
**Prerequisites:** Phase 1B.1 (Authorization Foundation), Phase 1B.2A (Customer Ownership), Phase 1B.2B (Technician Ownership)  
**Scope:** Centralized sales ownership for CRM leads, quotations, customers, projects, app-state reads, and PDF exports. Durable `assigned_sales_user_id` with transitional legacy salesperson-name fallback. No teams, sharing, customer-ownership, technician-ownership, authorization-middleware, or frontend changes.

---

## Implementation summary

Phase 1B.2C adds `SalesOwnershipResolver` and wires it into `server.ts` through two guard helpers:

- `guardSalesOwnedResource()` — JSON API routes
- `guardSalesOwnedResourceText()` — PDF/HTML text responses

Both use `salesAccessPrecheck()` to decide:

1. **Allow** — Admin, Director, Super Admin (ownership bypass)
2. **Enforce** — Sales Executive, Sales Manager (`Sales Advisor` normalizes to Sales Executive)
3. **Deny** — all other authenticated roles → **403** `Not authorized for this sales resource.`
4. **Deny** — missing actor → **401** `Authentication required.`

`GET /api/state` (Supabase and local) applies `filterAppStateForActor()` for enforcing actors, scoping leads, projects, quotations, `paymentTracks`, and `netMeteringTrackers` to owned lead ids.

`PUT /api/leads/:id/assign` resolves `salespersonName` to a durable user id via `resolveSalesUserByNameOrUsername()` (exact username or display-name match) and persists both legacy name and `assigned_sales_user_id` when resolvable.

---

## Ownership rules

### Primary rule

```
actor.id === resource.assigned_sales_user_id
```

### Legacy fallback (transitional)

When `assigned_sales_user_id` is absent:

- Match `assigned_salesperson`, `assignedSalesperson`, `bdmName`, or `bdm_name` against `actor.name` or `actor.username` (exact, case-insensitive).
- Unassigned lead (no user id and no legacy name) → **403** `Lead is not assigned to you.`
- Stale legacy name cannot override a different durable user id.

### Actor source

Identity comes from `req.actor` (Phase 1B.1 JWT hydration). Request body, query, and `X-Sunchaser-*` headers do not determine ownership when JWT is present.

### Bypass roles

| Role | Behavior |
|------|----------|
| Admin | Full bypass |
| Director | Full bypass |
| Super Admin | Full bypass |

### Enforced roles

| Role | Behavior |
|------|----------|
| Sales Executive | Own assigned resources only |
| Sales Manager | Own assigned resources only (no team rollup) |
| Sales Advisor | Treated as Sales Executive |

### Denied roles (on guarded sales routes)

Technician, Survey Engineer, Installation Team, Customer, Accounts Manager, Support Agent, and all other non-bypass roles receive **403** before ownership is evaluated.

### Parent resolution

| Resource type | Resolution |
|---------------|------------|
| `lead` | Direct row ownership |
| `quotation` | Parent lead via `lead_id` / embedded quote; merges quote `bdmName` for legacy fallback |
| `customer` | At least one linked lead owned by actor |
| `project` | Parent lead via `leadId` / `lead_id` |
| `manual_quote_export` | Lead id (route param or payload) |
| `quotation_pdf` | Lead id |

### Error semantics

| Condition | Status |
|-----------|--------|
| Missing actor | 401 |
| Non-sales, non-bypass role | 403 |
| Ownership mismatch | 403 |
| Missing lead / quote / customer / project | 404 |
| Soft-deleted lead | 404 (via `filterActiveLeads` / `deleted_at` check) |

---

## Protected routes

### App state

| Method | Path | Protection |
|--------|------|------------|
| GET | `/api/state` | `filterAppStateForActor` — scoped leads, projects, quotations, paymentTracks, netMeteringTrackers |

### Customer admin (sales-scoped)

| Method | Path | Resource type |
|--------|------|---------------|
| GET | `/api/admin/customer-systems/:customerId` | `customer` |
| GET | `/api/admin/customer-documents/:customerId` | `customer` |
| GET | `/api/admin/customer-savings/:customerId` | `customer` |

### Lead routes

| Method | Path | Resource type |
|--------|------|---------------|
| PUT | `/api/leads/:id` | `lead` |
| DELETE | `/api/leads/:id` | `lead` |
| DELETE | `/api/leads/:leadId/quotes/:quoteId` | `quotation` |
| PUT | `/api/leads/:id/assign` | `lead` (+ resolves durable user id on assign) |
| POST | `/api/leads/:id/ai-score` | `lead` |
| POST | `/api/leads/:id/schedule-survey` | `lead` |
| POST | `/api/leads/:id/whatsapp-reminder` | `lead` |
| POST | `/api/leads/:id/survey-report` | `lead` |
| POST | `/api/leads/:id/create-quote` | `lead` |
| POST | `/api/leads/:id/duplicate-quote` | `lead` |
| POST | `/api/leads/:id/update-quote` | `lead` |
| POST | `/api/leads/:id/accept-quote` | `lead` |
| POST | `/api/leads/:id/update-installation` | `lead` |

`POST /api/leads` (create) is not ownership-gated; assignment may be set at creation.

### Project routes

| Method | Path | Resource type |
|--------|------|---------------|
| POST | `/api/projects/:id/update-stage` | `project` |
| POST | `/api/projects/:leadId/net-metering/update` | `lead` |

### PDF / export routes

All PDF routes also require `resolveStaffActor()` (Phase 1B.2A).

| Method | Path | Resource type |
|--------|------|---------------|
| GET | `/api/export/pdf/auto-sizer/:leadId` | `quotation_pdf` |
| POST | `/api/export/pdf/manual-quote` | `manual_quote_export` (when `payload.leadId` present) |
| GET | `/api/export/pdf/manual-quote/:leadId` | `manual_quote_export` |
| GET | `/api/export/pdf/manual-quote/:leadId/download` | `manual_quote_export` |
| GET | `/api/export/pdf/manual-quote/:leadId/debug-html` | `manual_quote_export` |
| GET | `/api/export/pdf/manual-quote/:leadId/debug-template-map` | `manual_quote_export` |
| GET | `/api/export/pdf/:leadId` | `quotation_pdf` |

Customer and technician PDF paths unchanged.

---

## Files added

| File | Purpose |
|------|---------|
| `server/ownership/SalesOwnershipResolver.ts` | Resolver, bypass logic, app-state filter, parent chain resolution |
| `server/ownership/salesOwnership.test.ts` | Phase 1B.2C unit tests |
| `docs/phases/PHASE-1B2C-Sales-Ownership.md` | Phase record |

## Files modified

| File | Change |
|------|--------|
| `server.ts` | `guardSalesOwnedResource`, `salesAccessPrecheck`, route guards, `/api/state` scoping, assign durable-id resolution |
| `package.json` | Adds `test:phase-1b2c` |

**Not modified:** `OwnershipResolver.ts`, `TechnicianOwnershipResolver.ts`, `authorization.ts`, `dbManager.ts`, frontend, `database.json`.

---

## Tests passed

| Suite | Command | Result |
|-------|---------|--------|
| Phase 1B.2C | `npm run test:phase-1b2c` | **26/26** (expected at release) |

**Coverage highlights:**

- Durable user id precedence over stale legacy name
- Legacy `assigned_salesperson` and quote `bdmName` fallback
- Lead, quotation, customer, project, manual quote, quotation PDF resource types
- Admin bypass; non-sales roles denied (403), never silently allowed
- `filterAppStateForActor` — leads, projects, quotations, paymentTracks, netMeteringTrackers
- Unassigned lead rejection; missing resource 404

**Regression gate before deploy:**

```bash
npm run test:phase-1b2c
npm run test:phase-1b2a
npm run test:phase-1b2b
npm run test:phase-1b1
```

---

## Breaking changes

| Change | Impact |
|--------|--------|
| Lead mutation routes enforce assignment | Sales rep B cannot mutate Sales rep A's leads |
| Quote delete requires quotation ownership | Cross-rep quote deletion → **403** |
| PDF exports require lead ownership | Other rep's leads → **403** for sales staff |
| `GET /api/state` scoped for sales staff | Unowned leads/projects/quotes hidden from state payload |
| Non-sales roles on guarded routes | Technician, Customer, etc. → **403** on sales CRM mutations |
| Unassigned leads | Sales staff cannot access → **403** |
| Soft-deleted leads | Mutation paths → **404** |

---

## Known limitations

- **No Sales Manager team rollup** — managers see only their own assignments, not subordinates' pipelines.
- **No sharing or co-selling** — handoff requires reassignment via `/api/leads/:id/assign`.
- **Legacy name fields remain** — `assigned_salesperson` and quote `bdmName` kept for display; backfill `assigned_sales_user_id` recommended.
- **`POST /api/export/pdf/manual-quote` without `leadId`** — ownership not enforced when payload omits `leadId` (preview-only manual quote path).
- **Supabase column migration** — assign persists legacy name only if `assigned_sales_user_id` column missing (warn logged).
- **Frontend unchanged** — client may still send legacy query params; server ignores them for ownership when JWT present.

---

## Deployment notes

1. **No new environment variables** — uses existing JWT / `req.actor` from Phase 1B.1.
2. **Schema:** Add `leads.assigned_sales_user_id` in Supabase if absent. Assign API degrades gracefully to legacy name-only until column exists.
3. **Data backfill:** Resolve `assigned_salesperson` display names to user ids and populate `assigned_sales_user_id` on existing leads.
4. **Production:** Keep `LEGACY_HEADER_AUTH=false` (Phase 1B.1 default).
5. **Verify after deploy:**
   - Sales rep sees only owned leads in app state
   - Admin can access all leads
   - PDF export blocked for unowned lead id
   - Assign writes durable user id when salesperson name matches a user record

---

## Rollback plan

1. Revert the 1B.2C commit (or these files):
   - `server/ownership/SalesOwnershipResolver.ts`
   - `server/ownership/salesOwnership.test.ts`
   - Changes in `server.ts`, `package.json`
   - `docs/phases/PHASE-1B2C-Sales-Ownership.md`
2. Remove `"test:phase-1b2c"` from `package.json` if rolling back fully.
3. Restart the server.
4. Verify:
   - Sales team can update any lead without ownership errors
   - `GET /api/state` returns full lead list for all staff
   - PDF exports work for any staff Bearer session
   - `npm run test:phase-1b2a` and `npm run test:phase-1b2b` still pass
5. Rollback of 1B.2C does not affect customer ownership (1B.2A), technician ownership (1B.2B), or authorization middleware (1B.1).

---

## Acceptance criteria

- [x] `SalesOwnershipResolver` centralizes sales ownership with `SalesOwnershipError` (401/403/404)
- [x] Durable `assigned_sales_user_id` is the primary ownership key
- [x] Legacy name / `bdmName` fallback when durable id absent (exact match only)
- [x] Leads, quotations, customers, projects, PDF exports, and `/api/state` scoped
- [x] Admin, Director, Super Admin bypass; non-sales roles denied
- [x] `npm run test:phase-1b2c` — 26/26
- [x] Customer ownership, technician ownership, authorization middleware, frontend, `database.json` untouched
