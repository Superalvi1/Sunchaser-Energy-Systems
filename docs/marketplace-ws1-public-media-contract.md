# WS1 Public Catalogue — Media Contract (NON-EXECUTABLE)

Status: **review document only — no media inserted or activated.**

## Current v2 public media contract

Until a separate owned/licensed/user-upload/manufacturer media design is
approved, the WS1 public RPCs expose **supplier-sourced images only**.

A media row is eligible for the v2 public DTO only when all of the following
are true:

- `published = true`
- `role <> 'receipt'`
- `source_type = 'supplier'`
- `rights_status = 'supplier_approved'`
- `approved_by IS NOT NULL`
- `approved_at IS NOT NULL`
- `source_url IS NOT NULL` and HTTPS (`source_url like 'https://%'`)

The exact hostname allowlist is additionally enforced server-side in
`server/marketplace/catalogue/catalogueRepository.ts`
(`sanitizeRpcMediaUrls` via `normalizeAnyAllowedImageUrl`).

### Note on approval identity and timestamp

`approved_by` and `approved_at` are **operational metadata** required by the
`mp_media` publish gate. They record *who* approved publication and *when*, but
they are **not** documentary rights evidence. The rights evidence is the
`rights_status = 'supplier_approved'` value, which must be set through the
approved supplier-ingestion workflow.

## Remaining design work

The following source types are **explicitly excluded** from the v2 public
contract until their designs are approved:

### Sunchaser-owned assets

- Where are they stored? (Supabase Storage project, external CDN, both?)
- Which hostnames belong to Sunchaser? (env `MARKETPLACE_OWN_IMAGE_HOSTS`)
- What evidence proves ownership? (invoice, license file, copyright declaration)
- How is ownership recorded in `mp_media`? (`source_type = 'own'`,
  `rights_status = 'own'`, plus a permission/evidence reference)

### Licensed assets

- Which licensors are approved? (env `MARKETPLACE_LICENSED_IMAGE_HOSTS`)
- What license terms are permitted? (royalty-free, time-bound, per-use)
- Where is the license evidence stored? (`permission_reference`, external doc)
- How does the ingestion workflow set `rights_status = 'licensed'`?

### User uploads

- Are user uploads ever intended to be public?
- If yes, what moderation/approval workflow is required?
- How is the uploader's rights grant recorded?
- Which storage path pattern is trusted?

### Manufacturer assets

- Are manufacturer-provided assets treated as licensed or supplier?
- What evidence is required from the manufacturer?
- Which hosts are trusted for manufacturer CDN URLs?

### Permission / evidence references

- Schema for `mp_media.permission_reference` (URL, file ID, free text?)
- Required fields per source type
- Retention and audit requirements

### Allowed storage hosts

- Final allowlist for each source type
- Supabase Storage project host (env `MARKETPLACE_SUPABASE_STORAGE_HOST`)
- CDN hostnames and whether subdomains are allowed
- Process for adding/removing hosts

## Non-goals

- This document contains no executable SQL.
- No media rows are inserted, updated, or activated by this work.
- The v2 public RPCs return no images until supplier media passes the contract
  above and a reviewed DML activates the corresponding products.
