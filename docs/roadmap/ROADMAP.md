# Engineering Roadmap

This document records **completed** engineering phases only. Future phases are not listed here until they are implemented and documented.

---

## Completed

### Phase 1B.2C — Sales Ownership

**Commit:** _Pending (release prep in progress)_  
**Documentation:** [PHASE-1B2C-Sales-Ownership.md](../phases/PHASE-1B2C-Sales-Ownership.md)

**Delivered:**

- Centralized `SalesOwnershipResolver` with durable `assigned_sales_user_id` ownership rule
- Legacy `assigned_salesperson` / `bdmName` fallback when user id absent (exact match only)
- Route guards via `guardSalesOwnedResource` on leads, quotations, customers, projects, and PDF exports
- `GET /api/state` scoped via `filterAppStateForActor` for sales staff
- Admin / Director / Super Admin bypass; non-sales roles denied on guarded routes
- Assign API resolves salesperson name to durable user id
- Phase-specific automated tests (`test:phase-1b2c`, 26/26)

**Deployment note:** Backfill `assigned_sales_user_id` on leads from legacy salesperson names; ensure Supabase column exists before relying solely on durable id enforcement.

---

### Phase 1B.2B — Technician Ownership

**Commit:** _Pending (release prep in progress)_  
**Documentation:** _PHASE-1B2B-Technician-Ownership.md (to be created)_

**Delivered:**

- Centralized `TechnicianOwnershipResolver` with durable user-id ownership
- Technical staff routes (`/api/technical/*`) enforce assignment before read/write
- Authoritative `/api/technical/jobs/me` filter via `filterOwnedTechnicalJobs`
- Phase-specific automated tests (`test:phase-1b2b`)

**Deployment note:** Prefer `assigned_technician_user_id` / `assigned_user_id` on service requests and support tickets.

---

### Phase 1B.2A — Customer Ownership

**Commit:** _Pending (release prep in progress)_  
**Documentation:** _PHASE-1B2A-Customer-Ownership.md (to be created)_

**Delivered:**

- Centralized `OwnershipResolver` for customer portal resources
- Customer JWT route isolation (`customerRoutePolicy.ts`)
- Staff actor resolution (`staffActor.ts`)
- Phase-specific automated tests (`test:phase-1b2a`)

---

### Phase 1B.1 — Authorization Foundation

**Commit:** _Pending (release prep in progress)_  
**Documentation:** [PHASE-1B1-Authorization-Foundation.md](../phases/PHASE-1B1-Authorization-Foundation.md)

**Delivered:**

- Centralized `/api/*` authorization middleware with explicit public allowlist
- Fail-closed default route protection model
- Route policy split: `public`, `jwt_only`, and `protected`
- JWT actor hydration (`req.actor`) with account-status checks
- Phase 1A routes preserved as JWT-only
- Frontend Bearer migration and removal of legacy identity headers from migrated callers
- Phase-specific automated middleware tests (`test:phase-1b1`)

**Deployment note:** Keep `LEGACY_HEADER_AUTH=false` for strict enforcement after frontend migration.

---

### Phase 1A — Security Foundation

**Commit:** `39ad363`  
**Documentation:** [PHASE-1A-Security-Foundation.md](../phases/PHASE-1A-Security-Foundation.md)

**Delivered:**

- JWT access tokens issued on `POST /api/auth/login`
- Bearer JWT required on high-risk routes and diagnostics
- `GET /api/auth/me` for server-side session validation
- Frontend token storage and session restore
- Login rate limiting (per IP)
- Production startup validation for `JWT_SECRET` and `JWT_EXPIRES_IN`

**Deployment requirement:** Set `JWT_SECRET` (≥32 chars) and `JWT_EXPIRES_IN` on Render before production boot.

---

## Documentation index

| Area | Location |
|------|----------|
| Phases | `docs/phases/` |
| Security | `docs/security/SECURITY.md` |
| Changelog | `docs/changelog/CHANGELOG.md` |
| Vision | `docs/vision/VISION.md` |
| Architecture | `docs/architecture/` *(structure reserved)* |
| Deployment | `docs/deployment/` *(structure reserved)* |
| Decisions | `docs/decisions/` *(structure reserved)* |
