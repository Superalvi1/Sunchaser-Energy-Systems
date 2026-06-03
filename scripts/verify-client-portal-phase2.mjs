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

for (const staff of ["allauddin", "raza", "sales"]) {
  total++;
  const { ok, body } = await login(staff);
  const isStaff = ok && body.user?.role !== "Customer";
  console.log(`${isStaff ? "PASS" : "FAIL"}: ${staff} CRM login (${body.user?.role})`);
  if (isStaff) pass++;
}

total++;
const portalLogin = await login("portalclient");
const portalOk = portalLogin.ok && portalLogin.body.user?.role === "Customer";
console.log(`${portalOk ? "PASS" : "FAIL"}: portalclient login`);
if (portalOk) pass++;

if (portalLogin.body?.user?.id) {
  const { id, username } = portalLogin.body.user;

  for (const path of ["/api/customer-portal/documents/me", "/api/customer-portal/warranties/me"]) {
    total++;
    const res = await fetch(
      `${API}${path}?userId=${encodeURIComponent(id)}&username=${encodeURIComponent(username)}`,
      { headers: headers(id, username) }
    );
    const body = await res.json().catch(() => ({}));
    const ok = res.ok && (body.wallet || body.cards);
    console.log(`${ok ? "PASS" : "FAIL"}: GET ${path} (${res.status})`);
    if (ok) pass++;
  }

  total++;
  const claimRes = await fetch(`${API}/api/customer-portal/warranty-claim`, {
    method: "POST",
    headers: headers(id, username),
    body: JSON.stringify({
      userId: id,
      username,
      component: "Solar Panels",
      issueDescription: "Phase 2 verification test claim",
    }),
  });
  const claimOk = claimRes.status === 201 || claimRes.status === 200;
  console.log(`${claimOk ? "PASS" : "FAIL"}: POST warranty-claim (${claimRes.status})`);
  if (claimOk) pass++;

  total++;
  const otherRes = await fetch(
    `${API}/api/customer-portal/documents/me?userId=${encodeURIComponent(id)}&username=${encodeURIComponent(username)}&customerId=fake-other-customer`,
    { headers: headers(id, username) }
  );
  const otherBody = await otherRes.json().catch(() => ({}));
  const scoped = otherRes.ok && otherBody.customerId && !otherBody.documents?.some((d) => d.customerId !== otherBody.customerId);
  console.log(`${scoped ? "PASS" : "FAIL"}: documents scoped to own customer`);
  if (scoped) pass++;
} else {
  console.log("SKIP: portalclient not available — run client-portal-customer-user.sql");
}

console.log(`\n${pass}/${total} phase 2 checks passed`);
process.exit(pass === total ? 0 : 1);
