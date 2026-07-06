# Changelog

All notable changes to the Sunchaser Energy Systems CRM are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

_No unreleased application changes documented._

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
