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
| after t2-ownership | 9 passed, 0 failed | 9 passed, 0 failed |
| after t3-document-numbering | 9 passed, 0 failed | 9 passed, 0 failed |
| after t4-company-settings | 4 passed, 5 failed FAILED: [after t4-company-settings-new] contract provisions an invoice; [after t4-company-settings-new] payment recorded (404); [after t4-company-settings-new] invoice PDF (404); [a | 9 passed, 0 failed |
| after t5-subscriptions | 4 passed, 5 failed FAILED: [after t5-subscriptions-new] contract provisions an invoice; [after t5-subscriptions-new] payment recorded (404); [after t5-subscriptions-new] invoice PDF (404); [after t5-s | 9 passed, 0 failed |
| after t6-invoice-issuance-snapshot | 4 passed, 5 failed FAILED: [after t6-invoice-issuance-snapshot-new] contract provisions an invoice; [after t6-invoice-issuance-snapshot-new] payment recorded (404); [after t6-invoice-issuance-snapshot | 9 passed, 0 failed |
| after t7-company-admin | 4 passed, 5 failed FAILED: [after t7-company-admin-new] contract provisions an invoice; [after t7-company-admin-new] payment recorded (404); [after t7-company-admin-new] invoice PDF (404); [after t7-c | 9 passed, 0 failed |
| after t8-storage-reservations | 4 passed, 5 failed FAILED: [after t8-storage-reservations-new] contract provisions an invoice; [after t8-storage-reservations-new] payment recorded (404); [after t8-storage-reservations-new] invoice P | 9 passed, 0 failed |
