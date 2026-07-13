import type { Database } from "../../dbManager";
import { getSupabase, isSupabaseActive } from "../../dbManager";
import { loadInvoiceRecordById } from "../../invoiceDb.ts";
import { isTechnicalStaffRole } from "../../src/lib/technicalStaff.ts";
import {
  isSalesOwnershipBypassRole,
  isSalesStaffRole,
  SalesOwnershipError,
  SalesOwnershipResolver,
} from "../ownership/SalesOwnershipResolver.ts";
import {
  TechnicianOwnershipError,
  TechnicianOwnershipResolver,
} from "../ownership/TechnicianOwnershipResolver.ts";
import type { RequestActor } from "./actor.ts";

export class FinanceRouteLockdownError extends Error {
  statusCode: 401 | 403 | 404;

  constructor(message: string, statusCode: 401 | 403 | 404 = 403) {
    super(message);
    this.name = "FinanceRouteLockdownError";
    this.statusCode = statusCode;
  }
}

/**
 * Generic /api/db/update is Super Admin only (deny-by-default).
 * Other roles must use dedicated ownership-aware routes.
 * Finance-sensitive table list is retained for documentation / targeted checks.
 */
export const FINANCE_SENSITIVE_DB_TABLES = new Set([
  "invoices",
  "invoice_items",
  "invoiceItems",
  "invoice_payments",
  "invoicePayments",
  "paymentTracks",
  "payment_tracks",
  "project_finance_records",
  "projectFinanceRecords",
  "internal_costing_sheets",
  "internalCostingSheets",
  "deliveryChallans",
  "delivery_challans",
  "partyLedgerArchives",
  "party_ledger_archives",
  "bankAccounts",
  "bank_accounts",
  "inventoryPurchases",
  "inventory_purchases",
  "purchaseOrders",
  "purchase_orders",
  "investors",
]);

export const EXPORT_PROTECTED_TABLES = new Set(["leads", "payments", "projects"]);

const EXPORT_FULL_ACCESS_ROLES = new Set([
  "Super Admin",
  "Director",
  "Admin",
  "Accounts Manager",
]);

const DELIVERY_EXPORT_BYPASS_ROLES = new Set(["Super Admin", "Director", "Admin"]);

const LEAD_OWNERSHIP_MUTATION_FIELDS = [
  "assigned_sales_user_id",
  "assignedSalesUserId",
  "assigned_salesperson",
  "assignedSalesperson",
  "bdmName",
  "bdm_name",
] as const;

export type ExportAccessMode = "deny" | "full" | "sales_scoped";

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

export function isFinanceSensitiveDbTable(table: string): boolean {
  return FINANCE_SENSITIVE_DB_TABLES.has(String(table || "").trim());
}

export function isSuperAdminRole(role: string): boolean {
  return role === "Super Admin";
}

export function assertSuperAdminOnly(actor: RequestActor | undefined): void {
  if (!actor) {
    throw new FinanceRouteLockdownError("Authentication required.", 401);
  }
  if (!isSuperAdminRole(actor.role)) {
    throw new FinanceRouteLockdownError("Super Admin access required.", 403);
  }
}

export function assertFinanceDbUpdateAllowed(actor: RequestActor | undefined, table: string): void {
  if (!isFinanceSensitiveDbTable(table)) return;
  assertSuperAdminOnly(actor);
}

export function touchesLeadOwnershipFields(data: Record<string, unknown> | null | undefined): boolean {
  if (!data || typeof data !== "object") return false;
  return LEAD_OWNERSHIP_MUTATION_FIELDS.some(
    (field) => Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined
  );
}

export function assertLeadOwnershipMutationAllowed(
  actor: RequestActor | undefined,
  action: string,
  table: string,
  data: Record<string, unknown> | null | undefined
): void {
  if (String(table || "").trim() !== "leads") return;
  if (action !== "add" && action !== "edit") return;
  if (!touchesLeadOwnershipFields(data)) return;
  assertSuperAdminOnly(actor);
}

export function assertDbUpdateAllowed(
  actor: RequestActor | undefined,
  _action: string,
  _table: string,
  _data: unknown
): void {
  // Deny-by-default: only Super Admin may mutate via the generic /api/db/update endpoint.
  // Sales, Technician, Accounts Manager, Customer, and other staff must use dedicated routes.
  assertSuperAdminOnly(actor);
}

export function resolveExportAccess(
  actor: RequestActor | undefined,
  table: string
): ExportAccessMode {
  const normalized = String(table || "").trim();
  if (!EXPORT_PROTECTED_TABLES.has(normalized)) {
    return "deny";
  }
  if (!actor) return "deny";
  if (EXPORT_FULL_ACCESS_ROLES.has(actor.role)) return "full";
  if (isSalesStaffRole(actor.role)) return "sales_scoped";
  return "deny";
}

export function assertExportTableAccess(
  actor: RequestActor | undefined,
  table: string
): ExportAccessMode {
  const mode = resolveExportAccess(actor, table);
  if (mode === "deny") {
    if (!actor) {
      throw new FinanceRouteLockdownError("Authentication required.", 401);
    }
    throw new FinanceRouteLockdownError("Not authorized to export this data.", 403);
  }
  return mode;
}

export function filterExportStateForSales(actor: RequestActor, state: Database): Database {
  return SalesOwnershipResolver.filterAppStateForActor(actor, state as Record<string, unknown>) as Database;
}

export async function assertPaymentMilestoneAccess(
  actor: RequestActor | undefined,
  leadId: string,
  localDb?: Database
): Promise<void> {
  if (!actor) {
    throw new FinanceRouteLockdownError("Authentication required.", 401);
  }
  if (isSalesOwnershipBypassRole(actor.role)) return;
  if (isSalesStaffRole(actor.role)) {
    try {
      await SalesOwnershipResolver.assertResourceOwnedByActor(actor, "lead", leadId, localDb);
    } catch (err) {
      if (err instanceof SalesOwnershipError) {
        throw new FinanceRouteLockdownError(err.message, err.statusCode);
      }
      throw err;
    }
    return;
  }
  throw new FinanceRouteLockdownError("Not authorized to update payment milestones.", 403);
}

async function loadDeliveryChallanRow(
  challanId: string,
  localDb?: Database
): Promise<Record<string, unknown> | null> {
  const id = String(challanId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!.from("delivery_challans").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = ((localDb as any)?.deliveryChallans || []).find((r: any) => r.id === id);
  return (row as Record<string, unknown>) || null;
}

async function resolveChallanLeadId(
  challan: Record<string, unknown>,
  localDb?: Database
): Promise<string | null> {
  const direct = readField(challan, "lead_id", "leadId");
  if (direct) return direct;
  const invoiceId = readField(challan, "invoice_id", "invoiceId");
  if (!invoiceId) return null;
  try {
    const invoice = await loadInvoiceRecordById(invoiceId, localDb);
    return invoice.leadId || null;
  } catch {
    return null;
  }
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

  throw new FinanceRouteLockdownError("Not authorized for this delivery.", 403);
}

/** Delivery challan PDF/certificate export — staff ownership enforced (customer portal uses separate routes). */
export async function assertDeliveryChallanExportAccess(
  actor: RequestActor | undefined,
  challanId: string,
  localDb?: Database
): Promise<void> {
  if (!actor) {
    throw new FinanceRouteLockdownError("Authentication required.", 401);
  }
  if (actor.role === "Customer") {
    throw new FinanceRouteLockdownError("Not authorized for staff routes.", 403);
  }
  if (DELIVERY_EXPORT_BYPASS_ROLES.has(actor.role)) return;

  const challan = await loadDeliveryChallanRow(challanId, localDb);
  if (!challan) {
    throw new FinanceRouteLockdownError("Delivery challan not found.", 404);
  }

  if (isSalesStaffRole(actor.role)) {
    const leadId = await resolveChallanLeadId(challan, localDb);
    if (!leadId) {
      throw new FinanceRouteLockdownError("Delivery challan not found.", 404);
    }
    try {
      await SalesOwnershipResolver.assertResourceOwnedByActor(actor, "lead", leadId, localDb);
    } catch (err) {
      if (err instanceof SalesOwnershipError) {
        throw new FinanceRouteLockdownError(err.message, err.statusCode);
      }
      throw err;
    }
    return;
  }

  if (isTechnicalStaffRole(actor.role)) {
    try {
      await assertTechnicianDeliveryChallanAccess(actor, challan, localDb);
    } catch (err) {
      if (err instanceof TechnicianOwnershipError) {
        throw new FinanceRouteLockdownError(err.message, err.statusCode);
      }
      throw err;
    }
    return;
  }

  throw new FinanceRouteLockdownError("Not authorized for this delivery.", 403);
}

export function financeRouteLockdownErrorResponse(
  err: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void; send: (body: string) => void } }
): boolean {
  if (err instanceof FinanceRouteLockdownError) {
    if (err.statusCode === 404) {
      res.status(404).json({ error: err.message });
    } else {
      res.status(err.statusCode).json({ error: err.message });
    }
    return true;
  }
  return false;
}
