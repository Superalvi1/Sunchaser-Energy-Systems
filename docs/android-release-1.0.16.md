# Android 1.0.16 (version code 19)

Accounts opens as a separate full-page workspace from the CRM navigation or `/accounts`. Parties, Sales, Quotations, Items and Reports use the existing invoice, payment and ledger services. Mobile sale items and payment entry open full screen; transaction cards replace the narrow invoice table. Optional project fields collapse by default. Item catalogue changes remain in the existing web inventory tools.

Android navigation focuses on daily CRM and accounting tasks. WhatsApp management, Learning Studio, AI administration, telemetry and configuration modules remain in the web portal. Phone WhatsApp sharing actions remain available.

Incoming WhatsApp messages only link an existing CRM lead; they do not create a new lead. Explicit staff promotion remains supported. Historical automatic enquiries are hidden from CRM lists and counts without deleting messages, contacts, quotations or financial records. Smart Quote, manual and already converted clients remain visible.

Saved Android credentials are verified and restored at startup. Timeouts, offline connections and server errors preserve credentials and show a retry screen. Rejected or expired credentials require sign-in.

## Validation

- Session and lead qualification regression tests.
- WhatsApp inbox services and mocked production wiring tests.
- Invoice schema compatibility and invoice route checks.
- Browser smoke checks for desktop/mobile Accounts, item totals in the invoice request, payment request, manual party creation, Android session reload and simplified menus. All API writes in the smoke test are intercepted fixtures.
- Production web build and signed Android release build, followed by package/version/signature and upload-asset checks.

This update reuses the existing accounting services. It does not implement the entire Vyapar product or new purchase accounting. Browser checks simulate the Capacitor platform; a physical-device test is still recommended before Play Store rollout.
