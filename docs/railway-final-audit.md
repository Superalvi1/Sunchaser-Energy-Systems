# Sunchaser Railway Migration — Baseline Audit & Final Verification

**Date:** 2026-09-25  
**Project ID:** `11d4acc0-4f19-4c05-a41c-fa20d3b235af`  
**Environment ID:** `a3fcb877-f02b-44b5-af5c-f03fac71f05b`  
**Target Cutover Branch:** `chore/railway-final-cutover`  

---

## 1. Executive Summary

This audit assesses the migration status of the Sunchaser platform from legacy hosting (Render backend, Vercel frontend, and Supabase managed services) to unified Railway hosting.

The live production state on Railway consists of:
- **CRM Service:** `https://crm.sunchaserenergy.co` (Monolith Express backend + Vite React SPA)
- **Marketing Website:** `https://www.sunchaserenergy.co` (Next.js 16 storefront)
- **Quote Tool:** `https://quote.sunchaserenergy.co` (Interactive customer quotation tool)
- **SmartQuote:** `https://smartquote.sunchaserenergy.co` (Automated quote engine)
- **Railway PostgreSQL:** Managed PostgreSQL (142 tables, 460 constraints, 372 indexes, 142 RLS-enabled tables)
- **Railway Storage Bucket:** Object storage for watermark assets, customer documents, and project media
- **Daily Marketplace Price-Sync:** Scheduled cron executing price synchronization

Authoritative domain probes confirm:
- `www.sunchaserenergy.co`: 200 OK (TLS valid, expires Dec 2026)
- `sunchaserenergy.co`: 301 Permanent Redirect to `https://www.sunchaserenergy.co` (GoDaddy TLS valid, expires Nov 2026)
- `crm.sunchaserenergy.co`: 200 OK (Railway Hikari edge router, TLS valid, expires Dec 2026)
- `crm.sunchaserenergy.co/health`: 200 OK (`{"status":"ok","service":"sunchaser-crm"}`)
- `quote.sunchaserenergy.co`: 200 OK (Railway Hikari edge router, TLS valid, expires Dec 2026)
- `smartquote.sunchaserenergy.co`: 200 OK (Railway Hikari edge router, TLS valid, expires Dec 2026)

---

## 2. Repositories Inspected & Build Baseline

### 2.1 Repositories
1. `Superalvi1/Sunchaser-Energy-Systems` (`main` / `chore/railway-final-cutover`)
   - Monolithic repository containing Express 4 backend (`server.ts`), React 19 frontend SPA (`src/`), Android Capacitor project (`android/`), and database management modules (`dbManager.ts`, `productionCleanupDb.ts`).
2. `Superalvi1/Sunchaser-Marketing-Website` (`main` / `chore/railway-final-cutover`)
   - Next.js 16 static/dynamic marketing storefront (`marketing-next/`) consuming CRM catalogue APIs and submitting leads.

### 2.2 Test Suite Verification
- **CRM (`Sunchaser-Energy-Systems`):**
  - Command: `npm test`
  - Result: **All tests passed** (WhatsApp official policy, AutoSizer 35/35, CORS middleware, Public lead gateway, Startup smoke test on port 3000, Mobile disclosure layout tests, AI quote mobile layout tests).
- **Marketing (`Sunchaser-Marketing-Website/marketing-next`):**
  - Command: `npm test`
  - Result: **207 passed, 0 failed** across 22 test suites.

### 2.3 Production Build Verification
- **CRM (`Sunchaser-Energy-Systems`):**
  - Command: `npm run build`
  - Output: Vite bundle (2.67 MB SPA) + esbuild CJS server (`dist/server.cjs`, 2.3 MB) + Chromium install. Built cleanly with exit code 0.
- **Marketing (`Sunchaser-Marketing-Website/marketing-next`):**
  - Command: `npm run build`
  - Output: Next.js static and dynamic route compilation (97/97 pages). Built cleanly with exit code 0.

---

## 3. Cloud Provider & Infrastructure References

A systematic static analysis of both codebases was performed to uncover legacy infrastructure references.

### 3.1 `render.com` / `onrender.com`
- **Total Hits:** 95 in CRM across 67 files; 2 in Marketing across 2 files.
- **Key Occurrences:**
  - `src/services/api.ts:14`: `const RENDER_PRODUCTION_API = "https://sunchaser-energy-systems.onrender.com";`
  - `.env.production:4`: `VITE_API_BASE_URL=https://sunchaser-energy-systems.onrender.com`
  - `marketing-next/lib/catalogue/source.ts:4`: `const PRODUCTION_CRM_CATALOGUE_BASE_URL = "https://sunchaser-energy-systems.onrender.com";`
  - `marketing-next/.env.example:18`: `# CRM_CATALOGUE_BASE_URL=https://sunchaser-energy-systems.onrender.com`
  - `android/PRODUCTION_RELEASE.md:8`: Production API reference pointing to Render
  - `scripts/verify-*.mjs`: 28 verification scripts default to `https://sunchaser-energy-systems.onrender.com` when `API_BASE` is omitted.

### 3.2 `vercel.app` / `vercel`
- **Total Hits:** 48 in CRM across 23 files; 10 in Marketing across 4 files.
- **Key Occurrences:**
  - `.env.production.example:11`: `APP_URL="https://sunchaser-crm.vercel.app"`
  - `DEPLOYMENT.md:86-100`: Documentation steps for deploying frontend on Vercel
  - `server/middleware/cors.ts:2`: Comment noting Vercel CRM frontend talking to Render API
  - `vercel.json`: Root Vercel SPA configuration file
  - `scripts/vercelSpaConfig.test.ts`: Test asserting `vercel.json` rewrites
  - `marketing-next/lib/creator-publisher/accessRequests.ts:36`: Temporary file path resolution on Vercel (`/tmp`)
  - `marketing-next/docs/VERCEL_LOCKFILE_ROOT_FIX.md`: Historical build workaround doc

### 3.3 `supabase.co` & Supabase PostgreSQL
- **Total Hits:** 75 in CRM across 27 files; 0 in Marketing.
- **Key Occurrences:**
  - `.env.production:5`: `VITE_SUPABASE_URL=https://xxtdfvgkurxabpbmjban.supabase.co`
  - `server/marketplace/autoImport/autoImport.test.ts`: Mock connection string to Supabase pooler
  - `productionCleanupDb.ts:107`: Legacy host pattern `db.${hostRef}.supabase.co`
  - `server/unifiedMessaging/messagingRuntimeConfig.ts`: Supports `DATABASE_URL` or fallback `SUPABASE_DB_URL`
  - `scripts/execute-production-cleanup-20260606.mjs`: Cleanup utility connecting to Supabase

### 3.4 Supabase Storage
- **Total Hits:** 57 in CRM across 21 files; 0 in Marketing.
- **Key Occurrences:**
  - `src/lib/quoteAssetsStorage.ts`: Uploads watermarks to `quote-assets` bucket via `supabase.storage` when configured, with local filesystem fallback to `public/uploads/quote-assets/`.
  - `src/lib/quotePdfSettingsStore.ts`: Resolves public URLs with Supabase project URL prefix `/storage/v1/object/public/quote-assets/` or local fallback `/uploads/quote-assets/`.
  - `customerProfileDb.ts:295`: Uploads documents to `customer-documents` bucket.
  - `projectCompletionDb.ts:121`: Uploads media to `project-deliveries` bucket.
  - `database.json` & historical snapshots: Reference legacy Supabase storage asset URLs (`https://lskchobfhyryjpxfpyzo.supabase.co/storage/v1/object/public/uploads/...`).

### 3.5 Supabase Auth
- **Total Hits:** 0 direct calls to `@supabase/auth-helpers` or `supabase.auth.signUp/signInWithPassword`.
- **Finding:** The application employs a custom, self-contained JWT authentication layer (`userAuthDb.ts`, `server.ts`), storing users in the PostgreSQL `users` table with bcrypt-hashed passwords. Supabase Auth service was never the primary authentication authority.

### 3.6 Old API URLs & Endpoints
- `https://sunchaser-energy-systems.onrender.com` (Render CRM backend)
- `https://sunchaser-crm.vercel.app` (Vercel CRM frontend)
- `https://xxtdfvgkurxabpbmjban.supabase.co` (Supabase project)
- `https://lskchobfhyryjpxfpyzo.supabase.co` (Legacy Supabase project)

### 3.7 Webhook & Callback URLs
- **WhatsApp Webhook:** `/api/whatsapp/webhook`
  - Configured in Meta App Dashboard. Must point to `https://crm.sunchaserenergy.co/api/whatsapp/webhook`.
- **Google OAuth / GIS Callback:**
  - Configured in Google Cloud Console. Origin: `https://crm.sunchaserenergy.co`.
- **Public Lead Gateway:**
  - Endpoint: `POST https://crm.sunchaserenergy.co/api/public/leads`
  - Consumed by Marketing site (`CRM_PUBLIC_LEAD_ENDPOINT`).
- **Storefront Catalogue API:**
  - Endpoint: `GET https://crm.sunchaserenergy.co/api/marketplace/catalogue`
  - Consumed by Marketing site (`CRM_CATALOGUE_BASE_URL`).

---

## 4. Reference Classification Matrix

Every reference discovered across both repositories has been categorized according to the required 4-tier taxonomy:

| Category | Reference / File | Current Target | Classification Rationale & Action |
| :--- | :--- | :--- | :--- |
| **Must Migrate** | `src/services/api.ts:14,24` | `https://sunchaser-energy-systems.onrender.com` | Primary client API base fallback. Must default to `https://crm.sunchaserenergy.co` (or relative path `""` for same-origin browser contexts). |
| **Must Migrate** | `.env.production:4` | `https://sunchaser-energy-systems.onrender.com` | Production environment defaults packaged during Vite builds. Must point to `https://crm.sunchaserenergy.co`. |
| **Must Migrate** | `marketing-next/lib/catalogue/source.ts:4` | `https://sunchaser-energy-systems.onrender.com` | Marketing website default CRM catalogue base URL. Must default to `https://crm.sunchaserenergy.co`. |
| **Must Migrate** | `marketing-next/.env.example:18` | `https://sunchaser-energy-systems.onrender.com` | Marketing environment template. Must reflect `https://crm.sunchaserenergy.co`. |
| **Must Migrate** | `server/middleware/cors.ts:19` | `STATIC_ALLOWED_ORIGINS` | Must include `https://www.sunchaserenergy.co`, `https://quote.sunchaserenergy.co`, and `https://smartquote.sunchaserenergy.co` to ensure cross-origin browser requests succeed. |
| **Must Migrate** | `android/PRODUCTION_RELEASE.md:8` | `https://sunchaser-energy-systems.onrender.com` | Production Android build documentation. Must state `https://crm.sunchaserenergy.co`. |
| **Must Migrate** | `sunchaser-crm-comprehensive-smoke` | Service health check | Failed Railway deployment healthcheck. Must be refactored into a resilient test runner with genuine `/health` endpoint and dual job/service mode. |
| **Intentional Fallback** | `server/unifiedMessaging/messagingRuntimeConfig.ts` | `SUPABASE_DB_URL` | Dual-read of `DATABASE_URL || SUPABASE_DB_URL` allows instant rollback to Supabase PostgreSQL without code deployment. Keep intact. |
| **Intentional Fallback** | `server/marketplace/autoImport/autoImportDbUrl.ts` | `SUPABASE_DB_URL` | Dual-read allows marketplace price sync to run against legacy Supabase if Railway Postgres is in maintenance. Keep intact. |
| **Intentional Fallback** | `dbManager.ts:154-187` | `SUPABASE_URL` | Allows CRM to query Supabase REST if Railway Postgres credentials are removed. Keep intact. |
| **Intentional Fallback** | `marketing-next/lib/catalogue/source.ts:28` | Static catalogue fallback | If Railway CRM catalogue is temporarily unreachable, marketing site falls back to static catalogue rather than crashing. Keep intact. |
| **Intentional Fallback** | `src/lib/quoteAssetsStorage.ts:84-93` | Local `/uploads` fallback | If cloud storage is unavailable, watermark assets fall back safely to local persistent storage. Keep intact. |
| **Development-Only** | `server/invoiceBulkLoading.test.ts:3` | `https://example.supabase.co` | Test mock for invoice bulk loading tests. Keep intact. |
| **Development-Only** | `server/marketplace/autoImport/autoImport.test.ts` | `*.pooler.supabase.com` | Unit test mock for connection string parser. Keep intact. |
| **Development-Only** | `docker-compose.messaging-test.yml` | Local Postgres container | Local development harness for unified messaging. Keep intact. |
| **Development-Only** | `scripts/smoke-server-start.mjs` | Local port 3000 | CI startup smoke test. Keep intact. |
| **Development-Only** | `scripts/messaging-test-db-exec.sh` | Local test exec | Test execution harness. Keep intact. |
| **Obsolete** | `.env.production.example:11,40` | `sunchaser-crm.vercel.app`, `sunchaser-backend.onrender.com` | Example template referring to retired split-host architecture. Update to Railway conventions. |
| **Obsolete** | `DEPLOYMENT.md:86-100` | Vercel frontend setup | Split frontend on Vercel is retired; Railway serves unified full-stack monolith. |
| **Obsolete** | `scripts/verify-client-portal-phase*.mjs` | Hardcoded `API_BASE=https://sunchaser-energy-systems.onrender.com` | Deprecated phase verification scripts. Parameterize with `API_BASE` default to Railway. |
| **Obsolete** | `marketing-next/docs/VERCEL_LOCKFILE_ROOT_FIX.md` | Vercel pnpm-lock fix | Historical Vercel troubleshooting documentation. Retain as archival only. |

---

## 5. Root Cause Analysis: `sunchaser-crm-comprehensive-smoke` Failure

The Railway service `sunchaser-crm-comprehensive-smoke` failed its deployment health check for the following architectural reasons:
1. **Service Type Mismatch:** Railway created this service as a standard persistent Web Service, expecting a daemon listening on an assigned `$PORT` and responding `HTTP 200` to health checks.
2. **Missing Long-Running HTTP Server:** A test script is naturally an ephemeral process that runs tests, prints results, and exits with code 0 or 1. When a test process exits, Railway interprets the process termination as an abnormal crash or failure to bind to `$PORT`.
3. **Absence of Dedicated Smoke Runner:** The repository possessed modular unit/integration tests and a basic server-startup smoke script (`scripts/smoke-server-start.mjs`), but lacked a dedicated comprehensive smoke test suite packaged to operate as a Railway verification service.

### Resolution Architecture:
Implement `scripts/comprehensive-smoke.mjs` supporting **two execution modes**:
- **Mode A (One-Shot Job / CI):** Invoked with `npm run test:comprehensive-smoke` or `node scripts/comprehensive-smoke.mjs --job`. Executes the full test matrix against the target environment (via Railway private networking `http://crm.railway.internal:3000` or public URL `https://crm.sunchaserenergy.co`), writes JSON and Markdown reports to `reports/`, and exits with code 0 (success) or 1 (failure).
- **Mode B (Railway Health-Check Web Service):** Invoked when `PORT` or `SERVE_HEALTH=true` is set. Binds an Express HTTP server to `$PORT`, provides a `/health` endpoint returning `200 OK` with recent run statistics, offers `/run` to trigger on-demand test runs, and generates reports without crashing the Railway deployment.
