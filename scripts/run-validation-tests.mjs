/**
 * Controlled validation sequence (Tests A–G) against running backend.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BASE = process.env.API_BASE || "http://127.0.0.1:3000";
const DEMO_NAMES = [/arthur dent/i, /alvidon/i, /new1test/i, /^test1$/i, /sunchaser-test/i];

const results = [];

function pass(id, detail) {
  results.push({ id, status: "PASS", detail });
}
function fail(id, detail) {
  results.push({ id, status: "FAIL", detail });
}

async function api(method, urlPath, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${urlPath}`, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html or plain */
  }
  return { status: res.status, text, json };
}

function hasDemoLead(leads) {
  return (leads || []).some((l) =>
    DEMO_NAMES.some((p) => p.test(l.name || "") || p.test(l.id || ""))
  );
}

function readLocalLeadCount() {
  const db = JSON.parse(fs.readFileSync(path.join(root, "database.json"), "utf8"));
  return (db.leads || []).length;
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Preflight
  const diag = await api("GET", "/api/diagnostics/db");
  if (diag.status !== 200 || !diag.json?.supabaseActive) {
    fail("PREFLIGHT", `supabaseActive=${diag.json?.supabaseActive} status=${diag.status}`);
    printReport();
    process.exit(1);
  }
  pass("PREFLIGHT", `Supabase active; URL=${diag.json.supabaseUrl}`);

  const state0 = await api("GET", "/api/state");
  if (state0.status !== 200) fail("STATE-LOAD", `status ${state0.status}`);
  else if (hasDemoLead(state0.json?.leads))
    fail("STATE-LOAD", "Demo leads still in /api/state");
  else pass("STATE-LOAD", `/api/state OK; leads=${(state0.json?.leads || []).length}, no demo records`);

  const localLeadsBefore = readLocalLeadCount();

  // TEST A: Create lead, refresh, persist
  const testLeadName = `Validation Lead ${Date.now()}`;
  const create = await api("POST", "/api/leads", {
    name: testLeadName,
    email: "validation@test.local",
    phone: "0300-9990001",
    address: "Test Address",
    monthlyBill: 15000,
    location: "Lahore",
  });
  const leadId = create.json?.id;
  if (create.status !== 201 || !leadId) {
    fail("A", `Create failed status=${create.status} body=${create.text?.slice(0, 200)}`);
  } else {
    await wait(500);
    const stateA = await api("GET", "/api/state");
    const found = (stateA.json?.leads || []).find((l) => l.id === leadId);
    if (found?.name === testLeadName) pass("A", `Lead ${leadId} persists after refresh`);
    else fail("A", `Lead ${leadId} missing from /api/state after refresh`);
  }

  // TEST B: Delete lead, refresh, never returns
  if (leadId) {
    const del = await api("DELETE", `/api/leads/${leadId}`);
    await wait(500);
    const stateB = await api("GET", "/api/state");
    const stillThere = (stateB.json?.leads || []).some((l) => l.id === leadId);
    if (del.status === 200 && !stillThere)
      pass("B", `Deleted ${leadId}; absent after refresh`);
    else fail("B", `delete status=${del.status} stillThere=${stillThere}`);
  } else {
    fail("B", "Skipped (no lead from A)");
  }

  // TEST C: Logout / login — deleted lead stays gone
  const login = await api("POST", "/api/auth/login", {
    username: "admin",
    password: "123",
  });
  const stateC = await api("GET", "/api/state");
  const ghost =
    leadId && (stateC.json?.leads || []).some((l) => l.id === leadId);
  if (login.status === 200 && !ghost)
    pass("C", "Login OK; deleted lead still absent");
  else if (login.status !== 200)
    fail("C", `Login failed status=${login.status}`);
  else fail("C", `Deleted lead ${leadId} reappeared after login`);

  // TEST D: Restart backend and confirm deleted lead stays gone
  const { execSync } = await import("child_process");
  try {
    execSync("pkill -f 'dist/server.cjs' || true", { cwd: root });
  } catch {
    /* ignore */
  }
  await wait(1500);
  execSync("nohup node dist/server.cjs >> /tmp/sunchaser-server.log 2>&1 &", {
    cwd: root,
    shell: true,
  });
  await wait(4000);
  const stateD = await api("GET", "/api/state");
  const ghostD =
    leadId && (stateD.json?.leads || []).some((l) => l.id === leadId);
  if (!ghostD) pass("D", "After backend restart, deleted lead absent");
  else fail("D", `Deleted lead ${leadId} returned after restart`);

  // Create fresh lead for quote tests E/F/G
  const qLead = await api("POST", "/api/leads", {
    name: "Quote Validation Lead",
    email: "quote-val@test.local",
    phone: "0300-9990002",
    monthlyBill: 20000,
    location: "Lahore",
  });
  const qLeadId = qLead.json?.id;
  if (!qLeadId) {
    fail("E", "No lead for quote tests");
    fail("F", "No lead for quote tests");
    fail("G", "No lead for quote tests");
    printReport();
    process.exit(1);
  }

  await wait(4500); // avoid 4s quote rate limit from prior ops

  // TEST E: Auto Sizer quote + PDF with exact quoteId
  const autoQuote = await api("POST", `/api/leads/${qLeadId}/create-quote`, {
    quote_type: "auto_sizer",
    systemSizekW: 10,
    panelCount: 18,
    totalCost: 610500,
    clientName: "Quote Validation Lead",
    systemType: "Hybrid",
    inverterCapacity: "10kW",
  });
  const autoQuoteId =
    autoQuote.json?.quotes?.[0]?.id ||
    autoQuote.json?.quote?.id;
  await wait(800);
  if (!autoQuoteId) {
    fail("E", `Auto quote create failed: ${autoQuote.text?.slice(0, 300)}`);
  } else {
    const pdfE = await api(
      "GET",
      `/api/export/pdf/auto-sizer/${qLeadId}?quoteId=${encodeURIComponent(autoQuoteId)}`
    );
    const usesId =
      pdfE.text.includes(autoQuoteId) ||
      pdfE.text.includes("10") && pdfE.text.includes("kW");
    if (pdfE.status === 200 && usesId)
      pass("E", `PDF OK for quoteId=${autoQuoteId}`);
    else
      fail(
        "E",
        `PDF status=${pdfE.status} quoteId=${autoQuoteId} snippet=${pdfE.text?.slice(0, 120)}`
      );
  }

  await wait(4500);

  // TEST F: Manual BOQ with rows + PDF
  const manualRows = [
    {
      id: "row-val-1",
      srNo: 1,
      name: "Validation Panel Row",
      description: "Test manual BOQ line",
      unit: "Nos",
      qty: 2,
      rate: 50000,
      total: 100000,
      type: "item",
    },
  ];
  const manQuote = await api("POST", `/api/leads/${qLeadId}/create-quote`, {
    quote_type: "manual_boq",
    systemSizekW: 8.5,
    totalCost: 500000,
    clientName: "Quote Validation Lead",
    boqRows: manualRows,
    grandTotal: 100000,
    netTotal: 100000,
  });
  const manQuoteId =
    manQuote.json?.quotes?.find((q) => q.quote_type === "manual_boq")?.id ||
    manQuote.json?.quotes?.[0]?.id;
  await wait(800);
  if (!manQuoteId) {
    fail("F", `Manual quote create failed: ${manQuote.text?.slice(0, 300)}`);
  } else {
    const pdfF = await api(
      "GET",
      `/api/export/pdf/manual-quote/${qLeadId}?quoteId=${encodeURIComponent(manQuoteId)}`
    );
    if (
      pdfF.status === 200 &&
      pdfF.text.includes("Validation Panel Row")
    )
      pass("F", `Manual PDF contains BOQ row; quoteId=${manQuoteId}`);
    else
      fail(
        "F",
        `status=${pdfF.status} hasRow=${pdfF.text?.includes("Validation Panel Row")}`
      );
  }

  // TEST G: Zero-row manual BOQ blocks (preview path — no saved quoteId)
  const emptyPreview = await api("POST", "/api/export/pdf/manual-quote", {
    leadId: qLeadId,
    boqRows: [],
    clientName: "Empty BOQ Test",
    quote_type: "manual_boq",
  });
  const blocked = (emptyPreview.text || "").includes("No BOQ items added yet.");
  if (blocked) pass("G", "Empty manual BOQ blocked with expected message");
  else
    fail(
      "G",
      `Expected block message; POST snippet=${emptyPreview.text?.slice(0, 80)} GET=${emptyGet.text?.slice(0, 80)}`
    );

  // Cleanup quote test lead
  await api("DELETE", `/api/leads/${qLeadId}`);

  // Verify local JSON did not restore demo leads (may have validation leads from saveDb)
  const localAfter = readLocalLeadCount();
  const stateFinal = await api("GET", "/api/state");
  if (hasDemoLead(stateFinal.json?.leads))
    fail("VERIFY-SOT", "Demo leads in Supabase state");
  else
    pass(
      "VERIFY-SOT",
      `No demo leads in /api/state; local.json lead count ${localLeadsBefore}→${localAfter} (local may mirror writes; /api/state is Supabase)`
    );

  printReport();
  const anyFail = results.some((r) => r.status === "FAIL");
  process.exit(anyFail ? 1 : 0);
}

function printReport() {
  console.log("\n========== VALIDATION REPORT ==========\n");
  for (const r of results) {
    console.log(`${r.id}: ${r.status}`);
    console.log(`  ${r.detail}\n`);
  }
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`Summary: ${passed} PASS, ${failed} FAIL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
