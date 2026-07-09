/**
 * Client-side dashboard view model — derived from existing CRM state only.
 * No API calls, no LLM, no backend changes. BI via deterministic BusinessIntelligenceEngine.
 *
 * Recent Activity is intentionally sanitized: no raw activityLogs.details,
 * names, IDs, IPs, or DB modification text on the Admin Overview.
 */

import type { ActivityLog, DashboardStats, InventoryItem, Lead, Ticket } from "../types";
import { buildExecutiveBiViewModel, type ExecutiveBiViewModel } from "./executiveBiAdapter.ts";
import {
  buildAnonymizedRevenueChart,
  buildSafePipelineChart,
  classifyInstallationTaskLabel,
} from "./dashboardLabelSanitizers.ts";

export type DashboardPriority = "Low" | "Medium" | "High" | "Critical";

export type EnterpriseActivityCategory = "lead" | "ticket" | "system" | "finance" | "inventory";

export interface SanitizedEnterpriseActivity {
  id: string;
  timestamp: string;
  category: EnterpriseActivityCategory;
  eventType: string;
  label: string;
}

export interface DashboardKpi {
  id: string;
  label: string;
  value: string;
  sub?: string;
  trend?: number;
  accent: "emerald" | "amber" | "indigo" | "rose" | "sky" | "violet";
}

export interface DashboardAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
}

export interface DashboardTask {
  id: string;
  title: string;
  context: string;
  dueLabel: string;
  done: boolean;
}

export interface DashboardActivityItem {
  id: string;
  time: string;
  title: string;
  subtitle: string;
  kind: "lead" | "ticket" | "system";
}

export interface DashboardChartPoint {
  name: string;
  value: number;
}

export interface EnterpriseDashboardModel {
  healthScore: number;
  healthPriority: DashboardPriority;
  healthBreakdown: { label: string; score: number }[];
  aiSummary: string[];
  bi: ExecutiveBiViewModel;
  kpis: DashboardKpi[];
  alerts: DashboardAlert[];
  todayTasks: DashboardTask[];
  recentActivity: DashboardActivityItem[];
  pipelineChart: DashboardChartPoint[];
  revenueChart: DashboardChartPoint[];
}

const EMPTY_STATS: DashboardStats = {
  totalRevenue: 0,
  pendingRevenue: 0,
  totalLeads: 0,
  installedCount: 0,
  contractedCount: 0,
  pipelineCount: 0,
  leadsByStatus: {},
};

export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function safeTimestamp(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export function safeStats(stats: DashboardStats | null | undefined): DashboardStats {
  if (!stats || typeof stats !== "object") {
    return { ...EMPTY_STATS, leadsByStatus: {} };
  }

  const rawByStatus =
    stats.leadsByStatus && typeof stats.leadsByStatus === "object" ? stats.leadsByStatus : {};

  const leadsByStatus: Record<string, number> = {};
  for (const [key, count] of Object.entries(rawByStatus)) {
    if (!key) continue;
    leadsByStatus[key] = safeNumber(count);
  }

  return {
    totalRevenue: safeNumber(stats.totalRevenue),
    pendingRevenue: safeNumber(stats.pendingRevenue),
    totalLeads: safeNumber(stats.totalLeads),
    installedCount: safeNumber(stats.installedCount),
    contractedCount: safeNumber(stats.contractedCount),
    pipelineCount: safeNumber(stats.pipelineCount),
    leadsByStatus,
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function formatTime(iso: string): string {
  const safe = safeTimestamp(iso);
  if (!safe) return "—";
  const d = new Date(safe);
  return d.toLocaleString("en-PK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function classifyActivityCategory(action: string): EnterpriseActivityCategory {
  const a = action.toLowerCase();
  if (/lead|quote|quotation|sales|pipeline|contract/.test(a)) return "lead";
  if (/ticket|support|service|complaint/.test(a)) return "ticket";
  if (/invoice|finance|payment|ledger|costing/.test(a)) return "finance";
  if (/inventory|stock|procurement|delivery/.test(a)) return "inventory";
  return "system";
}

function categoryLabel(category: EnterpriseActivityCategory): string {
  switch (category) {
    case "lead":
      return "Lead activity";
    case "ticket":
      return "Ticket activity";
    case "finance":
      return "Finance activity";
    case "inventory":
      return "Inventory activity";
    default:
      return "System activity";
  }
}

function coarseEventType(action: string): string {
  const a = String(action || "").toLowerCase();
  if (/create|add|new|insert/.test(a)) return "Record created";
  if (/update|edit|modify|change|sync/.test(a)) return "Record updated";
  if (/delete|remove|archive|purge/.test(a)) return "Record removed";
  if (/login|logout|auth|session|sign/.test(a)) return "Authentication event";
  if (/status|stage|progress/.test(a)) return "Status update";
  if (/export|import|upload|download/.test(a)) return "File transfer";
  return "System event";
}

/**
 * Strip PII and operational detail from a raw activity log for Overview display.
 * Never returns details, userName, userId, role, IPs, IDs, or DB mutation text.
 */
export function sanitizeEnterpriseActivityLog(
  log: ActivityLog | null | undefined,
  index = 0
): SanitizedEnterpriseActivity | null {
  if (!log || typeof log !== "object") return null;

  const action = String(log.action || "").trim();
  const category = classifyActivityCategory(action);
  const timestamp = safeTimestamp(log.timestamp);

  return {
    id: `activity-${index}`,
    timestamp,
    category,
    eventType: coarseEventType(action),
    label: categoryLabel(category),
  };
}

function sanitizedActivityToItem(
  sanitized: SanitizedEnterpriseActivity,
  kind: DashboardActivityItem["kind"]
): DashboardActivityItem {
  return {
    id: sanitized.id,
    time: formatTime(sanitized.timestamp),
    title: sanitized.label,
    subtitle: sanitized.eventType,
    kind,
  };
}

function collectTodayTasks(leads: Lead[]): DashboardTask[] {
  const today = new Date().toISOString().slice(0, 10);
  const tasks: DashboardTask[] = [];
  let taskCounter = 0;

  for (let leadIndex = 0; leadIndex < leads.length; leadIndex += 1) {
    const lead = leads[leadIndex];
    if (!lead || typeof lead !== "object") continue;
    const installation = lead.installation;
    if (!installation) continue;

    const scheduled = String(installation.scheduledDate || "").slice(0, 10);

    if (scheduled === today) {
      tasks.push({
        id: `install-scheduled-${leadIndex}`,
        title: "Installation scheduled",
        context: "Assigned project",
        dueLabel: "Today",
        done: installation.status === "Completed",
      });
    }

    const installationTasks = safeArray(installation.tasks);
    for (let taskIndex = 0; taskIndex < installationTasks.length; taskIndex += 1) {
      const task = installationTasks[taskIndex];
      if (!task || typeof task !== "object") continue;
      tasks.push({
        id: `task-${taskCounter}`,
        title: classifyInstallationTaskLabel(task, taskIndex),
        context: "Assigned project",
        dueLabel: scheduled === today ? "Today" : "Upcoming",
        done: Boolean(task.done),
      });
      taskCounter += 1;
    }
  }

  return tasks
    .filter((t) => !t.done)
    .sort((a, b) => a.dueLabel.localeCompare(b.dueLabel) || a.title.localeCompare(b.title))
    .slice(0, 8);
}

function buildAlerts(
  stats: DashboardStats,
  tickets: Ticket[],
  inventory: InventoryItem[]
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  const openTickets = tickets.filter((t) => t?.status !== "Resolved" && t?.status !== "Closed");
  const highPriority = openTickets.filter((t) => t?.priority === "High");

  if (highPriority.length > 0) {
    alerts.push({
      id: "support-critical",
      severity: "critical",
      title: `${highPriority.length} high-priority ticket${highPriority.length > 1 ? "s" : ""}`,
      detail: "Support queue needs immediate attention.",
    });
  } else if (openTickets.length >= 5) {
    alerts.push({
      id: "support-backlog",
      severity: "warning",
      title: `${openTickets.length} open support tickets`,
      detail: "Consider assigning additional support capacity.",
    });
  }

  const newLeads = safeNumber(stats.leadsByStatus["New"] ?? stats.leadsByStatus.New);
  if (newLeads >= 5) {
    alerts.push({
      id: "lead-backlog",
      severity: "warning",
      title: `${newLeads} uncontacted leads`,
      detail: "New lead backlog may affect conversion rates.",
    });
  }

  const lowStock = inventory.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const qty = safeNumber(item.stock);
    const threshold = safeNumber(
      (item as { lowStockThreshold?: number; reorderLevel?: number }).lowStockThreshold ??
        (item as { reorderLevel?: number }).reorderLevel,
      5
    );
    return qty <= threshold;
  });
  if (lowStock.length > 0) {
    alerts.push({
      id: "inventory-low",
      severity: lowStock.length >= 3 ? "critical" : "warning",
      title: `${lowStock.length} low-stock item${lowStock.length > 1 ? "s" : ""}`,
      detail: "Procurement may be required before upcoming installs.",
    });
  }

  if (stats.pendingRevenue > stats.totalRevenue * 0.6 && stats.pendingRevenue > 0) {
    alerts.push({
      id: "pipeline-heavy",
      severity: "info",
      title: "Pipeline outweighs secured revenue",
      detail: "Focus on moving quoted leads to contracted stage.",
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      id: "all-clear",
      severity: "info",
      title: "Operations nominal",
      detail: "No critical alerts detected across support, sales, or inventory.",
    });
  }

  return alerts;
}

function buildAiSummaryFromBi(bi: ExecutiveBiViewModel): string[] {
  if (bi.executiveSummary.length > 0) {
    return bi.executiveSummary.map((item) => `${item.title} — ${item.detail}`);
  }
  return ["Business intelligence summary is available when CRM metrics are present."];
}

function buildRecentActivity(
  leads: Lead[],
  tickets: Ticket[],
  activityLogs: ActivityLog[]
): DashboardActivityItem[] {
  const items: DashboardActivityItem[] = [];

  activityLogs.forEach((log, index) => {
    const sanitized = sanitizeEnterpriseActivityLog(log, index);
    if (!sanitized) return;
    const kind: DashboardActivityItem["kind"] =
      sanitized.category === "lead"
        ? "lead"
        : sanitized.category === "ticket"
          ? "ticket"
          : "system";
    items.push(sanitizedActivityToItem(sanitized, kind));
  });

  const sortedLeads = [...leads]
    .filter((l) => l && typeof l === "object")
    .sort((a, b) => safeTimestamp(b.createdAt).localeCompare(safeTimestamp(a.createdAt)))
    .slice(0, 6);

  for (let i = 0; i < sortedLeads.length; i += 1) {
    const lead = sortedLeads[i];
    const ts = safeTimestamp(lead.createdAt);
    items.push({
      id: `lead-activity-${i}`,
      time: formatTime(ts || new Date(0).toISOString()),
      title: "Lead activity",
      subtitle: "Pipeline update",
      kind: "lead",
    });
  }

  const ticketSlice = tickets.filter((t) => t && typeof t === "object").slice(0, 4);
  for (let i = 0; i < ticketSlice.length; i += 1) {
    const ticket = ticketSlice[i];
    const ts = safeTimestamp(ticket.createdAt) || new Date(0).toISOString();
    items.push({
      id: `ticket-activity-${i}`,
      time: formatTime(ts),
      title: "Ticket activity",
      subtitle: "Support update",
      kind: "ticket",
    });
  }

  return items
    .sort((a, b) => {
      const aSort = a.time === "—" ? "" : a.time;
      const bSort = b.time === "—" ? "" : b.time;
      return bSort.localeCompare(aSort);
    })
    .slice(0, 10);
}

export interface BuildEnterpriseDashboardInput {
  stats?: DashboardStats | null;
  leads?: Lead[] | null;
  tickets?: Ticket[] | null;
  inventory?: InventoryItem[] | null;
  activityLogs?: ActivityLog[] | null;
  currencySymbol?: string;
}

export function buildEnterpriseDashboardModel(
  input: BuildEnterpriseDashboardInput = {}
): EnterpriseDashboardModel {
  const stats = safeStats(input.stats);
  const leads = safeArray(input.leads);
  const tickets = safeArray(input.tickets);
  const inventory = safeArray(input.inventory);
  const activityLogs = safeArray(input.activityLogs);
  const currencySymbol = String(input.currencySymbol ?? "Rs. ");

  const openTickets = tickets.filter((t) => t?.status !== "Resolved" && t?.status !== "Closed");

  const bi = buildExecutiveBiViewModel({ stats, leads, tickets, inventory });

  const kpis: DashboardKpi[] = [
    {
      id: "revenue",
      label: "Revenue Secured",
      value: `${currencySymbol}${stats.totalRevenue.toLocaleString()}`,
      sub: "Contracted & installed",
      accent: "emerald",
    },
    {
      id: "pipeline",
      label: "Pipeline Value",
      value: `${currencySymbol}${stats.pendingRevenue.toLocaleString()}`,
      sub: `${stats.pipelineCount} active opportunities`,
      accent: "amber",
    },
    {
      id: "deployments",
      label: "Active Deployments",
      value: String(stats.contractedCount + stats.installedCount),
      sub: `${stats.installedCount} installed`,
      accent: "indigo",
    },
    {
      id: "support",
      label: "Open Tickets",
      value: String(openTickets.length),
      sub: openTickets.length ? "Needs review" : "Queue clear",
      accent: openTickets.length >= 3 ? "rose" : "sky",
    },
  ];

  const pipelineChart = buildSafePipelineChart(stats.leadsByStatus);

  const revenueChart = buildAnonymizedRevenueChart(leads);

  return {
    healthScore: bi.healthScore,
    healthPriority: bi.healthPriority,
    healthBreakdown: bi.healthBreakdown,
    aiSummary: buildAiSummaryFromBi(bi),
    bi,
    kpis,
    alerts: buildAlerts(stats, tickets, inventory),
    todayTasks: collectTodayTasks(leads),
    recentActivity: buildRecentActivity(leads, tickets, activityLogs),
    pipelineChart,
    revenueChart: revenueChart.length ? revenueChart : [{ name: "No data", value: 0 }],
  };
}
