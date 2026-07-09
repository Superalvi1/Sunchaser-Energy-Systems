/**
 * Maps existing CRM app state → SafeBusinessSummary (aggregated counts only).
 * Client-side mirror of server SafeBusinessContext output — no PII, no raw rows.
 */

import type { DashboardStats, InventoryItem, Lead, Ticket } from "../types";
import type { SafeBusinessSummary } from "../../server/ai/context/SafeBusinessContext.ts";
import { safeArray, safeNumber, safeStats, safeTimestamp } from "./enterpriseDashboard.ts";

const DETERMINISTIC_GENERATED_AT = "1970-01-01T00:00:00.000Z";

function normalizeToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function mapLeadStatusToBucket(status: string): string {
  const token = normalizeToken(status);
  switch (token) {
    case "new":
      return "new";
    case "contacted":
      return "contacted";
    case "survey scheduled":
      return "survey_scheduled";
    case "quoted":
      return "quoted";
    case "negotiation":
      return "negotiation";
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "contracted":
    case "installed":
      return "won";
    case "installation":
    case "in progress":
      return "installation";
    default:
      return "other";
  }
}

function mapInstallationStatusToStage(status: string): string {
  const token = normalizeToken(status);
  switch (token) {
    case "scheduled":
      return "installation_scheduled";
    case "in progress":
      return "installation";
    case "completed":
      return "completed";
    case "not started":
      return "lead";
    case "maintenance":
      return "installation";
    default:
      return "other";
  }
}

function countLeadStatusBuckets(stats: DashboardStats, leads: Lead[]): Record<string, number> {
  const buckets: Record<string, number> = {};

  for (const [rawStatus, count] of Object.entries(stats.leadsByStatus)) {
    const bucket = mapLeadStatusToBucket(rawStatus);
    buckets[bucket] = (buckets[bucket] ?? 0) + safeNumber(count);
  }

  if (Object.keys(buckets).length === 0) {
    for (const lead of leads) {
      if (!lead || typeof lead !== "object") continue;
      const bucket = mapLeadStatusToBucket(String(lead.status || "other"));
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
  }

  return buckets;
}

function countQuotations(leads: Lead[]): number {
  let total = 0;
  for (const lead of leads) {
    if (!lead || typeof lead !== "object") continue;
    total += safeArray(lead.quotes).length;
  }
  return total;
}

function countProjectsByStage(leads: Lead[]): { total: number; byStage: Record<string, number> } {
  const byStage: Record<string, number> = {};
  let total = 0;

  for (const lead of leads) {
    if (!lead?.installation) continue;
    total += 1;
    const stage = mapInstallationStatusToStage(String(lead.installation.status || "other"));
    byStage[stage] = (byStage[stage] ?? 0) + 1;
  }

  return { total, byStage };
}

function countLowStock(inventory: InventoryItem[]): number {
  return inventory.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const qty = safeNumber(item.stock);
    const threshold = safeNumber(
      (item as { lowStockThreshold?: number; reorderLevel?: number }).lowStockThreshold ??
        (item as { reorderLevel?: number }).reorderLevel,
      5
    );
    return qty <= threshold;
  }).length;
}

function countTasksDue(leads: Lead[]): { today: number; tomorrow: number } {
  const todayStr = DETERMINISTIC_GENERATED_AT.slice(0, 10);
  const tomorrowDate = new Date(`${todayStr}T00:00:00.000Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);

  let today = 0;
  let tomorrow = 0;

  for (const lead of leads) {
    const installation = lead?.installation;
    if (!installation) continue;
    const scheduled = String(installation.scheduledDate || "").slice(0, 10);
    const pendingTasks = safeArray(installation.tasks).filter((t) => t && !t.done).length;
    if (pendingTasks === 0 && scheduled !== todayStr && scheduled !== tomorrowStr) continue;

    if (scheduled === todayStr) today += Math.max(1, pendingTasks);
    else if (scheduled === tomorrowStr) tomorrow += Math.max(1, pendingTasks);
    else if (pendingTasks > 0) today += pendingTasks;
  }

  return { today, tomorrow };
}

function financeSnapshotFromStats(stats: DashboardStats): SafeBusinessSummary["invoices"] {
  const securedCount = stats.contractedCount + stats.installedCount;
  const totalCount = Math.max(securedCount + stats.pipelineCount, securedCount, stats.pipelineCount > 0 ? 1 : 0);
  const totalAmount = safeNumber(stats.totalRevenue) + safeNumber(stats.pendingRevenue);

  let overdueCount = 0;
  if (totalCount > 0 && stats.pendingRevenue > 0 && stats.totalRevenue > 0) {
    const pipelinePressure = stats.pendingRevenue / Math.max(stats.totalRevenue, 1);
    if (pipelinePressure > 0.6) {
      overdueCount = Math.min(stats.pipelineCount, Math.max(1, Math.round(totalCount * 0.15)));
    }
  }

  return {
    totalCount,
    totalAmount,
    overdueCount,
  };
}

export interface SafeSummaryInput {
  stats?: DashboardStats | null;
  leads?: Lead[] | null;
  tickets?: Ticket[] | null;
  inventory?: InventoryItem[] | null;
}

export function buildSafeBusinessSummaryFromAppState(
  input: SafeSummaryInput = {}
): SafeBusinessSummary {
  const stats = safeStats(input.stats);
  const leads = safeArray(input.leads);
  const tickets = safeArray(input.tickets);
  const inventory = safeArray(input.inventory);

  const byStatus = countLeadStatusBuckets(stats, leads);
  const totalLeads = stats.totalLeads > 0 ? stats.totalLeads : leads.length;
  const projects = countProjectsByStage(leads);
  const openTickets = tickets.filter((t) => {
    const status = String(t?.status || "").toLowerCase();
    return status !== "resolved" && status !== "closed";
  });

  const tasks = countTasksDue(leads);

  return {
    scope: "admin",
    generatedAt: DETERMINISTIC_GENERATED_AT,
    leads: { total: totalLeads, byStatus },
    quotations: { total: countQuotations(leads) },
    projects: { total: projects.total, byStage: projects.byStage },
    invoices: financeSnapshotFromStats(stats),
    tickets: { total: tickets.length, open: openTickets.length },
    inventory: { lowStockCount: countLowStock(inventory) },
    tasks,
  };
}

export function isSafeSummaryPayload(summary: SafeBusinessSummary): boolean {
  const blob = JSON.stringify(summary);
  const forbidden = /phone|cnic|address|email|bank|password|customer.?name/i;
  return !forbidden.test(blob);
}
