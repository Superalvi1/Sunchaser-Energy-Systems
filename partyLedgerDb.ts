import {
  getSupabase,
  isSupabaseActive,
  type Database,
  verifyStaffPortalUser,
  StaffPortalAuthError,
} from "./dbManager.js";
import {
  isExcludedFromLedgerTotals,
  type InvoiceRecord,
  type PartyLedgerPayment,
  type PartyLedgerSummary,
  type PartyLedgerTransaction,
} from "./src/lib/invoices.ts";
import {
  resolveInvoiceBalanceDue,
  resolveInvoiceReceivedAmount,
} from "./src/lib/invoicePayments.ts";
import { loadInvoiceRecordById } from "./invoiceDb.js";
import type { RequestActor } from "./server/middleware/actor.ts";
import {
  FinanceOwnershipError,
  FinanceOwnershipResolver,
  partyKeyFromInvoiceRow,
} from "./server/ownership/FinanceOwnershipResolver.ts";

export function partyKeyFromInvoice(inv: {
  customerId?: string | null;
  customerName?: string;
  customerPhone?: string | null;
}) {
  return partyKeyFromInvoiceRow({
    customer_id: inv.customerId,
    customer_name: inv.customerName,
    customer_phone: inv.customerPhone,
  });
}

function toRequestActor(userId: string, username: string, role: string): RequestActor {
  return {
    id: userId,
    username,
    name: username,
    email: "",
    role,
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
  };
}

function mapFinanceOwnershipError(err: unknown): never {
  if (err instanceof FinanceOwnershipError) {
    throw new StaffPortalAuthError(err.message, err.statusCode);
  }
  throw err;
}

async function loadVisibleInvoicesForStaff(
  userId: string,
  username: string,
  role: string,
  localDb?: Database
): Promise<{ actor: RequestActor; invoices: InvoiceRecord[]; visibleRows: Record<string, unknown>[] }> {
  const actor = toRequestActor(userId, username, role);
  try {
    const visibleRows = await FinanceOwnershipResolver.getVisibleInvoiceRowsForActor(actor, localDb);
    const invoices: InvoiceRecord[] = [];
    for (const row of visibleRows) {
      invoices.push(await loadInvoiceRecordById(String(row.id), localDb));
    }
    return { actor, invoices, visibleRows };
  } catch (err) {
    mapFinanceOwnershipError(err);
  }
}

const ARCHIVE_TABLE = "party_ledger_archives";

export type PartyLedgerArchiveRecord = {
  partyKey: string;
  customerId: string | null;
  partyName: string | null;
  partyPhone: string | null;
  archivedAt: string;
  archivedBy: string;
};

export type PartyLedgerListOptions = {
  visibility?: "active" | "archived" | "all";
};

function mapArchiveRow(row: any): PartyLedgerArchiveRecord {
  return {
    partyKey: row.party_key || row.partyKey,
    customerId: row.customer_id ?? row.customerId ?? null,
    partyName: row.party_name ?? row.partyName ?? null,
    partyPhone: row.party_phone ?? row.partyPhone ?? null,
    archivedAt: row.archived_at || row.archivedAt,
    archivedBy: row.archived_by || row.archivedBy,
  };
}

function isArchiveTableMissing(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return err?.code === "42P01" || msg.includes("party_ledger_archives");
}

async function loadArchiveMap(localDb?: Database): Promise<Map<string, PartyLedgerArchiveRecord>> {
  const map = new Map<string, PartyLedgerArchiveRecord>();
  if (isSupabaseActive()) {
    try {
      const { data, error } = await getSupabase()!.from(ARCHIVE_TABLE).select("*");
      if (error) throw error;
      for (const row of data || []) {
        const rec = mapArchiveRow(row);
        map.set(rec.partyKey, rec);
      }
    } catch (err: any) {
      if (!isArchiveTableMissing(err)) throw err;
    }
  } else {
    for (const row of (localDb as any)?.partyLedgerArchives || []) {
      const rec = mapArchiveRow(row);
      map.set(rec.partyKey, rec);
    }
  }
  return map;
}

async function upsertArchiveRow(
  row: {
    party_key: string;
    customer_id: string | null;
    party_name: string;
    party_phone: string | null;
    archived_at: string;
    archived_by: string;
  },
  localDb?: Database
) {
  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from(ARCHIVE_TABLE).upsert(row, { onConflict: "party_key" });
    if (error) {
      if (isArchiveTableMissing(error)) {
        throw new StaffPortalAuthError(
          "Party archive table is not configured. Run scripts/party-ledger-archive-schema.sql in Supabase.",
          503
        );
      }
      throw error;
    }
    return;
  }
  const db = localDb as any;
  db.partyLedgerArchives = db.partyLedgerArchives || [];
  const idx = db.partyLedgerArchives.findIndex(
    (r: any) => (r.party_key || r.partyKey) === row.party_key
  );
  if (idx >= 0) db.partyLedgerArchives[idx] = row;
  else db.partyLedgerArchives.push(row);
}

async function deleteArchiveRow(partyKey: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from(ARCHIVE_TABLE).delete().eq("party_key", partyKey);
    if (error && !isArchiveTableMissing(error)) throw error;
    return;
  }
  const db = localDb as any;
  db.partyLedgerArchives = (db.partyLedgerArchives || []).filter(
    (r: any) => (r.party_key || r.partyKey) !== partyKey
  );
}

function applyArchiveMeta(
  parties: PartyLedgerSummary[],
  archiveMap: Map<string, PartyLedgerArchiveRecord>
): PartyLedgerSummary[] {
  return parties.map((p) => {
    const arch = archiveMap.get(p.partyKey);
    return {
      ...p,
      isArchived: !!arch,
      archivedAt: arch?.archivedAt ?? null,
      archivedBy: arch?.archivedBy ?? null,
    };
  });
}

function filterByVisibility(
  parties: PartyLedgerSummary[],
  visibility: PartyLedgerListOptions["visibility"]
) {
  if (visibility === "archived") return parties.filter((p) => p.isArchived);
  if (visibility === "all") return parties;
  return parties.filter((p) => !p.isArchived);
}

async function buildPartySummaries(
  userId: string,
  username: string,
  role: string,
  localDb?: Database
): Promise<PartyLedgerSummary[]> {
  const { invoices } = await loadVisibleInvoicesForStaff(userId, username, role, localDb);
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

    if (isExcludedFromLedgerTotals(inv.invoiceStatus, inv.archivedAt)) continue;

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

  return Array.from(map.values()).sort(
    (a, b) => b.balanceDue - a.balanceDue || a.name.localeCompare(b.name)
  );
}

async function assertPartyLedgerStaffAccess(userId: string, username: string, role: string, localDb?: Database) {
  await verifyStaffPortalUser(userId, username, localDb);
  const actor = toRequestActor(userId, username, role);
  try {
    FinanceOwnershipResolver.assertInvoiceStaffRouteAccess(actor);
  } catch (err) {
    mapFinanceOwnershipError(err);
  }
  return actor;
}

export async function listPartyLedgers(
  userId: string,
  username: string,
  role: string,
  localDb?: Database,
  options?: PartyLedgerListOptions
): Promise<PartyLedgerSummary[]> {
  const actor = await assertPartyLedgerStaffAccess(userId, username, role, localDb);

  const visibility = options?.visibility ?? "active";
  const [parties, archiveMap, allInvoiceRows] = await Promise.all([
    buildPartySummaries(userId, username, role, localDb),
    loadArchiveMap(localDb),
    FinanceOwnershipResolver.loadAllInvoiceRows(localDb),
  ]);

  const enriched = applyArchiveMeta(parties, archiveMap);

  if (visibility === "archived" || visibility === "all") {
    for (const arch of archiveMap.values()) {
      if (enriched.some((p) => p.partyKey === arch.partyKey)) continue;
      if (!FinanceOwnershipResolver.shouldIncludeArchiveSnapshot(actor, arch.partyKey, allInvoiceRows)) {
        continue;
      }
      enriched.push({
        partyKey: arch.partyKey,
        customerId: arch.customerId,
        name: arch.partyName || "Unknown party",
        phone: arch.partyPhone,
        billingAddress: null,
        totalSales: 0,
        receivedAmount: 0,
        balanceDue: 0,
        invoiceCount: 0,
        hasOverdue: false,
        isArchived: true,
        archivedAt: arch.archivedAt,
        archivedBy: arch.archivedBy,
      });
    }
  }

  return filterByVisibility(enriched, visibility).sort(
    (a, b) => b.balanceDue - a.balanceDue || a.name.localeCompare(b.name)
  );
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
  const { actor, invoices, visibleRows } = await loadVisibleInvoicesForStaff(
    userId,
    username,
    role,
    localDb
  );
  FinanceOwnershipResolver.assertPartyDetailVisible(actor, partyKey, visibleRows);

  const partyInvoices = invoices.filter((inv) => partyKeyFromInvoice(inv) === partyKey);
  const parties = await buildPartySummaries(userId, username, role, localDb);
  const archiveMap = await loadArchiveMap(localDb);
  const enriched = applyArchiveMeta(parties, archiveMap);
  let party = enriched.find((p) => p.partyKey === partyKey);
  if (!party) {
    throw new StaffPortalAuthError("Party not found.", 404);
  }

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

export async function archivePartyLedger(
  userId: string,
  username: string,
  role: string,
  partyKey: string,
  localDb?: Database
): Promise<PartyLedgerArchiveRecord> {
  const actor = await assertPartyLedgerStaffAccess(userId, username, role, localDb);

  try {
    await FinanceOwnershipResolver.assertPartyMutationAllowed(actor, partyKey, localDb);
  } catch (err) {
    mapFinanceOwnershipError(err);
  }

  const { visibleRows } = await loadVisibleInvoicesForStaff(userId, username, role, localDb);
  try {
    FinanceOwnershipResolver.assertPartyDetailVisible(actor, partyKey, visibleRows);
  } catch (err) {
    mapFinanceOwnershipError(err);
  }

  const parties = await buildPartySummaries(userId, username, role, localDb);
  const archiveMap = await loadArchiveMap(localDb);
  const enriched = applyArchiveMeta(parties, archiveMap);
  const party = enriched.find((p) => p.partyKey === partyKey);
  if (!party) {
    throw new StaffPortalAuthError("Party not found.", 404);
  }
  if (party.isArchived) {
    throw new StaffPortalAuthError("Party is already archived.", 400);
  }

  const row = {
    party_key: partyKey,
    customer_id: party.customerId,
    party_name: party.name,
    party_phone: party.phone,
    archived_at: new Date().toISOString(),
    archived_by: username,
  };
  await upsertArchiveRow(row, localDb);
  return mapArchiveRow(row);
}

export async function restorePartyLedger(
  userId: string,
  username: string,
  role: string,
  partyKey: string,
  localDb?: Database
): Promise<{ restored: true; partyKey: string }> {
  const actor = await assertPartyLedgerStaffAccess(userId, username, role, localDb);
  try {
    await FinanceOwnershipResolver.assertPartyMutationAllowed(actor, partyKey, localDb);
  } catch (err) {
    mapFinanceOwnershipError(err);
  }

  const archiveMap = await loadArchiveMap(localDb);
  if (!archiveMap.has(partyKey)) {
    throw new StaffPortalAuthError("Party is not archived.", 400);
  }

  await deleteArchiveRow(partyKey, localDb);
  return { restored: true, partyKey };
}

export async function hardDeletePartyLedger(
  userId: string,
  username: string,
  role: string,
  partyKey: string,
  localDb?: Database
): Promise<{ deleted: true; partyKey: string }> {
  const actor = await assertPartyLedgerStaffAccess(userId, username, role, localDb);
  try {
    await FinanceOwnershipResolver.assertPartyMutationAllowed(actor, partyKey, localDb);
  } catch (err) {
    mapFinanceOwnershipError(err);
  }

  const { transactions, payments } = await getPartyLedgerDetail(
    userId,
    username,
    role,
    partyKey,
    localDb
  );
  if (transactions.length > 0 || payments.length > 0) {
    throw new StaffPortalAuthError(
      "Cannot permanently delete a party that has invoices or payments. Archive instead.",
      400
    );
  }

  await deleteArchiveRow(partyKey, localDb);
  return { deleted: true, partyKey };
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
