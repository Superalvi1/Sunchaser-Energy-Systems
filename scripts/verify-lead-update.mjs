/**
 * Verify lead status update persists via PUT /api/leads/:id and GET /api/state.
 * Usage: API_BASE=http://localhost:3000 node scripts/verify-lead-update.mjs
 *        API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-lead-update.mjs
 */
const BASE = (process.env.API_BASE || "http://localhost:3000").replace(/\/$/, "");
const TS = Date.now();

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
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json, text };
}

function printSummary() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

async function main() {
  console.log(`\n=== Lead update verify @ ${BASE} ===\n`);

  const diag = await api("GET", "/api/diagnostics/db");
  record(
    "PREFLIGHT",
    diag.status === 200,
    `status=${diag.status} supabaseActive=${diag.json?.supabaseActive}`
  );

  const create = await api("POST", "/api/leads", {
    name: `LeadUpdateVerify-${TS}`,
    email: `leadupdate-${TS}@verify.local`,
    phone: `0300${String(TS).slice(-7)}`,
    address: "Verify address",
    monthlyBill: 12000,
    location: "Lahore",
    notes: `lead-update verify ${TS}`,
  });
  const leadId = create.json?.id;
  record(
    "CREATE LEAD",
    create.status === 201 && !!leadId,
    create.status === 201 ? `id=${leadId} status=${create.json?.status}` : `status=${create.status} body=${create.text?.slice(0, 200)}`
  );
  if (!leadId) {
    printSummary();
    return;
  }

  const update = await api("PUT", `/api/leads/${leadId}`, { status: "Contacted" });
  record(
    "PUT STATUS Contacted",
    update.status === 200 && update.json?.status === "Contacted",
    update.status === 200
      ? `status=${update.json?.status}`
      : `status=${update.status} body=${update.text?.slice(0, 200)}`
  );

  const state = await api("GET", "/api/state");
  const lead = (state.json?.leads || []).find((l) => l.id === leadId);
  record(
    "GET /api/state PERSIST",
    state.status === 200 && lead?.status === "Contacted",
    lead ? `status=${lead.status}` : "lead missing from state"
  );

  printSummary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
