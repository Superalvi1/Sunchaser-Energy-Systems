# Changelog

All notable changes to the Sunchaser Energy Systems CRM are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

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
