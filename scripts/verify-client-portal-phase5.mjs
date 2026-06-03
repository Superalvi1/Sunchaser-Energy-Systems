import dotenv from "dotenv";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(root, "..");
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const API = (
  process.env.VITE_API_BASE_URL ||
  process.env.API_BASE_URL ||
  "https://sunchaser-energy-systems.onrender.com"
).replace(/\/$/, "");

const headers = (userId, username, extra = {}) => ({
  "Content-Type": "application/json",
  "X-Sunchaser-User-Id": userId,
  "X-Sunchaser-Username": username,
  ...extra,
});

function isValidDashboard(d) {
  if (!d || typeof d !== "object") return false;
  return (
    d.todayGeneration?.display &&
    d.monthGeneration?.display &&
    d.lifetimeGeneration?.display &&
    d.savingsThisMonth?.display &&
    d.lifetimeSavings?.display &&
    d.co2SavedKg?.display &&
    typeof d.treesEquivalent === "number" &&
    typeof d.performanceStatus === "string" &&
    typeof d.systemSizeKw === "number"
  );
}

async function login(username, password = "123") {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

let pass = 0;
let total = 0;
let customerId = null;

total++;
const probeRes = await fetch(`${API}/api/diagnostics/phase5-tables`);
const probeRaw = await probeRes.text();
let probeBody = {};
try {
  probeBody = JSON.parse(probeRaw);
} catch {
  probeBody = {};
}
const tableOk = probeBody.probes?.customer_savings_profiles?.ok === true;
console.log(`${tableOk ? "PASS" : "FAIL"}: customer_savings_profiles table (${probeRes.status})`);
if (tableOk) pass++;
else if (probeRaw.includes("<!doctype html")) {
  console.log("  hint: deploy latest main first");
} else {
  console.log("  hint: run scripts/client-portal-phase5-schema.sql in Supabase SQL Editor");
}

total++;
const portal = await login("portalclient");
const portalOk = portal.ok && portal.body.user?.role === "Customer";
console.log(`${portalOk ? "PASS" : "FAIL"}: portalclient login`);
if (portalOk) pass++;

if (portal.body?.user?.id) {
  const { id, username } = portal.body.user;

  total++;
  const savingsRes = await fetch(`${API}/api/customer-portal/savings/me`, {
    headers: headers(id, username),
  });
  const savingsBody = await savingsRes.json().catch(() => ({}));
  customerId = savingsBody.customerId || portal.body.user.customerId || "cust-demo-portal";
  const savingsOk = savingsRes.ok && isValidDashboard(savingsBody.dashboard);
  console.log(`${savingsOk ? "PASS" : "FAIL"}: customer savings dashboard loads (${savingsRes.status})`);
  if (savingsOk) pass++;

  const staffLogin = await login("sales");
  if (staffLogin.body?.user?.id && customerId) {
    total++;
    const upsertRes = await fetch(`${API}/api/admin/customer-savings`, {
      method: "POST",
      headers: headers(staffLogin.body.user.id, staffLogin.body.user.username),
      body: JSON.stringify({
        customerId,
        systemSizeKw: 10,
        unitRate: 60,
        manualTodayGeneration: 42,
        manualMonthGeneration: 1200,
        lifetimeGeneration: 15000,
        performanceStatus: "Excellent",
        notes: "Phase 5 verify profile",
      }),
    });
    const upsertBody = await upsertRes.json().catch(() => ({}));
    const upsertOk =
      upsertRes.ok &&
      upsertBody.dashboard?.savingsThisMonth?.value === 1200 * 60;
    console.log(`${upsertOk ? "PASS" : "FAIL"}: staff upserts savings profile (${upsertRes.status})`);
    if (upsertOk) pass++;

    total++;
    const afterRes = await fetch(`${API}/api/customer-portal/savings/me`, {
      headers: headers(id, username),
    });
    const afterBody = await afterRes.json().catch(() => ({}));
    const customerSeesOk =
      afterRes.ok &&
      afterBody.dashboard?.todayGeneration?.value === 42 &&
      afterBody.dashboard?.performanceStatus === "Excellent";
    console.log(`${customerSeesOk ? "PASS" : "FAIL"}: customer sees updated savings`);
    if (customerSeesOk) pass++;
  }

  total++;
  const docsRes = await fetch(`${API}/api/customer-portal/documents/me`, {
    headers: headers(id, username),
  });
  console.log(`${docsRes.ok ? "PASS" : "FAIL"}: Phase 2 documents still work`);
  if (docsRes.ok) pass++;

  total++;
  const serviceRes = await fetch(`${API}/api/customer-portal/service/me`, {
    headers: headers(id, username),
  });
  console.log(`${serviceRes.ok ? "PASS" : "FAIL"}: Phase 4 service still works`);
  if (serviceRes.ok) pass++;
}

console.log(`\nPhase 5 verification: ${pass}/${total} passed`);

const phase4 = spawnSync("node", ["scripts/verify-client-portal-phase4.mjs"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (phase4.stdout) console.log(phase4.stdout);
if (phase4.status !== 0) {
  console.log("Phase 4 regression: FAIL");
  process.exit(1);
}
console.log("Phase 4 regression: PASS");
process.exit(pass === total ? 0 : 1);
