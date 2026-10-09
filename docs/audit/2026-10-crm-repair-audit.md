# CRM repair audit — October 2026

Scope: Smart Quote persistence, leads, documents, invoices/payments, mobile sessions, WhatsApp AI,
catalogue sync, security/reliability. Work was done on an isolated stack (PostgreSQL 16 + PostgREST 12 +
a local S3-compatible store) with synthetic users and clients. Production was inspected read-only
(Railway service configuration, deployment and HTTP logs); nothing was deployed or migrated.

Credential and account findings from the security review were reported privately to the owner and are
intentionally not described in this public repository.

## Confirmed defects and fixes

| # | Area | Severity | Root cause | Fix | Evidence |
|---|------|----------|-----------|-----|----------|
| 1 | Smart Quote | High | Every generate created a new lead **and** customer; an edit or a retry produced duplicates | Versioned storage: one lead per client phone, one immutable `smart_quote_versions` row per quote number; the latest version is summarised on the lead | Before: 2 leads/2 customers for one phone. After: 1 lead, versions 1–3 |
| 2 | Smart Quote | High | Duplicate protection was an in-memory map, lost on restart/deploy | Database uniqueness on the quote number plus deterministic new-lead id; the client reuses the quote number when retrying an unchanged quotation | Before: retry after restart → 201 and a duplicate. After: 200 replay, no duplicate |
| 3 | Smart Quote | Medium | Mobile sticky "Generate" button had no in-flight guard; a lost response showed only "Failed to fetch"; export failures were styled as success | Disabled while saving; actionable network message; red error styling | Browser: double tap → 1 lead; lost response → retry → 1 lead |
| 4 | Smart Quote | Medium | Older quotation stored only in lead notes would be overwritten by a newer one | Pre-history quotation is preserved as version 1 before the summary moves on | Unit test |
| 5 | Payments | High | No duplicate protection: a double click or retry recorded the same payment twice | Per-submission request id → deterministic payment id (PK); legacy clients get a 2-minute identical-payment guard | Before: two 201s, paid doubled. After: 409/200 replay, one row |
| 6 | Payments | High | Overpayment silently accepted (balance clamped to 0) | Rejected with the balance due in the message | Before: PKR 1,000,000 accepted on a PKR 100,000 invoice |
| 7 | Invoices | High | Saving the invoice form overwrote `paid_amount` from stale form state; the ledger and invoice disagreed. Balance used the old total when items and paid amount were saved together | Paid amount is derived from payment rows; balance uses the new total; total cannot drop below recorded payments | Before: paid 0 vs ledger 1,050,000. After: paid = ledger |
| 8 | Invoices | Medium | Item replacement ignored database errors (delete then insert) | Upsert new lines, then remove dropped lines; errors are surfaced | Code review + journey |
| 9 | Invoices | Medium | No audit trail for financial edits | Append-only activity entries for create, edit (field-level before → after), payment, archive, delete, bulk delete | Journey: audit rows present |
| 10 | Accounts | High | Sales roles with invoice permission saw **0 invoices**: an admin-only side request failed and `Promise.all` discarded the invoice list | Lists load independently | Browser: list shows invoices for the role |
| 11 | Payments UI | Medium | After recording a payment the editor reloaded stale list data | Editor re-selects the invoice returned by the server | Browser |
| 12 | Leads | Medium | `PUT /api/leads/:id` accepted `customerId` from the body, relinking a lead and overwriting another customer's contact details | Server-owned fields are ignored | Before: other customer renamed. After: unchanged |
| 13 | Leads | Medium | Editing notes could delete or forge the saved quotation block | Staff edit only their notes; the quotation block is kept server-side | Unit tests |
| 14 | Leads | Low | List sorted by creation only; returning clients stayed buried | Sorted by latest activity (creation or latest quote); latest quote badge | Browser |
| 15 | Documents | Medium | A response lost after the server stored a file created a duplicate on retry | Per-upload id → deterministic document id and storage path | Browser: 3 attempts → 1 row |
| 16 | Documents | Medium | Only extension and browser-declared type were checked | File signature must match the declared type; customer id validated for the storage path; authorisation checked before storage | Unit + browser |
| 17 | Sessions | Medium | A verified mobile session was never renewed, so it lapsed at `JWT_EXPIRES_IN` even for daily users | `POST /api/auth/refresh` renews a valid token at app start; expired, suspended or logged-out sessions still require sign-in | Browser (mobile emulation) |
| 18 | WhatsApp AI | Medium | The sales agent could send unsupervised replies once enabled in settings | Requires the server variable `WHATSAPP_SALES_AGENT_AUTONOMOUS_SEND=true` as well | Unit tests |
| 19 | Config | Low | Client fallback API pointed at the retired Render host | Fallback is `https://crm.sunchaserenergy.co` | Code |

## Verified as already fixed (previous releases)

- Document upload 500s (body limit, MIME parsing, unique ids) — production logs show 500s before 5 Oct and a 201 after.
- WhatsApp messages no longer create leads automatically; staff conversion works (re-verified end to end).
- Android session restore on app start (code fixed in 1.0.16; a shipped build must contain it).
- Daily supplier price sync runs successfully at 22:00 UTC (last run: 646 listings updated, 0 errors, 166 rejected variants recorded). Supplier prices do not change Smart Quote selling rates (separate static catalogue).

## Migration

`scripts/smart-quote-versions-schema.sql` (additive, idempotent; rollback `scripts/smart-quote-versions-rollback.sql`).
The application falls back to the previous behaviour until the table exists, so code may be deployed first.

## Not changed (decisions for the owner)

- Accounts Manager sees only invoices they created (Phase 1B.3B design); contract-generated invoices need Director/Super Admin.
- Signed storage links do not expire.
- Overpayments are now refused; advance or credit balances would need an explicit feature.
