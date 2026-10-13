# Appendix B: hard-coded Sunchaser values (what a second company would inherit today)

Method: `git ls-files` at commit `6969943`, runtime code only (`src/`, `server/`, top-level `*.ts`; 826 files; tests, docs, scripts and `sunchaser-crm/` excluded), counted with `grep`. "Hits" are occurrences, "files" are files containing at least one. These are counts I ran, not a reading of every line; each category still needs a per-site review when it is fixed. The production database was **not** read, so values stored in `settings`, `quote_pdf_settings`, `bank_accounts` and `company_terms` rows are not covered here (they are per-database singletons, see C).

## A. Identity and branding

| Value | Where | Size | What a second company would see |
|---|---|---|---|
| Company name "Sunchaser Energy Systems" / "SUNCHASER ENERGY" and variants | `src/lib/branding.ts` (`DEFAULT_BRANDING`), `invoicePdf.ts`, `server.ts`, `dbManager.ts`, quote/proposal renderers, AI prompts, `WelcomeWizard`, `CustomerPortal` | 37 occurrences of "Sunchaser Energy Systems" alone, plus variants | The founder's name on their documents wherever the stored setting is empty or a default is used |
| Logo, app icon, splash, invoice logo, signature image | `/assets/sunchaser-logo.png`, `/sunchaser-bank-accounts.png`, `/sunchaser-ceo-signature.png` (`branding.ts`, `brandingAssets.ts`, `quotePdfLayout.ts`) | 3 files, 3 source files | The default signature is the CEO's signature image and the default bank page is a Sunchaser bank-accounts image (defaults in `DEFAULT_BRANDING`; whether every document uses them was not traced) |
| Colours | `primaryColor #7c6cf0`, `secondaryColor #1a2b4c`, `accentColor #c5a028` in `DEFAULT_BRANDING` | 3 values | Sunchaser palette |
| Office locations | `DEFAULT_OFFICE_LOCATIONS` (Lahore DHA Phase 6, Rawalpindi, Multan, Faisalabad) | 4 | Sunchaser addresses on documents |
| Default terms text | `DEFAULT_BRANDING.terms` ("... Thank you for choosing Sunchaser Energy Systems") | 1 | Sunchaser terms |
| Android application | `capacitor.config.json` (`appId com.sunchaser.crm`, `appName Sunchaser CRM`), `android/app/build.gradle`, `strings.xml` | 4 | App name, icon and Play listing are Sunchaser's and cannot change per company at runtime |
| Public pages | `public/privacy-policy`, `public/account-deletion` (Play compliance pages) | 2 pages, 27 matches | Privacy and deletion pages name Sunchaser as the data controller |
| Local-storage and token names | `sunchaser_auth_token` (2 hits) and similar keys | cosmetic | none functionally; rename only for hygiene |

## B. Contact details and domains

| Value | Size | Notes |
|---|---|---|
| Phone numbers (0309-0236666, 0330-7776444, 0321-8486752 and others) | 11 files | `branding.ts`, `invoicePdf.ts`, `ProfessionalQuotationDocument`, `AdminApp`, `PublicQuotationBuilderPage`, `clientPortalUi`, `server.ts`, `dbManager.ts` |
| Email addresses (`ceo.sunchaser@gmail.com`, `billing@sunchaser-energy.com`, legacy `system.autolink@sunchaser.internal`) | 8 files | The default billing email in `DEFAULT_BRANDING` is a Gmail address (`ceo.sunchaser@...`) |
| Domains (`sunchaserenergy.co`, `crm.`, `smartquote.`, `quote.`, `sunchaser-energy.com`, `sunchaser.co/portal`) | about 14 distinct URLs | Portal links, quote links, canonical URLs and support links. Tenant portals and quote links need a company-aware base URL |
| Smart Quote public site | separate Railway service `sunchaser-quote-railway` on its own domain | Needs a company slug or key in the URL; today it is Sunchaser's |

## C. Singletons that must become per-company data

`settings`, `quote_pdf_settings` (read with `order by id limit 1`, `brandingDb.ts`), `bank_accounts`, `company_terms`, quote templates, role definitions. In the tenancy classification these are `tenant_config` tables. Today a second company would overwrite the first one's branding.

## D. Market and locale assumptions (decide per company, default Pakistan)

| Assumption | Size |
|---|---|
| Currency literal "PKR" | 214 hits, 77 files |
| Locale `en-PK` | 47 hits, 30 files |
| Time zone `Asia/Karachi` | 2 hits, 2 files |
| Country code `+92` / phone normalisation | 9 files (`src/lib/phoneNormalize.ts`, WhatsApp wiring, quote forms) |
| Net-metering and distribution-company names (NEPRA, IESCO, LESCO, K-Electric ...) in sizing, BOQ and consultant wizards | 10 files |

The pilot targets solar companies in the same market, so these can stay as defaults. They become a setting (currency, locale, time zone, country code, tax label) only if a company outside Pakistan is signed.

## E. Commercial logic

| Value | Where | Issue |
|---|---|---|
| Invoice numbers `INV-<year>-<count+1>` | `invoiceDb.ts` `nextInvoiceNumber` | Counts existing rows with the prefix: not company-aware, can repeat a number after deletions or a reset, and is not atomic. Needs a per-company counter and configurable format |
| Customer code, quote numbers, plan codes | `customerCode.ts`, `smartQuoteVersions.ts`, business unique keys | Global unique keys let one company collide with, or probe, another's numbers |
| Smart Quote selling rates and package library | `src/lib/boqCatalog.ts` (194 lines), `boqPackageLibrary.ts`, `autoSizer/generateRecommendedBoq.ts` | A static catalogue in code: every company would quote Sunchaser's prices. Needs a versioned per-company price book |
| Bank details | `scripts/invoice-sunchaser-bank-seed.sql`, bank-accounts image | Sunchaser's accounts seeded; second company must enter its own |
| Marketplace pricing and suppliers | `pricingRepository.ts`, `supplierRepository.ts` use `'sunchaser'` | Out of scope for pilots (`sunchaser_only`) |

## F. Founding-company literal `'sunchaser'`

11 runtime files, mostly WhatsApp transport defaults (`company_id text default 'sunchaser'`), the WhatsApp sales agent and knowledge adapter (`agentRuntime.ts`, `agentRoutes.ts`, `knowledgeProduction.ts`, `queryKnowledgeAdapter.ts`), unified-messaging runtime config and the marketplace repositories. The plan keeps `sunchaser` as the real id of the first company, so existing rows need no rewrite; the code must stop using it as an implicit default.

## G. Single-instance integrations

| Item | Fact |
|---|---|
| WhatsApp credentials | Read from process environment (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`): one number per deployment. `whatsapp_channels` is unique on `(company_id, phone_number_id)`, **not** on `phone_number_id` alone, so webhook routing by number is not yet safe |
| Object storage | Two namespaces `customer-documents` and `quote-assets`; keys are not company-prefixed (`server/storage/railwayObjectStorage.ts`) |
| Background work | 5-second AI-agent drain loop and other timers in the web process; external cron service for marketplace price sync (not a pilot feature) |
| AI providers | Four outbound paths; token use is not stored or limited per company |

## H. Business data tracked inside the repository (hygiene, not tenancy)

`database.json` (114 Sunchaser matches), `backups/sunchaser-backup-2026-06-02.json`, `backups/sunchaser-backup-pre-invoice-2026-06-05.json`, `sunchaser-crm.zip`, `q6_manual_quote.html`, `scripts/sprint-a-demo-data-audit-report.json`. Whether they hold real customer data was not examined here. The repository is public; this is covered by the private credential and history-purge sheet and must be settled before any other company's data is handled.
