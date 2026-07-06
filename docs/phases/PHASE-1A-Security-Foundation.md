# Phase 1A — Security Foundation

**Status:** Completed  
**Commit:** `39ad363` — `feat(security): Phase 1A JWT auth for selected API routes`  
**Scope:** JWT-based access control for a selected set of backend routes, login token issuance, frontend Bearer session handling, production JWT environment validation, and login rate limiting.

---

## Objectives (completed)

1. Issue signed JWT access tokens on successful staff/customer login.
2. Require valid Bearer tokens on high-risk read/write and diagnostic routes.
3. Validate active sessions server-side via `GET /api/auth/me`.
4. Persist and restore JWT sessions in the web client.
5. Rate-limit login attempts per IP.
6. Refuse production server startup when JWT configuration is missing or weak.

---

## Files added

| File | Purpose |
|------|---------|
| `server/auth/jwt.ts` | Sign and verify JWTs; `assertProductionJwtConfig()` for production boot |
| `server/middleware/auth.ts` | `requireAuth`, `protectSelectedApiRoutes`, `req.user` typing |
| `server/middleware/rateLimit.ts` | In-memory per-IP login rate limiter |
| `src/lib/authSession.ts` | `restoreAuthSession()` — validates stored JWT via `/api/auth/me` |

## Files modified

| File | Change |
|------|--------|
| `server.ts` | Global JWT middleware, login token, `/api/auth/me`, startup guard |
| `userAuthDb.ts` | Export `findUserByUsername` for session lookup |
| `src/services/api.ts` | Token storage, Bearer on `apiFetch`, `fetchAuthMe`, login persistence |
| `src/App.tsx` | JWT session restore on boot; logout clears token and user |
| `package.json` | `jsonwebtoken`, `@types/jsonwebtoken` |
| `package-lock.json` | Lockfile for JWT dependencies |
| `.env.example` | Document `JWT_SECRET` and `JWT_EXPIRES_IN` |

---

## Authentication flow

### Login

1. Client calls `POST /api/auth/login` with `{ username, password }`.
2. Server authenticates via existing `authenticateUser()` (Supabase or local `database.json`).
3. Server signs a JWT containing `{ userId, username, role }` using `JWT_SECRET` and `JWT_EXPIRES_IN`.
4. Response: `{ success: true, user, token }`.
5. Frontend `loginUser()` persists `token` → `localStorage.sunchaser_auth_token` and `user` → `localStorage.sunchaser_user`.

### Session restore (web)

1. On app boot, `restoreAuthSession()` reads `sunchaser_auth_token`.
2. If token present → `GET /api/auth/me` with `Authorization: Bearer <token>`.
3. On success → user restored; on 401 → `clearAuthSession()`.
4. If `sunchaser_user` exists but no token → session cleared (forces re-login).

### Logout

`clearAuthSession()` removes both `sunchaser_auth_token` and `sunchaser_user` from `localStorage`.

---

## Protected routes

Global middleware `protectSelectedApiRoutes` runs before route handlers. Protected paths return **401** without a valid Bearer token. Spoofed `X-Sunchaser-*` headers do not satisfy protection on these routes.

### Exact paths

| Method | Path |
|--------|------|
| `GET` | `/api/state` |
| `GET` | `/api/backup/export` |
| `POST` | `/api/db/update` |

### Path prefixes

| Prefix | Example |
|--------|---------|
| `/api/diagnostics/` | `/api/diagnostics/db`, `/api/diagnostics/quotation-settings`, phase table diagnostics, etc. |
| `/api/debug/` | `/api/debug/pdf-engine` |

### Route-level auth

| Method | Path | Middleware |
|--------|------|------------|
| `GET` | `/api/auth/me` | `requireAuth` on handler |

---

## Routes not protected in Phase 1A

All other `/api/*` routes remain unchanged. Customer portal, technical jobs, and most admin/staff endpoints continue to use existing `X-Sunchaser-User-Id`, `X-Sunchaser-Username`, and `X-Sunchaser-Role` header trust where implemented before Phase 1A.

---

## JWT configuration

| Variable | Required in production | Description |
|----------|------------------------|-------------|
| `JWT_SECRET` | Yes | HS256 signing key; minimum 32 characters; known placeholders rejected |
| `JWT_EXPIRES_IN` | Yes | Token lifetime (`jsonwebtoken` format, e.g. `8h`, `1d`) |
| `LOGIN_RATE_LIMIT_MAX` | No | Max login attempts per IP per window (default `10`) |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | No | Rate limit window in ms (default `60000`) |

Production startup calls `assertProductionJwtConfig()` and exits with code `1` if `JWT_SECRET` or `JWT_EXPIRES_IN` is missing or weak.

---

## Security controls implemented

| Control | Implementation |
|---------|----------------|
| Token signing | `jsonwebtoken` HS256 with server-only `JWT_SECRET` |
| Token verification | `verifyAccessToken()` on every protected request |
| Expired / invalid tokens | Middleware returns `401 { error: "Unauthorized" }` |
| Login brute-force mitigation | `loginRateLimit` on `POST /api/auth/login` (429 after threshold) |
| Session re-validation | `/api/auth/me` checks user still exists and is not suspended/rejected |
| Frontend secret isolation | `JWT_SECRET` is not present in Vite frontend bundles |
| Production fail-fast | Server refuses to boot without valid JWT env in `NODE_ENV=production` |

---

## Breaking changes

| Change | Impact |
|--------|--------|
| Protected routes require JWT | Unauthenticated or header-only calls to protected paths return `401` |
| Login response includes `token` | API clients must store and send Bearer token for protected routes |
| Stale sessions invalidated | Users with `sunchaser_user` but no `sunchaser_auth_token` must sign in again |
| Admin CRM boot | `fetchAppState` (`/api/state`) requires valid JWT after deploy |
| Production boot | Missing/weak JWT env prevents server start |

---

## Verification performed

- JWT forgery, expiry, and malformed token rejection (isolated tests)
- Protected routes: 401 without token; 200 with valid Bearer (local `dist/server.cjs`)
- Login rate limiter returns 429 after threshold
- No `JWT_SECRET` in `dist/assets/` frontend bundle
- TypeScript: Phase 1A introduced one error (`jwt.sign` typing), fixed before commit; no net new errors vs pre-Phase-1A baseline

---

## Known limitations (as shipped)

- Only the route classes listed above are JWT-protected.
- Most admin and portal APIs still trust `X-Sunchaser-*` headers.
- No server-side token revocation or refresh-token flow.
- Login rate limiter is in-memory (per process; resets on restart).
- Native app (Capacitor) does not auto-restore JWT session on boot.
