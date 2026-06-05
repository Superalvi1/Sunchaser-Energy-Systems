#!/usr/bin/env node
/**
 * Verify Vyapar-style invoice module: parties, sale invoice, PDF, portal.
 * Re-runnable: no hardcoded invoice numbers; isolated test customer per run.
 * Usage: node scripts/verify-invoice-vyapar.mjs
 */
import "dotenv/config";
import { config } from "dotenv";
import { existsSync } from "fs";
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

function hdr(staff) {
  return {
    "x-sunchaser-user-id": staff.id,
    "x-sunchaser-username": staff.username,
    "x-sunchaser-role": staff.role,
    "Content-Type": "application/json",
  };
}

async function main() {
  console.log(`\nInvoice Vyapar verify → ${API}\n`);
  const staff = await loginStaff();
  const headers = hdr(staff);

  const partiesRes = await fetch(`${API}/api/admin/parties`, { headers });
  if (partiesRes.ok) ok("GET /api/admin/parties");
  else fail("GET /api/admin/parties", await partiesRes.text());

  const listRes = await fetch(`${API}/api/admin/invoices`, { headers });
  const listData = await listRes.json().catch(() => ({}));
  const invoices = listData.invoices || [];
  if (listRes.ok) ok(`GET /api/admin/invoices (${invoices.length})`);
  else fail("GET /api/admin/invoices", listRes.status);

  const canonical = invoices.find((i) => i.invoiceNumber === "INV-2026-0007");
  if (canonical) {
    if (Number(canonical.grandTotal) === 1270000) ok("INV-2026-0007 grand total Rs 1,270,000");
    else fail("INV-2026-0007 grand total", String(canonical.grandTotal));
    if (Number(canonical.paidAmount) === 5000) ok("INV-2026-0007 paid Rs 5,000");
    else fail("INV-2026-0007 paid", String(canonical.paidAmount));
    if (Number(canonical.balanceDue) === 1265000) ok("INV-2026-0007 balance Rs 1,265,000");
    else fail("INV-2026-0007 balance", String(canonical.balanceDue));
    const payRows = canonical.payments || [];
    if (payRows.length >= 1) ok(`INV-2026-0007 payment rows (${payRows.length})`);
    else fail("INV-2026-0007 payment audit trail", "0 rows");
    if (canonical.customerId) ok(`INV-2026-0007 customer_id ${canonical.customerId}`);
    else fail("INV-2026-0007 customer_id", "null");
  } else {
    console.log("  ⚠ INV-2026-0007 not found — skip canonical checks");
  }

  const suffix = Date.now();
  const testPhone = `+92300${String(suffix).slice(-7)}`;
  const createBody = {
    customerName: `Vyapar Integrity Test ${suffix}`,
    customerPhone: testPhone,
    customerAddress: "Test address, Lahore",
    invoiceDate: new Date().toISOString().slice(0, 10),
    paymentTerms: "Cash on delivery",
    paymentMode: "Cash",
    paidAmount: 5000,
    notes: "Vyapar verify re-runnable create",
    terms: "Test invoice.",
    discountAmount: 0,
    invoiceTaxPercent: 0,
    items: [
      {
        itemName: "10kw hybrid system",
        description: "Verify package",
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
    headers,
    body: JSON.stringify(createBody),
  });
  const created = await create.json().catch(() => ({}));
  if (!create.ok) {
    fail("POST integrity test invoice", created.error || create.status);
  } else {
    const inv = created.invoice;
    ok("POST integrity test invoice", inv?.invoiceNumber);
    if (Number(inv.grandTotal) === 1270000) ok("Grand total Rs 1,270,000");
    else fail("Grand total", String(inv.grandTotal));
    if (Number(inv.paidAmount) === 5000) ok("Received Rs 5,000");
    else fail("Paid amount", String(inv.paidAmount));
    if (Number(inv.balanceDue) === 1265000) ok("Balance Rs 1,265,000");
    else fail("Balance", String(inv.balanceDue));
    const pays = inv.payments || [];
    if (pays.length >= 1) ok(`Payment audit row (${pays.length})`);
    else fail("Payment audit trail on create", "0 rows");
    if (inv.customerId) ok(`customer_id auto-linked (${inv.customerId})`);
    else fail("customer_id on create", "null");

    const pdfUrl = `${API}/api/export/pdf/invoice/${inv.id}?userId=${staff.id}&username=${staff.username}&role=${staff.role}`;
    const pdf = await fetch(pdfUrl);
    const html = await pdf.text();
    if (pdf.ok && html.includes("Sunchaser") && html.includes("ACKNOWLEDGEMENT")) {
      ok("Invoice PDF HTML (Vyapar layout)");
    } else fail("Invoice PDF", String(pdf.status));

    const parties2 = await fetch(`${API}/api/admin/parties`, { headers });
    if (parties2.ok) {
      const pdata = await parties2.json().catch(() => ({}));
      const party = (pdata.parties || []).find(
        (p) => p.phone === testPhone || String(p.name || "").includes(String(suffix))
      );
      if (
        party &&
        Number(party.totalSales) === 1270000 &&
        Number(party.receivedAmount) === 5000 &&
        Number(party.balanceDue) === 1265000
      ) {
        ok("Party ledger totals (isolated test customer)");
      } else {
        fail(
          "Party ledger totals",
          party
            ? `sales=${party.totalSales} recv=${party.receivedAmount} bal=${party.balanceDue}`
            : "party not found"
        );
      }
    } else {
      fail("GET /api/admin/parties (post-create)", parties2.status);
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
