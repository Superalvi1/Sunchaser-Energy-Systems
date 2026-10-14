# The restore journey repeated 15 times on one scratch stack (JOURNEY_REPEAT=15), BEFORE the fix

| Run | Result | Rows of beta after the fill (alpha is always 26) |
|---|---|---|
| 1 | pass (45/45) | 26 |
| 2 | pass (45/45) | 26 |
| 3 | pass (45/45) | 26 |
| 4 | pass (45/45) | 26 |
| 5 | pass (45/45) | 26 |
| 6 | pass (45/45) | 26 |
| 7 | FAIL (3 checks) | 20  <- fewer rows than expected |
| 8 | pass (45/45) | 25  <- fewer rows than expected |
| 9 | FAIL (2 checks) | 21  <- fewer rows than expected |
| 10 | pass (45/45) | 26 |
| 11 | pass (45/45) | 26 |
| 12 | pass (45/45) | 26 |
| 13 | pass (45/45) | 26 |
| 14 | pass (45/45) | 26 |
| 15 | pass (45/45) | 26 |

**Finding.** Three of the 15 runs show beta with fewer rows than alpha (20, 25 and 21 instead of 26). Runs 7 and 9 failed the checks "both companies are filled" and "beta still reads its own invoice" (run 7 also the row-count check); run 8 lost one row without failing a check. The application log of that stack holds exactly two server errors, both in the lead-update route that contracts a lead: `duplicate key value violates unique constraint "invoices_pkey"` and `... "invoice_items_pkey"` (`app-log-duplicate-key-lines.txt`). Two logged errors for three affected runs: **the one-row deficit of run 8 has no matching log line and is not explained.** Other row ids in the application are also built from the clock alone (for example the activity-log row `log-<ms>`, notifications, projects, orders); those were not changed, and a silent collision there is a candidate for run 8 that was not tested.

**Cause (reproduced).** The contract step builds the invoice id as `inv-<milliseconds>` and each line item id as `item-<milliseconds>-<n>` (`invoiceDb.ts`). The journey fills both companies at the same moment, so two contracts can build their ids in the same millisecond; the second insert fails with the duplicate-key error and the request answers HTTP 500 with that text. `concurrent-contracts-BEFORE-fix.txt` reproduces exactly that response on demand: 14 of 72 simultaneous contracts failed, with `invoices_pkey` and `invoice_items_pkey` in the body. After adding a random suffix to the invoice id, the line-item ids and the customer id the invoice workflow creates, all 72 succeed.

**What is and is not established.** Established: why the journey failed in runs 7 and 9, and that the same collision exists in the application for any two invoices built in the same millisecond (also within one company, and in production code, which uses the same ids). **Not established:** that the single failure seen in the previous round (reported then as "a document upload did not return an id") was this one. Its HTTP response was not recorded. It is plausible, because a contract that fails midway can leave the customer link empty and the next upload then names no customer, but that is a hypothesis and stays one.

Runs 1-9 used the first version of the instrumentation (it printed the HTTP status of a failed document upload; none failed). Runs 10-15 also recorded the status of every step of the fill; all passed, so that instrumentation never saw a failure.
