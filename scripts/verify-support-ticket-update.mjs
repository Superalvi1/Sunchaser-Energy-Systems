/**
 * Support ticket admin update flow:
 * create (portalclient) → assign technician → schedule visit → PATCH save → verify fields.
 */
import dotenv from "dotenv";
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
  return { ok: res.ok, body: await res.json().catch(() => ({})), status: res.status };
}

let pass = 0;
let total = 0;
let ticketId = "";

const portalLogin = await login("portalclient");
const adminLogin = await login("allauddin");

total++;
const loginsOk =
  portalLogin.ok &&
  portalLogin.body.user?.role === "Customer" &&
  adminLogin.ok &&
  adminLogin.body.user?.username === "allauddin";
console.log(`${loginsOk ? "PASS" : "FAIL"}: portalclient + allauddin login`);
if (loginsOk) pass++;

if (!loginsOk) {
  console.log(`\nSupport ticket update: ${pass}/${total} PASS`);
  process.exit(1);
}

const { id: customerId, username: customerUsername } = portalLogin.body.user;
const { id: adminId, username: adminUsername } = adminLogin.body.user;

total++;
const createUrl = `${API}/api/customer-portal/support-tickets`;
const createPayload = {
  userId: customerId,
  username: customerUsername,
  category: "General Inquiry",
  priority: "Medium",
  subject: "Verify support ticket update",
  description: "Automated test for assign + visit schedule save.",
};
console.log("create request", { url: createUrl, method: "POST", payload: createPayload });
const createRes = await fetch(createUrl, {
  method: "POST",
  headers: headers(customerId, customerUsername),
  body: JSON.stringify(createPayload),
});
const created = await createRes.json().catch(() => ({}));
console.log("create response", { status: createRes.status, body: created });
ticketId = created.id;
const createOk = createRes.status === 201 && ticketId;
console.log(`${createOk ? "PASS" : "FAIL"}: create support ticket`);
if (createOk) pass++;

total++;
const listUrl = `${API}/api/admin/support-tickets?userId=${encodeURIComponent(adminId)}&username=${encodeURIComponent(adminUsername)}`;
const listRes = await fetch(listUrl, { headers: headers(adminId, adminUsername) });
const listBody = await listRes.json().catch(() => ({}));
const listOk = listRes.ok && listBody.tickets?.some((t) => t.id === ticketId);
console.log(`${listOk ? "PASS" : "FAIL"}: allauddin admin list contains ticket (${listRes.status})`);
if (listOk) pass++;

total++;
const patchUrl = `${API}/api/admin/support-tickets/${encodeURIComponent(ticketId)}/update`;
const patchPayload = {
  userId: adminId,
  username: adminUsername,
  status: "Visit Scheduled",
  assignedTechnician: "Verify Technician",
  scheduledVisitDate: "2026-06-20",
};
console.log("save request", { url: patchUrl, method: "POST", payload: patchPayload });
const patchRes = await fetch(patchUrl, {
  method: "POST",
  headers: headers(adminId, adminUsername),
  body: JSON.stringify(patchPayload),
});
const patchText = await patchRes.text();
let patchBody = {};
try {
  patchBody = patchText ? JSON.parse(patchText) : {};
} catch {
  patchBody = { raw: patchText.slice(0, 300) };
}
console.log("patch response", { status: patchRes.status, body: patchBody });
const patchOk =
  patchRes.ok &&
  patchBody.assignedTechnician === "Verify Technician" &&
  patchBody.scheduledVisitDate === "2026-06-20" &&
  patchBody.status === "Visit Scheduled";
console.log(`${patchOk ? "PASS" : "FAIL"}: POST save assign technician + visit schedule`);
if (patchOk) pass++;

total++;
const corsRes = await fetch(patchUrl, {
  method: "OPTIONS",
  headers: {
    Origin: "https://localhost",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers":
      "Content-Type,X-Sunchaser-User-Id,X-Sunchaser-Username",
  },
});
const allowMethods = corsRes.headers.get("access-control-allow-methods") || "";
const corsOk = corsRes.ok && allowMethods.toUpperCase().includes("POST");
console.log(
  `${corsOk ? "PASS" : "FAIL"}: CORS preflight allows POST save (${allowMethods || "none"})`
);
if (corsOk) pass++;

total++;
const detailUrl = `${API}/api/customer-portal/support-tickets/${encodeURIComponent(ticketId)}?userId=${encodeURIComponent(customerId)}&username=${encodeURIComponent(customerUsername)}`;
const detailRes = await fetch(detailUrl, { headers: headers(customerId, customerUsername) });
const detailBody = await detailRes.json().catch(() => ({}));
const persisted =
  detailRes.ok &&
  detailBody.ticket?.assignedTechnician === "Verify Technician" &&
  detailBody.ticket?.scheduledVisitDate === "2026-06-20" &&
  detailBody.ticket?.status === "Visit Scheduled";
console.log(`${persisted ? "PASS" : "FAIL"}: customer portal sees persisted update`);
if (persisted) pass++;

console.log(`\nSupport ticket update: ${pass}/${total} PASS`);
process.exit(pass === total ? 0 : 1);
