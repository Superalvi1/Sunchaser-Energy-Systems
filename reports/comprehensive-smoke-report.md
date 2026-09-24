# Sunchaser Comprehensive Smoke & E2E Verification Report

**Status:** ✅ PASSED  
**Target API:** `https://crm.sunchaserenergy.co`  
**Run ID:** `CUTOVER_1790286350386`  
**Duration:** 15.16s  
**Timestamp:** 2026-09-24T21:45:50.386Z  
**Summary:** 23/23 passed (0 failed)  

---

## Test Results Summary

| ID | Title | Category | Status | Details |
| :--- | :--- | :--- | :--- | :--- |
| `T01_HEALTH` | CRM Service Liveness & Health | System | ✅ PASS | {"status":200,"body":{"status":"ok","service":"sunchaser-crm"}} |
| `T02_UNAUTH_REJECTION` | Protected API Rejection When Unauthenticated | Security | ✅ PASS | {"rolesMatrixStatus":401,"adminUsersStatus":401,"adminInvoicesStatus":401} |
| `T03_ADMIN_LOGIN` | Owner/Admin Authentication | Auth | ✅ PASS | {"user":"admin","role":"Super Admin"} |
| `T04_RBAC_MATRIX` | Role-Based Access Control & Roles Matrix | RBAC | ✅ PASS | {"rolesCount":9,"dynamic":true} |
| `T05_CLIENT_REGISTRATION` | Client Registration & Auto-Approval | Auth | ✅ PASS | {"status":201,"userId":"u-1790286354133","customerId":"cust-1790286354133"} |
| `T06_HASSAN_LINKING` | User-to-Customer Auto-Linking (Hassan Case) | Data-Integrity | ✅ PASS | {"hasCustomerId":true,"customerId":"cust-1790286354133"} |
| `T07_CLIENT_LOGIN` | Client Login & Session Issuance | Auth | ✅ PASS | {"status":200,"role":"Customer"} |
| `T08_SESSION_INVALIDATION` | Session Invalidation & Rejection | Security | ✅ PASS | {"status":401} |
| `T09_PASSWORD_RESET_OTP` | Password Reset & Recovery Gateway | Auth | ✅ PASS | {"status":200} |
| `T10_STAFF_WORKSPACE` | Staff Customer Directory Access | Staff | ✅ PASS | {"accountsCount":7} |
| `T11_LEAD_CREATION` | Lead Creation with Commercial Sizing | CRM | ✅ PASS | {"status":201,"leadId":"lead-9476f771-fb61-4b45-9432-040d85c87d99"} |
| `T12_PUBLIC_LEAD_GATEWAY` | Quote / SmartQuote Public Lead Ingestion | Integrations | ✅ PASS | {"unauthBlocked":true,"authCreated":false,"capturedLeadId":null} |
| `T13_PROPOSAL_CREATION` | Interactive Quotation & BOQ Creation | Quotation | ✅ PASS | {"status":200,"quoteId":"lead-9476f771-fb61-4b45-9432-040d85c87d99"} |
| `T14_PORTAL_VISIBILITY` | Client Portal Dashboard & Profile Access | Portal | ✅ PASS | {"status":200} |
| `T15_INVOICES_LEDGER` | Invoices & Payment Records Visibility | Finance | ✅ PASS | {"status":200,"invoicesCount":133} |
| `T16_WARRANTY_DOCUMENTS` | Warranties & Document Storage Access | Documents | ✅ PASS | {"status":200} |
| `T17_PDF_ENGINE` | Headless Chromium PDF Generation Engine | Export | ✅ PASS | {"status":200,"browserLaunchSuccess":true} |
| `T18_FILE_LIFECYCLE` | Document Upload & Object Storage Storage | Storage | ✅ PASS | {"status":201,"fileUrl":"https://crm.sunchaserenergy.co/api/storage/object/customer-documents/Y3VzdC0xNzkwMjg2MzU0MTMzLzE3OTAyODYzNjA1NzhfdmVyaWZ5X3Rlc3RfMTc5MDI4NjM2MDA0OC5wZGY?sig=552806e010d73e9611fcca379adefe0ef8d41475ca4d4daf1137550a18d67946"} |
| `T19_IMAGE_UPLOAD` | Watermark & Media Upload Engine | Storage | ✅ PASS | {"status":200,"url":"https://crm.sunchaserenergy.co/api/storage/object/quote-assets/d2F0ZXJtYXJrcy9zZXR0aW5ncy1jdXRvdmVyLXRlc3QtMTc5MDI4NjM2MTA1OS5wbmc?sig=369b22e785d7244c2edbb10a2705fbaf0818ee34d328f666b31c4baf599b5429"} |
| `T20_MARKETPLACE_CATALOGUE` | Marketplace Live Product Catalogue | Marketplace | ✅ PASS | {"source":"database","productsCount":736} |
| `T21_PRICE_SYNC_CONSUMPTION` | Marketplace Price-Sync Result Consumption | Marketplace | ✅ PASS | {"sampleCount":736,"hasPricedProducts":true} |
| `T22_LEAD_CONVERSION` | Lead-to-Project Conversion Flow | CRM | ✅ PASS | {"status":200} |
| `T23_DB_CONNECTIVITY` | Database Pool & Active Connection Diagnostics | Database | ✅ PASS | {"supabaseActive":true,"userCount":10} |

---
*Generated automatically by Sunchaser Railway Verification Suite.*