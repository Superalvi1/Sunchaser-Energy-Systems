# Grok parallel review — Sunchaser Publisher

**Branch:** `grok/provider-tests`  
**Role:** Provider/API, testing, reliability, independent verification  
**Date:** 2026-09-12  
**Does not merge to main. Does not deploy. No production Meta/TikTok accounts.**

GROK PARALLEL REVIEW COMPLETE: YES

---

## 1. Files inspected

### Publisher application

The dedicated Sunchaser Publisher Git repository was **not present** on GitHub
under `Superalvi1` (`sunchaser-publisher`, `Sunchaser-Publisher`, `publisher`
all 404). Vercel has only `sunchaser-energy-systems` and
`sunchaser-marketing-website`. Grok project artifacts contain the SEO agent
and marketing site, not the social publisher.

**This is itself a finding:** Phase 0 work Claude is doing is not visible on
the only Git remotes this agent can access. Independent line-by-line review of
“every publisher file” could not be performed against the live tree.

### CRM repository inspected instead (`Superalvi1/Sunchaser-Energy-Systems@main`)

Read/skimmed (not exhaustive of 49k-file blobs/images):

| Area | Paths |
|------|--------|
| Root / contracts | `ARCHITECTURE.md`, `ROADMAP.md`, `DEPLOYMENT.md`, `.env.example`, `package.json` |
| Auth / ownership | `server/auth/`, `server/ownership/`, `userAuthDb.ts` |
| Meta / WhatsApp | `server/whatsappTransport/*` (graph client, token crypto, connection service, onboarding) |
| Messaging | `server/unifiedMessaging/` |
| SSRF-safe HTTP | `server/marketplace/suppliers/safeHttp.ts` |
| Inbox Meta signup | `src/inbox/lib/metaEmbeddedSignup.ts` |
| Docs | `docs/architecture/*`, `docs/backlog/PRODUCT-BACKLOG.md`, `docs/security/` |
| Schema | `supabase-schema.sql` |

Reusable CRM patterns this package copies **by contract**, not by import:

- AES-256-GCM envelope `v1:<iv>:<tag>:<ciphertext>` (`server/whatsappTransport/whatsappTokenCrypto.ts`)
- Graph error sanitization (Bearer / `access_token=` redaction)
- SSRF host allowlists (`safeHttp.ts`)
- Timeout-after-send → do not automatic provider resend (WhatsApp transport PR)

Claude’s Phase 0 publisher files were not modified.

---

## 2. Current Meta API findings

Pinned Graph version in adapters: **v26.0** (Pages API “Get started” updated **2026-06-30**; Reels Publishing API updated **2026-07-30**).

### OAuth

- Use **Facebook Login for Business**.
- Permissions for Page publishing: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_manage_metadata`. Videos/Reels also need `publish_video`.
- User must have Page task **`CREATE_CONTENT`**.
- CSRF `state` required. Code exchange **server-side only**. Never put `client_secret` in the browser.

### Token lifecycle (official)

| Token | How obtained | Lifetime |
|-------|----------------|----------|
| Short-lived user | OAuth code exchange | ~1–2 hours |
| Long-lived user | `GET /{v}/oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token=` | **~60 days** (`expires_in` ≈ 5_184_000) |
| Page token from **long-lived user** via `GET /{user-id}/accounts` | **No expiration date**. Invalidated on password change, user losing Page role, app deauth, permission removal, token debug failure | |
| Page token from **short-lived user** | **~1 hour** — this is the classic production bug |

Re-exchange of a long-lived user token: token must be **≥ 24 hours old** and **not yet expired**.

### Token debugging

`GET /v26.0/debug_token?input_token={token}&access_token={app_id}|{app_secret}`

Fields: `is_valid`, `expires_at`, `scopes`, `granular_scopes`, `error`.

- `is_valid=false` and `expires_at` in the past → expired  
- `is_valid=false` and `expires_at` in the future → treated as **revoked/invalidated**

Graph error **190**: OAuth token invalid. Subcodes: **463** expiry, **460/458** invalidated/revoked. Do not treat these the same.

### Page selection

`GET /{user-id}/accounts` returns `id`, `name`, `access_token`, `tasks[]`. UI must require an explicit Page pick. Do not auto-bind the first Page in production without confirmation. Never return Page `access_token` to the browser.

### Publishing

| Kind | Endpoint | Notes |
|------|----------|-------|
| Text / link | `POST /{page-id}/feed` | `message`, optional `link`. Page token. Returns `{ id }` |
| Photo | `POST /{page-id}/photos` | `caption` (message deprecated). Returns `{ id, post_id }` |
| Video | `POST /{page-id}/videos` | `publish_video` permission |
| Reels | `POST /{page-id}/video_reels` | `upload_phase=start` → upload to `upload_url` → `upload_phase=finish` + `video_state=PUBLISHED\|DRAFT\|SCHEDULED` |

### Scheduled vs server-side scheduling

Pages publishing guide (2026-04-17): `published=false` + `scheduled_publish_time` between **10 minutes and 30 days**.

Feed reference (v26.0) mentions **75 days**. **Treat 10 minutes–30 days as the conservative production window.**

**Sunchaser must schedule in our worker**, not Meta, because:

1. The product requirement is “laptop off” — our cloud worker already owns the clock.
2. Meta native schedule cannot cover arbitrary horizons, retries, or TikTok (TikTok has no native schedule).
3. Mixing Meta-side schedule with worker-side schedule duplicates posts.

### Rate limits / errors

- 4 / 17 / 32 / 613 → rate limited, retry with backoff  
- 10 / 200 / 230 → permission  
- 368 → blocked/abusive  
- 1 / 2 → transient  
- 100 → invalid parameter, do not retry as-is  

There is **no idempotency key** on Page feed/photos/videos.

---

## 3. Current TikTok API findings

Source: TikTok for Developers, **last updated 2026-08-04**.

### OAuth

| Item | Value |
|------|--------|
| Scopes for Direct Post | `user.info.basic`, `video.publish` |
| Draft/inbox | `video.upload` |
| Access token | `expires_in = 86400` (24 hours) |
| Refresh token | `refresh_expires_in = 31536000` (365 days) |
| Refresh endpoint | `POST https://open.tiktokapis.com/v2/oauth/token/` `grant_type=refresh_token` |
| Rotation | **Returned `refresh_token` MAY differ. Persist the new value.** |

Refresh **before every publish** if access token expires within 1 hour.

### creator_info (mandatory before Direct Post)

`POST /v2/post/publish/creator_info/query/`  
Rate limit: **20 req/min** per user access token.

Returns `privacy_level_options`, comment/duet/stitch flags, `max_video_post_duration_sec`.

Public accounts: `PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | SELF_ONLY`  
Private accounts: `FOLLOWER_OF_CREATOR | MUTUAL_FOLLOW_FRIENDS | SELF_ONLY`

**Do not hard-code PUBLIC.** Unaudited apps: force **`SELF_ONLY`**. Direct Post guidelines require displaying nickname + privacy options and a **manual** privacy choice — UI work after Phase 0.

### Video Direct Post

`POST /v2/post/publish/video/init/` scope `video.publish`  
Then sequential PUTs to `upload_url` **or** `PULL_FROM_URL` from a **verified domain**.

Max video **4 GB**, **10 minutes**. Formats mp4 / quicktime / webm.

### Photo

`POST /v2/post/publish/content/init/` with `media_type=PHOTO`, `post_mode=DIRECT_POST`.  
1–35 images, JPEG/WEBP, ~20 MB each (third-party summaries; confirm against portal before production photo).

### Chunk rules (FILE_UPLOAD) — exact

- `total_chunk_count = floor(video_size / chunk_size)`  (**round down, not ceil**)
- Non-final chunk: **5 MB–64 MB** (decimal MB; official example uses `10_000_000`)
- Final chunk may exceed `chunk_size`, **up to 128 MB**, absorbing remainder
- **< 5 MB** → whole-file, `chunk_size === video_size`, count `1`
- **> 64 MB** → must be multiple chunks
- 1–1000 chunks, sequential
- `Content-Range: bytes {FIRST}-{LAST}/{TOTAL}` (inclusive)
- Non-final PUT → **206**; final → **201**

Official example: 50,000,123 bytes / 10,000,000 → 5 chunks, last 10,000,123.

### Status polling

`POST /v2/post/publish/status/fetch/` `{ publish_id }`  
**30 req/min** per user access token.

Statuses: `PROCESSING_UPLOAD`, `PROCESSING_DOWNLOAD`, `SEND_TO_USER_INBOX`, `PUBLISH_COMPLETE`, `FAILED`.

Init rate limit commonly documented as **6 req/min** per access token.

### No true idempotency

Re-calling `video/init` creates another publish. After a timeout, **never re-init**.

---

## 4. Additional vulnerabilities discovered

Categorized independently of Claude’s original 8/12/13/7 report.

### BLOCKER

| ID | Finding |
|----|---------|
| B-G1 | **Publisher source of truth is not on GitHub.** Parallel review cannot verify Phase 0 diffs. Create `sunchaser-publisher` (private) or a `publisher/` tree on a named branch and push it. |
| B-G2 | **No idempotency on either provider.** A worker timeout after the request leaves the system one retry away from duplicate Page posts / TikTok videos. This package encodes `unknown` + no auto-republish; Phase 0 DB **must** persist that state or the invariant is lost. |
| B-G3 | **Facebook Page token from short-lived user token (~1h)** if connect skips `fb_exchange_token` then `/accounts` with the long-lived user token. Publishing will silently die ~1 hour after connect. |

### HIGH

| ID | Finding |
|----|---------|
| H-G1 | TikTok `total_chunk_count` using `Math.ceil` (or last-chunk-short) fails init or leaves bytes unsent. Covered by tests. |
| H-G2 | TikTok refresh token rotation: dropping the new `refresh_token` locks the creator out until they reconnect. |
| H-G3 | Unaudited TikTok app posting `PUBLIC_TO_EVERYONE` is rejected or non-compliant. Default `SELF_ONLY` until audit. |
| H-G4 | Media URLs fetched by the worker from user-controlled hosts → SSRF. Adapters accept **asset ids + bytes from a trusted media plane**, never `fetch(userUrl)`. |
| H-G5 | OAuth `redirect_uri` open redirect / query-open redirect if callback accepts a client-supplied `next=` without allowlist. Phase 0 must pin redirect URIs 1:1 with the Meta/TikTok app settings. |
| H-G6 | Cross-tenant account bind: `connectAccount` must stamp `organizationId` from the **authenticated session**, never from the body. |
| H-G7 | Logging `Authorization` or Graph URLs with `access_token=` query. CRM WhatsApp already sanitizes; Publisher must use the same redaction (tests included). |
| H-G8 | Stale `processing` locks (worker crash) leave jobs stranded. Reconciliation must reclaim after TTL **without republishing**. |
| H-G9 | TikTok FILE_UPLOAD `upload_url` is on `open-upload.tiktokapis.com` (official example). A Graph/API-only SSRF allowlist would reject every video PUT. **Fixed here:** host added. |
| H-G10 | Facebook connect auto-bound `usable[0]` before the user picked a Page, minting and returning a Page token for a Page they did not select. **Fixed here:** `requiresPageSelection` returns pages without `account`. |
| H-G11 | `sendHttp` classified in-flight abort as `timeout_before_request` → scheduler would mark `failed` and auto-republish. **Fixed here:** once the request is handed to fetch, abort is `timeout_after_possible_accept` / `unknown`. |

### MEDIUM

| ID | Finding |
|----|---------|
| M-G1 | Facebook native `scheduled_publish_time` plus worker schedule → duplicate. Disable Meta-side schedule in v1. |
| M-G2 | `debug_token` requires app token (`app_id\|app_secret`). Leaking that app token is equivalent to app takeover. Server-only. |
| M-G3 | TikTok creator_info 20/min and init 6/min: a naive retry loop will 429 a whole org. Need per-account token buckets. |
| M-G4 | Photo/video multipart without max bytes → memory DoS on the worker. Cap asset size at provider limits (FB photos, TT 4GB with streaming — never buffer 4GB in the API process). |
| M-G5 | OAuth `state` not bound to session/org → login CSRF / account mix-up. |
| M-G6 | Token substitution: an attacker who can write `pageTokenEnvelope` for another org’s row publishes as them. Row-level org check on every decrypt. |
| M-G7 | Queue starvation: large TikTok uploads hold a worker forever. Separate “upload” vs “text” queues; cap concurrency per provider. |

### LOW

| ID | Finding |
|----|---------|
| L-G1 | Graph version drift (v26 now). Pin + calendar reminder. |
| L-G2 | `pages_manage_metadata` may be more than needed for post-only; minimize scopes at audit time. |
| L-G3 | Facebook feed vs Reels aspect-ratio failures should be `media_rejected`, not retried. |
| L-G4 | Metrics cardinality if `organization_id` is a Prometheus label — use bounded labels. |

CRM-adjacent (not Publisher, but relevant because Meta stack is shared):

- `WHATSAPP_LEGACY_ENV_CREDENTIALS_ENABLED=true` by default — env tokens bypass the encrypted connection store. Do not copy this pattern into Publisher.
- `.env.production` exists in the CRM repo (size 262). Confirm it has no live secrets (not opened here).

---

## 5. Provider architecture proposal

```
SocialProvider
  connectAccount()
  refreshCredentials()
  validateCredentials()
  publishText() / publishImage() / publishVideo()
  getPublishStatus()
  reconcilePublish()
  disconnectAccount()

FacebookProvider    TikTokProvider    MockProvider
```

Application code (API routes, job worker, UI) **must not** import Graph paths, TikTok chunk math, or OAuth URLs except through this package.

Implementation: `publisher/src/providers/*`. Registry: `ProviderRegistry`.

---

## 6. Token lifecycle proposal

### Facebook

1. Authorization code (server) → short-lived user token  
2. `fb_exchange_token` → long-lived user token (~60d), store encrypted, store `issued_at`  
3. `GET /me/accounts` **with that long-lived user token** → never-expiring Page token (until invalidation)  
4. Persist: `user_token_envelope`, `page_token_envelope`, `page_id`, `scopes`, `user_token_expires_at`, `page_tasks`  
5. Publish with **Page token**  
6. Daily `debug_token` on the Page token  
7. If user token remaining < 7 days and age ≥ 24h → reexchange, then re-pull Page token  
8. 190/revoked or missing `CREATE_CONTENT` → `needs_reconnect`, stop publishing  

### TikTok

1. Code → access (24h) + refresh (365d)  
2. Persist `refresh_token_expires_at`  
3. On refresh response, **always write** the returned `refresh_token` if present  
4. Before publish, if access expires within 1h → refresh  
5. Refresh failure → `needs_reconnect`  
6. Never log tokens  

Encryption: existing AES-256-GCM `v1:iv:tag:ciphertext`. Separate key `PUBLISHER_TOKEN_ENCRYPTION_KEY` (32 bytes). Do not reuse the WhatsApp key.

---

## 7. TikTok chunking test results

Implemented in `src/providers/tiktok/chunking.ts`.

Required sizes: 2, 4.9, 5, 5.1, 10, 11, 49, 50, 51, 287.3, 500 MB.

Property sweep: ≥500 sizes including 64MB±1, official 50,000,123 example, and random values up to 2GB.

Assertions:

- declared count === ranges sent  
- `total_chunk_count === floor(size / chunk_size)` (not ceil)  
- no overlap, no gaps, full coverage  
- last chunk absorbs remainder (`chunk_size + size % chunk_size`)  
- <5MB whole-file  
- >64MB multi-chunk  

Run: `npm --prefix publisher test` (68 passing) and `npm --prefix publisher run typecheck`.

---

## 8. Provider mock implementation

`MockProvider` implements `SocialProvider`.  
`createScenarioFetch` injects HTTP into real adapters.

Scenarios: success, 400, 401, 403, 429, 500, timeout_before_request, timeout_after_accept, malformed_response, expired_token, revoked_token, rate_limited.

---

## 9. Duplicate-post / reconciliation design

**Policy:** if we cannot prove the provider did not accept the post, status = `unknown` / `needs_review`. **`republishAllowed` is always false** from reconcile.

| Provider | If we have an id | If we do not |
|----------|------------------|--------------|
| Facebook | `GET /{id}` → published; 404 → **manual review** (deleted vs never created) | Optional later: fingerprint recent `/page/feed` — still review if ambiguous |
| TikTok | `status/fetch` PUBLISH_COMPLETE / FAILED / PROCESSING_* | **manual review**. Re-init **is** a duplicate |

Worker examines `processing` (stale lock), `unknown`, `failed` (classification only), `provider_pending`.

Failed with `retry_new_attempt` may start a **new** attempt only when reconcile (or the original response) proved the first attempt did not create a provider object.

---

## 10. Tests added

| File | Covers |
|------|--------|
| `tests/tiktok-chunking.test.ts` | Required sizes + official example |
| `tests/tiktok-chunking-property.test.ts` | Sweep + ceil bug |
| `tests/tiktok-tokens.test.ts` | 24h/365d, rotation, provider unknown |
| `tests/facebook-tokens.test.ts` | CREATE_CONTENT, 190 subcodes, debug_token |
| `tests/facebook-provider.test.ts` | HTTP scenarios against real adapter |
| `tests/provider-mocks.test.ts` | All 12 scenarios |
| `tests/scheduler-unknown-outcome.test.ts` | No auto-republish |
| `tests/reconciliation.test.ts` | Stale lock, unknown, found object |
| `tests/logging-redaction.test.ts` | Tokens never logged |
| `tests/crypto-envelope.test.ts` | AES-256-GCM |
| `tests/security-invariants.test.ts` | SSRF allowlist, OAuth state, republish matrix |

---

## 11. Files changed

All under `publisher/` on `grok/provider-tests`. CRM Phase 0 / auth / schema **untouched**.

---

## 12. Git diff summary

Isolated package: provider adapters, mocks, reconciliation, docs, tests. No production env files. No Vercel/Render config.

---

## 13. Remaining risks

- Phase 0 schema for `unknown` / `needs_review` / idempotency key may not exist yet.  
- Real Meta/TikTok sandbox not exercised (by design).  
- Photo PULL_FROM_URL / domain verification not implemented.  
- Reels resumable upload is stubbed at `upload_phase=start` until the media plane exists.  
- Consent UX for TikTok privacy is not built.  
- Publisher repo still missing as a first-class GitHub remote.

---

## 14. Hand back to Claude

1. Persist job states: `scheduled|processing|provider_pending|published|failed|unknown|needs_review`.  
2. Org-scoped RLS / tenancy on accounts + jobs. Authenticated API.  
3. OAuth callbacks: pinned redirect URI, signed `state` bound to org, PKCE for TikTok.  
4. Wire `PUBLISHER_TOKEN_ENCRYPTION_KEY`.  
5. Claim lock with TTL; on timeout-after-send write `unknown`, never `failed`.  
6. Do not implement a second Facebook token exchange. Use this package’s flow.  
7. Media plane: store bytes, pass `assetId` + bytes into adapters; no user-URL fetch.  
8. Feature-flag publishing off until audit + Phase 0 review.

---

## 15. Merge only after Phase 0

- This branch  
- Provider registry into the worker  
- Any SQL for provider accounts / publish jobs  
- OAuth app settings (redirect URIs, scopes)  
- TikTok audit submission  
- Production env keys  

**Do not merge `grok/provider-tests` into `main` now.**
