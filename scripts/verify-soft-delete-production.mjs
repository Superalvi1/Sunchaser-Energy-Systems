/**
 * Production verification: soft delete leads (commit 83a84ce)
 * Usage: API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-soft-delete-production.mjs
 */
const BASE = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
const TS = Date.now();
const TEST_NAME = "DeleteTest1";
const TEST_EMAIL = `deletetest1-${TS}@verify.local`;
const TEST_PHONE = "03007770001";

const SA_HEADERS = {
  "Content-Type": "application/json",
  "X-Sunchaser-User-Id": "u-allauddin",
  "X-Sunchaser-Username": "allauddin",
  "X-Sunchaser-Role": "Super Admin",
};

const results = [];

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${detail}`);
}

async function api(method, path, body, headers = { "Content-Type": "application/json" }) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
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

function findLead(leads, id) {
  return (leads || []).find((l) => l.id === id);
}

function findByName(leads, name) {
  return (leads || []).find((l) => l.name === name);
}

async function main() {
  console.log(`\n=== Soft-delete production verify @ ${BASE} ===\n`);

  const diag = await api("GET", "/api/diagnostics/db");
  record(
    "PREFLIGHT",
    diag.status === 200 && diag.json?.supabaseActive === true,
    `supabaseActive=${diag.json?.supabaseActive} bundle deploy check pending`
  );

  // 1. Create DeleteTest1
  const create = await api("POST", "/api/leads", {
    name: TEST_NAME,
    email: TEST_EMAIL,
    phone: TEST_PHONE,
    address: "Production verify address",
    monthlyBill: 20000,
    location: "Lahore",
    notes: `soft-delete verify ${TS}`,
  });
  const leadId = create.json?.id;
  record(
    "1 CREATE",
    create.status === 201 && !!leadId,
    create.status === 201 ? `id=${leadId}` : `status=${create.status} body=${create.text?.slice(0, 200)}`
  );
  if (!leadId) {
    printSummary();
    process.exit(1);
  }

  const stateAfterCreate = await api("GET", "/api/state");
  const visibleAfterCreate = findLead(stateAfterCreate.json?.leads, leadId);
  record(
    "1b CREATE visible in /api/state",
    !!visibleAfterCreate,
    visibleAfterCreate ? `name=${visibleAfterCreate.name}` : "lead missing from active list"
  );

  // 2. Delete lead
  const del = await api("DELETE", `/api/leads/${leadId}`);
  record(
    "2 DELETE",
    del.status === 200 && del.json?.softDeleted === true,
    `status=${del.status} softDeleted=${del.json?.softDeleted} deletedBy=${del.json?.deletedBy || "n/a"}`
  );

  // 3. Refresh check
  const stateRefresh = await api("GET", "/api/state");
  const goneRefresh = !findLead(stateRefresh.json?.leads, leadId);
  record(
    "3 REFRESH",
    stateRefresh.status === 200 && goneRefresh,
    goneRefresh ? "lead absent from active list" : `lead still visible id=${leadId}`
  );

  // 4. Logout/login simulation (second state fetch)
  await new Promise((r) => setTimeout(r, 1500));
  const stateLogin = await api("GET", "/api/state");
  const goneLogin = !findLead(stateLogin.json?.leads, leadId);
  record(
    "4 LOGOUT/LOGIN",
    stateLogin.status === 200 && goneLogin,
    goneLogin ? "lead still absent after re-fetch" : "lead reappeared"
  );

  // 5 & 6. Deleted leads recovery list (proves deleted_at in Supabase)
  const deletedList = await api("GET", "/api/leads/deleted", null, SA_HEADERS);
  const deletedRow = (deletedList.json?.leads || []).find((l) => l.id === leadId);
  record(
    "5 SUPABASE deleted_at",
    deletedList.status === 200 && !!deletedRow?.deletedAt,
    deletedRow?.deletedAt
      ? `deletedAt=${deletedRow.deletedAt} deletedBy=${deletedRow.deletedBy || "n/a"}`
      : `status=${deletedList.status} found=${!!deletedRow} err=${deletedList.json?.error || ""}`
  );
  record(
    "6 DELETED LEADS API",
    deletedList.status === 200 && Array.isArray(deletedList.json?.leads),
    `count=${(deletedList.json?.leads || []).length}`
  );

  // 8. Same phone/email while soft-deleted (before restore)
  const createDup = await api("POST", "/api/leads", {
    name: `${TEST_NAME}-Resubmit`,
    email: TEST_EMAIL,
    phone: TEST_PHONE,
    address: "Duplicate contact verify",
    monthlyBill: 18000,
    location: "Lahore",
  });
  const dupId = createDup.json?.id;
  record(
    "8 SAME PHONE/EMAIL (while deleted)",
    createDup.status === 201 && !!dupId && dupId !== leadId,
    createDup.status === 201 ? `newId=${dupId}` : `status=${createDup.status} ${createDup.text?.slice(0, 150)}`
  );

  // Clean up duplicate test lead (soft delete)
  if (dupId) {
    await api("DELETE", `/api/leads/${dupId}`);
  }

  // 7. Restore original lead
  const restore = await api("POST", `/api/leads/${leadId}/restore`, { role: "Super Admin" }, SA_HEADERS);
  const stateAfterRestore = await api("GET", "/api/state");
  const backAfterRestore = findLead(stateAfterRestore.json?.leads, leadId);
  record(
    "7 RESTORE",
    restore.status === 200 && !!backAfterRestore,
    restore.status === 200
      ? `lead visible again name=${backAfterRestore?.name}`
      : `restore status=${restore.status} visible=${!!backAfterRestore}`
  );

  // Final cleanup: soft-delete restored test lead
  await api("DELETE", `/api/leads/${leadId}`);

  printSummary();
  const failed = results.filter((r) => !r.ok).length;
  process.exit(failed > 0 ? 1 : 0);
}

function printSummary() {
  console.log("\n=== SUMMARY ===");
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} passed`);
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  FAIL: ${r.step} — ${r.detail}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
