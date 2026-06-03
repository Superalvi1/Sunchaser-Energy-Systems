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

function isValidCarePayload(d) {
  if (!d || typeof d !== "object") return false;
  if (!Array.isArray(d.plans) || d.plans.length < 3) return false;
  const names = d.plans.map((p) => p.name);
  return (
    names.includes("Care Basic") &&
    names.includes("Care Premium") &&
    names.includes("Total Peace Of Mind") &&
    d.plans.every(
      (p) =>
        typeof p.monthlyPrice === "number" &&
        Array.isArray(p.features) &&
        p.features.length > 0
    )
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
let hadActiveSub = false;
let staffLogin = null;

total++;
const probeRes = await fetch(`${API}/api/diagnostics/phase6-tables`);
const probeBody = await probeRes.json().catch(() => ({}));
const phase6Tables = [
  "subscription_plans",
  "customer_subscriptions",
  "subscription_payments",
  "service_visit_reports",
  "service_visit_photos",
];
const tablesOk = phase6Tables.every((t) => probeBody.probes?.[t]?.ok === true);
console.log(`${tablesOk ? "PASS" : "FAIL"}: phase 6 tables (${probeRes.status})`);
if (tablesOk) pass++;
else {
  console.log("  hint: run scripts/client-portal-phase6-schema.sql in Supabase SQL Editor");
}

total++;
const portal = await login("portalclient");
const portalOk = portal.ok && portal.body.user?.role === "Customer";
console.log(`${portalOk ? "PASS" : "FAIL"}: portalclient login`);
if (portalOk) pass++;

if (portal.body?.user?.id) {
  const { id, username } = portal.body.user;

  total++;
  const careRes = await fetch(`${API}/api/customer-portal/care/me`, {
    headers: headers(id, username),
  });
  const careBody = await careRes.json().catch(() => ({}));
  customerId = careBody.customerId || portal.body.user.customerId || "cust-demo-portal";
  hadActiveSub = !!careBody.subscription;
  const careOk = careRes.ok && isValidCarePayload(careBody);
  console.log(`${careOk ? "PASS" : "FAIL"}: care plans catalog loads (${careRes.status})`);
  if (careOk) pass++;

  staffLogin = await login("sales");
  if (staffLogin.body?.user?.id) {
    const staffId = staffLogin.body.user.id;
    const staffUser = staffLogin.body.user.username;

    total++;
    const revRes = await fetch(
      `${API}/api/admin/care/revenue-summary?userId=${encodeURIComponent(staffId)}&username=${encodeURIComponent(staffUser)}`,
      { headers: headers(staffId, staffUser) }
    );
    const revBody = await revRes.json().catch(() => ({}));
    const revOk =
      revRes.ok &&
      typeof revBody.activePlans === "number" &&
      typeof revBody.monthlyRecurringRevenue === "number";
    console.log(`${revOk ? "PASS" : "FAIL"}: staff revenue summary (${revRes.status})`);
    if (revOk) pass++;

    total++;
    const listRes = await fetch(
      `${API}/api/admin/care/subscriptions?segment=active&userId=${encodeURIComponent(staffId)}&username=${encodeURIComponent(staffUser)}`,
      { headers: headers(staffId, staffUser) }
    );
    const listOk = listRes.ok && Array.isArray((await listRes.json().catch(() => ({}))).subscriptions);
    console.log(`${listOk ? "PASS" : "FAIL"}: staff active subscribers list`);
    if (listOk) pass++;
  }

  if (!hadActiveSub && tablesOk) {
    total++;
    const subRes = await fetch(`${API}/api/customer-portal/care/subscribe`, {
      method: "POST",
      headers: headers(id, username),
      body: JSON.stringify({ planCode: "care_basic" }),
    });
    const subBody = await subRes.json().catch(() => ({}));
    const subOk = subRes.ok && subBody.status === "Active" && subBody.planCode === "care_basic";
    console.log(`${subOk ? "PASS" : "FAIL"}: customer subscribes to Care Basic (${subRes.status})`);
    if (subOk) pass++;
    hadActiveSub = subOk;
  } else if (hadActiveSub) {
    total++;
    console.log("PASS: customer already has active subscription (skip subscribe)");
    pass++;
  }

  if (hadActiveSub && tablesOk) {
    total++;
    const reqRes = await fetch(`${API}/api/customer-portal/care/service-request`, {
      method: "POST",
      headers: headers(id, username),
      body: JSON.stringify({ requestType: "cleaning" }),
    });
    const reqBody = await reqRes.json().catch(() => ({}));
    const reqOk = reqRes.ok && reqBody.request?.serviceType === "Cleaning";
    console.log(`${reqOk ? "PASS" : "FAIL"}: care visit creates service request (${reqRes.status})`);
    if (reqOk) pass++;

    if (staffLogin?.body?.user?.id && customerId) {
      total++;
      const rptRes = await fetch(`${API}/api/admin/care/visit-reports`, {
        method: "POST",
        headers: headers(staffLogin.body.user.id, staffLogin.body.user.username),
        body: JSON.stringify({
          customerId,
          technician: "Phase 6 Verify Tech",
          visitDate: new Date().toISOString().slice(0, 10),
          beforePhotoUrl: "https://example.com/before.jpg",
          afterPhotoUrl: "https://example.com/after.jpg",
          performanceImprovementNotes: "Generation improved after panel cleaning.",
        }),
      });
      const rptOk = rptRes.ok;
      console.log(`${rptOk ? "PASS" : "FAIL"}: staff creates visit report (${rptRes.status})`);
      if (rptOk) pass++;

      total++;
      const afterCare = await fetch(`${API}/api/customer-portal/care/me`, {
        headers: headers(id, username),
      });
      const afterBody = await afterCare.json().catch(() => ({}));
      const reportsOk =
        afterCare.ok &&
        Array.isArray(afterBody.visitReports) &&
        afterBody.visitReports.some((r) => r.beforePhotoUrl && r.afterPhotoUrl);
      console.log(`${reportsOk ? "PASS" : "FAIL"}: customer sees visit reports`);
      if (reportsOk) pass++;
    }
  }

  total++;
  const savingsRes = await fetch(`${API}/api/customer-portal/savings/me`, {
    headers: headers(id, username),
  });
  console.log(`${savingsRes.ok ? "PASS" : "FAIL"}: Phase 5 savings regression`);
  if (savingsRes.ok) pass++;

  total++;
  const serviceRes = await fetch(`${API}/api/customer-portal/service/me`, {
    headers: headers(id, username),
  });
  console.log(`${serviceRes.ok ? "PASS" : "FAIL"}: Phase 4 service regression`);
  if (serviceRes.ok) pass++;
}

console.log(`\nPhase 6 verification: ${pass}/${total} passed`);

const phase5 = spawnSync("node", ["scripts/verify-client-portal-phase5.mjs"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (phase5.stdout) console.log(phase5.stdout);
if (phase5.status !== 0) {
  console.log("Phase 5 regression: FAIL");
  process.exit(1);
}
console.log("Phase 5 regression: PASS");
process.exit(pass === total ? 0 : 1);
