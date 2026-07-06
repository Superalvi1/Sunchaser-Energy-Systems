#!/usr/bin/env node
/**
 * Link invoices with customer_id IS NULL to existing customers only.
 * Match order: phone → email (placeholder from phone) → exact name (unique only).
 * Does NOT create new customers.
 *
 * Uses production Admin API (local .env Supabase may be a different project).
 *
 * Usage:
 *   node scripts/backfill-invoice-customer-id.mjs          # dry-run
 *   node scripts/backfill-invoice-customer-id.mjs --apply  # PATCH invoices
 */
import dotenv from "dotenv";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(resolve(__dir, "../.env.local"))) {
  dotenv.config({ path: resolve(__dir, "../.env.local") });
}
dotenv.config();

const API = (
  process.env.API_BASE ||
  process.env.VITE_API_BASE ||
  "https://sunchaser-energy-systems.onrender.com"
).replace(/\/$/, "");
const STAFF_USER = process.env.VERIFY_STAFF_USER || "allauddin";
const STAFF_PASS = process.env.VERIFY_STAFF_PASS || "123";
const APPLY = process.argv.includes("--apply");

function stripPhoneFormatting(phone) {
  return String(phone || "").replace(/[\s\-().]/g, "").trim();
}

function normalizePakistanPhone(phone) {
  let raw = stripPhoneFormatting(phone);
  if (!raw) return null;
  if (raw.startsWith("+")) raw = raw.slice(1);
  raw = raw.replace(/\D/g, "");
  if (!raw) return null;
  if (raw.startsWith("92") && raw.length >= 12) return raw.slice(0, 12);
  if (raw.startsWith("0") && raw.length === 11) return `92${raw.slice(1)}`;
  if (raw.length === 10 && raw.startsWith("3")) return `92${raw}`;
  return raw.length >= 10 ? raw : null;
}

function placeholderEmailFromPhone(phone) {
  const norm = normalizePakistanPhone(phone) || stripPhoneFormatting(phone).replace(/\D/g, "");
  if (!norm) return null;
  return `invoice+${norm}@sunchaser.invoice`;
}

function buildCustomerIndexes(customers) {
  const byPhone = new Map();
  const byEmail = new Map();
  const byName = new Map();

  for (const c of customers) {
    const id = c.id;
    const phone = c.phone || "";
    const norm = normalizePakistanPhone(phone);
    if (norm) {
      const list = byPhone.get(norm) || [];
      if (!list.includes(id)) list.push(id);
      byPhone.set(norm, list);
    }
    const email = String(c.email || "").trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, id);
    const nameKey = String(c.name || "").trim();
    if (nameKey) {
      const list = byName.get(nameKey.toLowerCase()) || [];
      if (!list.some((x) => x.id === id)) list.push({ id, name: nameKey });
      byName.set(nameKey.toLowerCase(), list);
    }
  }
  return { byPhone, byEmail, byName };
}

function resolveExistingCustomerId(invoice, indexes) {
  const phone = String(invoice.customerPhone || invoice.customer_phone || "").trim();
  const name = String(invoice.customerName || invoice.customer_name || "").trim();

  if (phone) {
    const norm = normalizePakistanPhone(phone);
    if (norm) {
      const hits = indexes.byPhone.get(norm) || [];
      const unique = [...new Set(hits)];
      if (unique.length === 1) return { customerId: unique[0], method: "phone" };
      if (unique.length > 1) return { customerId: null, method: "phone_ambiguous", note: unique.join(",") };
    }
  }

  const placeholder = phone ? placeholderEmailFromPhone(phone) : null;
  if (placeholder) {
    const hit = indexes.byEmail.get(placeholder.toLowerCase());
    if (hit) return { customerId: hit, method: "email_placeholder" };
  }

  if (name) {
    const hits = indexes.byName.get(name.toLowerCase()) || [];
    const exactCase = hits.filter((h) => h.name === name);
    if (exactCase.length === 1) return { customerId: exactCase[0].id, method: "exact_name" };
    const unique = [...new Set(hits.map((h) => h.id))];
    if (unique.length === 1) return { customerId: unique[0], method: "exact_name_ci" };
    if (unique.length > 1) return { customerId: null, method: "name_ambiguous", note: unique.join(",") };
  }

  return { customerId: null, method: "no_match" };
}

/** Build customer directory from linked invoices + portal accounts (no new rows). */
function collectKnownCustomers(invoices, accounts) {
  const map = new Map();

  for (const inv of invoices) {
    const cid = inv.customerId || inv.customer_id;
    if (!cid) continue;
    const existing = map.get(cid) || { id: cid, name: "", phone: "", email: "" };
    existing.name = existing.name || inv.customerName || inv.customer_name || "";
    existing.phone = existing.phone || inv.customerPhone || inv.customer_phone || "";
    map.set(cid, existing);
  }

  for (const acc of accounts) {
    const cid = acc.customerId;
    if (!cid) continue;
    const existing = map.get(cid) || { id: cid, name: "", phone: "", email: "" };
    existing.name = existing.name || acc.name || "";
    existing.phone = existing.phone || acc.phone || "";
    existing.email = existing.email || acc.email || "";
    map.set(cid, existing);
  }

  return [...map.values()];
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

async function fetchInvoicesAndAccounts(headers) {
  const [invRes, accRes] = await Promise.all([
    fetch(`${API}/api/admin/invoices`, { headers }),
    fetch(`${API}/api/admin/customer-accounts`, { headers }),
  ]);
  const invData = await invRes.json().catch(() => ({}));
  const accData = await accRes.json().catch(() => ({}));
  if (!invRes.ok) throw new Error(invData.error || "Failed to list invoices");
  return { invoices: invData.invoices || [], accounts: accData.accounts || [] };
}

async function applyMatches(orphans, indexes, headers, report) {
  let updated = 0;
  for (const inv of orphans) {
    const oldId = inv.customerId || inv.customer_id || null;
    const { customerId: newId, method, note } = resolveExistingCustomerId(inv, indexes);
    let row = report.find((r) => r.invoice_id === inv.id);
    if (!row) {
      row = {
        invoice_number: inv.invoiceNumber || inv.invoice_number,
        customer: inv.customerName || inv.customer_name,
        old_customer_id: oldId,
        new_customer_id: null,
        match_method: "pending",
        note: "",
        invoice_id: inv.id,
      };
      report.push(row);
    }
    if (!newId) continue;
    row.new_customer_id = newId;
    row.match_method = method;
    row.note = note || "";

    if (APPLY) {
      const patch = await fetch(`${API}/api/admin/invoices/${inv.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ customerId: newId }),
      });
      const patchData = await patch.json().catch(() => ({}));
      if (!patch.ok) row.apply_error = patchData.error || patch.status;
      else {
        updated++;
        row.applied = true;
      }
    }
  }
  return updated;
}

/** One PATCH per phone group triggers server resolveInvoiceCustomerId (match or single create). */
async function serverLinkByPhoneGroups(orphans, headers, report) {
  if (!APPLY) return 0;
  const groups = new Map();
  for (const inv of orphans) {
    if (inv.customerId || inv.customer_id) continue;
    const phone = String(inv.customerPhone || inv.customer_phone || "").trim();
    const name = String(inv.customerName || inv.customer_name || "").trim();
    const norm = normalizePakistanPhone(phone);
    if (!norm || !name) continue;
    if (!groups.has(norm)) groups.set(norm, inv);
  }
  let linked = 0;
  for (const inv of groups.values()) {
    const patch = await fetch(`${API}/api/admin/invoices/${inv.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        customerName: inv.customerName || inv.customer_name,
        customerPhone: inv.customerPhone || inv.customer_phone,
        customerAddress: inv.customerAddress || inv.customer_address || null,
      }),
    });
    const data = await patch.json().catch(() => ({}));
    const invOut = data.invoice;
    if (patch.ok && invOut?.customerId) {
      linked++;
      const row = report.find((r) => r.invoice_id === inv.id);
      if (row) {
        row.new_customer_id = invOut.customerId;
        row.match_method = "server_resolve";
        row.applied = true;
      }
    }
  }
  return linked;
}

async function main() {
  const staff = await loginStaff();
  const headers = {
    "X-Sunchaser-User-Id": staff.id,
    "X-Sunchaser-Username": staff.username,
    "X-Sunchaser-Role": staff.role,
    "Content-Type": "application/json",
  };

  let { invoices: allInvoices, accounts } = await fetchInvoicesAndAccounts(headers);
  const report = [];
  let updated = 0;

  console.log(`\nInvoice customer_id backfill (${APPLY ? "APPLY" : "DRY-RUN"})`);
  console.log(`API: ${API}\n`);

  for (let pass = 1; pass <= 3; pass++) {
    const orphans = allInvoices.filter((i) => !(i.customerId || i.customer_id));
    const customers = collectKnownCustomers(allInvoices, accounts);
    const indexes = buildCustomerIndexes(customers);

    if (pass === 1) {
      console.log(`Pass 1 — match existing customers (indexed: ${customers.length}, orphans: ${orphans.length})`);
      for (const inv of orphans) {
        if (!report.find((r) => r.invoice_id === inv.id)) {
          report.push({
            invoice_number: inv.invoiceNumber || inv.invoice_number,
            customer: inv.customerName || inv.customer_name,
            old_customer_id: null,
            new_customer_id: null,
            match_method: "pending",
            note: "",
            invoice_id: inv.id,
          });
        }
      }
      updated += await applyMatches(orphans, indexes, headers, report);
    }

    if (pass === 2 && APPLY) {
      const stillOrphan = allInvoices.filter((i) => !(i.customerId || i.customer_id));
      console.log(`Pass 2 — server link one invoice per phone group (${stillOrphan.length} orphans)`);
      updated += await serverLinkByPhoneGroups(stillOrphan, headers, report);
      ({ invoices: allInvoices, accounts } = await fetchInvoicesAndAccounts(headers));
    }

    if (pass === 3 && APPLY) {
      const stillOrphan = allInvoices.filter((i) => !(i.customerId || i.customer_id));
      const customers2 = collectKnownCustomers(allInvoices, accounts);
      const indexes2 = buildCustomerIndexes(customers2);
      console.log(`Pass 3 — sibling phone match (${stillOrphan.length} orphans)`);
      updated += await applyMatches(stillOrphan, indexes2, headers, report);
      ({ invoices: allInvoices } = await fetchInvoicesAndAccounts(headers));
    }
  }

  // Final state for report
  ({ invoices: allInvoices } = await fetchInvoicesAndAccounts(headers));
  for (const row of report) {
    const inv = allInvoices.find((i) => i.id === row.invoice_id);
    if (inv?.customerId && !row.new_customer_id) {
      row.new_customer_id = inv.customerId;
      row.match_method = row.match_method === "pending" ? "server_resolve" : row.match_method;
    }
  }

  console.log("\n| Invoice | Customer | Old customer_id | New customer_id | Method |");
  console.log("|---------|----------|-----------------|-----------------|--------|");
  for (const r of report) {
    console.log(
      `| ${r.invoice_number} | ${r.customer} | ${r.old_customer_id ?? "null"} | ${r.new_customer_id ?? "—"} | ${r.match_method}${r.note ? ` (${r.note})` : ""}${r.apply_error ? ` ERR:${r.apply_error}` : ""} |`
    );
  }

  const linked = report.filter((r) => r.new_customer_id);
  const unmatched = report.filter((r) => !r.new_customer_id);

  console.log(`\n--- Summary ---`);
  console.log(`Linked: ${linked.length}`);
  console.log(`Still unmatched: ${unmatched.length}`);
  if (APPLY) console.log(`PATCH operations succeeded: ${updated}`);
  else console.log(`Run with --apply to write changes (includes server link pass for phone groups)`);

  if (unmatched.length) {
    console.log(`\nUnmatched:`);
    for (const r of unmatched) {
      console.log(`  ${r.invoice_number} — ${r.customer} [${r.match_method}]`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
