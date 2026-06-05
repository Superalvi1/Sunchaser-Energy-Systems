#!/usr/bin/env node
/**
 * Phantom quote fix verification (API-level).
 * Usage: node scripts/verify-phantom-quote-fix.mjs [baseUrl]
 */
const BASE = process.argv[2] || process.env.API_BASE_URL || "http://localhost:3000";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function pass(id, msg) {
  results.push({ id, ok: true, msg });
  console.log(`PASS ${id}: ${msg}`);
}
function fail(id, msg) {
  results.push({ id, ok: false, msg });
  console.log(`FAIL ${id}: ${msg}`);
}

const leadName = `PhantomTest1-${Date.now()}`;
let leadId = "";
let manualQuoteId = "";

try {
  const created = await api("POST", "/api/leads", {
    name: leadName,
    email: "phantom@test.com",
    phone: "03001234567",
    monthlyUnits: 900,
    location: "Lahore",
  });
  if (created.status !== 201 || !created.json?.id) {
    fail("1", `Lead create failed status=${created.status}`);
  } else {
    leadId = created.json.id;
    const quoteCount = (created.json.quotes || []).length;
    quoteCount === 0
      ? pass("1", `Lead ${leadId} created with zero quotes`)
      : fail("1", `Lead created with ${quoteCount} quote(s) unexpectedly`);
  }

  const auto5 = await api("POST", `/api/leads/${leadId}/create-quote`, {
    quote_type: "auto_sizer",
    source: "autosizer",
    systemSizekW: 5,
    panelCount: 9,
    panelType: "Jinko 580W",
    inverterType: "Knox 5kW",
    totalCost: 100000,
    boqRows: [
      { id: "row-1", type: "item", name: "Panels", qty: 9, rate: 10000, total: 90000 },
    ],
    boqItems: [
      { id: "row-1", type: "item", name: "Panels", qty: 9, rate: 10000, total: 90000 },
    ],
  });
  if (auto5.status >= 400) {
    fail("2a", `5kW autosizer save failed: ${auto5.text?.slice(0, 120)}`);
  } else {
    pass("2a", "5kW autosizer quote saved");
  }

  await sleep(4500);
  const autoQuoteId = auto5.json?.quotes?.[0]?.id;
  const auto10 = await api("POST", `/api/leads/${leadId}/update-quote`, {
    quoteId: autoQuoteId,
    quote_type: "auto_sizer",
    systemSizekW: 10,
    panelCount: 18,
    boqRows: [
      { id: "row-1", type: "item", name: "Panels", qty: 18, rate: 10000, total: 180000 },
    ],
    boqItems: [
      { id: "row-1", type: "item", name: "Panels", qty: 18, rate: 10000, total: 180000 },
    ],
  });
  const latestAuto = auto10.json?.quotes?.[0];
  Number(latestAuto?.systemSizekW) === 10
    ? pass("2", "Latest autosizer quote is 10kW after update")
    : fail("2", `Expected 10kW, got ${latestAuto?.systemSizekW}`);

  await sleep(4500);
  const emptyManual = await api("POST", `/api/leads/${leadId}/create-quote`, {
    quote_type: "manual_boq",
    systemSizekW: 8,
    boqRows: [],
    boqItems: [],
  });
  emptyManual.status === 400
    ? pass("3", "Empty manual quote rejected (new quote stays empty until explicit save)")
    : fail("3", `Empty manual quote should be rejected, got ${emptyManual.status}`);

  await sleep(4500);
  const manualSave = await api("POST", `/api/leads/${leadId}/create-quote`, {
    quote_type: "manual_boq",
    source: "manual",
    systemSizekW: 8,
    panelCount: 12,
    totalCost: 300000,
    boqRows: [
      { id: "m1", type: "item", name: "Item A", qty: 1, rate: 100000, total: 100000 },
      { id: "m2", type: "item", name: "Item B", qty: 1, rate: 100000, total: 100000 },
      { id: "m3", type: "item", name: "Item C", qty: 1, rate: 100000, total: 100000 },
    ],
    boqItems: [
      { id: "m1", type: "item", name: "Item A", qty: 1, rate: 100000, total: 100000 },
      { id: "m2", type: "item", name: "Item B", qty: 1, rate: 100000, total: 100000 },
      { id: "m3", type: "item", name: "Item C", qty: 1, rate: 100000, total: 100000 },
    ],
  });
  manualQuoteId = manualSave.json?.quotes?.find((q) => q.quote_type === "manual_boq")?.id;
  const itemCount = (manualSave.json?.quotes?.find((q) => q.id === manualQuoteId)?.boqRows || []).filter(
    (r) => r.type === "item"
  ).length;
  itemCount === 3
    ? pass("4", "Manual quote saved with exactly 3 items")
    : fail("4", `Expected 3 items, got ${itemCount}`);

  const pdf = await api("GET", `/api/export/pdf/manual-quote/${leadId}?quoteId=${manualQuoteId}`);
  const itemMatches = (pdf.text.match(/Item [ABC]/g) || []).length;
  itemMatches === 3
    ? pass("5", "PDF contains exactly 3 manual items")
    : fail("5", `PDF item mentions=${itemMatches}, expected 3`);

  const pdfLatest = await api("GET", `/api/export/pdf/manual-quote/${leadId}`);
  pdfLatest.status === 200 && pdfLatest.text.includes("Item A")
    ? pass("5b", "PDF without quoteId uses latest saved quote")
    : fail("5b", `Latest-quote PDF failed status=${pdfLatest.status}`);

  const freshLead = await api("POST", "/api/leads", {
    name: `PhantomEmpty-${Date.now()}`,
    email: "empty@test.com",
    phone: "03009999999",
  });
  const emptyLeadId = freshLead.json?.id;
  const pdfEmpty = await api("GET", `/api/export/pdf/manual-quote/${emptyLeadId}`);
  pdfEmpty.status === 404 || pdfEmpty.text.includes("Save a quote first")
    ? pass("5c", "PDF blocked when lead has no saved quote")
    : fail("5c", `Expected blocked PDF for empty lead, status=${pdfEmpty.status}`);

  await sleep(4500);
  const updateOne = await api("POST", `/api/leads/${leadId}/update-quote`, {
    quoteId: manualQuoteId,
    quote_type: "manual_boq",
    boqRows: [
      { id: "m1", type: "item", name: "Item A edited", qty: 1, rate: 100000, total: 100000 },
      { id: "m2", type: "item", name: "Item B", qty: 1, rate: 100000, total: 100000 },
      { id: "m3", type: "item", name: "Item C", qty: 1, rate: 100000, total: 100000 },
    ],
    boqItems: [
      { id: "m1", type: "item", name: "Item A edited", qty: 1, rate: 100000, total: 100000 },
      { id: "m2", type: "item", name: "Item B", qty: 1, rate: 100000, total: 100000 },
      { id: "m3", type: "item", name: "Item C", qty: 1, rate: 100000, total: 100000 },
    ],
  });
  const edited = updateOne.json?.quotes?.find((q) => q.id === manualQuoteId);
  edited?.boqRows?.[0]?.name === "Item A edited"
    ? pass("6", "Edited manual quote persisted")
    : fail("6", "Edited quote did not persist");

  const state = await api("GET", "/api/state");
  const reloaded = state.json?.leads?.find((l) => l.id === leadId);
  const phantomOnReload = (reloaded?.quotes || []).filter((q) => {
    const rows = q.boqRows || q.boqItems || [];
    return rows.filter((r) => r.type === "item").length === 0;
  }).length;
  phantomOnReload === 0
    ? pass("7", "No zero-item phantom quotes after reload")
    : fail("7", `Found ${phantomOnReload} zero-item quotes after reload`);
} catch (err) {
  fail("X", `Unhandled error: ${err.message}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nSummary: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
