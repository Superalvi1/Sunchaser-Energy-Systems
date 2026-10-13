# Appendix A: every table, classified for tenancy

Source: `scripts/saas/table-classification.json` on branch `claude/saas-pilot-multi-company` (141 tables) plus two tables added by release PR #111 that the classification does not yet contain (proposed classes below). Counts re-checked against the tracked SQL at commit `6969943`: **142 tracked tables, 2 unclassified, 0 stale**. This is an inventory of tracked SQL; the real production schema has not been read (`bills` is used by code but defined in no tracked SQL).

## Class summary

| Class | Meaning | Tables |
|---|---|---|
| `tenant` | Company-owned rows: add company_id (NOT NULL, default from request context), FK, index, RLS select/insert/update/delete. | 64 |
| `tenant_config` | Company-owned configuration: same as tenant, plus unique(company_id) or unique(company_id, key). Replaces global singletons. | 10 |
| `tenant_existing_company_id` | Already has company_id text. Add FK to companies(id) and RLS; keep values ('sunchaser'). | 14 |
| `identity` | Global identity table; visibility to a company only via company_memberships. | 1 |
| `role_template` | System rows (company_id NULL) readable by all; company rows isolated. | 2 |
| `dormant` | Feature not enabled in production. No tenant access until a scoping review is done. | 12 |
| `sunchaser_only` | Module owned by the founding company. No tenant access; routes blocked for other companies. | 38 |

## Unclassified tables introduced by PR #111 (proposal; must be added before the isolation checker can pass on the merged code)

| Table | Proposed class | Reason |
|---|---|---|
| `revoked_sessions` | `tenant` (or `identity` if sessions stay global) | rows carry `user_id` and token ids; with global users a revocation is global, so `identity` is the simpler and safer choice |
| `smart_quote_versions_rollback_backup` | rollback artefact | created only by the M1 rollback script; must be excluded from export and never exposed to the tenant role |

## Shared tables by class

### `tenant` (64)

Company-owned rows: add company_id (NOT NULL, default from request context), FK, index, RLS select/insert/update/delete.

| Table | Note |
|---|---|
| `activity_logs` | Core CRM record. |
| `after_sales_service_logs` | Projects, delivery and after-sales operations. |
| `bills` | Finance record: ledger-critical, keep per-company numbering and uniqueness. |
| `categories` | Inventory and product catalogue of the company. |
| `customer_documents` | Documents and portal data of a company's own customers. |
| `customer_energy_devices` | Documents and portal data of a company's own customers. |
| `customer_equipment` | Documents and portal data of a company's own customers. |
| `customer_portal_profiles` | Documents and portal data of a company's own customers. |
| `customer_savings_profiles` | Documents and portal data of a company's own customers. |
| `customer_subscriptions` | A solar company's own customer maintenance plans (NOT the SaaS plan). plan_code must become unique per company. |
| `customer_systems` | Documents and portal data of a company's own customers. |
| `customer_warranties` | Documents and portal data of a company's own customers. |
| `customers` | Core CRM record. |
| `delivery_challan_items` | Projects, delivery and after-sales operations. |
| `delivery_challan_photos` | Projects, delivery and after-sales operations. |
| `delivery_challans` | Projects, delivery and after-sales operations. |
| `design_sessions` | Core CRM record. |
| `energy_alerts` | Documents and portal data of a company's own customers. |
| `installation_photos` | Documents and portal data of a company's own customers. |
| `installation_tasks` | Core CRM record. |
| `interactive_proposal_events` | Core CRM record. |
| `interactive_proposals` | Core CRM record. |
| `internal_costing_sheets` | Finance record: ledger-critical, keep per-company numbering and uniqueness. |
| `inventory_items` | Inventory and product catalogue of the company. |
| `inventory_movements` | Inventory and product catalogue of the company. |
| `inventory_purchases` | Inventory and product catalogue of the company. |
| `investors` | Finance record: ledger-critical, keep per-company numbering and uniqueness. |
| `invoice_items` | Finance record: ledger-critical, keep per-company numbering and uniqueness. |
| `invoice_payments` | Finance record: ledger-critical, keep per-company numbering and uniqueness. |
| `invoices` | Finance record: ledger-critical, keep per-company numbering and uniqueness. |
| `leads` | Core CRM record. |
| `net_metering_trackers` | Documents and portal data of a company's own customers. |
| `notifications` | Core CRM record. |
| `orders` | Inventory and product catalogue of the company. |
| `party_ledger_archives` | Finance record: ledger-critical, keep per-company numbering and uniqueness. |
| `payments` | Finance record: ledger-critical, keep per-company numbering and uniqueness. |
| `products` | Inventory and product catalogue of the company. |
| `products_inventory` | Inventory and product catalogue of the company. |
| `project_completion_media` | Documents and portal data of a company's own customers. |
| `project_deliveries` | Projects, delivery and after-sales operations. |
| `project_delivery_items` | Projects, delivery and after-sales operations. |
| `project_delivery_updates` | Projects, delivery and after-sales operations. |
| `project_finance_records` | Finance record: ledger-critical, keep per-company numbering and uniqueness. |
| `project_installation_photos` | Documents and portal data of a company's own customers. |
| `project_installed_equipment` | Documents and portal data of a company's own customers. |
| `project_inventory_reservations` | Projects, delivery and after-sales operations. |
| `projects` | Projects, delivery and after-sales operations. |
| `purchase_orders` | Inventory and product catalogue of the company. |
| `quotations` | Core CRM record. |
| `service_requests` | Projects, delivery and after-sales operations. |
| `service_visit_photos` | Projects, delivery and after-sales operations. |
| `service_visit_reports` | Projects, delivery and after-sales operations. |
| `site_surveys` | Core CRM record. |
| `smart_quote_versions` | Core CRM record. |
| `solar_packages` | Inventory and product catalogue of the company. |
| `subscription_payments` | A solar company's own customer maintenance plans (NOT the SaaS plan). plan_code must become unique per company. |
| `subscription_plans` | A solar company's own customer maintenance plans (NOT the SaaS plan). plan_code must become unique per company. |
| `support_ticket_updates` | Projects, delivery and after-sales operations. |
| `support_tickets` | Projects, delivery and after-sales operations. |
| `technical_job_updates` | Projects, delivery and after-sales operations. |
| `warranties` | Documents and portal data of a company's own customers. |
| `warranty_claims` | Documents and portal data of a company's own customers. |
| `whatsapp_logs` | Legacy WhatsApp message logs linked to leads/customers. |
| `whatsapp_message_logs` | Legacy WhatsApp message logs linked to leads/customers. |

### `tenant_config` (10)

Company-owned configuration: same as tenant, plus unique(company_id) or unique(company_id, key). Replaces global singletons.

| Table | Note |
|---|---|
| `bank_accounts` | Currently a global singleton. Becomes one row per company (unique on company_id). |
| `ceo_messages` | Public website/branding content; per company. Pilot scope: only branding fields are exposed. |
| `company_terms` | Currently a global singleton. Becomes one row per company (unique on company_id). |
| `quote_pdf_settings` | Currently a global singleton. Becomes one row per company (unique on company_id). |
| `quote_template_pages` | Currently a global singleton. Becomes one row per company (unique on company_id). |
| `quote_templates` | Currently a global singleton. Becomes one row per company (unique on company_id). |
| `settings` | Currently a global singleton. Becomes one row per company (unique on company_id). |
| `social_links` | Public website/branding content; per company. Pilot scope: only branding fields are exposed. |
| `structure_descriptions` | Public website/branding content; per company. Pilot scope: only branding fields are exposed. |
| `website_content` | Public website/branding content; per company. Pilot scope: only branding fields are exposed. |

### `tenant_existing_company_id` (14)

Already has company_id text. Add FK to companies(id) and RLS; keep values ('sunchaser').

| Table | Note |
|---|---|
| `whatsapp_audit_events` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_channels` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_connections` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_contacts` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_conversation_assignment_events` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_conversation_crm_links` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_conversation_status_events` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_conversations` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_message_status_events` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_messages` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_oauth_states` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_outbound_idempotency_keys` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_read_watermarks` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |
| `whatsapp_webhook_events` | Already has company_id text default 'sunchaser' (declared NOT a real boundary). Add FK to companies(id) and RLS. |

### `identity` (1)

Global identity table; visibility to a company only via company_memberships.

| Table | Note |
|---|---|
| `users` | Global login identity. Access in a company is granted only through company_memberships. |

### `role_template` (2)

System rows (company_id NULL) readable by all; company rows isolated.

| Table | Note |
|---|---|
| `role_permissions` | company_id NULL = system template visible to all; company rows = custom roles owned by one company. |
| `roles` | company_id NULL = system template visible to all; company rows = custom roles owned by one company. |

### `dormant` (12)

Feature not enabled in production. No tenant access until a scoping review is done.

| Table | Note |
|---|---|
| `messaging_attachments` | Unified messaging store (organization_id). UNIFIED_MESSAGING_POSTGRES_ENABLED is off in production. Scope before enabling. |
| `messaging_audit_logs` | Unified messaging store (organization_id). UNIFIED_MESSAGING_POSTGRES_ENABLED is off in production. Scope before enabling. |
| `messaging_contact_identities` | Unified messaging store (organization_id). UNIFIED_MESSAGING_POSTGRES_ENABLED is off in production. Scope before enabling. |
| `messaging_contacts` | Unified messaging store (organization_id). UNIFIED_MESSAGING_POSTGRES_ENABLED is off in production. Scope before enabling. |
| `messaging_conversation_assignments` | Unified messaging store (organization_id). UNIFIED_MESSAGING_POSTGRES_ENABLED is off in production. Scope before enabling. |
| `messaging_conversations` | Unified messaging store (organization_id). UNIFIED_MESSAGING_POSTGRES_ENABLED is off in production. Scope before enabling. |
| `messaging_messages` | Unified messaging store (organization_id). UNIFIED_MESSAGING_POSTGRES_ENABLED is off in production. Scope before enabling. |
| `messaging_outbox` | Unified messaging store (organization_id). UNIFIED_MESSAGING_POSTGRES_ENABLED is off in production. Scope before enabling. |
| `messaging_status_events` | Unified messaging store (organization_id). UNIFIED_MESSAGING_POSTGRES_ENABLED is off in production. Scope before enabling. |
| `whatsapp_web_owner_diagnostics` | Unofficial WhatsApp Web session tables; not safe for multi-company until reviewed. Blocked for pilots. |
| `whatsapp_web_session_lease` | Unofficial WhatsApp Web session tables; not safe for multi-company until reviewed. Blocked for pilots. |
| `whatsapp_web_sync_jobs` | Unofficial WhatsApp Web session tables; not safe for multi-company until reviewed. Blocked for pilots. |

### `sunchaser_only` (38)

Module owned by the founding company. No tenant access; routes blocked for other companies.

| Table | Note |
|---|---|
| `learning_assessments` | Learning Studio (separate service, already has company_id). Not part of the pilot. |
| `learning_courses` | Learning Studio (separate service, already has company_id). Not part of the pilot. |
| `learning_enrollments` | Learning Studio (separate service, already has company_id). Not part of the pilot. |
| `learning_generation_jobs` | Learning Studio (separate service, already has company_id). Not part of the pilot. |
| `learning_usage_events` | Learning Studio (separate service, already has company_id). Not part of the pilot. |
| `mp_audit_events` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_auto_import_listings` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_auto_import_sync_runs` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_brands` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_cart_items` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_carts` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_categories` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_delivery_rates` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_delivery_zones` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_event_outbox` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_field_overrides` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_idempotency_keys` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_import_reject_ledger` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_job_runs` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_media` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_order_items` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_orders` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_payment_plans` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_payments` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_price_alerts` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_price_history` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_price_overrides` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_pricing_config` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_product_costs` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_product_variants` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_products` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_receipt_objects` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_receipts` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_storage_cleanup_outbox` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_supplier_observations` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_supplier_products` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_suppliers` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
| `mp_upload_intents` | Marketplace module. Owned by the founding company; no tenant access; routes blocked for pilots. |
