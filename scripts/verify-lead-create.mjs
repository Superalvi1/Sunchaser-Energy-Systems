/**
 * Verify Add Solar Lead: unique IDs, Supabase persistence, GET /api/state consistency.
 * Usage: API_BASE=http://localhost:3000 node scripts/verify-lead-create.mjs
 *        API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-lead-create.mjs
 */
const BASE = (process.env.API_BASE || "http://localhost:3000").replace(/\/$/, "");
const TS = Date.now();
const COUNT = 5;

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
  console.log(`\n=== Lead create verify @ ${BASE} ===\n`);

  const diag = await api("GET", "/api/diagnostics/db");
  record(
    "PREFLIGHT",
    diag.status === 200,
    `status=${diag.status} supabaseActive=${diag.json?.supabaseActive}`
  );

  const created = [];
  for (let i = 1; i <= COUNT; i++) {
    const name = `LeadVerify-${TS}-${i}`;
    const email = `leadverify-${TS}-${i}@verify.local`;
    const res = await api("POST", "/api/leads", {
      name,
      email,
      phone: `0300${String(TS).slice(-7)}${i}`,
      address: "Verify address",
      monthlyBill: 15000 + i * 1000,
      location: "Lahore",
      notes: `lead-create verify batch ${TS}`,
    });
    const id = res.json?.id;
    const uuidPart = id?.replace(/^lead-/, "") || "";
    const looksUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuidPart);
    record(
      `CREATE ${i}`,
      res.status === 201 && !!id && looksUuid,
      res.status === 201
        ? `id=${id}`
        : `status=${res.status} body=${res.text?.slice(0, 200)}`
    );
    if (id) created.push({ id, name, email });
  }

  const ids = created.map((c) => c.id);
  const uniqueIds = new Set(ids);
  record(
    "UNIQUE IDS",
    uniqueIds.size === created.length && created.length === COUNT,
    `${uniqueIds.size} unique of ${created.length} created`
  );

  const legacyDup = ids.filter((id) => /^lead-\d+$/.test(id));
  record(
    "NO LEGACY lead-N",
    legacyDup.length === 0,
    legacyDup.length ? `legacy ids: ${legacyDup.join(", ")}` : "all UUID-based"
  );

  const state = await api("GET", "/api/state");
  const stateLeads = state.json?.leads || [];
  const missing = created.filter((c) => !stateLeads.some((l) => l.id === c.id));
  record(
    "GET /api/state",
    state.status === 200 && missing.length === 0,
    missing.length
      ? `missing: ${missing.map((m) => m.id).join(", ")}`
      : `all ${COUNT} leads present (${stateLeads.length} total)`
  );

  if (diag.json?.supabaseActive) {
    record(
      "SUPABASE VIA STATE",
      missing.length === 0,
      missing.length === 0
        ? "GET /api/state reads Supabase; all created leads present"
        : "state missing leads — Supabase insert likely failed"
    );
  } else {
    record("SUPABASE TABLE", true, "skipped (supabase inactive, local JSON mode)");
  }

  printSummary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
