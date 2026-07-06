# Engineering Roadmap

This document records **completed** engineering phases only. Future phases are not listed here until they are implemented and documented.

---

## Completed

### Phase 1A — Security Foundation

**Commit:** `39ad363`  
**Documentation:** [PHASE-1A-Security-Foundation.md](../phases/PHASE-1A-Security-Foundation.md)

**Delivered:**

- JWT access tokens issued on `POST /api/auth/login`
- Bearer JWT required on `/api/state`, `/api/backup/export`, `/api/db/update`, `/api/diagnostics/*`, `/api/debug/*`
- `GET /api/auth/me` for server-side session validation
- Frontend token storage (`sunchaser_auth_token`) and session restore
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
