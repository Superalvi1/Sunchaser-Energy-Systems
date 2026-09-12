# Duplicate-post protection and reconciliation

## The failure

Worker sends POST. Provider accepts. TCP dies before we read `{ id }` / `publish_id`.

Blind retry = duplicate Page post or second TikTok video.

## Rule

`requestSent && !definitiveResponse` → job status `unknown`.  
`reconcilePublish` always returns `republishAllowed: false`.

## Provider capabilities

| | Facebook | TikTok |
|---|----------|--------|
| Client idempotency key | None | None |
| Handle to poll | `post_id` / `video_id` | `publish_id` from init |
| Poll API | `GET /{id}` | `POST /v2/post/publish/status/fetch/` |
| Search fallback | Recent page feed fingerprint (ambiguous) | None that is safe |
| Timeout before init/feed POST | Safe to retry | Safe to retry |
| Timeout after init/feed POST | Manual review | Manual review |

Failed (4xx/5xx with body) may retry only when the body proves the object was not created (most 4xx). 5xx after send is still `unknown` if we cannot parse a definitive rejection.
