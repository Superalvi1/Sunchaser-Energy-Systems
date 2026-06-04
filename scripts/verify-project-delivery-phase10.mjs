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
  return { ok: res.ok, body: await res.json().catch(() => ({})), status: res.status };
}

let pass = 0;
let total = 0;
let deliveryId = "";
let customerId = "cust-101";

total++;
const probeRes = await fetch(`${API}/api/diagnostics/phase10-tables`);
const probeBody = await probeRes.json().catch(() => ({}));
const tables = [
  "project_deliveries",
  "project_delivery_items",
  "project_installed_equipment",
  "project_installation_photos",
  "project_delivery_updates",
];
const schemaOk = probeBody.phase10Ready === true || tables.every((t) => probeBody.probes?.[t]?.ok === true);
console.log(`${schemaOk ? "PASS" : "FAIL"}: phase10 schema probes (${probeRes.status})`);
if (!schemaOk) {
  console.log("  hint: run scripts/client-portal-phase10-schema.sql in Supabase");
}
if (schemaOk) pass++;

let adminLogin = await login("allauddin");
if (!adminLogin.ok) adminLogin = await login("admin");
if (!adminLogin.ok) adminLogin = await login("sales");
const adminUser = adminLogin.body.user;

const techLogin = await login("technician");
const techUser = techLogin.body.user;
const portalLogin = await login("portalclient");
const portalUser = portalLogin.body.user;
if (portalUser?.customerId) customerId = portalUser.customerId;

total++;
let createdOk = false;
if (adminUser?.id && techUser?.id) {
  const createRes = await fetch(`${API}/api/admin/project-deliveries`, {
    method: "POST",
    headers: headers(adminUser.id, adminUser.username),
    body: JSON.stringify({
      customerId,
      projectTitle: `Phase 10 verify ${Date.now()}`,
      systemType: "Hybrid",
      projectType: "Residential",
      systemSizeKw: 10,
      assignedTechnicianUserId: techUser.id,
      installationAddress: "Verify Site Lahore",
      expectedInstallationDate: new Date().toISOString().slice(0, 10),
      deliveryStatus: "Order Confirmed",
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  deliveryId = created.id || "";
  createdOk = createRes.status === 201 && !!deliveryId;
}
console.log(`${createdOk ? "PASS" : "FAIL"}: admin creates delivery project (${customerId})`);
if (createdOk) pass++;

total++;
let itemsOk = false;
if (deliveryId && adminUser?.id) {
  const itemsRes = await fetch(`${API}/api/admin/project-deliveries/${encodeURIComponent(deliveryId)}/items`, {
    method: "POST",
    headers: headers(adminUser.id, adminUser.username),
    body: JSON.stringify({
      items: [
        { itemCategory: "Inverter", brand: "GoodWe", model: "GW10K-ET", quantity: 1, capacity: "10kW" },
      ],
    }),
  });
  itemsOk = itemsRes.ok;
}
console.log(`${itemsOk ? "PASS" : "FAIL"}: admin adds planned materials`);
if (itemsOk) pass++;

total++;
let techSees = false;
if (deliveryId && techUser?.id) {
  const listRes = await fetch(`${API}/api/technical/project-deliveries/me`, {
    headers: headers(techUser.id, techUser.username),
  });
  const listBody = await listRes.json().catch(() => ({}));
  techSees = listRes.ok && (listBody.deliveries || []).some((d) => d.id === deliveryId);
}
console.log(`${techSees ? "PASS" : "FAIL"}: technician sees assigned delivery`);
if (techSees) pass++;

total++;
let equipOk = false;
if (deliveryId && techUser?.id) {
  const eqRes = await fetch(
    `${API}/api/technical/project-deliveries/${encodeURIComponent(deliveryId)}/installed-equipment`,
    {
      method: "POST",
      headers: headers(techUser.id, techUser.username),
      body: JSON.stringify({
        equipmentType: "Inverter",
        brand: "GoodWe",
        model: "GW10K-ET",
        serialNumber: `GW-PH10-${Date.now()}`,
        capacity: "10kW",
        quantity: 1,
      }),
    }
  );
  const eqBody = await eqRes.json().catch(() => ({}));
  equipOk = eqRes.ok && eqBody.equipment?.serialNumber;
}
console.log(`${equipOk ? "PASS" : "FAIL"}: technician adds inverter with serial`);
if (equipOk) pass++;

total++;
let photoOk = false;
if (deliveryId && techUser?.id) {
  const phRes = await fetch(
    `${API}/api/technical/project-deliveries/${encodeURIComponent(deliveryId)}/photos`,
    {
      method: "POST",
      headers: headers(techUser.id, techUser.username),
      body: JSON.stringify({
        photoCategory: "Inverter photo",
        photoUrl: "https://example.com/phase10-inverter.jpg",
      }),
    }
  );
  photoOk = phRes.ok;
}
console.log(`${photoOk ? "PASS" : "FAIL"}: technician uploads installation photo`);
if (photoOk) pass++;

total++;
let completeOk = false;
if (deliveryId && techUser?.id) {
  const stRes = await fetch(
    `${API}/api/technical/project-deliveries/${encodeURIComponent(deliveryId)}/status`,
    {
      method: "PATCH",
      headers: headers(techUser.id, techUser.username),
      body: JSON.stringify({ status: "Installation Completed" }),
    }
  );
  completeOk = stRes.ok;
}
console.log(`${completeOk ? "PASS" : "FAIL"}: technician marks installation completed`);
if (completeOk) pass++;

total++;
let progressOk = false;
if (portalUser?.id) {
  const pdRes = await fetch(`${API}/api/customer-portal/project-delivery/me`, {
    headers: headers(portalUser.id, portalUser.username),
  });
  const pdBody = await pdRes.json().catch(() => ({}));
  progressOk =
    pdRes.ok &&
    pdBody.delivery?.id === deliveryId &&
    Array.isArray(pdBody.progress?.steps) &&
    pdBody.progress.steps.length > 0;
}
console.log(`${progressOk ? "PASS" : "FAIL"}: customer sees delivery progress`);
if (progressOk) pass++;

total++;
let installedOk = false;
if (portalUser?.id) {
  const pdRes = await fetch(`${API}/api/customer-portal/project-delivery/me`, {
    headers: headers(portalUser.id, portalUser.username),
  });
  const pdBody = await pdRes.json().catch(() => ({}));
  installedOk =
    pdRes.ok && (pdBody.installedEquipment || []).some((e) => String(e.serialNumber || "").includes("GW-PH10"));
}
console.log(`${installedOk ? "PASS" : "FAIL"}: customer sees installed equipment`);
if (installedOk) pass++;

total++;
let custPhotoOk = false;
if (portalUser?.id) {
  const pdRes = await fetch(`${API}/api/customer-portal/project-delivery/me`, {
    headers: headers(portalUser.id, portalUser.username),
  });
  const pdBody = await pdRes.json().catch(() => ({}));
  custPhotoOk = pdRes.ok && (pdBody.photos || []).length > 0;
}
console.log(`${custPhotoOk ? "PASS" : "FAIL"}: customer sees installation photo`);
if (custPhotoOk) pass++;

total++;
let warrantyOk = false;
if (portalUser?.id) {
  const wRes = await fetch(`${API}/api/customer-portal/warranties/me`, {
    headers: headers(portalUser.id, portalUser.username),
  });
  const wBody = await wRes.json().catch(() => ({}));
  const cards = wBody.cards || [];
  warrantyOk =
    wRes.ok &&
    cards.some(
      (c) =>
        (c.warranty?.brand || "").toLowerCase().includes("goodwe") ||
        (c.warranty?.model || "").toLowerCase().includes("gw10")
    );
}
console.log(`${warrantyOk ? "PASS" : "FAIL"}: warranty record auto-created`);
if (warrantyOk) pass++;

total++;
let regPass = true;
if (portalUser?.id) {
  for (const route of ["documents/me", "service/me", "care/me", "energy/me", "project-delivery/me"]) {
    const r = await fetch(`${API}/api/customer-portal/${route}`, {
      headers: headers(portalUser.id, portalUser.username),
    });
    if (!r.ok) regPass = false;
  }
}
const phase9Probe = await fetch(`${API}/api/diagnostics/phase9-tables`);
const phase9Tables = (await phase9Probe.json().catch(() => ({}))).probes?.phase9_schema_ready;
console.log(
  `${regPass && phase9Tables ? "PASS" : "FAIL"}: portal routes + phase9 schema still ready`
);
if (regPass && phase9Tables) pass++;

console.log(`\nPhase 10 verification: ${pass}/${total} passed`);

const phase9 = spawnSync("node", ["scripts/verify-technical-staff-phase9.mjs"], {
  cwd: repoRoot,
  encoding: "utf8",
  env: { ...process.env, VERIFY_CHAIN: "0" },
});
if (phase9.stdout) console.log(phase9.stdout);
process.exit(pass === total && phase9.status === 0 ? 0 : 1);
