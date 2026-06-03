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

async function login(username, password = "123") {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

let pass = 0;
let total = 0;
let customerId = "cust-demo-portal";

const tables = [
  "customer_portal_profiles",
  "customer_equipment",
  "installation_photos",
  "after_sales_service_logs",
];

total++;
const probeRes = await fetch(`${API}/api/diagnostics/pakistan-aftersales-tables`);
const probeBody = await probeRes.json().catch(() => ({}));
const tablesOk = tables.every((t) => probeBody.probes?.[t]?.ok === true);
console.log(`${tablesOk ? "PASS" : "FAIL"}: Pakistan after-sales tables`);
if (tablesOk) pass++;
else console.log("  hint: run scripts/client-portal-pakistan-aftersales-schema.sql in Supabase");

const portal = await login("portalclient");
if (portal.body?.user?.id) {
  const { id, username } = portal.body.user;
  customerId = portal.body.user.customerId || customerId;

  total++;
  const meRes = await fetch(`${API}/api/customer-portal/me`, {
    method: "POST",
    headers: headers(id, username),
    body: JSON.stringify({ userId: id, username }),
  });
  const meBody = await meRes.json().catch(() => ({}));
  const hasTracker = Array.isArray(meBody.tracker?.stages) && meBody.tracker.stages.length >= 4;
  console.log(`${hasTracker ? "PASS" : "FAIL"}: portal tracker loads (${meBody.tracker?.trackerType || "default"})`);
  if (hasTracker) pass++;

  const staff = await login("sales");
  if (staff.body?.user?.id) {
    const sid = staff.body.user.id;
    const su = staff.body.user.username;

    total++;
    const profRes = await fetch(`${API}/api/admin/customer-portal-profile`, {
      method: "POST",
      headers: headers(sid, su),
      body: JSON.stringify({
        customerId,
        trackerType: "residential",
        freeServiceMonths: 6,
      }),
    });
    const profOk = profRes.ok;
    console.log(`${profOk ? "PASS" : "FAIL"}: staff sets residential profile`);
    if (profOk) pass++;

    total++;
    const eqRes = await fetch(`${API}/api/admin/customer-equipment`, {
      method: "POST",
      headers: headers(sid, su),
      body: JSON.stringify({
        customerId,
        equipmentType: "breakers",
        brand: "Schneider",
        model: "MCB-32A",
        serialNumber: "BRK-VERIFY-1",
      }),
    });
    const eqOk = eqRes.ok;
    console.log(`${eqOk ? "PASS" : "FAIL"}: staff adds equipment`);
    if (eqOk) pass++;

    total++;
    const photoRes = await fetch(`${API}/api/admin/installation-photos`, {
      method: "POST",
      headers: headers(sid, su),
      body: JSON.stringify({
        customerId,
        photoCategory: "panels",
        photoUrl: "https://example.com/panel-install.jpg",
      }),
    });
    console.log(`${photoRes.ok ? "PASS" : "FAIL"}: staff adds installation photo`);
    if (photoRes.ok) pass++;

    total++;
    const logRes = await fetch(`${API}/api/admin/after-sales-service-log`, {
      method: "POST",
      headers: headers(sid, su),
      body: JSON.stringify({
        customerId,
        serviceType: "Breaker changed",
        componentChanged: "Main breaker",
        newComponentDetails: "32A MCB replaced",
        underFreeService: true,
        customerVisibleNotes: "Breaker changed during free service visit.",
        technicianName: "Verify Tech",
      }),
    });
    console.log(`${logRes.ok ? "PASS" : "FAIL"}: staff logs breaker change`);
    if (logRes.ok) pass++;
  }

  total++;
  const eqMe = await fetch(`${API}/api/customer-portal/equipment/me`, { headers: headers(id, username) });
  const eqBody = await eqMe.json().catch(() => ({}));
  console.log(`${eqMe.ok && Array.isArray(eqBody.equipment) ? "PASS" : "FAIL"}: customer sees equipment`);
  if (eqMe.ok) pass++;

  total++;
  const phMe = await fetch(`${API}/api/customer-portal/installation-photos/me`, { headers: headers(id, username) });
  const phBody = await phMe.json().catch(() => ({}));
  console.log(`${phMe.ok && Array.isArray(phBody.photos) ? "PASS" : "FAIL"}: customer sees installation photos`);
  if (phMe.ok) pass++;

  total++;
  const histRes = await fetch(`${API}/api/customer-portal/service-history/me`, { headers: headers(id, username) });
  const histBody = await histRes.json().catch(() => ({}));
  const histOk =
    histRes.ok &&
    Array.isArray(histBody.logs) &&
    histBody.freeService &&
    typeof histBody.freeService.status === "string";
  console.log(`${histOk ? "PASS" : "FAIL"}: customer service history + free service`);
  if (histOk) pass++;

  total++;
  const claimRes = await fetch(`${API}/api/customer-portal/warranty-claim`, {
    method: "POST",
    headers: headers(id, username),
    body: JSON.stringify({
      component: "Inverter",
      issueDescription: "Pakistan verify warranty claim",
      photoUrl: "https://example.com/issue.jpg",
      videoUrl: "https://example.com/issue.mp4",
    }),
  });
  console.log(`${claimRes.ok ? "PASS" : "FAIL"}: warranty claim creates ticket`);
  if (claimRes.ok) pass++;

  for (const route of ["documents/me", "service/me", "savings/me", "care/me"]) {
    total++;
    const r = await fetch(`${API}/api/customer-portal/${route}`, { headers: headers(id, username) });
    console.log(`${r.ok ? "PASS" : "FAIL"}: regression ${route}`);
    if (r.ok) pass++;
  }
}

console.log(`\nPakistan after-sales: ${pass}/${total} passed`);
const p6 = spawnSync("node", ["scripts/verify-client-portal-phase6.mjs"], { cwd: repoRoot, encoding: "utf8" });
if (p6.stdout) console.log(p6.stdout);
process.exit(pass === total && (p6.status === 0 || !tablesOk) ? 0 : 1);
