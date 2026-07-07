# Phase 1B.1 — Authorization Foundation

**Status:** Completed  
**Commit:** _Pending (release prep in progress)_  
**Scope:** Centralized API authorization middleware with fail-closed defaults, actor hydration, explicit public route allowlist, JWT-first policy model, and frontend migration of legacy non-Bearer API callers.

---

## Objectives (completed)

1. Introduce centralized authorization for `/api/*` with fail-closed behavior.
2. Keep public auth/health routes explicitly allowlisted.
3. Enforce JWT-only policy for Phase 1A migrated routes.
4. Hydrate `req.actor` from JWT claims validated against current DB state.
5. Preserve optional temporary legacy-header bridge behind `LEGACY_HEADER_AUTH=true`.
6. Migrate frontend raw API callers to attach Bearer JWT.
7. Remove frontend `X-Sunchaser-*` identity headers from migrated callers.

---

## Files added

| File | Purpose |
|------|---------|
| `server/middleware/actor.ts` | Actor model, JWT/legacy hydration, token/header readers, audit helper |
| `server/middleware/publicRoutes.ts` | Explicit public route allowlist |
| `server/middleware/routePolicy.ts` | Route policy resolver (`public` / `jwt_only` / `protected`) |
| `server/middleware/authorization.ts` | Centralized authorization middleware |
| `server/middleware/authorization.test.ts` | Phase 1B.1 middleware tests |
| `docs/phases/PHASE-1B1-Authorization-Foundation.md` | Phase implementation record |

## Files modified

| File | Change |
|------|--------|
| `server.ts` | Wires `createAuthorizationMiddleware` and updated auth actor flow |
| `server/middleware/auth.ts` | `createRequireAuth()` alignment with actor hydration |
| `.env.example` | Documents `LEGACY_HEADER_AUTH` behavior and default |
| `package.json` | Adds `test:phase-1b1` script |
| `src/services/api.ts` | Bearer-aware shared transport helpers, remove legacy identity headers |
| `src/components/SalesTeamApp.tsx` | Migrates raw API `fetch` calls to Bearer-aware fetch helper |
| `src/components/AdminApp.tsx` | Migrates `/api/db/update` call to Bearer-aware helper |
| `src/components/ManualAdminControl.tsx` | Migrates raw API calls to Bearer-aware helper |
| `src/components/InstallationTeamApp.tsx` | Migrates survey upload call to Bearer-aware helper |
| `src/components/quoteAuthoring/QuotePageAuthoringFields.tsx` | Migrates watermark upload to Bearer-aware helper |
| `src/lib/quotePdfExport.ts` | Migrates PDF export calls to Bearer-aware helper |
| `src/lib/quotePdfRender.ts` | Preview download script now sends Bearer when available |

---

## Authorization model delivered

### Public allowlist

No authorization required:

- `GET /health`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/verify-email`
- `GET /api/auth/verify-email`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### JWT-only routes

Bearer required; legacy headers never accepted:

- `GET /api/state`
- `GET /api/backup/export`
- `POST /api/db/update`
- `/api/diagnostics/*`
- `/api/debug/*`

### Protected default

All remaining `/api/*` routes are protected by default (fail closed).  
When `LEGACY_HEADER_AUTH=false` (default), requests must pass with Bearer JWT.

---

## Frontend JWT migration completed

Migrated non-`apiFetch` callers to Bearer-aware transport for:

- `/api/db/update`
- `/api/upload`
- `/api/quote-assets/watermark`
- `/api/leads/:id/create-quote`
- `/api/leads/:id/update-quote`
- `/api/leads/:id/survey-report`
- `/api/export/pdf/manual-quote/*`
- `/api/admin/customer-documents/upload` (XHR progress uploader)

Legacy `X-Sunchaser-*` frontend identity headers were removed from migrated callers.

---

## Verification performed

- `npm run test:phase-1b1` passed (12/12).
- Centralized middleware confirmed fail-closed on unknown `/api/*` routes without credentials.
- JWT-only routes reject missing/invalid credentials with `401`.
- Bearer-authenticated probes for migrated frontend route paths no longer returned `401` due to missing tokens.
- Local login failures observed during regression tests were traced to pre-existing email-verification/credential checks in `authenticateUser`, not middleware changes.

---

## Breaking behavior in this phase

| Change | Impact |
|--------|--------|
| `/api/*` now centralized under authorization middleware | Header-only frontend callers without Bearer fail with `401` |
| `LEGACY_HEADER_AUTH` defaults to `false` | Unmigrated clients relying on identity headers lose access |
| Fail-closed default for non-public routes | Newly added `/api/*` routes are protected unless explicitly allowlisted |

---

## Known limitations (as shipped)

- Login gating for non-customer users still requires verified email status; local seed users may fail login until verified.
- Some endpoint handlers still include legacy header parsing code paths for backward compatibility, even though frontend migrated callers now use Bearer.
