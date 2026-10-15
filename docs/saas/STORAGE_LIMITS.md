# Storage limits (pilot companies)

Applies only when `MULTI_COMPANY_ENABLED=true`, and only to companies other than the founding one. Single-company mode and the founding company are never metered and never refused.

## Rule

A pilot company's new file is accepted **only if all three are true**: its limit is known, its usage was measured, and the file fits. Otherwise the upload is refused and nothing is written.

| Situation | HTTP | `code` | `retryable` | What the user is told |
|---|---|---|---|---|
| The file would take the company over its limit | 402 | `storage_limit_exceeded` | no | the plan allows N MB; existing files are safe; delete files or ask the operator to raise the limit |
| The limit or the usage could not be read (database or object store down, or no answer within 8 s) | 503 + `Retry-After: 30` | `storage_unverified` | **yes** | we could not check your usage; nothing was lost; existing files are unaffected; try again in a minute |
| The company has no limit at all (no subscription row, or neither an override nor a plan value) | 403 | `storage_limit_not_set` | no | no limit has been set, uploads are paused, existing files are unaffected; ask the operator |

There is **no unlimited default**. Operator onboarding (`POST /api/platform/companies`) requires `storageLimitMb` (a whole number, 1 to 1 048 576) and stores it as the company's own override. Changing another limit later (`PATCH` with `limitOverrides`) **merges** into the existing overrides, so it cannot silently drop the storage limit; a `null` value removes that one override.

## What is never affected

Reading, downloading (signed links), listing and deleting never go through the guard. Files already stored are never deleted, moved or truncated, whatever the usage and whatever state the guard is in (tested: at the limit, at 0 MB, and with the object store's listing down).

## How concurrent uploads are kept inside the limit (across server processes)

The decision is made **by the database**, not by the server process, so several processes serving the same company cannot overshoot together. It needs migration **t8-storage-reservations** (`scripts/saas/phase2h-storage-reservations.sql`, rollback beside it); without it pilot-company uploads are refused as "could not verify" (retryable), the founding company and single-company mode are not affected. Apply t8 **before the switch is turned on and before any pilot company uploads** (the full order and the rollback are in `docs/ops/COMBINED_DEPLOYMENT_AND_ROLLBACK.md`). Rolling t8 back never touches a stored file and never changes what the quota counts (usage is measured from the object store); it only makes pilot uploads fail closed until t8 is applied again (journey `rollback-files-quota`).

1. **Usage** is the real size of the company's objects (a listing of its own key prefix in both namespaces). Each process caches its last listing for 60 seconds. Just before listing, the process takes a **mark** (`saas_storage_mark()`, a number from a database sequence).
2. **Reserve:** `saas_storage_reserve(company, bytes, limit, measured bytes, mark, ...)` runs in one short transaction under an advisory lock for that company, which every process takes. It counts: the measured bytes + reservations still **pending** + reservations that **finished after the mark** (those cannot be in the listing). It admits the write only if all of that plus the new file fits, and records a pending reservation.
3. **Settle:** after the write, the process calls `saas_storage_settle(id, 'commit')` (kept as a finished reservation, so processes with an older listing still count it) or `'release'` (the write failed: the row is deleted and the bytes are free at once).
4. **Cleanup:** a pending reservation whose process died expires by itself (180 s by default, longer than the object-store write timeout; `STORAGE_RESERVATION_TTL_SECONDS` overrides); a finished one is purged after 15 minutes (or three times the listing cache, if longer). Expired rows are purged by the company's next reservation. Settling is idempotent; if settling fails (database blip) the reservation just stays pending and expires, so the limit still holds.
5. A refusal made on a listing older than 2 seconds is re-checked once against a fresh listing, so a company that deleted files is not refused on old data.

What is counted twice, briefly, and why that is acceptable: an upload that completed just before a listing but whose "finished" note arrives just after it. That can only make the figure larger (an early refusal near the boundary), never let a write through.

**Assumptions and remaining limits (stated, not hidden):**
* The object store's **listing includes every object whose write has completed** (read-after-write listing). This is not proven for the production bucket; a store with lagging listings could let a burst overshoot by the uploads of the lag window. **Production-access item.**
* A pending reservation expires after its TTL even if the (very slow) upload is still running; the TTL is longer than the write timeout, so a live upload is not expected to outlive it.
* A reservation function that is missing, not permitted or unreachable fails **closed** (HTTP 503, retryable). Nothing falls back to a weaker check.
* It is a commercial control, not a security boundary.

## Which routes are metered (all go through `putRailwayObject`)

| Route | Notes |
|---|---|
| `POST /api/admin/customer-documents/upload` | customer documents |
| `POST /api/admin/invoices/:id/payments` with a receipt file | the payment is **not** recorded when the receipt is refused, so the user can retry or record it without a receipt |
| `POST /api/quote-assets/watermark` | watermark / logo images |
| `POST /api/upload` | for a pilot company: **images only (declared PNG, JPEG or WEBP, at most 5 MB; the type is the one the browser declares, the bytes are not inspected)**, stored under the company's own key space (`c/<company>/uploads/`), not in the shared public folder. The founding company keeps the old behaviour |

Not counted: smart-quote PDFs and WhatsApp-agent files (founding company only); a company **restore** (it puts back what the company already had; it runs outside any company request); and images embedded as text (a `data:` URL) inside a database record such as a quotation page or an installation-photo row. Each such request is bounded by the 15 MB body limit; nothing bounds the total. That is a gap, not a design choice.

## Tests

* `server/saas/subscriptionEnforcement.test.ts` (fail-closed, boundary, concurrency in one process, no cross-company counting) and `server/saas/storageReservations.test.ts` (several simulated processes sharing one reservation store: exactly as many fit as fit, randomised mixed sizes with failing writes, failed writes give room back in every process, a finished upload is counted by a process with an older listing and not twice after it lists again, a killed process's reservation expires, fail-closed, a **negative control** showing that processes that do not share the decision overshoot).
* `scripts/saas/tests/test-storage-reservations.sh` against a real PostgreSQL: the arithmetic, expiry, argument checks, privileges (service role only; the tenant role cannot call or read), idempotent apply/rollback, **40 simultaneous sessions competing for 10 units are admitted exactly 10 times (5 rounds)**, and a **negative control** (the same function without its lock admits more).
* Journey `scripts/saas/e2e/storage-two-instances.mjs` on **two real server processes** of the same build on one database and one object store: 24 mixed-route uploads race over both at the boundary (exactly as many accepted as fit), a deleted file frees exactly its room, failed writes through both processes leave no reservation and use no room, the founding company never reserves, a database that refuses the reservation function makes both processes fail closed (503, retryable, log line names the function) and recover without a restart, and a process killed with SIGKILL mid-upload leaves a pending reservation that blocks while it lives and stops blocking after it expires. Run against the previous per-process design it fails: 10 of 24 uploads accepted against a limit that fits 5, 1.9 MB stored against 1 MB (`docs/saas/evidence/round5/storage/`).
* `scripts/saas/e2e/storage-quota.mjs` (single-process, every upload route, fault injection of the store: listing down, listing hangs, rejected write, no limit set, no subscription, 0 MB). The cache times can be shortened for such a stack with `STORAGE_USAGE_CACHE_MS` and `STORAGE_LIMIT_CACHE_MS` (defaults 60 000 and 15 000).

## Guarantee and its one conservative edge
* **Never more than fits is stored** (proved by the unit tests, the PostgreSQL function tests and the two-instance journey).
* An upload that finished between another request's database mark and its object-store listing can be counted twice (once in the listing, once as a finished reservation). That can only make a request refuse when it would just fit, never admit too much. To keep it from refusing wrongly, a refusal made while other uploads are in flight or finished after the mark is **re-checked once** with a fresh mark and listing (`storageQuota.ts`; unit test "an upload counted twice ..." with a negative control). This relies on the stated read-after-write listing of the object store (PA3).
