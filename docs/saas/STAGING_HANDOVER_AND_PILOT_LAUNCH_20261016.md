# Sunchaser Sync: staging evidence and pilot launch brief

Status: IN PROGRESS — not approved for paid customer onboarding.
Date: 16 October 2026.
Candidate inspected: af359f05b0af12309d138448246965b9d57274e9 (PR #113 remains draft and unmerged).
This document records actions performed by Codex, separately from Claude's synthetic test reports.

## Verified work

- Created a private Railway project, **Sunchaser Sync SaaS Rehearsal**, with a separate rehearsal environment and object-store bucket.
- Provisioned PostgreSQL 17.11 with a separate 1 GB persistent disk and fresh database credentials. No public database endpoint was created.
- Copied the existing nightly backup recorded at 2026-10-15 20:01:51 UTC into the rehearsal bucket.
- Transfer size: 9,212,386 bytes. SHA-256: e49fc483ed52bd4165a3f693ec56f5bbedd337deff4cc01ec349c3fc68348b05.
- The copier used GET on that one existing backup; it did not connect to the production database. It was deleted after the copy.
- The restore job checked the archive checksum, required an empty rehearsal database and used pg_restore --no-owner --no-privileges --exit-on-error --single-transaction.
- Restore deployment d70bfaeb-d626-472c-b8db-1fa809b90ced reported RESTORE_COMMITTED and REHEARSAL_BACKUP_RESTORE_COMPLETE.
- Restored schema inventory: 179 tables, including 166 public and 9 crm_recovery tables. public.bills is absent. delivery_challans.created_by_user_id is absent.
- The temporary transfer receiver and its public domain were deleted after the restore.
- Fresh staging application/API credentials have been configured. WhatsApp conversations and AI replies, learning, marketplace and direct unified messaging are disabled. No production integration credentials were copied to the test application.
- Staging invoice floor: 100000, explicitly chosen for this rehearsal after the owner delegated the choice. It is not the historical maximum and has not been applied to live numbering.

- The fingerprint job completed: 179 tables, 99,248 rows and 798 recovery rows recorded privately in rehearsal_audit.baseline_tables.
- PostgREST 16.4 is healthy, pinned to sha256:d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df.
- Repair backend authentication, /api/auth/me, /api/admin/invoices and /api/state returned 200 using a synthetic administrator.
- Repair migrations r1-r4 applied individually in deployment 3cca29b3-ae18-43ad-9819-d2df19a5a84b, with authenticated read smoke after each. Ledger: 4 rows, checksums/chain/probes agree.
- These are migration/read checks, not yet acceptance of quotation/payment/file writes.
- Hosted-target shell guard passes syntax validation and refuses both a production-like hostname and a mismatched Railway project before any database operation.

## Not yet verified

The original backup has no row-count manifest. The archive transfer checksum and successful restore do not prove equality with a point-in-time source row manifest.
The corrected tenant rehearsal completed with zero failures on 16 October, deployment d08f10a4-bd12-48a3-8a49-d7d9398db3bf, run 2026-10-16T21:44:04.893Z. It applied t1-t9, compared 168 original public tables, checked ownership and numbering, rolled back all tenant migrations, compared data and schema, re-applied, and verified the ledger. Its older output labels say t1-t8, but retained runner logs explicitly include t9.
An independent original-column check after the completed run matched all 179 baseline tables, with only the tracked synthetic user and seven login audit rows excluded; recovery rows are unchanged.
The deployed candidate at c2d86ce4bf8f7fd6897e3135515c6f297d9bfa2f builds server.cjs SHA-256 2e7376397c17bd1996d761d939970dfd38d35eec977f69ac7ff83239f2b33268, matching the earlier tested runtime.
HTTP barrier verification passed all seven checks and recorded verified at 2026-10-16T21:51:27.179Z. Multi-company mode was then enabled.
Real provider storage checks passed C1-C6 including C1b: 25 strict next-list observations, 1100-object pagination, listing p95 65 ms, unsigned-request refusal and byte parity; run 2026-10-16T21:54:02.542Z.
Core cross-company financial/PDF/upload acceptance and browser acceptance are not yet reported as passed.

### Issues found and changes
- The rehearsal compared added columns and a newly created table against the old schema. It now fingerprints the exact original tables and column projections.
- Existing shared role templates intentionally have company_id NULL; the assertion now preserves these while rejecting other-company ownership.
- A real number formatter defect truncated 10000 and 10001 to 1000. Additive t9 preserves all digits, keeping the prior ownership checks and locking. The old SQL migrations are unchanged. Its rollback refuses oversized issuance instead of restoring truncation.
- The hosted negative control reproduced truncation; 17 focused checks passed after the fix, including large bigint values, narrow widths and tenant/anonymous restrictions. CI adds concurrent boundary and rollback/re-apply checks; exact-head CI is still pending.
- One test-runner build failed because command quoting removed a string literal. The command was corrected; this was not an application failure.
The staging application is private and is not a customer-ready demo.
The real restore does not resolve the historical synthetic restore-deficit incident.

## Authorisation and current work

The owner renewed authorisation to complete staging. The earlier audit-helper approval cancellation was resolved; that helper deployed and completed.
No approval question is pending for this isolated rehearsal.

Current jobs are one-shot with restart policy NEVER. Production services, data and integration credentials are outside these actions.
Next gates: complete the two-company financial/file acceptance, recovery drills and recovery test, then provision and review a synthetic-only demo. The schema-only demo factory refuses an existing target and never copies customer rows.
PR #111/#113 and any production release remain separate.

## Minimum sellable pilot

Audience: 2-3 solar installation companies with a real need to track quotations, follow-up and customer balances.
Positioning: "From enquiry to quotation, invoice and payment record in one company workspace."

Include:
- Operator-led company setup, company branding, staff roles and company-owned manual prices/terms.
- Leads and customers; manual quotations and PDFs; invoices, partial/final payments and customer documents.
- Customer portal, manual subscription records and defined storage limits.
- A documented backup/recovery process and support contact.

Defer:
- AI-generated customer replies and automated quote sending.
- AutoSizer/shared equipment catalogue, design tools, marketplace and learning modules.
- Delivery, warranty and handover workflows until the schema and complete journeys are proven.
- Per-company Android builds and broad self-service signup.

Do not advertise autonomous AI, complete accounting/tax compliance, unlimited storage, guaranteed uptime or a finished Android commercial release.

## Demo and onboarding

A ten-minute demo should show one synthetic enquiry becoming a customer, a branded quotation, an invoice, a partial payment, the remaining balance and a customer document download.
Then demonstrate two companies viewing their own records.

Onboarding collects the company's name/logo, contacts, staff list and roles, prices, payment terms, bank details and agreed numbering policy. Start with a small clean sample. Review imported balances with the company before using them.

Commercial pilot terms are still a proposal, not published prices:
- One setup fee and a monthly subscription quoted after the workflow demo.
- Explicit staff/storage limits, supported modules, support hours and data-export arrangements.
- Written acceptance of pilot limitations; no automatic annual commitment.
- A named person at each pilot company responsible for weekly use and feedback.

## Commercial validation

Before paid ads, invite a small set of solar-company owners to individual demos. No outreach has been sent.
Track demos booked, companies completing onboarding, weekly quotations/invoices/payments, support time and renewal decisions.
The decisive proof is sustained use and paid renewal. CI passing alone is not commercial validation.

## Release conditions

All staging gates must pass, credential/signing-key exposure must be handled, customer terms and data responsibilities must be settled, and the remaining offboarding limitation must have an agreed solution before paid onboarding.
Production deployment remains a distinct release decision based on the recorded evidence.
