// Railway staging parity suite (pre-DNS). Targets the Railway CRM/site origins
// only and refuses Render, Vercel, Supabase or custom production domains.
//
// Output hygiene: prints HTTP statuses, counts, content types and byte sizes
// only. Never prints tokens, passwords, record fields or response bodies.
//
// Write behaviour:
// - Staff checks are GET-only (login itself appends one Railway activity log).
// - Synthetic customer registration writes a Railway-only user/customer that
//   ops/railway-db/cleanup-test-data.py removes before DNS cutover.
// - The website -> CRM lead write runs only with SITE_LEAD_WRITE_CONFIRMED=true.

function requiredRailwayOrigin(name) {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is required.`);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash ||
    !url.hostname.endsWith(".up.railway.app")
  ) {
    throw new Error(`${name} must be a bare https://*.up.railway.app origin.`);
  }
  return url.origin;
}

const CRM = requiredRailwayOrigin("PARITY_RAILWAY_CRM_ORIGIN");
const SITE = requiredRailwayOrigin("PARITY_RAILWAY_SITE_ORIGIN");
const STAFF_USER = String(process.env.PARITY_STAFF_USERNAME || "").trim();
const STAFF_PASS = String(process.env.PARITY_STAFF_PASSWORD || "");
const SITE_LEAD_WRITE = process.env.SITE_LEAD_WRITE_CONFIRMED === "true";

const results = [];
function record(name, status, detail = "") {
  results.push({ name, status });
  console.log(`${status} ${name}${detail ? " :: " + detail : ""}`);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, "PASS", detail || "");
  } catch (error) {
    record(name, "FAIL", (error instanceof Error ? error.message : String(error)).slice(0, 200));
  }
}
function skip(name, reason) {
  record(name, "SKIP", reason);
}

async function request(path, { token, method = "GET", body, origin = CRM } = {}) {
  const headers = { accept: "application/json, text/html, application/pdf" };
  if (token) headers.authorization = "Bearer " + token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(origin + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const type = String(response.headers.get("content-type") || "");
  let json = null;
  if (type.includes("json")) {
    try { json = JSON.parse(buffer.toString("utf8")); } catch { json = null; }
  }
  return { status: response.status, type, bytes: buffer.length, buffer, json };
}

function safeError(res) {
  const message = res.json && typeof res.json.error === "string" ? res.json.error : "";
  return `HTTP ${res.status}${message ? " " + message.slice(0, 120) : ""}`;
}
function rows(value, ...keys) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const key of [...keys, "data", "items", "rows", "results"]) {
    const inner = value[key];
    if (Array.isArray(inner)) return inner;
    if (inner && typeof inner === "object") {
      const nested = rows(inner, ...keys);
      if (nested) return nested;
    }
  }
  return null;
}
function expectOk(res, label = "") {
  if (res.status !== 200) throw new Error(`${label}${safeError(res)}`);
}

// Staff-only GET routes used both for unauthenticated and customer-token denial.
const STAFF_ROUTES = [
  "/api/state",
  "/api/admin/users",
  "/api/admin/roles",
  "/api/admin/invoices",
  "/api/admin/parties",
  "/api/admin/finance/summary",
  "/api/admin/warranty-claims",
  "/api/admin/customer-accounts",
  "/api/leads/deleted",
  "/api/interactive-proposals",
  "/api/inbox/conversations",
  "/api/inbox/admin/whatsapp/connection-status",
  "/api/backup/export",
  "/api/export/customers",
  "/api/diagnostics/db",
];

// ---------------------------------------------------------------- public
await check("CRM /health", async () => {
  const res = await request("/health");
  expectOk(res);
});

await check("Staff routes reject anonymous requests (401)", async () => {
  const bad = [];
  for (const path of STAFF_ROUTES) {
    const res = await request(path);
    if (res.status !== 401) bad.push(`${path}=${res.status}`);
  }
  if (bad.length) throw new Error(bad.join(", "));
  return `${STAFF_ROUTES.length} routes`;
});

await check("Storage proxy rejects unsigned object request", async () => {
  const res = await request("/api/storage/object/documents/" + encodeURIComponent("parity/does-not-exist.pdf"));
  if (res.status === 200) throw new Error("unsigned request returned 200");
  return `HTTP ${res.status}`;
});

await check("Public lead gateway rejects missing API key", async () => {
  const res = await request("/api/public/leads", { method: "POST", body: {} });
  if (res.status !== 401 && res.status !== 403) throw new Error(safeError(res));
  return `HTTP ${res.status}`;
});

await check("Marketplace checkout stays fail-closed", async () => {
  const res = await request("/api/marketplace/checkout", { method: "POST", body: {} });
  if (res.status === 200 || res.status === 201) throw new Error(`HTTP ${res.status}`);
  return `HTTP ${res.status}`;
});

let crmCatalogueCount = 0;
await check("CRM catalogue served from Railway database", async () => {
  const pub = await request("/api/marketplace/catalogue/publication");
  expectOk(pub, "publication ");
  const source = pub.json?.data?.effectivePublicCatalogueSource;
  if (source !== "database") throw new Error("effective source=" + source);
  const res = await request("/api/marketplace/catalogue/products");
  expectOk(res);
  crmCatalogueCount = rows(res.json, "items")?.length || 0;
  if (crmCatalogueCount < 100) throw new Error("products=" + crmCatalogueCount);
  return `products=${crmCatalogueCount} (first page)`;
});

// ---------------------------------------------------------------- website
for (const path of ["/", "/shop", "/solar-panels", "/contact", "/robots.txt", "/sitemap.xml"]) {
  await check(`Website ${path}`, async () => {
    const res = await request(path, { origin: SITE });
    expectOk(res);
    return `${res.bytes} bytes`;
  });
}

await check("Website /shop renders live catalogue (not 30-item static fallback)", async () => {
  const res = await request("/shop", { origin: SITE });
  expectOk(res);
  const html = res.buffer.toString("utf8");
  const productLinks = new Set(html.match(/\/shop\/[a-z0-9][a-z0-9-]{2,}/gi) || []);
  if (productLinks.size <= 30) throw new Error(`distinct product links=${productLinks.size}`);
  return `distinct product links=${productLinks.size}`;
});

await check("Website AI lead gateway validates input before forwarding", async () => {
  const res = await request("/api/ai-lead", { origin: SITE, method: "POST", body: {} });
  if (res.status !== 400) throw new Error(safeError(res));
  return "HTTP 400 on empty payload";
});

// ---------------------------------------------------------------- staff
let staffToken = "";
let staffState = null;
const sample = {};
if (!STAFF_USER || !STAFF_PASS) {
  skip("Staff login with existing account", "PARITY_STAFF_USERNAME/PASSWORD secrets not configured");
} else {
  await check("Staff login with existing account", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: { username: STAFF_USER, password: STAFF_PASS },
    });
    expectOk(res);
    staffToken = String(res.json?.token || "");
    if (!staffToken) throw new Error("token missing");
    return `role=${res.json?.user?.role}`;
  });
  await check("Wrong password is rejected", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: { username: STAFF_USER, password: STAFF_PASS + "-wrong" },
    });
    if (res.status === 200) throw new Error("wrong password accepted");
    return `HTTP ${res.status}`;
  });
}

if (staffToken) {
  await check("Staff /api/auth/me", async () => {
    const res = await request("/api/auth/me", { token: staffToken });
    expectOk(res);
  });

  await check("CRM state loads (clients, leads, quotations, warranties, payments)", async () => {
    const res = await request("/api/state", { token: staffToken });
    expectOk(res);
    staffState = res.json || {};
    const count = (key) => (Array.isArray(staffState[key]) ? staffState[key].length : "n/a");
    sample.quoteLeadId = (staffState.quotations || []).map((q) => q?.leadId || q?.lead_id).find(Boolean);
    sample.leadIds = new Set((staffState.leads || []).map((l) => String(l?.id)));
    return [
      "leads_active=" + count("leads"),
      "quotations=" + count("quotations"),
      "projects=" + count("projects"),
      "paymentTracks=" + count("paymentTracks"),
      "warranties=" + count("warranties"),
      "tickets=" + count("tickets"),
      "activityLogs=" + count("activityLogs"),
      "whatsAppLogs=" + count("whatsAppLogs"),
      "solarPackages=" + count("solarPackages"),
    ].join(" ");
  });

  const staffReads = [
    ["Roles matrix", "/api/auth/roles-matrix", "roles"],
    ["Roles admin", "/api/admin/roles", "roles"],
    ["Users admin", "/api/admin/users", "users"],
    ["Customer accounts (clients)", "/api/admin/customer-accounts", "customers"],
    ["Customer linking (clients)", "/api/admin/customer-linking/customers", "customers"],
    ["Soft-deleted leads", "/api/leads/deleted", "leads"],
    ["Invoices", "/api/admin/invoices", "invoices"],
    ["Contracted-ready invoices", "/api/admin/invoices/contracted-ready", "invoices"],
    ["Party ledger", "/api/admin/parties", "parties"],
    ["Finance summary", "/api/admin/finance/summary", ""],
    ["Finance projects (payments)", "/api/admin/finance/projects", "projects"],
    ["Operations dashboard", "/api/admin/operations/dashboard", ""],
    ["Warranty claims", "/api/admin/warranty-claims", "claims"],
    ["Service requests", "/api/admin/service-requests", "requests"],
    ["Support tickets", "/api/admin/support-tickets", "tickets"],
    ["Project deliveries", "/api/admin/project-deliveries", "deliveries"],
    ["Delivery dashboard", "/api/admin/deliveries/dashboard/summary", ""],
    ["Inventory items", "/api/admin/inventory/items", "items"],
    ["Interactive proposals", "/api/interactive-proposals", "proposals"],
    ["Branding", "/api/admin/branding", ""],
    ["Website catalogue sync status", "/api/admin/website-catalog-sync", ""],
    ["WhatsApp connection status (read-only)", "/api/inbox/admin/whatsapp/connection-status", ""],
    ["Inbox conversations (read-only)", "/api/inbox/conversations", "conversations"],
    ["WhatsApp logs (read-only)", "/api/admin/whatsapp/logs", "logs"],
  ];
  for (const [label, path, key] of staffReads) {
    await check(label, async () => {
      const res = await request(path, { token: staffToken });
      expectOk(res);
      const list = rows(res.json, key);
      if (path === "/api/admin/invoices" && list) {
        sample.invoiceId = list.map((i) => i?.id).find(Boolean);
      }
      if (path === "/api/admin/customer-accounts" && list) {
        sample.customerId = list.map((c) => c?.customerId || c?.customer_id || c?.id).find(Boolean);
      }
      return list ? `rows=${list.length}` : `${res.bytes} bytes`;
    });
  }

  await check("Database backup export", async () => {
    const res = await request("/api/backup/export", { token: staffToken });
    expectOk(res);
    const tables = res.json && typeof res.json === "object" ? Object.keys(res.json).length : 0;
    return `${res.bytes} bytes, top-level keys=${tables}`;
  });

  if (sample.customerId) {
    const id = encodeURIComponent(sample.customerId);
    for (const [label, path] of [
      ["Client documents", `/api/admin/customer-documents/${id}`],
      ["Client systems", `/api/admin/customer-systems/${id}`],
      ["Client portal (staff view)", `/api/customer-portal/${id}`],
    ]) {
      await check(label, async () => {
        const res = await request(path, { token: staffToken });
        expectOk(res);
        return `${res.bytes} bytes`;
      });
    }
  } else {
    skip("Client documents / systems / portal", "no customer id available");
  }

  if (sample.invoiceId) {
    await check("Invoice PDF/print render", async () => {
      const res = await request(`/api/export/pdf/invoice/${encodeURIComponent(sample.invoiceId)}`, { token: staffToken });
      expectOk(res);
      return `${res.type.split(";")[0]} ${res.bytes} bytes`;
    });
  } else {
    skip("Invoice PDF/print render", "no invoice id available");
  }

  if (sample.quoteLeadId) {
    await check("Quotation PDF download (Chromium)", async () => {
      const res = await request(`/api/export/pdf/manual-quote/${encodeURIComponent(sample.quoteLeadId)}/download`, { token: staffToken });
      expectOk(res);
      const isPdf = res.buffer.subarray(0, 5).toString("latin1") === "%PDF-";
      if (res.type.includes("pdf") && !isPdf) throw new Error("content-type pdf but no %PDF- header");
      return `${res.type.split(";")[0]} ${res.bytes} bytes pdfMagic=${isPdf}`;
    });
  } else {
    skip("Quotation PDF download (Chromium)", "no saved quotation found");
  }

  await check("PDF engine launches Chromium", async () => {
    const res = await request("/api/debug/pdf-engine", { token: staffToken });
    expectOk(res);
    if (res.json?.browserLaunchSuccess === false) throw new Error("browserLaunchSuccess=false");
  });
}

// ---------------------------------------------------------------- customer
const stamp = Date.now();
const custUser = "railwayparity" + stamp;
const custPass = "RailwayParity" + stamp + "Zx9";
let custToken = "";
let custId = "";
await check("Synthetic customer registration (Railway only)", async () => {
  const res = await request("/api/auth/register", {
    method: "POST",
    body: {
      username: custUser,
      password: custPass,
      email: custUser + "@example.com",
      name: "Railway Parity Verification",
      role: "Customer",
      phone: "+920000000000",
    },
  });
  if (res.status !== 201) throw new Error(safeError(res));
  custId = String(res.json?.user?.customerId || "");
  if (!custId) throw new Error("customerId missing");
});
await check("Synthetic customer login", async () => {
  const res = await request("/api/auth/login", { method: "POST", body: { username: custUser, password: custPass } });
  expectOk(res);
  custToken = String(res.json?.token || "");
  if (!custToken) throw new Error("token missing");
  if (res.json?.user?.role !== "Customer") throw new Error("role=" + res.json?.user?.role);
});

if (custToken) {
  for (const path of [
    "/api/customer-portal/me",
    "/api/customer-portal/invoices/me",
    "/api/customer-portal/payments/me",
    "/api/customer-portal/warranties/me",
    "/api/customer-portal/documents/me",
    "/api/customer-portal/system/me",
  ]) {
    await check(`Customer portal ${path}`, async () => {
      const res = await request(path, { token: custToken });
      expectOk(res);
    });
  }

  await check("Customer token denied on staff routes (403)", async () => {
    const bad = [];
    for (const path of STAFF_ROUTES) {
      const res = await request(path, { token: custToken });
      if (res.status !== 403) bad.push(`${path}=${res.status}`);
    }
    if (bad.length) throw new Error(bad.join(", "));
    return `${STAFF_ROUTES.length} routes`;
  });

  if (sample.customerId && sample.customerId !== custId) {
    await check("Customer cannot open another client's portal", async () => {
      const res = await request(`/api/customer-portal/${encodeURIComponent(sample.customerId)}`, { token: custToken });
      if (res.status === 200) throw new Error("HTTP 200 for foreign customer");
      return `HTTP ${res.status}`;
    });
  }
  if (sample.invoiceId) {
    await check("Customer cannot open another client's invoice", async () => {
      const res = await request(`/api/export/pdf/invoice/${encodeURIComponent(sample.invoiceId)}`, { token: custToken });
      if (res.status === 200) throw new Error("HTTP 200 for foreign invoice");
      return `HTTP ${res.status}`;
    });
  }
}

// ---------------------------------------------------------------- lead flow
if (!SITE_LEAD_WRITE) {
  skip("Website -> CRM lead creation", "SITE_LEAD_WRITE_CONFIRMED is not true");
} else {
  let leadId = "";
  await check("Website -> CRM lead creation", async () => {
    const res = await request("/api/ai-lead", {
      origin: SITE,
      method: "POST",
      body: {
        name: "Railway Parity Verification " + stamp,
        phone: "+920000000000",
        city: "Lahore",
        customerType: "residential",
        monthlyBill: 1,
        backupRequirement: "none",
        roofType: "other",
        systemPreference: "railway-parity-test",
        consent: true,
        pagePath: "/railway-parity-test",
      },
    });
    if (res.status !== 201 && res.status !== 200) throw new Error(safeError(res) + " code=" + (res.json?.code || ""));
    leadId = String(res.json?.leadId || "");
    if (!leadId) throw new Error("leadId missing");
    console.log("SITE_LEAD_ID " + leadId);
  });
  if (leadId && staffToken) {
    await check("Website lead is visible in Railway CRM", async () => {
      const res = await request("/api/state", { token: staffToken });
      expectOk(res);
      const found = (res.json?.leads || []).some((l) => String(l?.id) === leadId);
      if (!found) throw new Error("lead not found in Railway CRM state (website may still target Render)");
    });
  }
}

const count = (s) => results.filter((r) => r.status === s).length;
console.log(`RAILWAY_PARITY_RESULT pass=${count("PASS")} fail=${count("FAIL")} skip=${count("SKIP")}`);
if (count("FAIL") > 0) process.exit(1);
