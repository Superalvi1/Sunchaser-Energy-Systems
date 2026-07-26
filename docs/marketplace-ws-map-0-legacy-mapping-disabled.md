# WS-MAP-0 — Legacy supplier mapping bypass closed

## Summary

`POST /api/marketplace/admin/suppliers/mappings` is permanently fail-closed.

Both historical registrations are denied identically:

1. `server/marketplace/pricing/pricingRoutes.ts` (currently reachable — mounted first in `server.ts`)
2. `server/marketplace/suppliers/supplierRoutes.ts` (latent duplicate — mounted second)

Shared denial: `server/marketplace/legacyMappingDisabled.ts`

## HTTP response

```http
HTTP/1.1 410 Gone

{
  "error": "LEGACY_MAPPING_DISABLED",
  "message": "Legacy supplier mapping is disabled."
}
```

No RPC call, no repository mutation, no audit payload with request data, and no reflection of actor/body/header values.

## Repository defense

Production repository wrappers no longer invoke `mp_admin_upsert_supplier_mapping`:

- `pricingRepository.upsertSupplierMapping` → throws `LEGACY_MAPPING_DISABLED` (410)
- `supplierRepository.upsertMapping` → throws `LEGACY_MAPPING_DISABLED` (410)

## SQL guard (manual only)

Artifact: `scripts/marketplace-ws-map-0-legacy-guard.sql`

- **MANUAL APPLICATION ONLY / DO NOT AUTO-APPLY**
- No hosted SQL was applied during WS-MAP-0 implementation
- Preserves RPC name/signature; replaces body with fail-closed raise
- Never mutates `mp_supplier_products`
- Revokes `EXECUTE` from `public`, `anon`, `authenticated`, and `service_role`
- Safe to reapply locally

## Out of scope

WS-MAP-1+ controlled mapping lifecycle, candidate staging, evidence/OCC UI, hosted migration, publication, and catalogue import are not part of this change.
