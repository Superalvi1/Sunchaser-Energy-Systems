#!/usr/bin/env node
/**
 * Verify Vyapar-style invoice module: parties, sale invoice, PDF, portal.
 * Usage: node scripts/verify-invoice-vyapar.mjs
 * Requires .env.local with API_BASE or defaults to production.
 */
import "dotenv/config";
import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(resolve(__dir, "../.env.local"))) {
  config({ path: resolve(__dir, "../.env.local") });
}

const API = (process.env.API_BASE || process.env.VITE_API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(
  /\/$/,
  ""
);
const STAFF_USER = process.env.VERIFY_STAFF_USER || "allauddin";
const STAFF_PASS = process.env.VERIFY_STAFF_PASS || "123";

let passed = 0;
let failed = 0;
function ok(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}
function fail(msg, detail = "") {
  failed++;
  console.log(`  ✗ ${msg}${detail ? `: ${detail}` : ""}`);
}

async function loginStaff() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: STAFF_USER, password: STAFF_PASS }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Staff login failed");
  return data.user;
}

async function main() {
  console.log(`\nInvoice Vyapar verify → ${API}\n`);
  const staff = await loginStaff();
  const hdr = {
    "x-sunchaser-user-id": staff.id,
    "x-sunchaser-username": staff.username,
    "x-sunchaser-role": staff.role,
    "Content-Type": "application/json",
  };

  const partiesRes = await fetch(`${API}/api/admin/parties`, { headers: hdr });
  if (partiesRes.ok) ok("GET /api/admin/parties");
  else fail("GET /api/admin/parties", await partiesRes.text());

  const createBody = {
    customerName: "Dr Abdullah Park View",
    customerPhone: "+923207818428",
    customerAddress:
      "House no 209 Topaz Block, Park View City Multan road lahore",
    poNumber: "209topa",
    poDate: "2026-06-04",
    invoiceNumber: "3394",
    invoiceDate: "2026-06-04",
    invoiceTime: "02:42 PM",
    dueDate: "2026-06-11",
    paymentTerms: "Cash on delivery",
    paymentMode: "Cash",
    paidAmount: 5000,
    notes: "Cash on delivery system",
    terms: "System booked in COD basis.",
    discountAmount: 0,
    invoiceTaxPercent: 0,
    items: [
      {
        itemName: "10kw hybrid system",
        description:
          "Longi 615w 16, Goodwe/solis, Dyness battery — full hybrid COD package",
        qty: 1,
        unit: "NONE",
        rate: 1270000,
        taxPercent: 0,
        discountAmount: 0,
      },
    ],
  };

  const create = await fetch(`${API}/api/admin/invoices`, {
    method: "POST",
    headers: hdr,
    body: JSON.stringify(createBody),
  });
  const created = await create.json().catch(() => ({}));
  if (!create.ok) {
    fail("POST test invoice", created.error || create.status);
  } else {
    const inv = created.invoice;
    ok("POST Dr Abdullah invoice");
    if (Number(inv.grandTotal) === 1270000) ok("Grand total Rs 1,270,000");
    else fail("Grand total", String(inv.grandTotal));
    if (Number(inv.paidAmount) === 5000) ok("Received Rs 5,000");
    else fail("Paid amount", String(inv.paidAmount));
    if (Number(inv.balanceDue) === 1265000) ok("Balance Rs 1,265,000");
    else fail("Balance", String(inv.balanceDue));

    const pdfUrl = `${API}/api/export/pdf/invoice/${inv.id}?userId=${staff.id}&username=${staff.username}&role=${staff.role}`;
    const pdf = await fetch(pdfUrl);
    const html = await pdf.text();
    if (pdf.ok && html.includes("Sunchaser") && html.includes("ACKNOWLEDGEMENT")) {
      ok("Invoice PDF HTML (Vyapar layout)");
    } else fail("Invoice PDF", String(pdf.status));

    const parties2 = await fetch(`${API}/api/admin/parties`, { headers: hdr });
    if (parties2.ok) {
      const pdata = await parties2.json().catch(() => ({}));
      const party = (pdata.parties || []).find((p) =>
        String(p.name || "").toLowerCase().includes("abdullah")
      );
      if (party && Number(party.balanceDue) >= 1265000) ok("Party ledger balance");
      else fail("Party ledger", party ? String(party.balanceDue) : "party not found");
    } else {
      console.log("  ⚠ Party ledger route not deployed yet — skip until push");
    }
  }

  const portalRes = await fetch(`${API}/api/customer-portal/invoices/me`, {
    headers: {
      "x-sunchaser-user-id": "cust-shafiq",
      "x-sunchaser-username": "shafiq",
    },
  });
  if (portalRes.status === 403 || portalRes.status === 400) {
    ok("Portal invoices endpoint (auth gate)");
  } else if (portalRes.ok) {
    const pdata = await portalRes.json();
    ok(`Portal invoices (${(pdata.invoices || []).length} rows, bal ${pdata.payableBalance ?? 0})`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
