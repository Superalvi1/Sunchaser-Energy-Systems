# Intermediate deployment states
Backends: NEW = this build, multi-company flag off; REPAIR = build of PR #111. Each cell is the smoke's result: passed/failed checks.

| State (schema after this step) | NEW backend | REPAIR backend |
|---|---|---|
| before M1 (schema before the repair release) | 9 passed, 0 failed | 9 passed, 0 failed |
| after r1-smart-quote-versions | 9 passed, 0 failed | 9 passed, 0 failed |
| after r2-session-revocation | 9 passed, 0 failed | 9 passed, 0 failed |
| after r3-invoice-payments-integrity | 9 passed, 0 failed | 9 passed, 0 failed |
| after r4-invoice-save-atomic | 9 passed, 0 failed | 9 passed, 0 failed |
| after t1-company-foundation | 9 passed, 0 failed | 9 passed, 0 failed |
| after t1b-tenancy-barrier | 9 passed, 0 failed | 9 passed, 0 failed |
| after t2-ownership | 9 passed, 0 failed | 9 passed, 0 failed |
| after t3-document-numbering | 9 passed, 0 failed | 9 passed, 0 failed |
| after t4-company-settings | 9 passed, 0 failed | 9 passed, 0 failed |
| after t5-subscriptions | 9 passed, 0 failed | 9 passed, 0 failed |
| after t6-invoice-issuance-snapshot | 9 passed, 0 failed | 9 passed, 0 failed |
| after t7-company-admin | 9 passed, 0 failed | 9 passed, 0 failed |
| after t8-storage-reservations | 9 passed, 0 failed | 9 passed, 0 failed |

## Informational: the first invoice of the sequence is deleted (a gap), then each build creates an invoice
| gap in the numbering | NEW 9 passed, 0 failed | REPAIR 4 passed, 5 failed FAILED: [gap-repair] contract provisions an invoice; [gap-repair] payment recorded (404); [gap-repair] invoice PDF (404); [gap-repair] document upload (404); [gap-repair] the docume |

## With the tenancy marker ON (as before the first pilot company): sign-in on each backend
| marker on | NEW (flag off) refused (HTTP 503) | REPAIR refused (HTTP 500) |
