# CEO-authorized automatic supplier catalogue import

## Authorization

The CEO authorized automatic import of public Kamal Solar and Aladin.pk catalogue
products without product-by-product approval, manual mapping approval, or manual
price approval.

Public supplier listed price is published as the Sunchaser website price.
The CEO purchasing discount (~10%) is **not** applied.

## Safety

- Never merges on-grid with hybrid.
- Never merges different capacities, phases, battery voltages, panel wattages, or model suffixes.
- Uncertain identity → separate listings (import continues).
- Rejects missing/invalid prices and duplicate URLs.
- WS-MAP-0 legacy `POST /suppliers/mappings` remains fail-closed.
- Does not call `mp_admin_upsert_supplier_mapping`.

## Enablement

```bash
MARKETPLACE_ENABLED=true
MARKETPLACE_CEO_AUTO_IMPORT_ENABLED=true
MARKETPLACE_WS4_KAMAL_LIVE_ENABLED=true
MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD=shopify_storefront_products_json
MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED=true
MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD=shopify_storefront_products_json
```

## Super-Admin API

- `POST /api/marketplace/admin/suppliers/auto-import/run`
- `GET /api/marketplace/admin/suppliers/auto-import/health`
- `GET /api/marketplace/admin/suppliers/auto-import/listings`

UI: Admin → Supplier Catalogue Sync

## SQL (manual)

`scripts/marketplace-ceo-auto-import.sql` — apply only after review to environments
that should persist auto-imported catalogue rows and website prices.
