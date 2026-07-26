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

Live mode is **disabled by default**. Enable each supplier explicitly:

```bash
MARKETPLACE_ENABLED=true

MARKETPLACE_WS4_KAMAL_LIVE_ENABLED=true
MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD=shopify_storefront_products_json

MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED=true
MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD=shopify_storefront_products_json

# Phase 1 keep these unset/false:
# MARKETPLACE_WS4_LIVE_PUBLICATION_ENABLED=false
# MARKETPLACE_WS4_PHASE1_PREVIEW_ONLY=true
```

Authorized method must match exactly `shopify_storefront_products_json`. Any other value keeps the adapter fail-closed.

## Manual Super Admin preview

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

## Failure behavior

- One supplier failing does **not** discard the other supplier’s observations (`status: partial`).
- Overlapping preview/price-check jobs return `409 CONFLICT`.
- Invalid/zero/malformed/suspicious prices become review candidates (`parseStatus` not `ok`).
- Compare-at / struck-through prices are never treated as the current listed price.
- Network client is HTTPS-only with hostname allowlist, DNS private-IP blocking, redirect validation, timeouts, size limits, and bounded retries.

## Rate limits / concurrency

- Suppliers are fetched **sequentially**.
- Page size 250, max 40 pages per supplier.
- User-Agent: `SunchaserSupplierMonitor/1.0 (+https://sunchaserenergy.co; supplier-catalogue-monitor)`
- Conservative retries with exponential backoff on timeout / 429 / 5xx.

## Current limitation (Phase 1)

- **Preview only** — no automatic publication.
- `mp_publish_price` is not invoked for live Shopify observations.
- Scheduled production publication remains disabled.
- Images are collected as remote HTTPS URLs only (not downloaded into storage).
- Exact active unlocked mappings only — no fuzzy auto-mapping.
- Four evidence-blocker variants remain locked.
