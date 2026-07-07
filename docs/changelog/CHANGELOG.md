# Changelog

All notable changes to the Sunchaser Energy Systems CRM are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

## [Phase 1B.2C] — 2026-07-07

**Commit:** _Pending (release prep in progress)_

### Added

- `server/ownership/SalesOwnershipResolver.ts` — centralized sales ownership with durable `assigned_sales_user_id`, Admin/Director/Super Admin bypass, legacy salesperson-name fallback, and app-state filtering
- `server/ownership/salesOwnership.test.ts` — 26 automated unit tests
- `docs/phases/PHASE-1B2C-Sales-Ownership.md` — detailed phase documentation
- `package.json` — `test:phase-1b2c` script
- `server.ts` — `guardSalesOwnedResource`, `guardSalesOwnedResourceText`, `salesAccessPrecheck`, `resolveSalesUserByNameOrUsername`

### Changed

- `server.ts` — lead, quote, project, customer admin, and PDF export routes enforce sales ownership via `req.actor`
- `GET /api/state` — scoped for enforcing actors via `filterAppStateForActor` (leads, projects, quotations, paymentTracks, netMeteringTrackers)
- `PUT /api/leads/:id/assign` — resolves and persists `assigned_sales_user_id` alongside legacy `assigned_salesperson`

### Security

- Sales Executive / Sales Manager may only access resources assigned to their user id.
- Non-sales roles (Technician, Customer, Accounts Manager, etc.) receive **403** on guarded sales routes.
- Spoofed `X-Sunchaser-*` headers or body/query identity do not grant cross-salesperson access when JWT is present.
- Durable user id takes precedence over stale legacy salesperson name.
- Admin, Director, and Super Admin retain override access.
- Customer ownership (Phase 1B.2A) and technician ownership (Phase 1B.2B) unchanged.

### Breaking

- Sales staff accessing unassigned or other-rep leads, quotes, customers, projects, or PDFs receive **403**.
- `GET /api/state` returns scoped data for sales staff (unowned leads hidden).
- Soft-deleted leads excluded from mutation paths (**404**).

---

## [Phase 1B.2B] — 2026-07-07

**Commit:** _Pending (release prep in progress)_

### Added

- `server/ownership/TechnicianOwnershipResolver.ts` — centralized technician ownership with durable user-id checks and legacy name fallback
- `server/ownership/technicianOwnership.test.ts` — unit tests for assignment enforcement
- `server/ownership/technicianJobsMe.test.ts` — integration tests for `/api/technical/jobs/me` filtering
- `package.json` — `test:phase-1b2b` script

### Changed

- `dbManager.ts` — technical job list/detail uses `TechnicianOwnershipResolver.filterOwnedTechnicalJobs`; durable-id-first assignee matching
- `projectDeliveryDb.ts` / `projectCompletionDb.ts` — delivery assignment enforced on completion workflows

### Security

- Technicians may only access assigned jobs, service requests, support tickets, warranty visits, and deliveries.
- Stale legacy `assigned_technician` name cannot override durable `assigned_user_id`.

### Breaking

- Technicians accessing unassigned or other technicians' resources now receive **403**.

---

## [Phase 1B.2A] — 2026-07-07

**Commit:** _Pending (release prep in progress)_

### Added

- `server/ownership/OwnershipResolver.ts` — customer ownership resolver with parent chain resolution
- `server/middleware/customerRoutePolicy.ts` — customer JWT route allowlist
- `server/middleware/staffActor.ts` — `resolveStaffActor()` for staff/admin handlers
- `server/ownership/ownership.test.ts` — customer ownership unit tests
- `package.json` — `test:phase-1b2a` script

### Changed

- `server.ts` — customer portal routes use `req.actor` only; staff PDF routes use `resolveStaffActor`
- `server/middleware/authorization.ts` — customer actors blocked from non-allowlisted routes
- `dbManager.ts` — portal lead lookup scoped to `customerId` only (email/phone fallback removed)

### Security

- Customer JWT actors limited to customer-portal and owned PDF routes.
- `actor.customerId === resource.customer_id` enforced on protected customer resources.

### Breaking

- Customer actors reaching staff/admin routes receive **403** even with spoofed identity headers.

---

## [Phase 1B.1] — 2026-07-07

**Commit:** _Pending (release prep in progress)_

### Added

- `server/middleware/actor.ts` — actor hydration from JWT/legacy headers with account-status guardrails
- `server/middleware/publicRoutes.ts` — explicit public route allowlist
- `server/middleware/routePolicy.ts` — route policy classification for centralized auth
- `server/middleware/authorization.ts` — fail-closed `/api/*` authorization middleware
- `server/middleware/authorization.test.ts` — automated tests for policy and fallback behavior
- `docs/phases/PHASE-1B1-Authorization-Foundation.md` — detailed phase documentation

### Changed

- `server.ts` wires centralized authorization middleware and actor-aware auth flow
- `server/middleware/auth.ts` aligned with `req.actor` hydration flow
- `.env.example` documents `LEGACY_HEADER_AUTH` default/bridge behavior
- `package.json` adds `test:phase-1b1`
- Frontend non-`apiFetch` callers migrated to Bearer-aware transport:
  - `src/components/SalesTeamApp.tsx`
  - `src/components/AdminApp.tsx`
  - `src/components/ManualAdminControl.tsx`
  - `src/components/InstallationTeamApp.tsx`
  - `src/components/quoteAuthoring/QuotePageAuthoringFields.tsx`
  - `src/lib/quotePdfExport.ts`
  - `src/lib/quotePdfRender.ts`
  - `src/services/api.ts`

### Security

- Public routes are explicit; all other `/api/*` routes are protected by default.
- Phase 1A JWT routes (`/api/state`, `/api/backup/export`, `/api/db/update`, `/api/diagnostics/*`, `/api/debug/*`) remain JWT-only.
- Frontend migrated callers now attach `Authorization: Bearer <token>` instead of relying on `X-Sunchaser-*` identity headers.

### Breaking

- Requests to protected `/api/*` routes without valid Bearer JWT now fail closed (`401`) when `LEGACY_HEADER_AUTH=false` (default).

---

## [Phase 1A] — 2026-06-12

**Commit:** `39ad363` — `feat(security): Phase 1A JWT auth for selected API routes`

### Added

- `server/auth/jwt.ts` — JWT sign/verify and production env validation
- `server/middleware/auth.ts` — `requireAuth` and `protectSelectedApiRoutes`
- `server/middleware/rateLimit.ts` — login rate limiter
- `src/lib/authSession.ts` — `restoreAuthSession()` helper
- `GET /api/auth/me` — Bearer-protected session endpoint
- `jsonwebtoken` and `@types/jsonwebtoken` dependencies
- Frontend `sunchaser_auth_token` storage and Bearer attachment on `apiFetch`
- `fetchAuthMe()` client helper
- Production fail-fast when `JWT_SECRET` or `JWT_EXPIRES_IN` is missing or weak

### Changed

- `POST /api/auth/login` now returns `{ success, user, token }` and is rate-limited
- `src/App.tsx` restores sessions via JWT + `/api/auth/me` instead of trusting cached user alone
- Logout clears both `sunchaser_auth_token` and `sunchaser_user`
- `.env.example` documents `JWT_SECRET` and `JWT_EXPIRES_IN`

### Security

- JWT Bearer required on:
  - `GET /api/state`
  - `GET /api/backup/export`
  - `POST /api/db/update`
  - All `/api/diagnostics/*` routes
  - All `/api/debug/*` routes
- Spoofed `X-Sunchaser-*` headers no longer grant access to protected routes above

### Breaking

- Protected routes return `401` without a valid Bearer token
- Users with cached `sunchaser_user` but no `sunchaser_auth_token` must sign in again
- Production server exits on startup if JWT environment is not configured
