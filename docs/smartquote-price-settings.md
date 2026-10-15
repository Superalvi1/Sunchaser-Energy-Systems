# Smart Quote prices and commercial pages

In CRM, open **Accounts → Smart Quote Prices**. Approved quotation administrators (Super Admin, Admin, Director and Technical CEO) can edit the selling prices, search the catalogue, edit the default preparer, set quotation validity, and enter one payment milestone or condition per line. Save changes, then refresh an already-open Smart Quote page.

Panel rates are PKR per watt. Inverters, batteries and accessories are per unit. FOX bundles retain their included battery at zero additional charge. Installation and elevated structure are per watt; standard stands are per stand; civil pads are per leg. The editor labels the remaining cable/protection/service units.

The public and staff builders fetch the same settings. Prices must load successfully before an estimate can be generated. WhatsApp-generated quotes also load those prices. The PDF starts with the customer/preparer cover, followed by the BOQ and totals, then dedicated payment-plan and terms pages. Staff quotes require the client name, and allow the preparer to be entered per quote.

Saved CRM lead snapshots and original archived PDFs retain their original prices. Settings updates affect new calculations, not previously stored documents. A stale price-editor save returns 409 and requires reloading the saved version.

## Storage and access

- `GET /api/public/smart-quote-settings`: selling prices and document text only; no global CRM settings.
- `GET/PUT /api/admin/smart-quote-settings`: verified CRM JWT plus quotation administrator role.
- Dedicated `settings` row with key `smart_quote_pricing`; does not overwrite `global` settings. Existing table, no schema migration.
- Data API writes use compare-and-swap against the originally read JSON value. First-write conflicts are also rejected. Data API failures do not save to the local fallback.
- Local development without a data API persists `smartQuoteSettings` in the existing file database.

Run `npm run test:smart-quote-settings` and `npm run test:smart-quote-pdf`. The payment milestones are editable commercial text; no payment collection or payment-status changes are performed by this feature.

## Session recovery

If the server rejects the current JWT with 401 while Accounts is open, the CRM clears the rejected credential and shows an in-place sign-in dialog. Signing back into the same account/role retains the open workspace and unsaved prices. A failed initial price read is retried; writes are never replayed. An account or role change reloads the application before displaying any prior workspace. On startup, rejected cached credentials go directly to sign-in. Network errors, 5xx responses and permission denials do not trigger this recovery.
