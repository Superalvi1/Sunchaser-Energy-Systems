import dotenv from "dotenv";

const root = new URL("..", import.meta.url).pathname;
dotenv.config({ path: `${root}/.env.local` });

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

function isValidSummary(summary) {
  if (!summary || typeof summary !== "object") return false;
  const status = summary.status ?? summary.serviceStatus;
  return (
    typeof summary.lastCleaningDate !== "undefined" &&
    typeof summary.nextRecommendedCleaningDate !== "undefined" &&
    typeof status === "string" &&
    typeof summary.openRequestsCount === "number" &&
    Array.isArray(summary.availableServiceTypes) &&
    summary.availableServiceTypes.length >= 5 &&
    (summary.latestRequest === null || typeof summary.latestRequest === "object")
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
let createdRequestId = null;

total++;
const phase4Probe = await fetch(`${API}/api/diagnostics/phase4-tables`);
const phase4Body = await phase4Probe.json().catch(() => ({}));
const tableOk = phase4Body.probes?.service_requests?.ok === true;
console.log(
  `${tableOk ? "PASS" : "FAIL"}: service_requests table on production (${phase4Probe.status})`
);
if (tableOk) pass++;
else if (phase4Probe.status === 404) {
  console.log("  hint: deploy latest main so /api/diagnostics/phase4-tables exists");
} else if (!tableOk) {
  console.log("  hint: run scripts/client-portal-phase4-schema.sql in Supabase SQL Editor");
}

total++;
const portal = await login("portalclient");
const portalOk = portal.ok && portal.body.user?.role === "Customer";
console.log(`${portalOk ? "PASS" : "FAIL"}: portalclient login (${portal.status})`);
if (portalOk) pass++;

if (portal.body?.user?.id) {
  const { id, username } = portal.body.user;

  total++;
  const summaryRes = await fetch(`${API}/api/customer-portal/service/me`, {
    headers: headers(id, username),
  });
  const summaryBody = await summaryRes.json().catch(() => ({}));
  const summaryOk =
    summaryRes.ok &&
    isValidSummary(summaryBody.summary) &&
    Array.isArray(summaryBody.requests);
  console.log(
    `${summaryOk ? "PASS" : "FAIL"}: service summary endpoint (${summaryRes.status})`
  );
  if (!summaryOk && summaryRes.ok) {
    console.log("  response keys:", Object.keys(summaryBody).join(", "));
    if (summaryBody.summary) console.log("  summary keys:", Object.keys(summaryBody.summary).join(", "));
  }
  if (summaryOk) pass++;

  total++;
  const createRes = await fetch(`${API}/api/customer-portal/service-requests`, {
    method: "POST",
    headers: headers(id, username),
    body: JSON.stringify({
      serviceType: "Cleaning",
      preferredDate: "2026-07-01",
      preferredTime: "Morning (8am–12pm)",
      notes: "Phase 4 verify service request",
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  createdRequestId = created.id || null;
  const createOk = createRes.status === 201 && created.id && created.status === "Submitted";
  console.log(`${createOk ? "PASS" : "FAIL"}: portalclient creates service request (${createRes.status})`);
  if (!createOk && createRes.status !== 201) {
    console.log("  error:", created.error || created.message || JSON.stringify(created).slice(0, 200));
  }
  if (createOk) pass++;

  if (createdRequestId) {
    total++;
    const detailRes = await fetch(
      `${API}/api/customer-portal/service-requests/${encodeURIComponent(createdRequestId)}`,
      { headers: headers(id, username) }
    );
    const detailBody = await detailRes.json().catch(() => ({}));
    const detailOk = detailRes.ok && detailBody.request?.id === createdRequestId;
    console.log(`${detailOk ? "PASS" : "FAIL"}: portalclient reads own request detail`);
    if (detailOk) pass++;

    total++;
    const staffLogin = await login("sales");
    const blockedRes = await fetch(
      `${API}/api/customer-portal/service-requests/${encodeURIComponent(createdRequestId)}`,
      { headers: headers(staffLogin.body.user?.id, staffLogin.body.user?.username) }
    );
    const blocked = blockedRes.status === 403;
    console.log(`${blocked ? "PASS" : "FAIL"}: staff blocked from customer service detail (${blockedRes.status})`);
    if (blocked) pass++;

    if (staffLogin.body?.user?.id) {
      total++;
      const adminList = await fetch(
        `${API}/api/admin/service-requests?userId=${encodeURIComponent(staffLogin.body.user.id)}&username=${encodeURIComponent(staffLogin.body.user.username)}`,
        { headers: headers(staffLogin.body.user.id, staffLogin.body.user.username) }
      );
      const adminBody = await adminList.json().catch(() => ({}));
      const adminOk =
        adminList.ok && adminBody.requests?.some((r) => r.id === createdRequestId);
      console.log(`${adminOk ? "PASS" : "FAIL"}: staff service desk lists request`);
      if (adminOk) pass++;

      total++;
      const patchRes = await fetch(
        `${API}/api/admin/service-requests/${encodeURIComponent(createdRequestId)}`,
        {
          method: "PATCH",
          headers: headers(staffLogin.body.user.id, staffLogin.body.user.username),
          body: JSON.stringify({
            status: "Scheduled",
            assignedTechnician: "Verify Tech",
            scheduledVisitDate: "2026-07-05",
          }),
        }
      );
      const patched = await patchRes.json().catch(() => ({}));
      const patchOk = patchRes.ok && patched.status === "Scheduled";
      console.log(`${patchOk ? "PASS" : "FAIL"}: staff schedules service visit`);
      if (patchOk) pass++;
    }
  } else {
    console.log("SKIP: detail/admin tests (no created request id)");
  }

  total++;
  const supportRes = await fetch(`${API}/api/customer-portal/support-tickets/me`, {
    headers: headers(id, username),
  });
  console.log(`${supportRes.ok ? "PASS" : "FAIL"}: support center still works (${supportRes.status})`);
  if (supportRes.ok) pass++;
}

console.log(`\nPhase 4 verification: ${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
