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
let customerId = "cust-101";

const phase8Tables = ["customer_energy_devices", "energy_alerts"];
total++;
const probeRes = await fetch(`${API}/api/diagnostics/phase8-tables`);
const probeBody = await probeRes.json().catch(() => ({}));
const tablesOk = phase8Tables.every((t) => probeBody.probes?.[t]?.ok === true);
console.log(`${tablesOk ? "PASS" : "FAIL"}: phase 8 tables (${probeRes.status})`);
if (tablesOk) pass++;
else console.log("  hint: run scripts/client-portal-phase8-schema.sql in Supabase SQL Editor");

total++;
const portal = await login("portalclient");
const portalOk = portal.ok && portal.body.user?.role === "Customer";
console.log(`${portalOk ? "PASS" : "FAIL"}: portalclient login`);
if (portalOk) pass++;

if (portal.body?.user?.id) {
  const { id, username } = portal.body.user;
  customerId = portal.body.user.customerId || customerId;

  const staff = await login("sales");
  if (staff.body?.user?.id && tablesOk) {
    const sid = staff.body.user.id;
    const su = staff.body.user.username;
    const serial = `GW-PH8-${Date.now()}`;

    total++;
    const regRes = await fetch(`${API}/api/admin/energy/devices`, {
      method: "POST",
      headers: headers(sid, su),
      body: JSON.stringify({
        customerId,
        brand: "GoodWe",
        deviceSerial: serial,
        plantId: "plant-phase8-verify",
        unitRatePkr: 55,
      }),
    });
    const regBody = await regRes.json().catch(() => ({}));
    const regOk = regRes.ok && regBody.brand === "GoodWe" && regBody.deviceSerial === serial;
    console.log(`${regOk ? "PASS" : "FAIL"}: staff registers GoodWe device (${regRes.status})`);
    if (regOk) pass++;

    total++;
    const monRes = await fetch(
      `${API}/api/admin/energy/monitoring?userId=${encodeURIComponent(sid)}&username=${encodeURIComponent(su)}`,
      { headers: headers(sid, su) }
    );
    const mon = await monRes.json().catch(() => ({}));
    const monOk =
      monRes.ok &&
      typeof mon.onlineCount === "number" &&
      (mon.customers || []).some((c) => c.customerId === customerId);
    console.log(`${monOk ? "PASS" : "FAIL"}: staff energy monitoring desk`);
    if (monOk) pass++;
  }

  total++;
  const energyRes = await fetch(`${API}/api/customer-portal/energy/me`, {
    headers: headers(id, username),
  });
  const energy = await energyRes.json().catch(() => ({}));
  const energyOk =
    energyRes.ok &&
    Array.isArray(energy.devices) &&
    energy.reading &&
    typeof energy.reading.solarPower === "number" &&
    typeof energy.reading.batterySOC === "number" &&
    energy.savings?.fromLiveData === true &&
    typeof energy.savings.dailySavingsPkr === "number";
  console.log(`${energyOk ? "PASS" : "FAIL"}: customer energy dashboard (${energyRes.status})`);
  if (energyOk) pass++;

  total++;
  const hasUnified =
    energyOk &&
    ["solarPower", "loadPower", "batterySOC", "gridImport", "gridExport", "todayGeneration", "monthGeneration", "lifetimeGeneration"].every(
      (k) => typeof energy.reading[k] === "number"
    );
  console.log(`${hasUnified ? "PASS" : "FAIL"}: unified adapter reading shape`);
  if (hasUnified) pass++;

  total++;
  let regPass = true;
  for (const route of ["documents/me", "service/me", "savings/me", "care/me", "equipment/me"]) {
    const r = await fetch(`${API}/api/customer-portal/${route}`, { headers: headers(id, username) });
    if (!r.ok) regPass = false;
  }
  console.log(`${regPass ? "PASS" : "FAIL"}: Phase 1–7 portal regressions (sample routes)`);
  if (regPass) pass++;
}

console.log(`\nPhase 8 verification: ${pass}/${total} passed`);

const phase7 = spawnSync("node", ["scripts/verify-client-portal-phase7.mjs"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (phase7.stdout) console.log(phase7.stdout);
process.exit(pass === total && phase7.status === 0 ? 0 : 1);
