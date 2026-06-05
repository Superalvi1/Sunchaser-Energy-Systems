import {
  getSupabase,
  isSupabaseActive,
  type Database,
  verifyStaffPortalUser,
  StaffPortalAuthError,
} from "./dbManager.js";
import {
  canCreateInvoice,
  isExcludedFromLedgerTotals,
  type PartyLedgerPayment,
  type PartyLedgerSummary,
  type PartyLedgerTransaction,
} from "./src/lib/invoices.ts";
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
    let existing = map.get(key);
    if (!existing) {
      existing = {
        partyKey: key,
        customerId: inv.customerId || null,
        name: inv.customerName,
        phone: inv.customerPhone || null,
        billingAddress: inv.customerAddress || null,
        totalSales: 0,
        receivedAmount: 0,
        balanceDue: 0,
        invoiceCount: 0,
        hasOverdue: false,
      };
      map.set(key, existing);
    }

    if (!existing.billingAddress && inv.customerAddress) {
      existing.billingAddress = inv.customerAddress;
    }
    if (!existing.customerId && inv.customerId) {
      existing.customerId = inv.customerId;
    }

    if (isExcludedFromLedgerTotals(inv.invoiceStatus)) continue;

    const sales = Number(inv.grandTotal || 0);
    const paid = resolveInvoiceReceivedAmount(inv);
    const balance = resolveInvoiceBalanceDue(inv);
    const overdue = inv.paymentStatus === "Overdue";

    existing.totalSales += sales;
    existing.receivedAmount += paid;
    existing.balanceDue += balance;
    existing.invoiceCount += 1;
    existing.hasOverdue = existing.hasOverdue || overdue;
  }

  return Array.from(map.values()).sort((a, b) => b.balanceDue - a.balanceDue || a.name.localeCompare(b.name));
}

export async function getPartyLedgerDetail(
  userId: string,
  username: string,
  role: string,
  partyKey: string,
  localDb?: Database
): Promise<{
  party: PartyLedgerSummary;
  transactions: PartyLedgerTransaction[];
  payments: PartyLedgerPayment[];
}> {
  const parties = await listPartyLedgers(userId, username, role, localDb);
  const party = parties.find((p) => p.partyKey === partyKey);
  if (!party) {
    const err = new StaffPortalAuthError("Party not found.", 404);
    (err as any).statusCode = 404;
    throw err;
  }

  const invoices = await listAdminInvoices(userId, username, role, localDb);
  const partyInvoices = invoices.filter((inv) => partyKeyFromInvoice(inv) === partyKey);

  const transactions: PartyLedgerTransaction[] = partyInvoices
    .map((inv) => ({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      grandTotal: inv.grandTotal,
      paidAmount: resolveInvoiceReceivedAmount(inv),
      balanceDue: resolveInvoiceBalanceDue(inv),
      paymentStatus: inv.paymentStatus,
      invoiceStatus: inv.invoiceStatus || "active",
    }))
    .sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)));

  const payments: PartyLedgerPayment[] = [];
  for (const inv of partyInvoices) {
    for (const p of inv.payments || []) {
      payments.push({
        id: p.id,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        paymentDate: p.paymentDate,
        paymentMethod: p.paymentMethod,
        referenceNumber: (p as any).referenceNumber ?? (p as any).reference_number ?? null,
        amount: Number(p.amount || 0),
        recordedBy: p.recordedBy || null,
        receiptUrl: p.receiptUrl || null,
        notes: p.notes || null,
        createdAt: p.createdAt,
      });
    }
  }
  payments.sort((a, b) => {
    const da = String(b.paymentDate || b.createdAt || "");
    const db = String(a.paymentDate || a.createdAt || "");
    return da.localeCompare(db);
  });

  return { party, transactions, payments };
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
