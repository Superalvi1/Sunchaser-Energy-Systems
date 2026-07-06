# Vision

## Product

Sunchaser Energy Systems CRM is an integrated platform for solar sales, project operations, customer portals, technical field work, and admin tooling. The backend runs on Render; the web client is deployed on Vercel and talks to the Render API.

---

## Security vision (as implemented in Phase 1A)

The first security milestone establishes **cryptographic proof of identity** for the highest-risk backend surfaces:

1. **Signed sessions** — Users receive a JWT on login instead of relying solely on client-supplied identity headers.
2. **Server-enforced gates** — Selected routes that expose full system state, backups, database writes, diagnostics, and debug tooling require a verified Bearer token before any handler runs.
3. **Session re-validation** — The client confirms tokens against `/api/auth/me` on restore; stale or invalid sessions are cleared.
4. **Operational safety** — Production refuses to start without properly configured JWT secrets.
5. **Abuse resistance** — Login is rate-limited per IP.

Phase 1A intentionally protects a **narrow, high-impact route set** while leaving the broader API surface on existing header-based patterns. That boundary is documented in [PHASE-1A-Security-Foundation.md](../phases/PHASE-1A-Security-Foundation.md).

---

## Engineering principles observed in Phase 1A

- **Fail closed on protected routes** — Missing or bad tokens return `401`; no fallback to anonymous access.
- **Secrets stay server-side** — `JWT_SECRET` never ships in the frontend bundle.
- **Minimal scope** — Security changes limited to auth plumbing and explicitly listed routes; no unrelated refactors.
- **Backward-aware rollout** — Login still uses existing credential validation; token is additive to the login response. Users without stored tokens must re-authenticate once after deploy.

---

## Documentation

Engineering documentation lives under `docs/`:

| Directory | Purpose |
|-----------|---------|
| `phases/` | Completed phase specifications |
| `roadmap/` | Record of shipped phases |
| `security/` | Security controls and requirements |
| `changelog/` | Release history |
| `vision/` | Product and engineering direction |
| `architecture/` | *(reserved)* |
| `deployment/` | *(reserved)* |
| `decisions/` | *(reserved)* |
