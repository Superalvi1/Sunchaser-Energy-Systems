#!/usr/bin/env node
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(root, "..", ".env.local") });

const API = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
const H = (id, u, role) => ({
  "Content-Type": "application/json",
  "X-Sunchaser-User-Id": id,
  "X-Sunchaser-Username": u,
  "X-Sunchaser-Role": role || "",
});

let pass = 0;
let fail = 0;
const ok = (l, d) => { pass++; console.log(`PASS: ${l}${d ? ` — ${d}` : ""}`); };
const bad = (l, d) => { fail++; console.log(`FAIL: ${l}${d ? ` — ${d}` : ""}`); };

async function login(username) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123" }),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

async function main() {
  console.log(`\nInvoice module verify — ${API}\n`);

  const branding = await fetch(`${API}/api/branding`);
  if (branding.ok) ok("GET /api/branding");
  else bad("branding", branding.status);

  const admin = await login("allauddin");
  if (!admin.ok) {
    bad("allauddin login");
    process.exit(1);
  }
  const u = admin.body.user;
  const hdr = H(u.id, u.username, u.role);

  const list = await fetch(`${API}/api/admin/invoices`, { headers: hdr });
  if (list.ok) ok("GET /api/admin/invoices");
  else bad("admin invoices list", list.status);

  const create = await fetch(`${API}/api/admin/invoices`, {
    method: "POST",
    headers: hdr,
    body: JSON.stringify({
      customerName: "Invoice Verify Customer",
      customerPhone: "03001234567",
      items: [{ description: "Solar panels 10kW", qty: 1, unit: "set", rate: 500000, taxPercent: 0, discountAmount: 0 }],
      discountAmount: 0,
      invoiceTaxPercent: 0,
    }),
  });
  const created = await create.json().catch(() => ({}));
  const invId = created.invoice?.id;
  if (create.status === 201 && invId) ok("POST create invoice", created.invoice?.invoiceNumber);
  else bad("create invoice", created.error || create.status);

  if (invId) {
    const pdf = await fetch(
      `${API}/api/export/pdf/invoice/${invId}?userId=${encodeURIComponent(u.id)}&username=${encodeURIComponent(u.username)}&role=${encodeURIComponent(u.role)}`
    );
    const html = await pdf.text();
    if (pdf.ok && html.includes("TAX INVOICE") && html.includes("Grand Total")) ok("Invoice PDF HTML");
    else bad("invoice PDF", pdf.status);

    const pay = await fetch(`${API}/api/admin/invoices/${invId}/payments`, {
      method: "POST",
      headers: hdr,
      body: JSON.stringify({ amount: 100000, paymentMethod: "Cash", notes: "verify" }),
    });
    if (pay.ok) ok("Record payment");
    else bad("payment", pay.status);
  }

  const shafiq = await login("shafiq").catch(() => ({ ok: false }));
  if (shafiq?.ok && shafiq.body?.user) {
    const portal = await fetch(`${API}/api/customer-portal/invoices/me`, {
      headers: H(shafiq.body.user.id, shafiq.body.user.username),
    });
    if (portal.ok) ok("Customer portal invoices/me");
    else bad("portal invoices", portal.status);
  } else {
    console.log("SKIP: shafiq customer login (optional)");
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
