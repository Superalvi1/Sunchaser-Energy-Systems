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

const headers = (userId, username) => ({
  "Content-Type": "application/json",
  "X-Sunchaser-User-Id": userId,
  "X-Sunchaser-Username": username,
});

async function login(username) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123" }),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

let pass = 0;
let total = 0;
let customerId = "cust-demo-portal";

total++;
const colProbe = await fetch(`${API}/api/diagnostics/phase7-columns`);
const colBody = await colProbe.json().catch(() => ({}));
const colOk = colBody.probes?.phase7_columns?.ok === true;
console.log(`${colOk ? "PASS" : "FAIL"}: Phase 7 columns on after_sales_service_logs`);
if (colOk) pass++;
else console.log("  hint: run scripts/client-portal-phase7-schema.sql");

const portal = await login("portalclient");
if (portal.body?.user?.id) {
  const { id, username } = portal.body.user;
  customerId = portal.body.user.customerId || customerId;

  const staff = await login("sales");
  if (staff.body?.user?.id) {
    const sid = staff.body.user.id;
    const su = staff.body.user.username;

    total++;
    const recRes = await fetch(`${API}/api/admin/maintenance-records`, {
      method: "POST",
      headers: headers(sid, su),
      body: JSON.stringify({
        customerId,
        serviceType: "Breaker Replacement",
        description: "Main breaker replaced — Phase 7 verify",
        replacementParts: "32A MCB Schneider",
        warrantyCovered: true,
        performanceImprovementPct: 12,
        beforePhotoUrl: "https://example.com/before-brk.jpg",
        afterPhotoUrl: "https://example.com/after-brk.jpg",
        technicianName: "Phase 7 Tech",
      }),
    });
    console.log(`${recRes.ok ? "PASS" : "FAIL"}: staff creates maintenance record`);
    if (recRes.ok) pass++;
  }

  total++;
  const histRes = await fetch(`${API}/api/customer-portal/service-history/me`, {
    headers: headers(id, username),
  });
  const hist = await histRes.json().catch(() => ({}));
  const histOk =
    histRes.ok &&
    Array.isArray(hist.timeline) &&
    hist.summary &&
    typeof hist.summary.totalVisits === "number" &&
    hist.timeline.some((r) => r.serviceType === "Breaker Replacement");
  console.log(`${histOk ? "PASS" : "FAIL"}: customer timeline + dashboard summary`);
  if (histOk) pass++;

  total++;
  const meRes = await fetch(`${API}/api/customer-portal/me`, {
    method: "POST",
    headers: headers(id, username),
    body: JSON.stringify({ userId: id, username }),
  });
  const me = await meRes.json().catch(() => ({}));
  const residential = me.tracker?.trackerType === "residential" && me.tracker?.stages?.length === 4;
  console.log(`${residential ? "PASS" : "FAIL"}: residential tracker (4 stages)`);
  if (residential) pass++;

  for (const route of ["documents/me", "service/me", "savings/me", "care/me", "equipment/me"]) {
    total++;
    const r = await fetch(`${API}/api/customer-portal/${route}`, { headers: headers(id, username) });
    console.log(`${r.ok ? "PASS" : "FAIL"}: regression ${route}`);
    if (r.ok) pass++;
  }
}

console.log(`\nPhase 7 verification: ${pass}/${total} passed`);
const pak = spawnSync("node", ["scripts/verify-client-portal-pakistan-aftersales.mjs"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (pak.stdout) console.log(pak.stdout);
process.exit(pass === total && pak.status === 0 ? 0 : 1);
