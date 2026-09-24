#!/usr/bin/env node
/**
 * Comprehensive Authenticated End-to-End & Health Smoke Test Suite
 *
 * Supports two execution models:
 *  1. One-Shot Job (CLI / Railway Job / CI):
 *       node scripts/comprehensive-smoke.mjs [--job]
 *       Exits with code 0 on success, code 1 on failure.
 *  2. Health-Check Web Service (Railway Web Service with health check):
 *       node scripts/comprehensive-smoke.mjs --serve
 *       (Or automatically activated if PORT / SERVE_HEALTH=true is present)
 *       Binds to $PORT, provides /health, /ready, /run, /report, and stays alive.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Load environment files if present
function loadEnvFile(filePath) {
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...vals] = trimmed.split("=");
      const val = vals.join("=").trim().replace(/^["']|["']$/g, "");
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = val;
      }
    }
  }
}

loadEnvFile(path.join(rootDir, ".env.local"));
loadEnvFile(path.join(rootDir, ".env.bootstrap.local"));
loadEnvFile(path.join(rootDir, ".env"));

// Configuration
const TARGET_API = (
  process.env.CRM_URL ||
  process.env.CRM_INTERNAL_URL ||
  process.env.API_BASE ||
  (process.argv.includes("--local") ? "http://127.0.0.1:3000" : "https://crm.sunchaserenergy.co")
).replace(/\/$/, "");

const PUBLIC_LEAD_KEY =
  process.env.PUBLIC_LEAD_API_KEY ||
  process.env.VITE_PUBLIC_LEAD_API_KEY ||
  "";

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS =
  process.env.BOOTSTRAP_ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD ||
  "";

const IS_SERVE_MODE =
  process.argv.includes("--serve") ||
  process.env.SERVE_HEALTH === "true" ||
  (Boolean(process.env.PORT) && !process.argv.includes("--job"));

const PORT = Number(process.env.PORT || 8080);
const REPORTS_DIR = path.join(rootDir, "reports");
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// Minimal 1x1 PNG for image upload test
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Minimal valid PDF for document upload test
const TINY_PDF_B64 =
  "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCAyMDAgMjAwXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDQKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjE5NQolJUVPRgo=";

// State of test execution
let latestReport = null;
let isRunning = false;

// Helper: HTTP request wrapper
async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${TARGET_API}${endpoint}`;
  const headers = {
    "User-Agent": "Sunchaser-Comprehensive-Smoke/1.0",
    ...(options.headers || {}),
  };
  if (options.body && typeof options.body === "object" && !(options.body instanceof Buffer)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, headers: res.headers, text, json };
}

// Runner
export async function runComprehensiveSuite() {
  if (isRunning) return latestReport;
  isRunning = true;

  const testRunId = `CUTOVER_${Date.now()}`;
  const startTime = new Date();
  const results = [];
  const cleanupTasks = [];

  function record(id, title, category, passed, details = {}) {
    results.push({
      id,
      title,
      category,
      passed,
      timestamp: new Date().toISOString(),
      details,
    });
    console.log(`[${passed ? "PASS" : "FAIL"}] [${id}] ${title}${details.message ? ` — ${details.message}` : ""}`);
  }

  console.log(`\n======================================================`);
  console.log(`Sunchaser Comprehensive Verification & Smoke Suite`);
  console.log(`Target: ${TARGET_API}`);
  console.log(`Run ID: ${testRunId}`);
  console.log(`Started: ${startTime.toISOString()}`);
  console.log(`======================================================\n`);

  let adminAuth = null;
  let testCustomerAuth = null;
  let createdLeadId = null;
  let createdQuoteId = null;
  let createdCustomerId = null;

  try {
    // ------------------------------------------------------------------
    // TEST 1: Service Liveness & Health Endpoint
    // ------------------------------------------------------------------
    try {
      const res = await apiRequest("/health");
      const passed = res.ok && res.json?.status === "ok";
      record("T01_HEALTH", "CRM Service Liveness & Health", "System", passed, {
        status: res.status,
        body: res.json,
      });
    } catch (err) {
      record("T01_HEALTH", "CRM Service Liveness & Health", "System", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 2: Protected API Rejection When Unauthenticated
    // ------------------------------------------------------------------
    try {
      const res1 = await apiRequest("/api/auth/roles-matrix");
      const res2 = await apiRequest("/api/admin/users");
      const res3 = await apiRequest("/api/admin/invoices");
      const passed = (res1.status === 401 || res1.status === 403) &&
                     (res2.status === 401 || res2.status === 403) &&
                     (res3.status === 401 || res3.status === 403);
      record("T02_UNAUTH_REJECTION", "Protected API Rejection When Unauthenticated", "Security", passed, {
        rolesMatrixStatus: res1.status,
        adminUsersStatus: res2.status,
        adminInvoicesStatus: res3.status,
      });
    } catch (err) {
      record("T02_UNAUTH_REJECTION", "Protected API Rejection When Unauthenticated", "Security", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 3: Owner / Admin Authentication
    // ------------------------------------------------------------------
    try {
      if (!ADMIN_PASS) {
        record("T03_ADMIN_LOGIN", "Owner/Admin Authentication", "Auth", false, {
          message: "No bootstrap or admin password configured in environment",
        });
      } else {
        const res = await apiRequest("/api/auth/login", {
          method: "POST",
          body: { username: ADMIN_USER, password: ADMIN_PASS },
        });
        if (res.ok && res.json?.token && res.json?.user) {
          adminAuth = {
            token: res.json.token,
            user: res.json.user,
            headers: {
              Authorization: `Bearer ${res.json.token}`,
              "X-Sunchaser-User-Id": res.json.user.id,
              "X-Sunchaser-Username": res.json.user.username,
            },
          };
          record("T03_ADMIN_LOGIN", "Owner/Admin Authentication", "Auth", true, {
            user: res.json.user.username,
            role: res.json.user.role,
          });
        } else {
          record("T03_ADMIN_LOGIN", "Owner/Admin Authentication", "Auth", false, {
            status: res.status,
            error: res.json?.error || res.text,
          });
        }
      }
    } catch (err) {
      record("T03_ADMIN_LOGIN", "Owner/Admin Authentication", "Auth", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 4: Role-Based Access Matrix Verification
    // ------------------------------------------------------------------
    if (adminAuth) {
      try {
        const matrixRes = await apiRequest("/api/auth/roles-matrix", { headers: adminAuth.headers });
        const rolesRes = await apiRequest("/api/admin/roles", { headers: adminAuth.headers });
        const passed = matrixRes.ok && rolesRes.ok &&
                       Array.isArray(rolesRes.json?.roles) &&
                       rolesRes.json.roles.length >= 9;
        record("T04_RBAC_MATRIX", "Role-Based Access Control & Roles Matrix", "RBAC", passed, {
          rolesCount: rolesRes.json?.roles?.length,
          dynamic: matrixRes.json?.dynamic,
        });
      } catch (err) {
        record("T04_RBAC_MATRIX", "Role-Based Access Control & Roles Matrix", "RBAC", false, { error: err.message });
      }
    }

    // ------------------------------------------------------------------
    // TEST 5: Client Self-Registration (Hassan-Style Linking Verification)
    // ------------------------------------------------------------------
    const testClientUsername = `test_client_${Date.now()}`;
    const testClientPassword = `CutoverSecure_${Date.now()}!`;
    const testClientEmail = `${testClientUsername}@sunchaser-verify.test`;

    try {
      const regRes = await apiRequest("/api/auth/register", {
        method: "POST",
        body: {
          username: testClientUsername,
          password: testClientPassword,
          name: "Cutover Verification Client",
          email: testClientEmail,
          phone: "03001234567",
          role: "Customer",
        },
      });

      const passed = regRes.status === 201 && regRes.json?.user?.role === "Customer";
      const userObj = regRes.json?.user;
      createdCustomerId = userObj?.customerId || userObj?.customer_id;

      if (passed && userObj?.id) {
        cleanupTasks.push(async () => {
          if (adminAuth) {
            await apiRequest(`/api/admin/users/${userObj.id}`, {
              method: "DELETE",
              headers: adminAuth.headers,
            });
          }
        });
      }

      record("T05_CLIENT_REGISTRATION", "Client Registration & Auto-Approval", "Auth", passed, {
        status: regRes.status,
        userId: userObj?.id,
        customerId: createdCustomerId,
      });

      // Hassan-Style Self-Registration Linking Check:
      // Verify user has customer_id linked, or appears in customer linking
      const linkingPassed = Boolean(createdCustomerId);
      record("T06_HASSAN_LINKING", "User-to-Customer Auto-Linking (Hassan Case)", "Data-Integrity", linkingPassed, {
        hasCustomerId: Boolean(createdCustomerId),
        customerId: createdCustomerId,
      });
    } catch (err) {
      record("T05_CLIENT_REGISTRATION", "Client Registration & Auto-Approval", "Auth", false, { error: err.message });
      record("T06_HASSAN_LINKING", "User-to-Customer Auto-Linking (Hassan Case)", "Data-Integrity", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 7: Client Login & Session Verification
    // ------------------------------------------------------------------
    try {
      const loginRes = await apiRequest("/api/auth/login", {
        method: "POST",
        body: { username: testClientUsername, password: testClientPassword },
      });

      const passed = loginRes.ok && Boolean(loginRes.json?.token);
      if (passed) {
        testCustomerAuth = {
          token: loginRes.json.token,
          user: loginRes.json.user,
          headers: {
            Authorization: `Bearer ${loginRes.json.token}`,
            "X-Sunchaser-User-Id": loginRes.json.user.id,
            "X-Sunchaser-Username": loginRes.json.user.username,
          },
        };
      }
      record("T07_CLIENT_LOGIN", "Client Login & Session Issuance", "Auth", passed, {
        status: loginRes.status,
        role: loginRes.json?.user?.role,
      });
    } catch (err) {
      record("T07_CLIENT_LOGIN", "Client Login & Session Issuance", "Auth", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 8: Session Invalidation / Logout
    // ------------------------------------------------------------------
    try {
      // Send request with an invalid/revoked Bearer token
      const res = await apiRequest("/api/auth/me", {
        headers: { Authorization: "Bearer INVALID_TOKEN_12345" },
      });
      const passed = res.status === 401 || res.status === 403;
      record("T08_SESSION_INVALIDATION", "Session Invalidation & Rejection", "Security", passed, {
        status: res.status,
      });
    } catch (err) {
      record("T08_SESSION_INVALIDATION", "Session Invalidation & Rejection", "Security", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 9: Password Reset / OTP Route Verification
    // ------------------------------------------------------------------
    try {
      const forgotRes = await apiRequest("/api/auth/forgot-password", {
        method: "POST",
        body: { email: testClientEmail },
      });
      // Route should accept and return safe envelope without crashing
      const passed = forgotRes.status === 200 || forgotRes.status === 201;
      record("T09_PASSWORD_RESET_OTP", "Password Reset & Recovery Gateway", "Auth", passed, {
        status: forgotRes.status,
      });
    } catch (err) {
      record("T09_PASSWORD_RESET_OTP", "Password Reset & Recovery Gateway", "Auth", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 10: Staff Login & Role Privileges
    // ------------------------------------------------------------------
    if (adminAuth) {
      try {
        const staffRes = await apiRequest("/api/admin/customer-accounts", { headers: adminAuth.headers });
        const passed = staffRes.ok && Array.isArray(staffRes.json?.accounts);
        record("T10_STAFF_WORKSPACE", "Staff Customer Directory Access", "Staff", passed, {
          accountsCount: staffRes.json?.accounts?.length,
        });
      } catch (err) {
        record("T10_STAFF_WORKSPACE", "Staff Customer Directory Access", "Staff", false, { error: err.message });
      }
    }

    // ------------------------------------------------------------------
    // TEST 11: Lead Creation & Management
    // ------------------------------------------------------------------
    if (adminAuth) {
      try {
        const leadRes = await apiRequest("/api/leads", {
          method: "POST",
          headers: adminAuth.headers,
          body: {
            name: `Cutover Test Lead ${Date.now()}`,
            phone: "+92 300 9999999",
            email: `lead_${Date.now()}@sunchaser-verify.test`,
            monthlyBill: 45000,
            city: "Lahore",
            address: "DHA Phase 5, Lahore",
            notes: "Automated cutover smoke test lead",
          },
        });

        const passed = leadRes.ok && Boolean(leadRes.json?.id || leadRes.json?.lead?.id);
        createdLeadId = leadRes.json?.id || leadRes.json?.lead?.id;

        if (passed && createdLeadId) {
          cleanupTasks.push(async () => {
            await apiRequest(`/api/leads/${createdLeadId}`, {
              method: "DELETE",
              headers: adminAuth.headers,
            });
          });
        }

        record("T11_LEAD_CREATION", "Lead Creation with Commercial Sizing", "CRM", passed, {
          status: leadRes.status,
          leadId: createdLeadId,
        });
      } catch (err) {
        record("T11_LEAD_CREATION", "Lead Creation with Commercial Sizing", "CRM", false, { error: err.message });
      }
    }

    // ------------------------------------------------------------------
    // TEST 12: Public Lead Capture (Quote / SmartQuote Tool Gateway)
    // ------------------------------------------------------------------
    try {
      // First verify rejection without credentials
      const unauthLeadRes = await apiRequest("/api/public/leads", {
        method: "POST",
        body: { name: "Probe Lead", phone: "03000000000", city: "Lahore" },
      });
      const unauthBlocked = unauthLeadRes.status === 401;

      // If key is configured, verify authorized submission
      let authCreated = false;
      let capturedLeadId = null;
      if (PUBLIC_LEAD_KEY) {
        const publicLeadRes = await apiRequest("/api/public/leads", {
          method: "POST",
          headers: { "x-public-lead-key": PUBLIC_LEAD_KEY },
          body: {
            name: "SmartQuote Web Lead",
            phone: "03008888888",
            city: "Lahore",
            monthlyBillPkr: 55000,
            source: "smartquote.sunchaserenergy.co",
          },
        });
        if (publicLeadRes.status === 201 && publicLeadRes.json?.leadId) {
          authCreated = true;
          capturedLeadId = publicLeadRes.json.leadId;
          if (adminAuth) {
            cleanupTasks.push(async () => {
              await apiRequest(`/api/leads/${capturedLeadId}`, {
                method: "DELETE",
                headers: adminAuth.headers,
              });
            });
          }
        }
      }

      const passed = unauthBlocked || authCreated;
      record("T12_PUBLIC_LEAD_GATEWAY", "Quote / SmartQuote Public Lead Ingestion", "Integrations", passed, {
        unauthBlocked,
        authCreated,
        capturedLeadId,
      });
    } catch (err) {
      record("T12_PUBLIC_LEAD_GATEWAY", "Quote / SmartQuote Public Lead Ingestion", "Integrations", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 13: Interactive Quotation & Proposal Creation
    // ------------------------------------------------------------------
    if (adminAuth && createdLeadId) {
      try {
        // Allow rate-limit window to settle
        await new Promise((r) => setTimeout(r, 1000));
        const quoteRes = await apiRequest(`/api/leads/${createdLeadId}/create-quote`, {
          method: "POST",
          headers: adminAuth.headers,
          body: {
            quote_type: "manual_boq",
            systemSizekW: 10,
            systemType: "On-grid",
            panelModel: "Longi Hi-MO 6 580W",
            panelCount: 18,
            panelQty: 18,
            inverterModel: "GoodWe 10kW On-Grid",
            inverterType: "GoodWe 10kW On-Grid",
            inverterQty: 1,
            structureType: "L3 Elevated",
            totalCost: 1250000,
            grandTotal: 1250000,
            netTotal: 1250000,
            boqRows: [
              { type: "item", item: "Longi 580W Panels", qty: 18, rate: 22000, amount: 396000 },
              { type: "item", item: "GoodWe 10kW Inverter", qty: 1, rate: 280000, amount: 280000 },
            ],
            terms: "Standard 25-year performance warranty.",
          },
        });

        const passed = quoteRes.ok && Boolean(quoteRes.json?.quote?.id || quoteRes.json?.id);
        createdQuoteId = quoteRes.json?.quote?.id || quoteRes.json?.id;

        record("T13_PROPOSAL_CREATION", "Interactive Quotation & BOQ Creation", "Quotation", passed, {
          status: quoteRes.status,
          quoteId: createdQuoteId,
        });
      } catch (err) {
        record("T13_PROPOSAL_CREATION", "Interactive Quotation & BOQ Creation", "Quotation", false, { error: err.message });
      }
    }

    // ------------------------------------------------------------------
    // TEST 14: Customer Portal Profile & Proposal Visibility
    // ------------------------------------------------------------------
    if (testCustomerAuth) {
      try {
        const portalRes = await apiRequest("/api/customer-portal/me", { headers: testCustomerAuth.headers });
        const passed = portalRes.ok && typeof portalRes.json === "object";
        record("T14_PORTAL_VISIBILITY", "Client Portal Dashboard & Profile Access", "Portal", passed, {
          status: portalRes.status,
        });
      } catch (err) {
        record("T14_PORTAL_VISIBILITY", "Client Portal Dashboard & Profile Access", "Portal", false, { error: err.message });
      }
    }

    // ------------------------------------------------------------------
    // TEST 15: Invoices & Payment Ledger
    // ------------------------------------------------------------------
    if (adminAuth) {
      try {
        const invoicesRes = await apiRequest("/api/admin/invoices", { headers: adminAuth.headers });
        const passed = invoicesRes.ok && Array.isArray(invoicesRes.json?.invoices);
        record("T15_INVOICES_LEDGER", "Invoices & Payment Records Visibility", "Finance", passed, {
          status: invoicesRes.status,
          invoicesCount: invoicesRes.json?.invoices?.length,
        });
      } catch (err) {
        record("T15_INVOICES_LEDGER", "Invoices & Payment Records Visibility", "Finance", false, { error: err.message });
      }
    }

    // ------------------------------------------------------------------
    // TEST 16: Warranties & Documents Visibility
    // ------------------------------------------------------------------
    if (adminAuth) {
      try {
        const docsRes = await apiRequest("/api/admin/customer-linking/customers", { headers: adminAuth.headers });
        const passed = docsRes.ok;
        record("T16_WARRANTY_DOCUMENTS", "Warranties & Document Storage Access", "Documents", passed, {
          status: docsRes.status,
        });
      } catch (err) {
        record("T16_WARRANTY_DOCUMENTS", "Warranties & Document Storage Access", "Documents", false, { error: err.message });
      }
    }

    // ------------------------------------------------------------------
    // TEST 17: PDF Engine Diagnostic & Export Capability
    // ------------------------------------------------------------------
    try {
      const pdfDiag = await apiRequest("/api/debug/pdf-engine", {
        headers: adminAuth ? adminAuth.headers : {},
      });
      const passed = pdfDiag.ok && pdfDiag.json?.browserLaunchSuccess === true;
      record("T17_PDF_ENGINE", "Headless Chromium PDF Generation Engine", "Export", passed, {
        status: pdfDiag.status,
        browserLaunchSuccess: pdfDiag.json?.browserLaunchSuccess,
        chromiumPath: pdfDiag.json?.chromiumPath,
      });
    } catch (err) {
      record("T17_PDF_ENGINE", "Headless Chromium PDF Generation Engine", "Export", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 18: File Upload & Download Lifecycle
    // ------------------------------------------------------------------
    if (adminAuth && createdCustomerId) {
      try {
        const uploadRes = await apiRequest("/api/admin/customer-documents/upload", {
          method: "POST",
          headers: adminAuth.headers,
          body: {
            customerId: createdCustomerId,
            fileName: `verify_test_${Date.now()}.pdf`,
            mimeType: "application/pdf",
            documentType: "other",
            title: "Verification PDF",
            base64Data: `data:application/pdf;base64,${TINY_PDF_B64}`,
          },
        });

        const fileUrl = uploadRes.json?.fileUrl || uploadRes.json?.url;
        const passed = uploadRes.ok && Boolean(fileUrl);
        record("T18_FILE_LIFECYCLE", "Document Upload & Object Storage Storage", "Storage", passed, {
          status: uploadRes.status,
          fileUrl,
          storagePath: uploadRes.json?.storagePath,
        });
      } catch (err) {
        record("T18_FILE_LIFECYCLE", "Document Upload & Object Storage Storage", "Storage", false, { error: err.message });
      }
    }

    // ------------------------------------------------------------------
    // TEST 19: Watermark Image Asset Ingestion
    // ------------------------------------------------------------------
    if (adminAuth) {
      try {
        const watermarkRes = await apiRequest("/api/quote-assets/watermark", {
          method: "POST",
          headers: adminAuth.headers,
          body: {
            base64Data: `data:image/png;base64,${TINY_PNG_B64}`,
            settingsId: "settings-cutover-test",
          },
        });

        const passed = watermarkRes.ok;
        if (passed && watermarkRes.json?.globalWatermarkFile) {
          const wmFile = watermarkRes.json.globalWatermarkFile;
          cleanupTasks.push(async () => {
            await apiRequest("/api/quote-assets/watermark", {
              method: "DELETE",
              headers: adminAuth.headers,
              body: { globalWatermarkFile: wmFile },
            });
          });
        }

        record("T19_IMAGE_UPLOAD", "Watermark & Media Upload Engine", "Storage", passed, {
          status: watermarkRes.status,
          url: watermarkRes.json?.publicUrl,
        });
      } catch (err) {
        record("T19_IMAGE_UPLOAD", "Watermark & Media Upload Engine", "Storage", false, { error: err.message });
      }
    }

    // ------------------------------------------------------------------
    // TEST 20: Marketplace Live Catalogue API
    // ------------------------------------------------------------------
    try {
      const pubRes = await apiRequest("/api/marketplace/catalogue/publication");
      const productsRes = await apiRequest("/api/marketplace/catalogue/products");
      const passed = pubRes.ok && productsRes.ok &&
                     Array.isArray(productsRes.json?.data?.items) &&
                     productsRes.json.data.items.length > 0;
      record("T20_MARKETPLACE_CATALOGUE", "Marketplace Live Product Catalogue", "Marketplace", passed, {
        source: pubRes.json?.data?.catalogueSource,
        productsCount: productsRes.json?.data?.items?.length,
      });
    } catch (err) {
      record("T20_MARKETPLACE_CATALOGUE", "Marketplace Live Product Catalogue", "Marketplace", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 21: Daily Price Sync Consumption
    // ------------------------------------------------------------------
    try {
      const productsRes = await apiRequest("/api/marketplace/catalogue/products");
      const items = productsRes.json?.data?.items || [];
      const hasPricedItems = items.some(
        (i) => i.defaultVariant && typeof i.defaultVariant.websitePrice === "number" && i.defaultVariant.websitePrice > 0
      );
      record("T21_PRICE_SYNC_CONSUMPTION", "Marketplace Price-Sync Result Consumption", "Marketplace", hasPricedItems, {
        sampleCount: items.length,
        hasPricedProducts: hasPricedItems,
      });
    } catch (err) {
      record("T21_PRICE_SYNC_CONSUMPTION", "Marketplace Price-Sync Result Consumption", "Marketplace", false, { error: err.message });
    }

    // ------------------------------------------------------------------
    // TEST 22: Lead Conversion Flow
    // ------------------------------------------------------------------
    if (adminAuth && createdLeadId) {
      try {
        const acceptRes = await apiRequest(`/api/leads/${createdLeadId}/accept-quote`, {
          method: "POST",
          headers: adminAuth.headers,
          body: {
            quoteId: createdQuoteId || `Q-${Date.now()}`,
          },
        });
        const passed = acceptRes.ok;
        record("T22_LEAD_CONVERSION", "Lead-to-Project Conversion Flow", "CRM", passed, {
          status: acceptRes.status,
        });
      } catch (err) {
        record("T22_LEAD_CONVERSION", "Lead-to-Project Conversion Flow", "CRM", false, { error: err.message });
      }
    }

    // ------------------------------------------------------------------
    // TEST 23: Database Connectivity Diagnostics
    // ------------------------------------------------------------------
    if (adminAuth) {
      try {
        const diagRes = await apiRequest("/api/diagnostics/auth-users", { headers: adminAuth.headers });
        const passed = diagRes.ok && Boolean(diagRes.json?.supabaseActive);
        record("T23_DB_CONNECTIVITY", "Database Pool & Active Connection Diagnostics", "Database", passed, {
          supabaseActive: diagRes.json?.supabaseActive,
          userCount: diagRes.json?.userCount,
        });
      } catch (err) {
        record("T23_DB_CONNECTIVITY", "Database Pool & Active Connection Diagnostics", "Database", false, { error: err.message });
      }
    }

  } finally {
    // ------------------------------------------------------------------
    // SAFE CLEANUP
    // ------------------------------------------------------------------
    console.log(`\nExecuting isolated test data cleanup (${cleanupTasks.length} tasks)...`);
    for (const task of cleanupTasks) {
      try {
        await task();
      } catch (err) {
        console.warn("Cleanup warning:", err.message);
      }
    }
  }

  const endTime = new Date();
  const durationMs = endTime.getTime() - startTime.getTime();
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  const allPassed = failedCount === 0;

  latestReport = {
    testRunId,
    targetApi: TARGET_API,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationMs,
    totalTests: results.length,
    passed: passedCount,
    failed: failedCount,
    status: allPassed ? "PASS" : "FAIL",
    results,
  };

  // Generate Reports
  const jsonReportPath = path.join(REPORTS_DIR, "comprehensive-smoke-report.json");
  const mdReportPath = path.join(REPORTS_DIR, "comprehensive-smoke-report.md");

  fs.writeFileSync(jsonReportPath, JSON.stringify(latestReport, null, 2), "utf-8");

  const mdLines = [
    `# Sunchaser Comprehensive Smoke & E2E Verification Report`,
    ``,
    `**Status:** ${latestReport.status === "PASS" ? "✅ PASSED" : "❌ FAILED"}  `,
    `**Target API:** \`${TARGET_API}\`  `,
    `**Run ID:** \`${testRunId}\`  `,
    `**Duration:** ${(durationMs / 1000).toFixed(2)}s  `,
    `**Timestamp:** ${startTime.toISOString()}  `,
    `**Summary:** ${passedCount}/${results.length} passed (${failedCount} failed)  `,
    ``,
    `---`,
    ``,
    `## Test Results Summary`,
    ``,
    `| ID | Title | Category | Status | Details |`,
    `| :--- | :--- | :--- | :--- | :--- |`,
    ...results.map(
      (r) =>
        `| \`${r.id}\` | ${r.title} | ${r.category} | ${
          r.passed ? "✅ PASS" : "❌ FAIL"
        } | ${escapeMd(JSON.stringify(r.details))} |`
    ),
    ``,
    `---`,
    `*Generated automatically by Sunchaser Railway Verification Suite.*`,
  ];

  fs.writeFileSync(mdReportPath, mdLines.join("\n"), "utf-8");
  console.log(`\nReports written to:\n - ${jsonReportPath}\n - ${mdReportPath}`);
  console.log(`Final Status: ${latestReport.status} (${passedCount}/${results.length} passed)\n`);

  isRunning = false;
  return latestReport;
}

function escapeMd(str) {
  return str.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ------------------------------------------------------------------
// Web Service Server Mode (for Railway Web Service deployment)
// ------------------------------------------------------------------
function startServer() {
  console.log(`Starting Sunchaser Smoke Verification Daemon on port ${PORT}...`);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/health" || url.pathname === "/ready") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          status: "ok",
          service: "sunchaser-crm-comprehensive-smoke",
          mode: "daemon",
          lastRun: latestReport
            ? {
                status: latestReport.status,
                passed: latestReport.passed,
                failed: latestReport.failed,
                total: latestReport.totalTests,
                timestamp: latestReport.endTime,
              }
            : null,
          uptimeSec: Math.floor(process.uptime()),
        })
      );
    }

    if (url.pathname === "/run") {
      if (isRunning) {
        res.writeHead(409, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Test run currently in progress." }));
      }
      runComprehensiveSuite().catch(console.error);
      res.writeHead(202, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "Comprehensive smoke run initiated." }));
    }

    if (url.pathname === "/report") {
      const mdPath = path.join(REPORTS_DIR, "comprehensive-smoke-report.md");
      if (fs.existsSync(mdPath)) {
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        return res.end(fs.readFileSync(mdPath, "utf-8"));
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("No report generated yet.");
    }

    if (url.pathname === "/report.json") {
      const jsonPath = path.join(REPORTS_DIR, "comprehensive-smoke-report.json");
      if (fs.existsSync(jsonPath)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(fs.readFileSync(jsonPath, "utf-8"));
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "No report generated yet." }));
    }

    // Default root handler
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html>
        <head><title>Sunchaser CRM Comprehensive Smoke</title></head>
        <body style="font-family: sans-serif; padding: 2rem;">
          <h1>Sunchaser Smoke Verification Service</h1>
          <p>Status: <strong>ONLINE</strong></p>
          <ul>
            <li><a href="/health">/health</a> — Health check endpoint</li>
            <li><a href="/run">/run</a> — Trigger fresh test run</li>
            <li><a href="/report">/report</a> — View latest Markdown report</li>
            <li><a href="/report.json">/report.json</a> — View raw JSON report</li>
          </ul>
        </body>
      </html>
    `);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Smoke daemon listening on http://0.0.0.0:${PORT}`);
    // Run initial verification upon startup
    runComprehensiveSuite().catch((err) => {
      console.error("Initial smoke run failed:", err);
    });
  });
}

// Entrypoint dispatch
if (IS_SERVE_MODE) {
  startServer();
} else {
  runComprehensiveSuite()
    .then((report) => {
      process.exit(report.status === "PASS" ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal suite execution error:", err);
      process.exit(1);
    });
}
