# Marketplace daily supplier price sync

This job checks the public Shopify catalogues for Kamal Solar and Alladin once
per day and updates prices for **existing auto-import listings only**.

## Locked behavior

- Price: exact, valid, in-stock Kamal price first; otherwise exact, valid,
  in-stock Alladin price.
- No markup and no CEO purchasing discount.
- Missing, malformed, non-positive, or out-of-stock observations do not replace
  the last valid price.
- The daily job never creates products and does not change product names,
  brands, categories, images, inventory status, activation, or public source.
- `MARKETPLACE_CATALOGUE_SOURCE=static` remains an independent publication gate.

## Render Cron command

```bash
npm run marketplace:price-sync:daily
```

Recommended schedule: once daily during low traffic, for example `15 2 * * *`
(02:15 UTC / 07:15 PKT).

Required environment configuration:

```text
MARKETPLACE_ENABLED=true
MARKETPLACE_CEO_AUTO_IMPORT_ENABLED=true
MARKETPLACE_CEO_AUTO_IMPORT_PERSIST=true
MARKETPLACE_WS4_KAMAL_LIVE_ENABLED=true
MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD=shopify_storefront_products_json
MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED=true
MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD=shopify_storefront_products_json
SUPABASE_URL=<server-side project URL>
SUPABASE_SERVICE_ROLE_KEY=<server-side key>
MARKETPLACE_CEO_AUTO_IMPORT_DATABASE_URL=<dedicated authorized Postgres URL>
```

The command exits `2` before fetching/writing when a required feature or
authorization flag is absent. It exits `1` when the sync fails or if a
price-only run unexpectedly reports a created product.

## Deployment order

1. Review and apply `scripts/marketplace-ceo-auto-import-atomic.sql` in a
   controlled database migration window.
2. Run the daily command once manually with the public catalogue still set to
   `static`.
3. Confirm `productsCreated=0`, review changed prices, and confirm images and
   stock fields are unchanged.
4. Create the Render Cron Job using the command and schedule above.

The one-time image copy is a separate operation. It must write approved
supplier media with source URL and permission provenance, and is intentionally
not part of this recurring price-only job.
