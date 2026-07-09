/**
 * Safe display labels for Enterprise Dashboard — never echo raw CRM strings.
 */

import type { InstallationTask, Lead } from "../types";

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const KNOWN_LEAD_STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  "survey scheduled": "Survey Scheduled",
  quoted: "Quoted",
  contracted: "Contracted",
  installed: "Installed",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

const KNOWN_PROJECT_STAGE_LABELS: Record<string, string> = {
  "not started": "Not Started",
  scheduled: "Scheduled",
  "in progress": "In Progress",
  completed: "Completed",
  maintenance: "Maintenance",
  installation: "In Progress",
  lead: "Not Started",
};

const GENERIC_TASK_LABELS = ["Installation task", "Site task", "Follow-up task"] as const;

function normalizeToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function safeLeadStatusLabel(rawStatus: string): string {
  const token = normalizeToken(rawStatus);
  return KNOWN_LEAD_STATUS_LABELS[token] ?? "Other";
}

export function safeProjectStageLabel(rawStage: string): string {
  const token = normalizeToken(rawStage);
  return KNOWN_PROJECT_STAGE_LABELS[token] ?? "Other";
}

export function anonymizeSalespersonLabel(repIndex: number): string {
  if (repIndex <= 0) return "Assigned sales";
  return `Sales rep ${repIndex}`;
}

export function safeTaskLabel(taskIndex: number): string {
  const idx = Math.abs(taskIndex) % GENERIC_TASK_LABELS.length;
  return GENERIC_TASK_LABELS[idx];
}

export interface DashboardChartPoint {
  name: string;
  value: number;
}

export function buildSafePipelineChart(leadsByStatus: Record<string, number>): DashboardChartPoint[] {
  const aggregated = new Map<string, number>();

  for (const [rawStatus, count] of Object.entries(leadsByStatus)) {
    const label = safeLeadStatusLabel(rawStatus);
    aggregated.set(label, (aggregated.get(label) ?? 0) + safeNumber(count));
  }

  return [...aggregated.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

export function buildAnonymizedRevenueChart(leads: Lead[]): DashboardChartPoint[] {
  const eligible = leads
    .filter((lead) => lead && typeof lead === "object")
    .filter((lead) => lead.status === "Contracted" || lead.status === "Installed")
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const repIndexByKey = new Map<string, number>();
  let nextRepIndex = 1;
  const revenueByLabel = new Map<string, number>();

  for (const lead of eligible) {
    const rawRep = String(lead.assignedSalesperson ?? "").trim();
    let label: string;

    if (!rawRep) {
      label = "Assigned sales";
    } else {
      if (!repIndexByKey.has(rawRep)) {
        repIndexByKey.set(rawRep, nextRepIndex);
        nextRepIndex += 1;
      }
      label = anonymizeSalespersonLabel(repIndexByKey.get(rawRep)!);
    }

    const revenue = safeNumber(lead.quotes?.[0]?.totalCost);
    revenueByLabel.set(label, (revenueByLabel.get(label) ?? 0) + revenue);
  }

  return [...revenueByLabel.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, 6);
}

export function classifyInstallationTaskLabel(
  task: InstallationTask | null | undefined,
  taskIndex: number
): string {
  if (!task || typeof task !== "object") return "Installation task";
  return safeTaskLabel(taskIndex);
}
