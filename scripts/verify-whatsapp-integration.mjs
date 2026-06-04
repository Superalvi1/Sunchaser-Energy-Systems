/**
 * WhatsApp Phase 1: click-to-chat + Supabase whatsapp_message_logs.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("0")) return `92${digits.slice(1)}`;
  return digits;
}

function buildWhatsAppDeepLink(phone, message) {
  return `https://wa.me/${normalizePhoneForWhatsApp(phone)}?text=${encodeURIComponent(message)}`;
}

const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(root, "..", ".env.local") });

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

total++;
const phone = normalizePhoneForWhatsApp("0300 1234567");
const link = buildWhatsAppDeepLink("03001234567", "Hello Test, quotation ready.");
const linkOk = phone.startsWith("92") && link.includes("wa.me/") && link.includes("text=");
console.log(`${linkOk ? "PASS" : "FAIL"}: wa.me deep link builder`);
if (linkOk) pass++;

total++;
const admin = await login("allauddin");
const adminOk = admin.ok && admin.body.user?.username === "allauddin";
console.log(`${adminOk ? "PASS" : "FAIL"}: allauddin login`);
if (adminOk) pass++;

if (adminOk) {
  const { id, username } = admin.body.user;
  total++;
  const logRes = await fetch(`${API}/api/whatsapp/log-opened`, {
    method: "POST",
    headers: headers(id, username),
    body: JSON.stringify({
      userId: id,
      username,
      phone: "923001234567",
      messageType: "quotation_sent",
      messageBody: "Hello Verify, your solar quotation from Sunchaser is ready.",
      leadId: "lead-verify",
      vars: { customerName: "Verify" },
    }),
  });
  const logBody = await logRes.json().catch(() => ({}));
  const logOk = logRes.ok && logBody.id && logBody.messageType === "quotation_sent";
  console.log(`${logOk ? "PASS" : "FAIL"}: log WhatsApp opened (${logRes.status})`);
  if (logOk) pass++;

  total++;
  const logsRes = await fetch(`${API}/api/admin/whatsapp/logs`, {
    headers: headers(id, username),
  });
  const logsBody = await logsRes.json().catch(() => ({}));
  const logsOk =
    logsRes.ok &&
    Array.isArray(logsBody.logs) &&
    logsBody.logs.some((l) => l.messageType === "quotation_sent");
  console.log(`${logsOk ? "PASS" : "FAIL"}: admin reads WhatsApp logs`);
  if (logsOk) pass++;
}

total++;
const probeRes = await fetch(`${API}/api/diagnostics/phase11-tables`);
const probeBody = await probeRes.json().catch(() => ({}));
const tableOk = probeBody.probes?.whatsapp_message_logs?.ok === true || probeBody.phase11Ready;
console.log(`${tableOk ? "PASS" : "FAIL"}: whatsapp_message_logs table probe`);
if (tableOk) pass++;

console.log(`\nWhatsApp integration: ${pass}/${total} PASS`);
process.exit(pass === total ? 0 : 1);
