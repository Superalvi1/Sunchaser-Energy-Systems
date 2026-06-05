import {
  getSupabase,
  isSupabaseActive,
  type Database,
  verifyStaffPortalUser,
  StaffPortalAuthError,
} from "./dbManager.js";
import { canCreateInvoice, type PartyLedgerSummary, type PartyLedgerTransaction } from "./src/lib/invoices.ts";
import {
  resolveInvoiceBalanceDue,
  resolveInvoiceReceivedAmount,
} from "./src/lib/invoicePayments.ts";
import { listAdminInvoices } from "./invoiceDb.js";

function partyKeyFromInvoice(inv: {
  customerId?: string | null;
  customerName?: string;
  customerPhone?: string | null;
}) {
  if (inv.customerId) return `cid:${inv.customerId}`;
  const name = String(inv.customerName || "").trim().toLowerCase();
  const phone = String(inv.customerPhone || "").trim();
  return `name:${name}|${phone}`;
}

export async function listPartyLedgers(
  userId: string,
  username: string,
  role: string,
  localDb?: Database
): Promise<PartyLedgerSummary[]> {
  await verifyStaffPortalUser(userId, username, localDb);
  if (!canCreateInvoice(username, role)) {
    throw new StaffPortalAuthError("You do not have permission to view party ledgers.", 403);
  }

  const invoices = await listAdminInvoices(userId, username, role, localDb);
  const map = new Map<string, PartyLedgerSummary>();

  for (const inv of invoices) {
    const key = partyKeyFromInvoice(inv);
    const existing = map.get(key);
    const sales = Number(inv.grandTotal || 0);
    const paid = resolveInvoiceReceivedAmount(inv);
    const balance = resolveInvoiceBalanceDue(inv);

    if (existing) {
      existing.totalSales += sales;
      existing.receivedAmount += paid;
      existing.balanceDue += balance;
      existing.invoiceCount += 1;
      if (!existing.billingAddress && inv.customerAddress) {
        existing.billingAddress = inv.customerAddress;
      }
    } else {
      map.set(key, {
        partyKey: key,
        customerId: inv.customerId || null,
        name: inv.customerName,
        phone: inv.customerPhone || null,
        billingAddress: inv.customerAddress || null,
        totalSales: sales,
        receivedAmount: paid,
        balanceDue: balance,
        invoiceCount: 1,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.balanceDue - a.balanceDue || a.name.localeCompare(b.name));
}

export async function getPartyLedgerDetail(
  userId: string,
  username: string,
  role: string,
  partyKey: string,
  localDb?: Database
): Promise<{ party: PartyLedgerSummary; transactions: PartyLedgerTransaction[] }> {
  const parties = await listPartyLedgers(userId, username, role, localDb);
  const party = parties.find((p) => p.partyKey === partyKey);
  if (!party) {
    const err = new StaffPortalAuthError("Party not found.", 404);
    (err as any).statusCode = 404;
    throw err;
  }

  const invoices = await listAdminInvoices(userId, username, role, localDb);
  const transactions: PartyLedgerTransaction[] = invoices
    .filter((inv) => partyKeyFromInvoice(inv) === partyKey)
    .map((inv) => ({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      grandTotal: inv.grandTotal,
      paidAmount: resolveInvoiceReceivedAmount(inv),
      balanceDue: resolveInvoiceBalanceDue(inv),
      paymentStatus: inv.paymentStatus,
    }))
    .sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)));

  return { party, transactions };
}

export async function getPartyLedgerByCustomerId(
  userId: string,
  username: string,
  role: string,
  customerId: string,
  localDb?: Database
) {
  return getPartyLedgerDetail(userId, username, role, `cid:${customerId}`, localDb);
}
