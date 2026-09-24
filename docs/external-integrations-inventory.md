# Sunchaser Energy Systems — External Integration Inventory

**Status:** Verified for Railway Production Cutover  
**Security Standard:** Strict configuration audit; zero credential exposure.  
**Audited:** September 2026  

---

## 1. Inventory Summary

| Integration | Protocol / Provider | Production Target | Legacy Dependency Status | Cutover Status |
| :--- | :--- | :--- | :--- | :---: |
| **WhatsApp Meta Cloud API** | Webhook (HTTPS POST/GET) | `https://crm.sunchaserenergy.co/api/whatsapp/webhook` | Formerly Render | ✅ Configured for Railway |
| **WhatsApp Web Session Lease** | Postgres / Redis lease lock | Internal Railway Postgres | Formerly Render single-dyno | ✅ High-availability lease enabled |
| **Email Delivery (Transactional)** | SMTP / API provider | Environment-configured | Standalone | ✅ Verified |
| **TikTok Publisher Callbacks** | Webhook (HTTPS POST) | `https://crm.sunchaserenergy.co/api/marketing/tiktok` | None | ✅ Active |
| **Meta (FB/IG) Lead Ads** | Graph API Webhook | `https://crm.sunchaserenergy.co/api/marketing/facebook` | Formerly Render | ✅ Active |
| **Google OAuth 2.0** | OAuth2 Redirect Flow | `https://crm.sunchaserenergy.co/api/auth/google/callback` | Formerly Render URL | ✅ Callback URI updated |
| **PDF Generation Engine** | Playwright Chromium (Headless) | Internal Railway CRM container | Formerly Render native | ✅ Verified (T17 Smoke Test PASS) |
| **Marketplace Daily Price Sync** | Railway Scheduled Cron Job | Internal Railway container job | None (New automated architecture) | ✅ Verified (Atomic SQL sync) |
| **Kamal Solar Price Scraper** | HTTP Scraper Adapter | Internal Railway CRM | None | ✅ Tested & Active |
| **Aladin Price Scraper** | HTTP Scraper Adapter | Internal Railway CRM | None | ✅ Tested & Active |
| **Android CRM App API Base** | REST HTTPS JSON | `https://crm.sunchaserenergy.co` | Formerly Render `onrender.com` | ✅ Updated in Android app config |
| **Client Portal Gateway** | CORS + JWT Auth | `https://crm.sunchaserenergy.co` | Legacy Supabase Auth | ✅ Verified |
| **Public Lead Capture Gateway** | REST POST (API-Key gated) | `https://crm.sunchaserenergy.co/api/public/leads` | Formerly Render | ✅ Verified (T12 Smoke Test PASS) |

---

## 2. Integration Detail & Configuration Safety

### 1. WhatsApp Meta Cloud API Webhook
- **Webhook Endpoint:** `https://crm.sunchaserenergy.co/api/whatsapp/webhook`
- **Verification Protocol:** Hub verification via `hub.challenge` and `hub.verify_token`.
- **Inbound Security:** HMAC-SHA256 signature verification via raw request body middleware before JSON parsing (`installWhatsAppRawBodyMiddleware`).
- **Action Required in Meta Developer App:** Ensure the Webhook URL in Meta App Dashboard points to `https://crm.sunchaserenergy.co/api/whatsapp/webhook`.

### 2. Google OAuth 2.0
- **Authorized JavaScript Origins:**
  - `https://crm.sunchaserenergy.co`
  - `https://www.sunchaserenergy.co`
- **Authorized Redirect URIs:**
  - `https://crm.sunchaserenergy.co/api/auth/google/callback`
- **Safe Transition Note:** Do not remove legacy `onrender.com` redirect URIs in Google Cloud Console until the 72-hour cutover observation window elapses.

### 3. PDF Generation Engine
- **Engine:** Playwright Chromium headless running in Linux x86_64 container.
- **Verification Endpoint:** `GET /api/debug/pdf-engine`.
- **Status:** Verified operating under Railway execution sandbox with full font and layout rendering support.

### 4. Scheduled Marketplace Price Sync
- **Service Name:** `marketplace-daily-price-sync`
- **Schedule:** Daily at `00:00 PKT` (`19:00 UTC`).
- **Mechanism:** One-shot atomic commit batch using `scripts/marketplace-ceo-auto-import-atomic.sql` with statement timeout safeguards.
- **Verification Status:** Latest Railway run exited with code 0 (all 736 products synced).

### 5. Android CRM Application
- **API Base URL Configuration:** `https://crm.sunchaserenergy.co`
- **Capacitor Configuration:** `capacitor.config.ts` allowlist includes `crm.sunchaserenergy.co`.
- **Public Staged PDF Downloads:** Gated by single-use token `/api/export/pdf/staged-public/:uuid` to allow native Android browser downloads without session cookie leakage.
