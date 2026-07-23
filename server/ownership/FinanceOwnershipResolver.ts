import type { Database } from "../../dbManager";
import { getSupabase, isSupabaseActive } from "../../dbManager";
import { canCreateInvoice } from "../../src/lib/invoices.ts";
import { isTechnicalStaffRole } from "../../src/lib/technicalStaff.ts";
import type { RequestActor } from "../middleware/actor.ts";
import { isSalesStaffRole } from "./SalesOwnershipResolver.ts";
import {
  TechnicianOwnershipError,
  TechnicianOwnershipResolver,
} from "./TechnicianOwnershipResolver.ts";

export type FinanceOwnedResourceType =
  | "invoice"
  | "invoice_item"
  | "invoice_payment"
  | "delivery_challan"
  | "delivery_challan_photo"
  | "project_finance_record"
  | "internal_costing_sheet"
  | "inventory_purchase"
  | "party_ledger"
  | "invoice_pdf"
  | "delivery_challan_pdf";

export class FinanceOwnershipError extends Error {
  statusCode: 401 | 403 | 404;

  constructor(message: string, statusCode: 401 | 403 | 404 = 403) {
    super(message);
    this.name = "FinanceOwnershipError";
    this.statusCode = statusCode;
  }
}

const FINANCE_STAFF_ROLES = new Set(["Accounts Manager"]);
const OWNERSHIP_BYPASS_ROLES = new Set(["Super Admin", "Director", "Admin"]);

function normalizeToken(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function readField(row: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

/** Durable finance owner — created_by_user_id only. */
export function readFinanceOwnerUserId(row: Record<string, unknown> | null | undefined): string {
  return readField(row, "created_by_user_id", "createdByUserId");
}

/** Legacy creator text — username or user id stored in created_by. */
export function readLegacyFinanceCreatedBy(row: Record<string, unknown> | null | undefined): string {
  return readField(row, "created_by", "createdBy");
}

export function isFinanceStaffRole(role: string): boolean {
  return FINANCE_STAFF_ROLES.has(role);
}

export function isFinanceOwnershipBypassRole(role: string): boolean {
  return OWNERSHIP_BYPASS_ROLES.has(role);
}

/** Invoice list/detail bypass — Director and Super Admin see all invoices. */
export function isInvoiceListBypassRole(role: string): boolean {
  return role === "Super Admin" || role === "Director";
}

export function assertInvoiceStaffRouteAccess(actor: RequestActor | undefined): void {
  if (!actor) {
    throw new FinanceOwnershipError("Unauthorized", 401);
  }
  if (actor.role === "Customer") {
    throw new FinanceOwnershipError("Not authorized for invoice routes.", 403);
  }
  if (isTechnicalStaffRole(actor.role)) {
    throw new FinanceOwnershipError("Not authorized for invoice routes.", 403);
  }
  if (isInvoiceListBypassRole(actor.role)) return;
  if (actor.role === "Admin") return;
  if (isFinanceStaffRole(actor.role)) return;
  if (isSalesStaffRole(actor.role) || actor.role === "Sales Manager") return;
  if (canCreateInvoice(actor.username, actor.role)) return;
  throw new FinanceOwnershipError("Not authorized for invoice routes.", 403);
}

export function filterInvoiceRowsForActor(
  actor: RequestActor,
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  if (isInvoiceListBypassRole(actor.role)) return rows;
  return rows.filter((row) => isRowFinanceOwnedByActor(actor, row));
}

/**
 * Exact match only: normalized username or display name.
 * Also accepts created_by stored as durable user id string.
 */
export function legacyFinanceCreatedByMatches(actor: RequestActor, createdBy: string): boolean {
  const raw = String(createdBy || "").trim();
  if (!raw) return false;
  if (raw === actor.id) return true;
  const token = normalizeToken(raw);
  return token === normalizeToken(actor.username) || token === normalizeToken(actor.name);
}

export function assertRowFinanceOwnedByActor(
  actor: RequestActor,
  row: Record<string, unknown> | null | undefined
): void {
  const ownerUserId = readFinanceOwnerUserId(row);
  if (ownerUserId) {
    if (ownerUserId !== actor.id) {
      throw new FinanceOwnershipError("You cannot access another finance user's record.", 403);
    }
    return;
  }
  // TODO(phase-1b-backfill): remove legacy created_by username/name fallback after data backfill.
  const legacyCreatedBy = readLegacyFinanceCreatedBy(row);
  if (!legacyCreatedBy) {
    throw new FinanceOwnershipError("Finance record is not assigned to you.", 403);
  }
  if (!legacyFinanceCreatedByMatches(actor, legacyCreatedBy)) {
    throw new FinanceOwnershipError("You cannot access another finance user's record.", 403);
  }
}

/** Finance resource rows — durable id or exact legacy user id in created_by only. */
export function assertRowFinanceResourceOwnedByActor(
  actor: RequestActor,
  row: Record<string, unknown> | null | undefined
): void {
  const ownerUserId = readFinanceOwnerUserId(row);
  if (ownerUserId) {
    if (ownerUserId !== actor.id) {
      throw new FinanceOwnershipError("You cannot access another finance user's record.", 403);
    }
    return;
  }
  // TODO(phase-1b-backfill): remove legacy created_by user-id fallback after data backfill.
  const legacyCreatedBy = readLegacyFinanceCreatedBy(row);
  if (!legacyCreatedBy || legacyCreatedBy !== actor.id) {
    throw new FinanceOwnershipError("You cannot access another finance user's record.", 403);
  }
}

export function isRowFinanceResourceOwnedByActor(
  actor: RequestActor,
  row: Record<string, unknown> | null | undefined
): boolean {
  try {
    assertRowFinanceResourceOwnedByActor(actor, row);
    return true;
  } catch {
    return false;
  }
}

export function filterFinanceResourceRowsForActor(
  actor: RequestActor,
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  if (isFinanceOwnershipBypassRole(actor.role)) return rows;
  return rows.filter((row) => isRowFinanceResourceOwnedByActor(actor, row));
}

export function assertFinanceResourceRouteAccess(actor: RequestActor | undefined): void {
  if (!actor) {
    throw new FinanceOwnershipError("Unauthorized", 401);
  }
  if (actor.role === "Customer") {
    throw new FinanceOwnershipError("Not authorized for finance resource routes.", 403);
  }
  if (isTechnicalStaffRole(actor.role)) {
    throw new FinanceOwnershipError("Not authorized for finance resource routes.", 403);
  }
  if (isSalesStaffRole(actor.role) || actor.role === "Sales Manager") {
    throw new FinanceOwnershipError("Not authorized for finance resource routes.", 403);
  }
  if (isFinanceOwnershipBypassRole(actor.role)) return;
  if (isFinanceStaffRole(actor.role)) return;
  throw new FinanceOwnershipError("Not authorized for finance resource routes.", 403);
}

async function assertProjectFinanceModuleOwnedByActor(
  actor: RequestActor,
  recordId: string,
  localDb?: Database
): Promise<void> {
  assertFinanceResourceRouteAccess(actor);
  if (isFinanceOwnershipBypassRole(actor.role)) return;
  const record = await loadProjectFinanceRow(recordId, localDb);
  if (!record) {
    throw new FinanceOwnershipError("Project finance record not found.", 404);
  }
  assertRowFinanceResourceOwnedByActor(actor, record);
}

async function assertInternalCostingSheetModuleOwnedByActor(
  actor: RequestActor,
  sheetId: string,
  localDb?: Database
): Promise<void> {
  if (isFinanceOwnershipBypassRole(actor.role)) return;
  const sheet = await loadInternalCostingSheetRow(sheetId, localDb);
  if (!sheet) {
    throw new FinanceOwnershipError("Internal costing sheet not found.", 404);
  }
  assertRowFinanceResourceOwnedByActor(actor, sheet);
}

async function assertInventoryPurchaseModuleOwnedByActor(
  actor: RequestActor,
  purchaseId: string,
  localDb?: Database
): Promise<void> {
  if (isFinanceOwnershipBypassRole(actor.role)) return;
  const purchase = await loadInventoryPurchaseRow(purchaseId, localDb);
  if (!purchase) {
    throw new FinanceOwnershipError("Inventory purchase not found.", 404);
  }
  assertRowFinanceResourceOwnedByActor(actor, purchase);
}

export function isRowFinanceOwnedByActor(
  actor: RequestActor,
  row: Record<string, unknown> | null | undefined
): boolean {
  try {
    assertRowFinanceOwnedByActor(actor, row);
    return true;
  } catch {
    return false;
  }
}

export function partyKeyFromInvoiceRow(row: Record<string, unknown>): string {
  const customerId = readField(row, "customer_id", "customerId");
  if (customerId) return `cid:${customerId}`;
  const name = normalizeToken(String(row.customer_name || row.customerName || ""));
  const phone = String(row.customer_phone || row.customerPhone || "").trim();
  return `name:${name}|${phone}`;
}

async function loadInvoiceRow(invoiceId: string, localDb?: Database): Promise<Record<string, unknown> | null> {
  const id = String(invoiceId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!.from("invoices").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = ((localDb as any)?.invoices || []).find((r: any) => r.id === id);
  return (row as Record<string, unknown>) || null;
}

async function loadInvoiceItemRow(itemId: string, localDb?: Database): Promise<Record<string, unknown> | null> {
  const id = String(itemId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!.from("invoice_items").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = ((localDb as any)?.invoiceItems || []).find((r: any) => r.id === id);
  return (row as Record<string, unknown>) || null;
}

async function loadInvoicePaymentRow(paymentId: string, localDb?: Database): Promise<Record<string, unknown> | null> {
  const id = String(paymentId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!.from("invoice_payments").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = ((localDb as any)?.invoicePayments || []).find((r: any) => r.id === id);
  return (row as Record<string, unknown>) || null;
}

async function loadDeliveryChallanRow(challanId: string, localDb?: Database): Promise<Record<string, unknown> | null> {
  const id = String(challanId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!.from("delivery_challans").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = ((localDb as any)?.deliveryChallans || []).find((r: any) => r.id === id);
  return (row as Record<string, unknown>) || null;
}

async function loadDeliveryChallanPhotoRow(
  photoId: string,
  localDb?: Database
): Promise<Record<string, unknown> | null> {
  const id = String(photoId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!.from("delivery_challan_photos").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = ((localDb as any)?.deliveryChallanPhotos || []).find((r: any) => r.id === id);
  return (row as Record<string, unknown>) || null;
}

async function loadProjectFinanceRow(recordId: string, localDb?: Database): Promise<Record<string, unknown> | null> {
  const id = String(recordId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("project_finance_records")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = (localDb?.projectFinanceRecords || []).find((r: any) => r.id === id);
  return (row as Record<string, unknown>) || null;
}

async function loadInternalCostingSheetRow(sheetId: string, localDb?: Database): Promise<Record<string, unknown> | null> {
  const id = String(sheetId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("internal_costing_sheets")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = (localDb?.internalCostingSheets || []).find((r: any) => r.id === id);
  return (row as Record<string, unknown>) || null;
}

async function loadInventoryPurchaseRow(purchaseId: string, localDb?: Database): Promise<Record<string, unknown> | null> {
  const id = String(purchaseId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("inventory_purchases")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = (localDb?.inventoryPurchases || []).find((r: any) => r.id === id);
  return (row as Record<string, unknown>) || null;
}

export function assertPartyLedgerStaffRouteAccess(actor: RequestActor | undefined): void {
  assertInvoiceStaffRouteAccess(actor);
}

async function loadAllInvoiceRows(localDb?: Database): Promise<Record<string, unknown>[]> {
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!.from("invoices").select("*");
    return (data as Record<string, unknown>[]) || [];
  }
  return (((localDb as any)?.invoices || []) as Record<string, unknown>[]) || [];
}

async function getVisibleInvoiceRowsForActor(
  actor: RequestActor,
  localDb?: Database
): Promise<Record<string, unknown>[]> {
  const all = await loadAllInvoiceRows(localDb);
  return filterInvoiceRowsForActor(actor, all);
}

function visibleRowsForParty(
  visibleRows: Record<string, unknown>[],
  partyKey: string
): Record<string, unknown>[] {
  const key = String(partyKey || "").trim();
  return visibleRows.filter((row) => partyKeyFromInvoiceRow(row) === key);
}

export function assertPartyDetailVisible(
  actor: RequestActor,
  partyKey: string,
  visibleRows: Record<string, unknown>[]
): void {
  assertPartyLedgerStaffRouteAccess(actor);
  if (visibleRowsForParty(visibleRows, partyKey).length === 0) {
    throw new FinanceOwnershipError("Party not found.", 404);
  }
}


export function assertDeliveryStaffRouteAccess(actor: RequestActor | undefined): void {
  if (!actor) {
    throw new FinanceOwnershipError("Unauthorized", 401);
  }
  if (actor.role === "Customer") {
    throw new FinanceOwnershipError("Not authorized for delivery routes.", 403);
  }
  if (isInvoiceListBypassRole(actor.role)) return;
  if (isTechnicalStaffRole(actor.role)) return;
  if (actor.role === "Admin") return;
  if (isFinanceStaffRole(actor.role)) return;
  if (isSalesStaffRole(actor.role) || actor.role === "Sales Manager") return;
  if (canCreateInvoice(actor.username, actor.role)) return;
  throw new FinanceOwnershipError("Not authorized for delivery routes.", 403);
}

async function resolveChallanLeadId(
  challan: Record<string, unknown>,
  localDb?: Database
): Promise<string | null> {
  const direct = readField(challan, "lead_id", "leadId");
  if (direct) return direct;
  const invoiceId = readField(challan, "invoice_id", "invoiceId");
  if (!invoiceId) return null;
  const invoice = await loadInvoiceRow(invoiceId, localDb);
  return invoice ? readField(invoice, "lead_id", "leadId") : null;
}

async function findProjectDeliveryIdForTechnicianOnLead(
  actorId: string,
  leadId: string,
  localDb?: Database
): Promise<string | null> {
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("project_deliveries")
      .select("id")
      .eq("lead_id", leadId)
      .eq("assigned_technician_user_id", actorId)
      .maybeSingle();
    return data?.id ? String(data.id) : null;
  }
  const row = (localDb?.projectDeliveries || []).find(
    (delivery: any) =>
      String(delivery.lead_id || delivery.leadId || "") === leadId &&
      String(delivery.assigned_technician_user_id || delivery.assignedTechnicianUserId || "") === actorId
  );
  return row?.id ? String(row.id) : null;
}

async function assertTechnicianDeliveryChallanAccess(
  actor: RequestActor,
  challan: Record<string, unknown>,
  localDb?: Database
): Promise<void> {
  const projectId = readField(challan, "project_id", "projectId");
  if (projectId) {
    try {
      await TechnicianOwnershipResolver.assertResourceOwnedByActor(
        actor,
        "delivery_record",
        projectId,
        localDb
      );
      return;
    } catch (err) {
      if (!(err instanceof TechnicianOwnershipError)) throw err;
    }
  }

  const leadId = await resolveChallanLeadId(challan, localDb);
  if (leadId) {
    const deliveryId = await findProjectDeliveryIdForTechnicianOnLead(actor.id, leadId, localDb);
    if (deliveryId) {
      await TechnicianOwnershipResolver.assertResourceOwnedByActor(
        actor,
        "delivery_record",
        deliveryId,
        localDb
      );
      return;
    }
  }

  throw new FinanceOwnershipError("Not authorized for this delivery.", 403);
}

async function assertDeliveryInvoiceModuleOwnedByActor(
  actor: RequestActor,
  invoiceId: string,
  localDb?: Database
): Promise<void> {
  if (isInvoiceListBypassRole(actor.role)) return;

  if (isTechnicalStaffRole(actor.role)) {
    const invoice = await loadInvoiceRow(invoiceId, localDb);
    if (!invoice) {
      throw new FinanceOwnershipError("Invoice not found.", 404);
    }
    await assertTechnicianDeliveryChallanAccess(actor, invoice, localDb);
    return;
  }

  assertDeliveryStaffRouteAccess(actor);
  await assertInvoiceModuleOwnedByActor(actor, invoiceId, localDb);
}

async function assertDeliveryChallanModuleOwnedByActor(
  actor: RequestActor,
  challanId: string,
  localDb?: Database
): Promise<void> {
  if (isInvoiceListBypassRole(actor.role)) return;

  const challan = await loadDeliveryChallanRow(challanId, localDb);
  if (!challan) {
    throw new FinanceOwnershipError("Delivery challan not found.", 404);
  }

  if (isTechnicalStaffRole(actor.role)) {
    await assertTechnicianDeliveryChallanAccess(actor, challan, localDb);
    return;
  }

  const invoiceId = readField(challan, "invoice_id", "invoiceId");
  if (!invoiceId) {
    throw new FinanceOwnershipError("Delivery challan not found.", 404);
  }

  assertDeliveryStaffRouteAccess(actor);
  await assertInvoiceModuleOwnedByActor(actor, invoiceId, localDb);
}

async function assertDeliveryChallanPhotoModuleOwnedByActor(
  actor: RequestActor,
  photoId: string,
  localDb?: Database
): Promise<void> {
  const photo = await loadDeliveryChallanPhotoRow(photoId, localDb);
  if (!photo) {
    throw new FinanceOwnershipError("Delivery challan photo not found.", 404);
  }
  const challanId = readField(photo, "challan_id", "challanId");
  if (!challanId) {
    throw new FinanceOwnershipError("Delivery challan photo not found.", 404);
  }
  await assertDeliveryChallanModuleOwnedByActor(actor, challanId, localDb);
}

async function assertPartyMutationAllowed(
  actor: RequestActor,
  partyKey: string,
  localDb?: Database
): Promise<void> {
  assertPartyLedgerStaffRouteAccess(actor);
  if (isInvoiceListBypassRole(actor.role)) return;

  const key = String(partyKey || "").trim();
  if (!key) {
    throw new FinanceOwnershipError("Party not found.", 404);
  }

  const all = await loadAllInvoiceRows(localDb);
  const partyInvoices = all.filter((row) => partyKeyFromInvoiceRow(row) === key);
  if (partyInvoices.length === 0) return;

  for (const row of partyInvoices) {
    if (!isRowFinanceOwnedByActor(actor, row)) {
      throw new FinanceOwnershipError(
        "You cannot modify a party that includes invoices owned by another user.",
        403
      );
    }
  }
}

export function shouldIncludeArchiveSnapshot(
  actor: RequestActor,
  partyKey: string,
  allInvoiceRows: Record<string, unknown>[]
): boolean {
  if (isInvoiceListBypassRole(actor.role)) return true;
  const partyInvoices = allInvoiceRows.filter((row) => partyKeyFromInvoiceRow(row) === partyKey);
  if (partyInvoices.length === 0) return false;
  return partyInvoices.every((row) => isRowFinanceOwnedByActor(actor, row));
}

async function assertInvoiceOwnedByActor(
  actor: RequestActor,
  invoiceId: string,
  localDb?: Database
): Promise<void> {
  const invoice = await loadInvoiceRow(invoiceId, localDb);
  if (!invoice) {
    throw new FinanceOwnershipError("Invoice not found.", 404);
  }
  assertRowFinanceOwnedByActor(actor, invoice);
}

/** Invoice module ownership — Admin/Sales/Accounts Manager own-only; Director/Super Admin bypass. */
async function assertInvoiceModuleOwnedByActor(
  actor: RequestActor,
  invoiceId: string,
  localDb?: Database
): Promise<void> {
  assertInvoiceStaffRouteAccess(actor);
  if (isInvoiceListBypassRole(actor.role)) return;
  await assertInvoiceOwnedByActor(actor, invoiceId, localDb);
}

async function assertPartyLedgerOwnedByActor(
  actor: RequestActor,
  partyKey: string,
  localDb?: Database
): Promise<void> {
  assertPartyLedgerStaffRouteAccess(actor);
  const visible = await getVisibleInvoiceRowsForActor(actor, localDb);
  assertPartyDetailVisible(actor, partyKey, visible);
}

export function financeOwnershipErrorResponse(
  err: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void; send: (body: string) => void } }
): boolean {
  if (err instanceof FinanceOwnershipError) {
    res.status(err.statusCode).json({ error: err.message });
    return true;
  }
  return false;
}

/** Finance collections stripped from CRM boot state for all actors. */
const FINANCE_BOOT_STRIP_KEYS = [
  "invoices",
  "invoiceItems",
  "invoicePayments",
  "deliveryChallans",
  "deliveryChallanItems",
  "deliveryChallanPhotos",
  "projectFinanceRecords",
  "internalCostingSheets",
  "inventoryPurchases",
  "partyLedgerArchives",
  "investors",
] as const;

/** Known safe keys for GET /api/state — unknown keys are removed (fail closed). */
const CRM_BOOT_STATE_ALLOWLIST = new Set([
  "leads",
  "tickets",
  "netMeteringHistory",
  "inventory",
  "projects",
  "netMeteringTrackers",
  "paymentTracks",
  "activityLogs",
  "whatsAppLogs",
  "purchaseOrders",
  "categories",
  "products",
  "orders",
  "warranties",
  "notifications",
  "solarPackages",
  "settings",
  "websiteContent",
  "quotations",
  "quoteTemplates",
  "quoteTemplatePages",
  "bankAccounts",
  "companyTerms",
  "ceoMessages",
  "socialLinks",
  "structureDescriptions",
  "quotePdfSettings",
  "stats",
  "currentUser",
]);

function maskBankAccountForStaff(row: Record<string, unknown>): Record<string, unknown> {
  const rawNumber = String(
    row.accountNumber ?? row.account_number ?? row.accountNo ?? ""
  ).trim();
  const masked =
    rawNumber.length > 4
      ? `${"*".repeat(rawNumber.length - 4)}${rawNumber.slice(-4)}`
      : rawNumber
        ? "****"
        : "";
  const maskedRow: Record<string, unknown> = {
    bankName: row.bankName ?? row.bank_name ?? "",
    accountTitle: row.accountTitle ?? row.account_title ?? row.title ?? "",
    accountNumber: masked,
    showOnInvoice: !!(row.showOnInvoice ?? row.show_on_invoice),
    isActive: !!(row.isActive ?? row.is_active ?? true),
  };
  if (row.id != null) maskedRow.id = row.id;
  return maskedRow;
}

function filterAppStateForActor<T extends Record<string, unknown>>(actor: RequestActor, state: T): T {
  const bypass = isFinanceOwnershipBypassRole(actor.role);
  const result: Record<string, unknown> = { ...state };

  for (const key of FINANCE_BOOT_STRIP_KEYS) {
    delete result[key];
  }

  for (const key of Object.keys(result)) {
    if (!CRM_BOOT_STATE_ALLOWLIST.has(key)) {
      delete result[key];
    }
  }

  if (!bypass) {
    if (result.purchaseOrders !== undefined) {
      result.purchaseOrders = [];
    }
    if (result.bankAccounts !== undefined) {
      const accounts = Array.isArray(result.bankAccounts) ? result.bankAccounts : [];
      result.bankAccounts = accounts.map((row) =>
        maskBankAccountForStaff(row as Record<string, unknown>)
      );
    }
  }

  return result as T;
}

export const FinanceOwnershipResolver = {
  isFinanceStaffRole,
  isFinanceOwnershipBypassRole,
  isInvoiceListBypassRole,
  assertInvoiceStaffRouteAccess,
  assertPartyLedgerStaffRouteAccess,
  filterInvoiceRowsForActor,
  partyKeyFromInvoiceRow,
  assertPartyDetailVisible,
  shouldIncludeArchiveSnapshot,

  async loadAllInvoiceRows(localDb?: Database): Promise<Record<string, unknown>[]> {
    return loadAllInvoiceRows(localDb);
  },

  async getVisibleInvoiceRowsForActor(
    actor: RequestActor,
    localDb?: Database
  ): Promise<Record<string, unknown>[]> {
    assertPartyLedgerStaffRouteAccess(actor);
    return getVisibleInvoiceRowsForActor(actor, localDb);
  },

  async assertPartyMutationAllowed(
    actor: RequestActor | undefined,
    partyKey: string,
    localDb?: Database
  ): Promise<void> {
    if (!actor) {
      throw new FinanceOwnershipError("Unauthorized", 401);
    }
    await assertPartyMutationAllowed(actor, partyKey, localDb);
  },

  assertDeliveryStaffRouteAccess,

  assertFinanceResourceRouteAccess,
  filterFinanceResourceRowsForActor,
  assertRowFinanceResourceOwnedByActor,
  isRowFinanceResourceOwnedByActor,
  filterAppStateForActor,

  async assertProjectFinanceRecordOwnedByActor(
    actor: RequestActor | undefined,
    recordId: string,
    localDb?: Database
  ): Promise<void> {
    if (!actor) {
      throw new FinanceOwnershipError("Unauthorized", 401);
    }
    await assertProjectFinanceModuleOwnedByActor(actor, recordId, localDb);
  },

  async assertInternalCostingSheetOwnedByActor(
    actor: RequestActor | undefined,
    sheetId: string,
    localDb?: Database
  ): Promise<void> {
    if (!actor) {
      throw new FinanceOwnershipError("Unauthorized", 401);
    }
    await assertInternalCostingSheetModuleOwnedByActor(actor, sheetId, localDb);
  },

  async assertInventoryPurchaseOwnedByActor(
    actor: RequestActor | undefined,
    purchaseId: string,
    localDb?: Database
  ): Promise<void> {
    if (!actor) {
      throw new FinanceOwnershipError("Unauthorized", 401);
    }
    await assertInventoryPurchaseModuleOwnedByActor(actor, purchaseId, localDb);
  },

  async assertDeliveryInvoiceOwnedByActor(
    actor: RequestActor | undefined,
    invoiceId: string,
    localDb?: Database
  ): Promise<void> {
    if (!actor) {
      throw new FinanceOwnershipError("Unauthorized", 401);
    }
    await assertDeliveryInvoiceModuleOwnedByActor(actor, invoiceId, localDb);
  },

  async assertDeliveryChallanOwnedByActor(
    actor: RequestActor | undefined,
    challanId: string,
    localDb?: Database
  ): Promise<void> {
    if (!actor) {
      throw new FinanceOwnershipError("Unauthorized", 401);
    }
    await assertDeliveryChallanModuleOwnedByActor(actor, challanId, localDb);
  },

  async assertDeliveryChallanPhotoOwnedByActor(
    actor: RequestActor | undefined,
    photoId: string,
    localDb?: Database
  ): Promise<void> {
    if (!actor) {
      throw new FinanceOwnershipError("Unauthorized", 401);
    }
    await assertDeliveryChallanPhotoModuleOwnedByActor(actor, photoId, localDb);
  },

  async assertInvoiceModuleOwnedByActor(
    actor: RequestActor | undefined,
    invoiceId: string,
    localDb?: Database
  ): Promise<void> {
    if (!actor) {
      throw new FinanceOwnershipError("Unauthorized", 401);
    }
    await assertInvoiceModuleOwnedByActor(actor, invoiceId, localDb);
  },

  async assertInvoicePdfOwnedByActor(
    actor: RequestActor | undefined,
    invoiceId: string,
    localDb?: Database
  ): Promise<void> {
    await this.assertInvoiceModuleOwnedByActor(actor, invoiceId, localDb);
  },

  shouldEnforceForActor(actor: RequestActor | undefined): boolean {
    if (!actor) return true;
    return !isFinanceOwnershipBypassRole(actor.role);
  },

  assertFinanceActor(actor: RequestActor | undefined): string {
    if (!actor) {
      throw new FinanceOwnershipError("Unauthorized", 401);
    }
    if (!isFinanceStaffRole(actor.role)) {
      throw new FinanceOwnershipError("Not authorized for finance ownership scope.");
    }
    return actor.id;
  },

  async assertResourceOwnedByActor(
    actor: RequestActor | undefined,
    resourceType: FinanceOwnedResourceType,
    resourceId: string,
    localDb?: Database
  ): Promise<void> {
    if (!actor) {
      throw new FinanceOwnershipError("Unauthorized", 401);
    }

    const id = String(resourceId || "").trim();
    if (!id) {
      throw new FinanceOwnershipError("Resource not found.", 404);
    }

    if (
      resourceType === "delivery_challan" ||
      resourceType === "delivery_challan_pdf" ||
      resourceType === "delivery_challan_photo"
    ) {
      switch (resourceType) {
        case "delivery_challan":
        case "delivery_challan_pdf":
          await assertDeliveryChallanModuleOwnedByActor(actor, id, localDb);
          return;
        case "delivery_challan_photo":
          await assertDeliveryChallanPhotoModuleOwnedByActor(actor, id, localDb);
          return;
      }
    }

    if (
      resourceType === "project_finance_record" ||
      resourceType === "internal_costing_sheet" ||
      resourceType === "inventory_purchase"
    ) {
      switch (resourceType) {
        case "project_finance_record":
          await assertProjectFinanceModuleOwnedByActor(actor, id, localDb);
          return;
        case "internal_costing_sheet":
          await assertInternalCostingSheetModuleOwnedByActor(actor, id, localDb);
          return;
        case "inventory_purchase":
          await assertInventoryPurchaseModuleOwnedByActor(actor, id, localDb);
          return;
      }
    }

    if (!this.shouldEnforceForActor(actor)) return;

    if (!isFinanceStaffRole(actor.role)) {
      throw new FinanceOwnershipError("Not authorized for this finance resource.", 403);
    }

    switch (resourceType as string) {
      case "invoice":
      case "invoice_pdf": {
        await assertInvoiceOwnedByActor(actor, id, localDb);
        return;
      }
      case "invoice_item": {
        const item = await loadInvoiceItemRow(id, localDb);
        if (!item) {
          throw new FinanceOwnershipError("Invoice item not found.", 404);
        }
        const invoiceId = readField(item, "invoice_id", "invoiceId");
        if (!invoiceId) {
          throw new FinanceOwnershipError("Invoice item not found.", 404);
        }
        await assertInvoiceOwnedByActor(actor, invoiceId, localDb);
        return;
      }
      case "invoice_payment": {
        const payment = await loadInvoicePaymentRow(id, localDb);
        if (!payment) {
          throw new FinanceOwnershipError("Invoice payment not found.", 404);
        }
        const invoiceId = readField(payment, "invoice_id", "invoiceId");
        if (!invoiceId) {
          throw new FinanceOwnershipError("Invoice payment not found.", 404);
        }
        await assertInvoiceOwnedByActor(actor, invoiceId, localDb);
        return;
      }
      case "project_finance_record": {
        await assertProjectFinanceModuleOwnedByActor(actor, id, localDb);
        return;
      }
      case "internal_costing_sheet": {
        await assertInternalCostingSheetModuleOwnedByActor(actor, id, localDb);
        return;
      }
      case "inventory_purchase": {
        await assertInventoryPurchaseModuleOwnedByActor(actor, id, localDb);
        return;
      }
      case "party_ledger": {
        await assertPartyLedgerOwnedByActor(actor, id, localDb);
        return;
      }
      default:
        throw new FinanceOwnershipError("Resource not found.", 404);
    }
  },
};
