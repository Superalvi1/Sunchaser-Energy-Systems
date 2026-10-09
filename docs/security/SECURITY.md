# Security

Security controls implemented in the Sunchaser Energy Systems CRM. This document reflects **what is deployed in code** as of Phase 1A (`39ad363`).

---

## Authentication

### JWT access tokens

- **Algorithm:** HS256 (`jsonwebtoken`)
- **Secret:** `JWT_SECRET` environment variable (server only)
- **Lifetime:** `JWT_EXPIRES_IN` (e.g. `8h`)
- **Claims:** `userId`, `username`, `role`
- **Issued on:** successful `POST /api/auth/login`
- **Transport:** `Authorization: Bearer <token>` header

### Session validation

- `GET /api/auth/me` requires Bearer token
- Handler re-loads user from database; returns `401` if user not found, `403` if suspended or rejected

### Frontend session storage

| Key | Content |
|-----|---------|
| `sunchaser_auth_token` | JWT string |
| `sunchaser_user` | Cached user object (not sole auth gate on web) |

Boot flow validates token via `/api/auth/me` before restoring UI session.

---

### Session lifecycle (renewal, revocation, absolute limit)

- `POST /api/auth/refresh` exchanges a still-valid token for a new one. The new token keeps the original sign-in time
  (`sst`) and is never valid past `sst + SESSION_MAX_AGE_DAYS` (default 30 days), whatever `JWT_EXPIRES_IN` is.
- The same absolute limit is enforced on **every** authenticated request, not only on refresh. Tokens with no expiry, an
  unknown start time or a start time in the future are refused.
- Every request re-reads the user: deleted users get `401`; `Suspended`, `Rejected` and `Pending` accounts get `403`;
  the role always comes from the database, never from the token.
- Tokens carry `pwv`, a keyed digest of the stored password hash. Any password change or reset (admin or self-service)
  changes the hash and therefore revokes every earlier token, including ones renewed by a thief. Tokens issued before
  this claim existed carry no `pwv` and remain valid until they expire (at most `JWT_EXPIRES_IN`); rotating `JWT_SECRET`
  retires all tokens at once.
- Renewal is rate limited per user (`REFRESH_RATE_LIMIT_MAX` per `REFRESH_RATE_LIMIT_WINDOW_MS`). Login, refresh and
  `/api/auth/*` responses are sent with `Cache-Control: no-store`.
- Logging out clears the token on the device only. Server-side "sign out everywhere" needs a per-user session epoch
  (see the proposed migration kept with the pre-deployment review); until then a changed password is the way to end a
  stolen session.
- The password-reset and e-mail-verification links are delivered by e-mail only; the API responses never contain them
  and production logs do not record them.

## Authorization (Phase 1A scope)

### JWT-protected routes

Middleware `protectSelectedApiRoutes` enforces Bearer JWT on:

- `GET /api/state`
- `GET /api/backup/export`
- `POST /api/db/update`
- `/api/diagnostics/*`
- `/api/debug/*`

`GET /api/auth/me` uses `requireAuth` directly on the route handler.

### Legacy header auth (unchanged)

Routes outside the protected set above may still read:

- `X-Sunchaser-User-Id`
- `X-Sunchaser-Username`
- `X-Sunchaser-Role`

The frontend continues to send these headers on many staff and portal API calls alongside Bearer tokens where applicable.

---

## Rate limiting

| Endpoint | Limit | Config |
|----------|-------|--------|
| `POST /api/auth/login` | 10 attempts / IP / minute (default) | `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MS` |

Exceeded limit returns `429` with `Retry-After` header.

**Note:** In-memory store; per-process; resets on server restart.

---

## Production environment requirements

When `NODE_ENV=production`, the server calls `assertProductionJwtConfig()` at startup and **exits** if:

- `JWT_SECRET` is missing
- `JWT_SECRET` is shorter than 32 characters
- `JWT_SECRET` matches a known placeholder value
- `JWT_EXPIRES_IN` is missing

---

## Token rejection behavior

| Condition | HTTP status |
|-----------|-------------|
| No `Authorization` header | `401` |
| Malformed JWT | `401` |
| Wrong signature / forged token | `401` |
| Expired token | `401` |
| Valid token, inactive account on `/api/auth/me` | `403` |

---

## Secret handling

- `JWT_SECRET` must not appear in frontend bundles (verified: absent from `dist/assets/`)
- Documented only in `.env.example` as a placeholder; real value set in Render environment

---

## Phase 1A limitations

Documented gaps as of this release:

1. Majority of `/api/*` routes are not JWT-protected.
2. No server-side token revocation list (password change/reset revokes via the `pwv` claim; suspension and deletion are
   checked on every request).
3. No refresh-token rotation or reuse detection (renewal is rate limited and capped by the absolute session limit).
4. Login rate limit is not distributed across multiple server instances.
5. Native mobile app does not auto-restore JWT sessions on launch.

See [PHASE-1A-Security-Foundation.md](../phases/PHASE-1A-Security-Foundation.md) for full phase detail.
