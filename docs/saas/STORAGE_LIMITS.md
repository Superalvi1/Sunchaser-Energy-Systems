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

## How concurrent uploads are kept inside the limit

* Usage is the real size of the company's objects (a listing of its own key prefix in both namespaces), cached for 60 seconds.
* The decision for one company is made one at a time (a queue per company). Bytes of uploads that were accepted but not yet finished are counted ("in flight"), so a burst cannot all pass on one stale number. A failed write gives its bytes back; a finished one stays counted.
* A refusal made on a figure older than 2 seconds is re-checked once against a fresh listing, so a company that deleted files is not refused on old data.
* **Known limit:** the queue lives in one server process. With several server processes serving the same company at the same moment, uploads in different processes can overshoot by the size of the uploads in flight; the next listing corrects it. It is a commercial control, not a security boundary.

## Which routes are metered (all go through `putRailwayObject`)

| Route | Notes |
|---|---|
| `POST /api/admin/customer-documents/upload` | customer documents |
| `POST /api/admin/invoices/:id/payments` with a receipt file | the payment is **not** recorded when the receipt is refused, so the user can retry or record it without a receipt |
| `POST /api/quote-assets/watermark` | watermark / logo images |
| `POST /api/upload` | for a pilot company: **images only (declared PNG, JPEG or WEBP, at most 5 MB; the type is the one the browser declares, the bytes are not inspected)**, stored under the company's own key space (`c/<company>/uploads/`), not in the shared public folder. The founding company keeps the old behaviour |

Not counted: smart-quote PDFs and WhatsApp-agent files (founding company only); a company **restore** (it puts back what the company already had; it runs outside any company request); and images embedded as text (a `data:` URL) inside a database record such as a quotation page or an installation-photo row. Each such request is bounded by the 15 MB body limit; nothing bounds the total. That is a gap, not a design choice.

## Tests

`server/saas/subscriptionEnforcement.test.ts` (fail-closed, boundary, concurrency, queue not poisoned by a failure, no cross-company counting; the concurrency test fails if the serialisation is removed), `server/saas/platformApi.test.ts` (limit required at onboarding), and the journey `scripts/saas/e2e/storage-quota.mjs`, which on a real stack with a fault-injectable object store runs 14 simultaneous uploads at the boundary, every route above over the limit and with room, listing down, listing hanging, a rejected write, no limit set, no subscription, and a 0 MB limit. The cache times can be shortened for such a stack with `STORAGE_USAGE_CACHE_MS` and `STORAGE_LIMIT_CACHE_MS` (defaults 60 000 and 15 000).
