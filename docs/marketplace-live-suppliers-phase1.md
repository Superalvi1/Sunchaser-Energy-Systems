# Marketplace Live Suppliers — Phase 1 (Preview Only)

## Authorized suppliers

| Supplier | Origin | Access method |
|----------|--------|---------------|
| Kamal Solar | https://kamalsolar.pk/ | `shopify_storefront_products_json` |
| Alladin | https://alladin.pk/ | `shopify_storefront_products_json` |

Both stores expose the public Shopify storefront catalogue feed:

`GET https://{host}/products.json?limit=250&page={n}`

No login, private API, CAPTCHA bypass, or browser credentials are used.

Kamal product pages state buyers should **confirm price on WhatsApp**. Phase 1 therefore sets `confirmPriceRecommended=true` on every Kamal observation.

## Configuration (server-only)

Live mode is **disabled by default**. Enable each supplier explicitly to allow **fetching**:

```bash
MARKETPLACE_ENABLED=true

# Fetch enablement (per supplier) — does NOT enable publication
MARKETPLACE_WS4_KAMAL_LIVE_ENABLED=true
MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD=shopify_storefront_products_json

MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED=true
MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD=shopify_storefront_products_json

# Publication scheduling gates (must stay false/unset in Phase 1)
# MARKETPLACE_WS4_LIVE_PUBLICATION_ENABLED=false
# MARKETPLACE_WS4_PHASE1_PREVIEW_ONLY=true
```

| Flag / constant | Enables |
|-----------------|---------|
| `MARKETPLACE_WS4_*_LIVE_ENABLED` + exact `AUTHORIZED_METHOD` | Live **fetch** for that supplier |
| `MARKETPLACE_WS4_LIVE_PUBLICATION_ENABLED=true` **and** `MARKETPLACE_WS4_PHASE1_PREVIEW_ONLY` not `true` | Required before scheduled publication can even be considered |
| `PHASE1_LIVE_PUBLICATION_ALLOWED` (hardcoded `false` in code) | Hard lock — live Shopify observations never enter `mp_publish_price` |

Authorized method must match exactly `shopify_storefront_products_json`. Any other value keeps the adapter fail-closed.

## Two-layer publication protection

Phase 1 keeps **two independent layers** so preview and ingestion cannot publish live prices:

1. **Live preview path** (`POST /suppliers/live-preview` / `runLivePreview`)
   - Never calls `mp_publish_price`
   - Always returns `productionReady=false` and `publishedCount=0`

2. **Existing ingestion / price-check path** (`runPriceCheck`)
   - Rejects live Shopify observations for publication because
     `PHASE1_LIVE_PUBLICATION_ALLOWED=false`
   - Fixture/manual observations retain prior WS4 test behavior; live
     `shopify_storefront_products_json` evidence is observation-only

**Scheduled publication** requires its own separate gates (`isScheduledPublicationAllowed`) and remains disabled while Phase 1 preview-only is in force. Changing or removing the hardcoded `PHASE1_LIVE_PUBLICATION_ALLOWED` lock requires a separately reviewed future release.

## Manual Super Admin preview

Ordinary Admin **cannot** use this endpoint — Super Admin only.

```http
POST /api/marketplace/admin/suppliers/live-preview
Authorization: Bearer <super-admin-jwt>
Content-Type: application/json

{ "suppliers": ["kamal", "alladin"] }
```

Optional body omits `suppliers` to preview both.

Local one-shot (does not publish):

```bash
MARKETPLACE_WS4_KAMAL_LIVE_ENABLED=true \
MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD=shopify_storefront_products_json \
MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED=true \
MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD=shopify_storefront_products_json \
node --import tsx scripts/live-preview-once.mjs
```

Response summary includes discovered/accepted/excluded/matched/unmatched/invalid prices/images, `productionReady=false`, and `publishedCount=0`.

Denied for Guest, Customer, Sales, and ordinary Admin (Super Admin only).

## Pagination deduplication

Products are deduplicated **per supplier** with key `${supplier}:${shopifyProductId}` before normalization and preview totals.

- **Quality-aware selection**: a later duplicate replaces an earlier record only when it is at least as usable/complete for Phase 1 catalogue purposes (usable variants and usable current listed price are mandatory protections — a later row with missing/empty/zero/malformed price or no variants cannot erase an earlier complete product).
- Compare-at / struck-through prices are never treated as the current listed price during selection.
- **Deterministic tie-break**: when completeness ranks are equivalent, the later successfully keyed record wins (whole-record selection; no silent merge of contradictory prices, variants, or availability).
- Malformed rows (missing product id) never replace a valid keyed entry.
- Material price or availability conflicts emit a **bounded sanitized warning** (no raw supplier bodies).
- Kamal and Alladin IDs never collide (supplier-scoped keys).
- Preview totals (`discovered`, `accepted`, `excluded`, prices, images) use unique products only; image counts are not inflated by duplicate page rows.
- Safe pagination termination and the 40-page ceiling are unchanged. A non-empty duplicate-only page does not terminate pagination early solely because rows were already seen.

## Network / DNS pinning

Outbound catalogue HTTPS uses DNS resolve → public-IP validation → **pinned connection** to those validated addresses via `node:https` `lookup` override. TLS SNI / certificate hostname verification still use the original allowlisted hostname (`rejectUnauthorized` remains enabled; `NODE_TLS_REJECT_UNAUTHORIZED=0` is never set). Every redirect hop is re-validated and re-pinned independently.

## Failure behavior

- One supplier failing does **not** discard the other supplier’s observations (`status: partial`).
- Overlapping preview/price-check jobs return `409 CONFLICT`.
- Invalid/zero/malformed/suspicious prices become review candidates (`parseStatus` not `ok`).
- Compare-at / struck-through prices are never treated as the current listed price.
- Network client is HTTPS-only with hostname allowlist, DNS private-IP blocking, redirect validation, timeouts, size limits, and bounded retries.

## Category filter notes

Bare “inverter” is insufficient for acceptance. Solar/hybrid/on-grid/off-grid/PV context or an approved product_type is required. UPS / automotive power inverters without solar context are excluded. VFDs remain accepted when VFD context is present.

## Rate limits / concurrency

- Suppliers are fetched **sequentially**.
- Page size 250, max 40 pages per supplier.
- User-Agent: `SunchaserSupplierMonitor/1.0 (+https://sunchaserenergy.co; supplier-catalogue-monitor)`
- Conservative retries with exponential backoff on timeout / 429 / 5xx.

## Current limitation (Phase 1)

- **Preview only** — no automatic publication.
- `mp_publish_price` is not invoked from live preview; live observations are blocked from publication in price-check by `PHASE1_LIVE_PUBLICATION_ALLOWED=false`.
- Scheduled production publication remains disabled.
- Images are collected as remote HTTPS URLs only (not downloaded into storage).
- Exact active unlocked mappings only — no fuzzy auto-mapping.
- Four evidence-blocker variants remain locked.
