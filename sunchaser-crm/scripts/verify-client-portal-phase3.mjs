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
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

let pass = 0;
let total = 0;
let createdTicketId = null;

for (const staff of ["allauddin", "raza", "sales"]) {
  total++;
  const { ok, body } = await login(staff);
  const good = ok && body.user?.role !== "Customer";
  console.log(`${good ? "PASS" : "FAIL"}: ${staff} CRM login`);
  if (good) pass++;
}

total++;
const portal = await login("portalclient");
const portalOk = portal.ok && portal.body.user?.role === "Customer";
console.log(`${portalOk ? "PASS" : "FAIL"}: portalclient login`);
if (portalOk) pass++;

if (portal.body?.user?.id) {
  const { id, username } = portal.body.user;

  total++;
  const createRes = await fetch(`${API}/api/customer-portal/support-tickets`, {
    method: "POST",
    headers: headers(id, username),
    body: JSON.stringify({
      userId: id,
      username,
      category: "General Inquiry",
      priority: "Medium",
      subject: "Phase 3 verify ticket",
      description: "Automated verification ticket for support center.",
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  createdTicketId = created.id;
  const createOk = createRes.status === 201 && created.id;
  console.log(`${createOk ? "PASS" : "FAIL"}: portalclient creates ticket (${createRes.status})`);
  if (createOk) pass++;

  total++;
  const listRes = await fetch(
    `${API}/api/customer-portal/support-tickets/me?userId=${encodeURIComponent(id)}&username=${encodeURIComponent(username)}`,
    { headers: headers(id, username) }
  );
  const listBody = await listRes.json().catch(() => ({}));
  const listOk =
    listRes.ok &&
    Array.isArray(listBody.tickets) &&
    listBody.tickets.some((t) => t.id === createdTicketId);
  console.log(`${listOk ? "PASS" : "FAIL"}: portalclient lists own tickets`);
  if (listOk) pass++;

  total++;
  const staffLogin = await login("sales");
  const otherRes = await fetch(
    `${API}/api/customer-portal/support-tickets/${encodeURIComponent(createdTicketId || "x")}?userId=${encodeURIComponent(staffLogin.body.user.id)}&username=${encodeURIComponent(staffLogin.body.user.username)}`,
    { headers: headers(staffLogin.body.user.id, staffLogin.body.user.username) }
  );
  const blocked = otherRes.status === 403;
  console.log(`${blocked ? "PASS" : "FAIL"}: non-customer blocked from customer ticket detail`);
  if (blocked) pass++;

  total++;
  const docsRes = await fetch(
    `${API}/api/customer-portal/documents/me?userId=${encodeURIComponent(id)}&username=${encodeURIComponent(username)}`,
    { headers: headers(id, username) }
  );
  console.log(`${docsRes.ok ? "PASS" : "FAIL"}: documents still work (${docsRes.status})`);
  if (docsRes.ok) pass++;

  if (staffLogin.body?.user?.id && createdTicketId) {
    total++;
    const adminList = await fetch(
      `${API}/api/admin/support-tickets?userId=${encodeURIComponent(staffLogin.body.user.id)}&username=${encodeURIComponent(staffLogin.body.user.username)}`,
      { headers: headers(staffLogin.body.user.id, staffLogin.body.user.username) }
    );
    const adminBody = await adminList.json().catch(() => ({}));
    const adminOk =
      adminList.ok && adminBody.tickets?.some((t) => t.id === createdTicketId);
    console.log(`${adminOk ? "PASS" : "FAIL"}: staff sees ticket in desk`);
    if (adminOk) pass++;

    total++;
    const patchRes = await fetch(`${API}/api/admin/support-tickets/${createdTicketId}`, {
      method: "PATCH",
      headers: headers(staffLogin.body.user.id, staffLogin.body.user.username),
      body: JSON.stringify({
        userId: staffLogin.body.user.id,
        username: staffLogin.body.user.username,
        status: "In Review",
        assignedTechnician: "Verify Tech",
        customerVisibleNote: "We are reviewing your request.",
      }),
    });
    console.log(`${patchRes.ok ? "PASS" : "FAIL"}: staff updates ticket (${patchRes.status})`);
    if (patchRes.ok) pass++;

    total++;
    const detailRes = await fetch(
      `${API}/api/customer-portal/support-tickets/${encodeURIComponent(createdTicketId)}?userId=${encodeURIComponent(id)}&username=${encodeURIComponent(username)}`,
      { headers: headers(id, username) }
    );
    const detailBody = await detailRes.json().catch(() => ({}));
    const detailOk =
      detailRes.ok && detailBody.ticket?.status === "In Review";
    console.log(`${detailOk ? "PASS" : "FAIL"}: portalclient sees updated status`);
    if (detailOk) pass++;
  }
} else {
  console.log("SKIP: portalclient unavailable");
}

console.log(`\n${pass}/${total} phase 3 checks passed`);
process.exit(pass === total ? 0 : 1);
