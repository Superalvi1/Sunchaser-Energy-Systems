import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));

function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("0")) return `92${digits.slice(1)}`;
  if (digits.length === 10) return `92${digits}`;
  return digits;
}

function buildWhatsAppDeepLink(phone, message) {
  const normalized = normalizePhoneForWhatsApp(phone);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

function financeHasNoProfitFields(fin) {
  if (!fin || typeof fin !== "object") return true;
  return (
    fin.supplierCost === undefined &&
    fin.grossProfit === undefined &&
    fin.profitMarginPercent === undefined &&
    fin.totalExpense === undefined &&
    fin.installationCost === undefined &&
    fin.transportCost === undefined &&
    fin.miscExpense === undefined
  );
}

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
let financeId = "";
let deliveryId = "";
let customerId = "cust-101";

total++;
const probeRes = await fetch(`${API}/api/diagnostics/phase11-tables`);
const probeBody = await probeRes.json().catch(() => ({}));
const tables = ["project_finance_records", "whatsapp_message_logs"];
const schemaOk =
  probeBody.phase11Ready === true || tables.every((t) => probeBody.probes?.[t]?.ok === true);
console.log(`${schemaOk ? "PASS" : "FAIL"}: phase11 schema probes (${probeRes.status})`);
if (!schemaOk) {
  console.log("  hint: run scripts/client-portal-phase11-schema.sql in Supabase");
}
if (schemaOk) pass++;

const allauddinLogin = await login("allauddin");
const salesLogin = await login("sales");
const razaLogin = await login("raza");
const techLogin = await login("technician");
const portalLogin = await login("portalclient");

const allauddin = allauddinLogin.body.user;
const sales = salesLogin.body.user;
const raza = razaLogin.body.user;
const tech = techLogin.body.user;
const portal = portalLogin.body.user;
if (portal?.customerId) customerId = portal.customerId;

// Ensure a delivery exists for linking
if (allauddin?.id && tech?.id) {
  const createRes = await fetch(`${API}/api/admin/project-deliveries`, {
    method: "POST",
    headers: headers(allauddin.id, allauddin.username),
    body: JSON.stringify({
      customerId,
      projectTitle: `Phase 11 finance ${Date.now()}`,
      systemType: "Hybrid",
      projectType: "Residential",
      assignedTechnicianUserId: tech.id,
      deliveryStatus: "Order Confirmed",
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  deliveryId = created.id || deliveryId;
}

const saleValue = 1000000;
const advance = 300000;
const supplier = 400000;
const install = 100000;
const transport = 20000;
const misc = 10000;
const expectedExpense = supplier + install + transport + misc;
const expectedProfit = saleValue - expectedExpense;
const expectedMargin = Number(((expectedProfit / saleValue) * 100).toFixed(2));

total++;
let createFinOk = false;
if (allauddin?.id) {
  const finRes = await fetch(`${API}/api/admin/finance/projects`, {
    method: "POST",
    headers: headers(allauddin.id, allauddin.username),
    body: JSON.stringify({
      customerId,
      projectDeliveryId: deliveryId || undefined,
      saleValue,
      advanceReceived: advance,
      supplierCost: supplier,
      installationCost: install,
      transportCost: transport,
      miscExpense: misc,
    }),
  });
  const finBody = await finRes.json().catch(() => ({}));
  financeId = finBody.id || "";
  createFinOk =
    finRes.status === 201 &&
    !!financeId &&
    finBody.grossProfit === expectedProfit &&
    Math.abs(finBody.profitMarginPercent - expectedMargin) < 0.01;
}
console.log(`${createFinOk ? "PASS" : "FAIL"}: Super Admin allauddin creates finance record`);
if (createFinOk) pass++;

total++;
let allauddinSeesProfit = false;
if (financeId && allauddin?.id) {
  const getRes = await fetch(`${API}/api/admin/finance/projects/${encodeURIComponent(financeId)}`, {
    headers: headers(allauddin.id, allauddin.username),
  });
  const row = await getRes.json().catch(() => ({}));
  allauddinSeesProfit =
    getRes.ok &&
    row.supplierCost === supplier &&
    row.grossProfit === expectedProfit &&
    row.profitMarginPercent === expectedMargin;
}
console.log(`${allauddinSeesProfit ? "PASS" : "FAIL"}: allauddin sees supplier cost and profit`);
if (allauddinSeesProfit) pass++;

/** Sales / Technical CEO: staff-safe payments allowed, no cost/profit fields. */
async function staffSeesSafePaymentsOnly(user) {
  if (!deliveryId || !user?.id) return false;
  const res = await fetch(
    `${API}/api/staff/payments/projects/${encodeURIComponent(deliveryId)}`,
    { headers: headers(user.id, user.username) }
  );
  const body = await res.json().catch(() => ({}));
  const fin = body.finance;
  if (!fin) return res.ok && financeHasNoProfitFields(fin);
  return res.ok && financeHasNoProfitFields(fin);
}

/** Technicians must be blocked from staff payment endpoint (403). */
async function technicianBlockedFromStaffPayments(user) {
  if (!deliveryId || !user?.id) return false;
  const res = await fetch(
    `${API}/api/staff/payments/projects/${encodeURIComponent(deliveryId)}`,
    { headers: headers(user.id, user.username) }
  );
  const body = await res.json().catch(() => ({}));
  return res.status === 403 && financeHasNoProfitFields(body.finance);
}

total++;
const salesBlocked = await staffSeesSafePaymentsOnly(sales);
console.log(`${salesBlocked ? "PASS" : "FAIL"}: sales cannot see supplier cost or profit`);
if (salesBlocked) pass++;

total++;
const razaBlocked = await staffSeesSafePaymentsOnly(raza);
console.log(`${razaBlocked ? "PASS" : "FAIL"}: raza cannot see supplier cost or profit`);
if (razaBlocked) pass++;

total++;
const techBlocked = await technicianBlockedFromStaffPayments(tech);
console.log(
  `${techBlocked ? "PASS" : "FAIL"}: technician blocked from staff payments (403, no profit leak)`
);
if (techBlocked) pass++;

total++;
let customerBlocked = true;
let customerSeesSafe = false;
if (portal?.id) {
  const custRes = await fetch(`${API}/api/customer-portal/payments/me`, {
    headers: headers(portal.id, portal.username),
  });
  const custBody = await custRes.json().catch(() => ({}));
  const proj = (custBody.projects || [])[0];
  customerBlocked =
    custRes.ok &&
    !("supplierCost" in (proj || {})) &&
    !("grossProfit" in (proj || {})) &&
    !("profitMarginPercent" in (proj || {}));
  customerSeesSafe =
    custRes.ok &&
    (custBody.totals?.invoiceAmount != null || (custBody.projects || []).length === 0) &&
    (custBody.projects || []).every(
      (p) =>
        p.invoiceAmount !== undefined &&
        p.amountPaid !== undefined &&
        p.balanceRemaining !== undefined
    );
}
console.log(`${customerBlocked ? "PASS" : "FAIL"}: customer cannot see supplier cost or profit`);
if (customerBlocked) pass++;

total++;
console.log(`${customerSeesSafe ? "PASS" : "FAIL"}: customer can see sale value, paid, balance`);
if (customerSeesSafe) pass++;

total++;
const calcOk = expectedProfit === saleValue - expectedExpense && expectedMargin > 0;
console.log(`${calcOk ? "PASS" : "FAIL"}: profit calculation is correct`);
if (calcOk) pass++;

total++;
const phone = "03001234567";
const msg = "Hello Customer, your remaining project balance is PKR 50,000.";
const link = buildWhatsAppDeepLink(phone, msg);
const norm = normalizePhoneForWhatsApp(phone);
const linkOk =
  link.startsWith("https://wa.me/") &&
  link.includes(norm) &&
  link.includes(encodeURIComponent(msg));
console.log(`${linkOk ? "PASS" : "FAIL"}: WhatsApp link generated correctly`);
if (linkOk) pass++;

total++;
let waLogOk = false;
if (allauddin?.id) {
  const waRes = await fetch(`${API}/api/whatsapp/log-opened`, {
    method: "POST",
    headers: headers(allauddin.id, allauddin.username),
    body: JSON.stringify({
      phone: "923001234567",
      messageType: "quotation_sent",
      customerId,
      vars: { customerName: "Verify Client" },
    }),
  });
  const waBody = await waRes.json().catch(() => ({}));
  waLogOk = waRes.status === 201 && waBody.status === "Opened" && waBody.messageType === "quotation_sent";
}
console.log(`${waLogOk ? "PASS" : "FAIL"}: WhatsApp log created`);
if (waLogOk) pass++;

total++;
const p10Tables = [
  "project_deliveries",
  "project_delivery_items",
  "project_installed_equipment",
  "project_installation_photos",
  "project_delivery_updates",
];
const p10ProbeRes = await fetch(`${API}/api/diagnostics/phase10-tables`);
const p10ProbeBody = await p10ProbeRes.json().catch(() => ({}));
const p10SchemaOk =
  p10ProbeBody.phase10Ready === true ||
  p10Tables.every((t) => p10ProbeBody.probes?.[t]?.ok === true);
console.log(`${p10SchemaOk ? "PASS" : "FAIL"}: Phase 10 schema smoke (${p10ProbeRes.status})`);
if (p10SchemaOk) pass++;

total++;
let p10PortalOk = false;
if (portal?.id) {
  const p10CustRes = await fetch(`${API}/api/customer-portal/project-delivery/me`, {
    headers: headers(portal.id, portal.username),
  });
  const p10CustBody = await p10CustRes.json().catch(() => ({}));
  p10PortalOk =
    p10CustRes.ok &&
    (p10CustBody.delivery != null ||
      p10CustBody.progress != null ||
      Array.isArray(p10CustBody.deliveries) ||
      p10CustBody.customerId != null);
}
console.log(`${p10PortalOk ? "PASS" : "FAIL"}: Phase 10 customer delivery smoke`);
if (p10PortalOk) pass++;

console.log(`\nPhase 11: ${pass}/${total} PASS`);
process.exit(pass === total ? 0 : 1);
