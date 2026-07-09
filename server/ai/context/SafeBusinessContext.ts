/**
 * Safe, permission-filtered business summaries for AI chat (V2).
 * Counts and aggregates only — never full CRM rows or PII.
 */

import type { Database } from "../../../dbManager.ts";
import { filterActiveLeads } from "../../../src/lib/leadSoftDelete.ts";
import { isTechnicalStaffRole } from "../../../src/lib/technicalStaff.ts";
import type { RequestActor } from "../../middleware/actor.ts";
import {
  FinanceOwnershipResolver,
  isFinanceStaffRole,
} from "../../ownership/FinanceOwnershipResolver.ts";
import { OwnershipResolver } from "../../ownership/OwnershipResolver.ts";
import {
  isRowSalesOwnedByActor,
  isSalesOwnershipBypassRole,
  SalesOwnershipResolver,
} from "../../ownership/SalesOwnershipResolver.ts";
import {
  isRowAssignedToActor,
  readAssignedUserId,
  TechnicianOwnershipResolver,
} from "../../ownership/TechnicianOwnershipResolver.ts";

export const SAFE_BUSINESS_CONTEXT_MAX_CHARS = 2048;

const SENSITIVE_FIELD_PATTERN =
  /phone|cnic|address|email|bank|account|iban|password|payment.?method|private.?note|customer.?name|notes/i;

const ADMIN_BROAD_ROLES = new Set(["Admin", "Director", "Super Admin", "Technical CEO"]);

/** Only these strings may appear as grouping keys in AI context JSON. */
export const SAFE_BUCKET_LABELS = [
  "new",
  "contacted",
  "survey_scheduled",
  "quoted",
  "contracted",
  "installed",
  "negotiation",
  "won",
  "lost",
  "installation",
  "in_progress",
  "lead",
  "site_survey",
  "design_approval",
  "quotation_approved",
  "advance_received",
  "equipment_procurement",
  "installation_scheduled",
  "installation_completed",
  "net_metering_submitted",
  "net_metering_approved",
  "commissioned",
  "material_procurement",
  "structure_installation",
  "panel_installation",
  "inverter_installation",
  "testing_commissioning",
  "completed",
  "open",
  "resolved",
  "closed",
  "assigned",
  "pending",
  "delivered",
  "cancelled",
  "scheduled",
  "in_transit",
  "paid",
  "unpaid",
  "overdue",
  "other",
  "unknown",
] as const;

export type SafeBucketLabel = (typeof SAFE_BUCKET_LABELS)[number];

const SAFE_BUCKET_LABEL_SET = new Set<string>(SAFE_BUCKET_LABELS);

function normalizeLookupToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function toSafeBucket(mapped: SafeBucketLabel | undefined, raw: string): SafeBucketLabel {
  if (!raw.trim()) return "unknown";
  return mapped ?? "other";
}

const LEAD_STATUS_MAP: Record<string, SafeBucketLabel> = {
  new: "new",
  contacted: "contacted",
  "survey scheduled": "survey_scheduled",
  quoted: "quoted",
  contracted: "contracted",
  installed: "installed",
  negotiation: "negotiation",
  won: "won",
  lost: "lost",
  installation: "installation",
  "in progress": "in_progress",
};

const PROJECT_STAGE_MAP: Record<string, SafeBucketLabel> = {
  survey: "site_survey",
  "site survey": "site_survey",
  "lead created": "lead",
  "design approval": "design_approval",
  "quotation approved": "quotation_approved",
  "advance received": "advance_received",
  "equipment procurement": "equipment_procurement",
  "material procurement": "material_procurement",
  "installation scheduled": "installation_scheduled",
  "installation completed": "installation_completed",
  installation: "installation",
  "structure installation": "structure_installation",
  "panel installation": "panel_installation",
  "inverter installation": "inverter_installation",
  "testing commissioning": "testing_commissioning",
  "testing & commissioning": "testing_commissioning",
  "net metering submitted": "net_metering_submitted",
  "net metering approved": "net_metering_approved",
  commissioned: "commissioned",
  "commissioned handover completed": "commissioned",
  completed: "completed",
};

const TICKET_STATUS_MAP: Record<string, SafeBucketLabel> = {
  open: "open",
  assigned: "assigned",
  pending: "pending",
  "in progress": "in_progress",
  resolved: "resolved",
  closed: "closed",
};

const SERVICE_REQUEST_STATUS_MAP: Record<string, SafeBucketLabel> = {
  assigned: "assigned",
  open: "open",
  pending: "pending",
  "in progress": "in_progress",
  closed: "closed",
  resolved: "resolved",
  completed: "completed",
};

const DELIVERY_STATUS_MAP: Record<string, SafeBucketLabel> = {
  pending: "pending",
  scheduled: "scheduled",
  "in transit": "in_transit",
  "in progress": "in_progress",
  delivered: "delivered",
  completed: "completed",
  cancelled: "cancelled",
};

export function normalizeLeadStatusBucket(raw: string): SafeBucketLabel {
  return toSafeBucket(LEAD_STATUS_MAP[normalizeLookupToken(raw)], raw);
}

export function normalizeProjectStageBucket(raw: string): SafeBucketLabel {
  return toSafeBucket(PROJECT_STAGE_MAP[normalizeLookupToken(raw)], raw);
}

export function normalizeTicketStatusBucket(raw: string): SafeBucketLabel {
  return toSafeBucket(TICKET_STATUS_MAP[normalizeLookupToken(raw)], raw);
}

export function normalizeServiceRequestStatusBucket(raw: string): SafeBucketLabel {
  return toSafeBucket(SERVICE_REQUEST_STATUS_MAP[normalizeLookupToken(raw)], raw);
}

export function normalizeDeliveryStatusBucket(raw: string): SafeBucketLabel {
  return toSafeBucket(DELIVERY_STATUS_MAP[normalizeLookupToken(raw)], raw);
}

export function assertSafeBucketRecord(record: Record<string, number>): void {
  for (const key of Object.keys(record)) {
    if (!SAFE_BUCKET_LABEL_SET.has(key)) {
      throw new Error(`Unsafe bucket label in AI context: ${key}`);
    }
  }
}

function countBySafeBucket(
  rows: Record<string, unknown>[],
  field: string,
  normalize: (raw: string) => SafeBucketLabel
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const bucket = normalize(readField(row, field));
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  assertSafeBucketRecord(counts);
  return counts;
}

export type SafeBusinessSummary = {
  scope: "customer" | "sales" | "technician" | "staff" | "admin";
  generatedAt: string;
  leads?: { total: number; byStatus: Record<string, number> };
  quotations?: { total: number };
  projects?: { total: number; byStage: Record<string, number> };
  invoices?: {
    totalCount: number;
    totalAmount: number;
    overdueCount: number;
  };
  tickets?: { total: number; open: number };
  serviceRequests?: { total: number; open: number };
  deliveries?: { total: number; pending: number };
  inventory?: { lowStockCount: number };
  tasks?: { today: number; tomorrow: number };
  assignedJobs?: {
    serviceRequests: number;
    supportTickets: number;
    deliveries: number;
  };
};

function readField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function readCustomerId(row: Record<string, unknown>): string {
  return readField(row, "customerId", "customer_id");
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function filterByCustomerId(rows: Record<string, unknown>[], customerId: string): Record<string, unknown>[] {
  const id = String(customerId || "").trim();
  if (!id) return [];
  return rows.filter((row) => readCustomerId(row) === id);
}

function countQuotationsInLeads(leads: Record<string, unknown>[]): number {
  let total = 0;
  for (const lead of leads) {
    const quotes = lead.quotes;
    if (Array.isArray(quotes)) total += quotes.length;
  }
  return total;
}

function isAdminBroadRole(role: string): boolean {
  return ADMIN_BROAD_ROLES.has(role);
}

export function canActorAccessFinanceSummary(actor: RequestActor): boolean {
  try {
    FinanceOwnershipResolver.assertInvoiceStaffRouteAccess(actor);
    return true;
  } catch {
    return false;
  }
}

export function canActorAccessDeliverySummary(actor: RequestActor): boolean {
  try {
    FinanceOwnershipResolver.assertDeliveryStaffRouteAccess(actor);
    return true;
  } catch {
    return false;
  }
}

export function canActorAccessInventorySummary(actor: RequestActor): boolean {
  return isAdminBroadRole(actor.role) || isFinanceStaffRole(actor.role);
}

function isOpenTicketStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized !== "resolved" && normalized !== "closed";
}

function isPendingDeliveryStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return !["delivered", "completed", "cancelled"].includes(normalized);
}

function readInvoiceAmount(row: Record<string, unknown>): number {
  const raw = row.grand_total ?? row.grandTotal ?? row.total ?? row.amount ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function isOverdueInvoice(row: Record<string, unknown>, todayIso: string): boolean {
  const status = String(row.payment_status ?? row.paymentStatus ?? "").toLowerCase();
  if (status === "overdue") return true;
  if (status === "paid") return false;
  const due = readField(row, "due_date", "dueDate").slice(0, 10);
  if (!due) return false;
  return due < todayIso.slice(0, 10);
}

function countLowStockItems(db: Database): number {
  const foundation = db.inventoryFoundationItems || [];
  if (foundation.length > 0) {
    return foundation.filter((item) => {
      const available = Number(item.availableQty ?? item.available_qty ?? 0);
      const threshold = Number(item.lowStockThreshold ?? item.low_stock_threshold ?? 5);
      return available <= threshold;
    }).length;
  }
  const legacy = db.inventory || [];
  return legacy.filter((item) => {
    const qty = Number(item.quantity ?? item.stock ?? item.availableQty ?? 0);
    const threshold = Number(item.lowStockThreshold ?? item.reorderLevel ?? 5);
    return qty <= threshold;
  }).length;
}

function collectVisibleLeads(actor: RequestActor, db: Database): Record<string, unknown>[] {
  const active = filterActiveLeads(db.leads || []) as Record<string, unknown>[];
  if (isAdminBroadRole(actor.role) || isSalesOwnershipBypassRole(actor.role)) {
    return active;
  }
  if (SalesOwnershipResolver.isSalesStaffRole(actor.role)) {
    return SalesOwnershipResolver.filterAppStateForActor(actor, { leads: active }).leads as Record<
      string,
      unknown
    >[];
  }
  if (actor.role === "Customer") {
    const customerId = String(actor.customerId || "").trim();
    return filterByCustomerId(active, customerId);
  }
  return active.filter((lead) => isRowSalesOwnedByActor(actor, lead));
}

function collectVisibleProjects(
  actor: RequestActor,
  db: Database,
  visibleLeads: Record<string, unknown>[]
): Record<string, unknown>[] {
  const projects = asRows(db.projects);
  if (isAdminBroadRole(actor.role) || isSalesOwnershipBypassRole(actor.role)) {
    return projects;
  }
  if (SalesOwnershipResolver.isSalesStaffRole(actor.role)) {
    return SalesOwnershipResolver.filterAppStateForActor(actor, {
      leads: visibleLeads,
      projects,
    }).projects as Record<string, unknown>[];
  }
  if (actor.role === "Customer") {
    return filterByCustomerId(projects, String(actor.customerId || ""));
  }
  const leadIds = new Set(visibleLeads.map((l) => readField(l, "id")));
  return projects.filter((p) => leadIds.has(readField(p, "leadId", "lead_id")));
}

function collectVisibleQuotations(
  actor: RequestActor,
  db: Database,
  visibleLeads: Record<string, unknown>[]
): number {
  if (actor.role === "Customer") {
    return countQuotationsInLeads(visibleLeads);
  }
  const standalone = asRows(db.quotations);
  if (isAdminBroadRole(actor.role) || isSalesOwnershipBypassRole(actor.role)) {
    return standalone.length + countQuotationsInLeads(asRows(db.leads));
  }
  if (SalesOwnershipResolver.isSalesStaffRole(actor.role)) {
    const scoped = SalesOwnershipResolver.filterAppStateForActor(actor, {
      leads: visibleLeads,
      quotations: standalone,
    });
    return (
      (scoped.quotations as Record<string, unknown>[]).length +
      countQuotationsInLeads(scoped.leads as Record<string, unknown>[])
    );
  }
  return countQuotationsInLeads(visibleLeads);
}

function collectTaskCounts(leads: Record<string, unknown>[]): { today: number; tomorrow: number } {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);

  let todayCount = 0;
  let tomorrowCount = 0;

  for (const lead of leads) {
    const installation = lead.installation as Record<string, unknown> | undefined;
    const tasks = installation?.tasks;
    if (!Array.isArray(tasks)) continue;
    for (const task of tasks) {
      const row = task as Record<string, unknown>;
      const due = readField(row, "dueDate", "due_date", "scheduledDate", "scheduled_date").slice(0, 10);
      if (!due) continue;
      if (due === todayKey) todayCount += 1;
      else if (due === tomorrowKey) tomorrowCount += 1;
    }
  }

  return { today: todayCount, tomorrow: tomorrowCount };
}

function resolveScope(actor: RequestActor): SafeBusinessSummary["scope"] {
  if (actor.role === "Customer") return "customer";
  if (isTechnicalStaffRole(actor.role)) return "technician";
  if (SalesOwnershipResolver.isSalesStaffRole(actor.role)) return "sales";
  if (isAdminBroadRole(actor.role)) return "admin";
  return "staff";
}

function buildTechnicianAssignedSummary(
  actor: RequestActor,
  db: Database
): Pick<SafeBusinessSummary, "assignedJobs" | "serviceRequests" | "tickets" | "deliveries"> {
  const serviceRequests = asRows(db.serviceRequests).filter((row) => isRowAssignedToActor(actor, row));
  const tickets = asRows(db.tickets).filter((row) => isRowAssignedToActor(actor, row));
  const deliveries = asRows(db.projectDeliveries).filter(
    (row) => readAssignedUserId(row) === actor.id
  );

  return {
    assignedJobs: {
      serviceRequests: serviceRequests.length,
      supportTickets: tickets.length,
      deliveries: deliveries.length,
    },
    serviceRequests: {
      total: serviceRequests.length,
      open: serviceRequests.filter((r) => isOpenTicketStatus(readField(r, "status"))).length,
    },
    tickets: {
      total: tickets.length,
      open: tickets.filter((t) => isOpenTicketStatus(readField(t, "status"))).length,
    },
    deliveries: {
      total: deliveries.length,
      pending: deliveries.filter((d) => isPendingDeliveryStatus(readField(d, "status"))).length,
    },
  };
}

export function containsSensitiveBusinessFields(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(containsSensitiveBusinessFields);
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) return true;
      if (containsSensitiveBusinessFields(nested)) return true;
    }
    return false;
  }
  if (typeof value === "string") {
    if (SENSITIVE_FIELD_PATTERN.test(value)) return false;
    if (/\b\d{4}[\s-]?\d{7}\b/.test(value)) return true;
  }
  return false;
}

export function boundSafeBusinessContextJson(summary: SafeBusinessSummary): string {
  const clone: SafeBusinessSummary = { ...summary };
  let json = JSON.stringify(clone);
  if (json.length <= SAFE_BUSINESS_CONTEXT_MAX_CHARS) return json;

  delete clone.tasks;
  json = JSON.stringify(clone);
  if (json.length <= SAFE_BUSINESS_CONTEXT_MAX_CHARS) return json;

  if (clone.leads?.byStatus) {
    clone.leads = { total: clone.leads.total, byStatus: { other: clone.leads.total } };
  }
  if (clone.projects?.byStage) {
    clone.projects = { total: clone.projects.total, byStage: { other: clone.projects.total } };
  }

  json = JSON.stringify(clone);
  if (json.length > SAFE_BUSINESS_CONTEXT_MAX_CHARS) {
    return JSON.stringify({
      scope: clone.scope,
      generatedAt: clone.generatedAt,
      truncated: true,
    });
  }
  return json;
}

export async function buildSafeBusinessContext(
  actor: RequestActor,
  db: Database,
  includeBusinessContext: boolean
): Promise<SafeBusinessSummary | null> {
  if (!includeBusinessContext) return null;

  const generatedAt = new Date().toISOString();
  const scope = resolveScope(actor);
  const summary: SafeBusinessSummary = { scope, generatedAt };

  if (actor.role === "Customer") {
    try {
      OwnershipResolver.assertCustomerActor(actor);
    } catch {
      return { scope: "customer", generatedAt };
    }
  } else if (isTechnicalStaffRole(actor.role)) {
    TechnicianOwnershipResolver.assertTechnicianActor(actor);
    Object.assign(summary, buildTechnicianAssignedSummary(actor, db));
    return summary;
  }

  const visibleLeads = collectVisibleLeads(actor, db);
  const visibleProjects = collectVisibleProjects(actor, db, visibleLeads);

  summary.leads = {
    total: visibleLeads.length,
    byStatus: countBySafeBucket(visibleLeads, "status", normalizeLeadStatusBucket),
  };
  summary.projects = {
    total: visibleProjects.length,
    byStage: countBySafeBucket(visibleProjects, "stage", normalizeProjectStageBucket),
  };
  summary.quotations = { total: collectVisibleQuotations(actor, db, visibleLeads) };

  if (actor.role === "Customer") {
    const customerId = String(actor.customerId || "");
    const tickets = filterByCustomerId(asRows(db.tickets), customerId);
    const serviceRequests = filterByCustomerId(asRows(db.serviceRequests), customerId);
    summary.tickets = {
      total: tickets.length,
      open: tickets.filter((t) => isOpenTicketStatus(readField(t, "status"))).length,
    };
    summary.serviceRequests = {
      total: serviceRequests.length,
      open: serviceRequests.filter((r) => isOpenTicketStatus(readField(r, "status"))).length,
    };
    return summary;
  }

  const taskCounts = collectTaskCounts(visibleLeads);
  if (taskCounts.today > 0 || taskCounts.tomorrow > 0) {
    summary.tasks = taskCounts;
  }

  if (canActorAccessFinanceSummary(actor)) {
    const invoices = FinanceOwnershipResolver.filterInvoiceRowsForActor(
      actor,
      await FinanceOwnershipResolver.loadAllInvoiceRows(db)
    );
    summary.invoices = {
      totalCount: invoices.length,
      totalAmount: Math.round(invoices.reduce((sum, row) => sum + readInvoiceAmount(row), 0) * 100) / 100,
      overdueCount: invoices.filter((row) => isOverdueInvoice(row, generatedAt)).length,
    };
  }

  if (canActorAccessDeliverySummary(actor)) {
    const deliveries = asRows(db.projectDeliveries);
    let visible = deliveries;
    if (!isAdminBroadRole(actor.role) && SalesOwnershipResolver.isSalesStaffRole(actor.role)) {
      const leadIds = new Set(visibleLeads.map((l) => readField(l, "id")));
      visible = deliveries.filter((d) => leadIds.has(readField(d, "leadId", "lead_id")));
    }
    summary.deliveries = {
      total: visible.length,
      pending: visible.filter((d) => isPendingDeliveryStatus(readField(d, "status"))).length,
    };
  }

  if (canActorAccessInventorySummary(actor)) {
    summary.inventory = { lowStockCount: countLowStockItems(db) };
  }

  if (!isAdminBroadRole(actor.role)) {
    const allTickets = asRows(db.tickets);
    const allService = asRows(db.serviceRequests);
    let tickets = allTickets;
    let serviceRequests = allService;
    if (SalesOwnershipResolver.isSalesStaffRole(actor.role)) {
      const customerIds = new Set(visibleLeads.map((l) => readCustomerId(l)).filter(Boolean));
      tickets = allTickets.filter((t) => customerIds.has(readCustomerId(t)));
      serviceRequests = allService.filter((r) => customerIds.has(readCustomerId(r)));
    }
    summary.tickets = {
      total: tickets.length,
      open: tickets.filter((t) => isOpenTicketStatus(readField(t, "status"))).length,
    };
    summary.serviceRequests = {
      total: serviceRequests.length,
      open: serviceRequests.filter((r) => isOpenTicketStatus(readField(r, "status"))).length,
    };
  } else {
    const tickets = asRows(db.tickets);
    const serviceRequests = asRows(db.serviceRequests);
    summary.tickets = {
      total: tickets.length,
      open: tickets.filter((t) => isOpenTicketStatus(readField(t, "status"))).length,
    };
    summary.serviceRequests = {
      total: serviceRequests.length,
      open: serviceRequests.filter((r) => isOpenTicketStatus(readField(r, "status"))).length,
    };
  }

  return summary;
}
