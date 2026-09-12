# Hand-back to Claude (Phase 0 owner)

Do **not** rewrite auth/DB in this branch. Consume these contracts.

## Must land in Phase 0

1. Authenticated Publisher API (no anonymous publish/connect).
2. `organization_id` on every account and job; RLS or equivalent.
3. Job status enum including `unknown` and `needs_review`.
4. Idempotency key unique per `(organization_id, job_id, attempt_number)` **and** a rule that `unknown` cannot increment attempt for a new provider call.
5. AES-256-GCM column for tokens using `v1:iv:tag:ciphertext`. Key: `PUBLISHER_TOKEN_ENCRYPTION_KEY` (not the WhatsApp key).
6. OAuth state bound to org + user; redirect URI allowlist.
7. Processing lock TTL; reconciliation loop calling `SocialProvider.reconcilePublish`.
8. Feature flag `PUBLISHER_ENABLED=false` until review.
9. Facebook connect is two-step: list pages (no tokens in the response) → persist only after `selectedPageId`.
10. Persist `tokenIssuedAt` for Facebook reexchange (must be ≥ 24h old). Do not fake issued-at.
11. Allowlist `open-upload.tiktokapis.com` and `rupload.facebook.com` in addition to API hosts.

## Must not do in Phase 0

- Re-implement TikTok chunk math (use `planTikTokFileUpload`).
- Fetch user-supplied media URLs.
- Auto-retry after timeout.
- Connect production Facebook/TikTok.
- Merge this branch to main.

## Import surface

```ts
import {
  FacebookProvider,
  TikTokProvider,
  MockProvider,
  ProviderRegistry,
  planTikTokFileUpload,
  reconcileOne,
  mayAutoRepublish,
} from "../publisher/src/index.ts";
```

Scheduler tests should inject `MockProvider`. Production worker injects real providers with `fetchLike` defaulting to HTTPS allowlisted hosts only.
