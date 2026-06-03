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
const portal = await login("portalclient");
const portalOk = portal.ok && portal.body.user?.role === "Customer";
console.log(`${portalOk ? "PASS" : "FAIL"}: portalclient login (${portal.status})`);
if (portalOk) pass++;

if (portal.body?.user?.id) {
  const { id, username } = portal.body.user;

  total++;
  const summaryRes = await fetch(
    `${API}/api/customer-portal/service/me?userId=${encodeURIComponent(id)}&username=${encodeURIComponent(username)}`,
    { headers: headers(id, username) }
  );
  const summaryBody = await summaryRes.json().catch(() => ({}));
  const summaryOk =
    summaryRes.ok &&
    summaryBody.summary &&
    typeof summaryBody.summary.serviceStatus === "string" &&
    Array.isArray(summaryBody.requests);
  console.log(
    `${summaryOk ? "PASS" : "FAIL"}: service summary endpoint (${summaryRes.status})`
  );
  if (summaryOk) pass++;

  total++;
  const createRes = await fetch(`${API}/api/customer-portal/service-requests`, {
    method: "POST",
    headers: headers(id, username),
    body: JSON.stringify({
      userId: id,
      username,
      serviceType: "Cleaning",
      preferredDate: "2026-07-01",
      preferredTime: "Morning (8am–12pm)",
      notes: "Phase 4 verify service request",
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  createdRequestId = created.id;
  const createOk = createRes.status === 201 && created.id && created.status === "Submitted";
  console.log(`${createOk ? "PASS" : "FAIL"}: portalclient creates service request (${createRes.status})`);
  if (createOk) pass++;

  total++;
  const detailRes = await fetch(
    `${API}/api/customer-portal/service-requests/${encodeURIComponent(createdRequestId || "x")}?userId=${encodeURIComponent(id)}&username=${encodeURIComponent(username)}`,
    { headers: headers(id, username) }
  );
  const detailBody = await detailRes.json().catch(() => ({}));
  const detailOk = detailRes.ok && detailBody.request?.id === createdRequestId;
  console.log(`${detailOk ? "PASS" : "FAIL"}: portalclient reads own request detail`);
  if (detailOk) pass++;

  total++;
  const staffLogin = await login("sales");
  const blockedRes = await fetch(
    `${API}/api/customer-portal/service-requests/${encodeURIComponent(createdRequestId || "x")}?userId=${encodeURIComponent(staffLogin.body.user?.id || "x")}&username=${encodeURIComponent(staffLogin.body.user?.username || "x")}`,
    { headers: headers(staffLogin.body.user?.id, staffLogin.body.user?.username) }
  );
  const blocked = blockedRes.status === 403;
  console.log(`${blocked ? "PASS" : "FAIL"}: staff blocked from customer service detail`);
  if (blocked) pass++;

  total++;
  const supportRes = await fetch(
    `${API}/api/customer-portal/support-tickets/me?userId=${encodeURIComponent(id)}&username=${encodeURIComponent(username)}`,
    { headers: headers(id, username) }
  );
  console.log(`${supportRes.ok ? "PASS" : "FAIL"}: support center still works (${supportRes.status})`);
  if (supportRes.ok) pass++;

  if (staffLogin.body?.user?.id && createdRequestId) {
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
          userId: staffLogin.body.user.id,
          username: staffLogin.body.user.username,
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
}

console.log(`\nPhase 4 verification: ${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
