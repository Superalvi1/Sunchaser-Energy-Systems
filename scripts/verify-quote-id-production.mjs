/**
 * Production verification: collision-safe quote IDs (commit 496dbe8)
 * Usage: API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-quote-id-production.mjs
 */
const BASE = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
const TS = Date.now();
const UUID_QUOTE_ID = /^q-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_COUNT_ID = /^q-\d+$/;

const results = [];

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${detail}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json, text };
}

function boqRows() {
  return [
    { type: "item", description: "Panels", qty: 12, rate: 10000, amount: 120000 },
    { type: "item", description: "Inverter", qty: 1, rate: 80000, amount: 80000 },
    { type: "item", description: "Installation", qty: 1, rate: 50000, amount: 50000 },
  ];
}

function quotePayload() {
  return {
    systemSizekW: 7.2,
    panelCount: 12,
    totalCost: 250000,
    grandTotal: 250000,
    netTotal: 250000,
    boqRows: boqRows(),
    boqItems: boqRows(),
    quote_type: "manual_boq",
    idempotencyKey: `verify-${TS}-${Math.random().toString(36).slice(2)}`,
    clientName: `QuoteVerify ${TS}`,
    clientPhone: "03009990001",
    clientEmail: `quote-verify-${TS}@verify.local`,
    clientAddress: "Production quote verify",
    cityArea: "Lahore",
  };
}

async function fetchBundleSignals() {
  const res = await fetch(`${BASE}/server.cjs`);
  if (!res.ok) {
    return { ok: false, detail: `server.cjs HTTP ${res.status}` };
  }
  const body = await res.text();
  const hasNew = body.includes("generateQuotationId") || body.includes("randomUUID");
  const hasOld = body.includes("(lead.quotes || []).length + 1");
  return {
    ok: true,
    size: body.length,
    hasNew,
    hasOld,
    bundleReady: hasNew && !hasOld,
  };
}

async function main() {
  console.log(`\n=== Quote ID production verify @ ${BASE} ===\n`);

  const health = await api("GET", "/health");
  record("HEALTH", health.status === 200 && health.json?.status === "ok", `status=${health.status}`);

  const bundle = await fetchBundleSignals();
  record(
    "BUNDLE",
    bundle.ok && bundle.bundleReady,
    bundle.ok
      ? `size=${bundle.size} generateQuotationId=${bundle.hasNew} oldCountScheme=${bundle.hasOld}`
      : bundle.detail
  );

  const createLead = await api("POST", "/api/leads", {
    name: `QuoteVerifyLead ${TS}`,
    email: `quote-verify-lead-${TS}@verify.local`,
    phone: `0300${String(TS).slice(-7)}`,
    address: "Quote verify lead",
    monthlyBill: 25000,
    location: "Lahore",
    notes: `quote-id verify ${TS}`,
  });
  const leadId = createLead.json?.id;
  record(
    "CREATE_LEAD",
    createLead.status === 201 && !!leadId,
    createLead.status === 201 ? `id=${leadId}` : `status=${createLead.status} ${createLead.text?.slice(0, 200)}`
  );
  if (!leadId) {
    printSummary();
    process.exit(1);
  }

  const quoteIds = [];
  for (let i = 1; i <= 5; i++) {
    if (i > 1) await new Promise((r) => setTimeout(r, 4500));
    const payload = quotePayload();
    const save = await api("POST", `/api/leads/${leadId}/create-quote`, payload);
    const latest = save.json?.quotes?.[0];
    const id = latest?.id;
    const uuidOk = !!id && UUID_QUOTE_ID.test(id);
    const legacy = !!id && LEGACY_COUNT_ID.test(id);
    const duplicateErr =
      save.status === 409 ||
      save.status === 500 ||
      /duplicate key|quotations_pkey/i.test(save.text || "");
    const ok = save.status === 200 && uuidOk && !legacy && !duplicateErr;
    if (ok && id) quoteIds.push(id);
    record(
      `QUOTE_${i}`,
      ok,
      ok
        ? `id=${id}`
        : `status=${save.status} id=${id || "none"} legacy=${legacy} err=${save.text?.slice(0, 180)}`
    );
  }

  const unique = new Set(quoteIds);
  record(
    "UNIQUE_IDS",
    quoteIds.length === 5 && unique.size === 5,
    `count=${quoteIds.length} unique=${unique.size}`
  );

  printSummary(quoteIds, bundle);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

function printSummary(quoteIds = [], bundle = null) {
  console.log("\n--- REPORT ---");
  console.log(`production_api: ${BASE}`);
  console.log(`bundle_size: ${bundle?.size ?? "unknown"}`);
  console.log(`bundle_has_uuid_generator: ${bundle?.hasNew ?? "unknown"}`);
  console.log(`bundle_has_old_count_scheme: ${bundle?.hasOld ?? "unknown"}`);
  console.log(`generated_quote_ids: ${quoteIds.length ? quoteIds.join(", ") : "none"}`);
  console.log(`overall: ${results.every((r) => r.ok) ? "PASS" : "FAIL"}`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
