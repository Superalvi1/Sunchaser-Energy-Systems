# Sunchaser Publisher — provider adapters (isolated)

This package is the **Grok parallel track** (`grok/provider-tests`).

It does **not** implement Phase 0 authentication, tenancy, or database schema.
Claude owns that layer. This package is designed so the scheduler/worker can
depend on `SocialProvider` without embedding Facebook Graph or TikTok
Content Posting details.

```
CRM / Publisher UI
      ↓
Publisher API  (Phase 0 — Claude)
      ↓
SocialProvider  (this package)
      ├── FacebookProvider
      └── TikTokProvider
      ↓
PostgreSQL/Supabase  →  Cloud Worker  →  Facebook / TikTok
```

## What this branch contains

- Provider interface + Facebook/TikTok adapters
- AES-256-GCM token envelope (`v1:iv:tag:ciphertext`) matching CRM WhatsApp crypto
- TikTok FILE_UPLOAD chunk planner + property tests
- HTTP and SocialProvider mocks for every failure class (400/401/403/429/500/timeouts/malformed/expired/revoked)
- Duplicate-post protection: `unknown` never auto-republishes
- Reconciliation worker design + tests
- Structured logging + redaction
- Independent security review and current Meta/TikTok API findings

## Run tests

```bash
cd publisher
npm install
npm test
npm run typecheck
```

No production Facebook or TikTok accounts are contacted. No credentials are
checked in. Do not merge to `main` until Phase 0 lands.

See [docs/PARALLEL-REVIEW.md](docs/PARALLEL-REVIEW.md) for the full handoff.
