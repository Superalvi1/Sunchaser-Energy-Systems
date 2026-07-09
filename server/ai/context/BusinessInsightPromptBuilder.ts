/**
 * Transforms SafeBusinessSummary into assistant-readable insight prompts (V3).
 * Read-only guidance only — no tools, mutations, or raw CRM rows.
 */

import type { SafeBusinessSummary } from "./SafeBusinessContext.ts";
import { SAFE_BUCKET_LABELS } from "./SafeBusinessContext.ts";

export type BusinessInsightAgentId =
  | "sales"
  | "finance"
  | "operations"
  | "support"
  | "procurement"
  | "ceo";

export interface BusinessInsightPromptInput {
  actorRole: string;
  agentId: string;
  summary: SafeBusinessSummary;
}

const READ_ONLY_RULES = `Read-only assistant mode (mandatory):
- You cannot create, update, send, assign, reserve, or delete anything in the CRM.
- Never say "I have created...", "I have updated...", "I have sent...", or similar action claims.
- Give recommendations only, using phrases like "You may want to...", "Consider...", or "Recommended next step...".
- Use only the permitted business summary below. If the answer needs raw records, customer names, contact details, amounts not listed, or any data absent from the summary, clearly say you do not have enough data.
- Keep answers concise. For daily briefings or "what should I focus on" questions, reply with 3–6 short bullet points drawn only from the summary.`;

const AGENT_FOCUS: Record<BusinessInsightAgentId, string> = {
  sales:
    "Sales focus: prioritize leads by status, quotation follow-ups, pipeline momentum, and conversion risk visible in the counts. Suggest next outreach steps — do not claim any CRM action was taken.",
  finance:
    "Finance focus: prioritize invoice totals, overdue counts, and payment risk when finance summary fields are present. If invoice data is missing below, state that finance data is not available for this role.",
  operations:
    "Operations focus: prioritize project stages, pending deliveries, and open service requests. Highlight bottlenecks visible in the counts only.",
  support:
    "Support focus: prioritize open tickets and service requests. Suggest triage and follow-up — never claim a ticket was updated.",
  procurement:
    "Procurement focus: prioritize low-stock counts and replenishment needs implied by inventory summary. Recommend review steps only.",
  ceo:
    "Executive focus: synthesize overall business health from every field present in the permitted summary (leads, projects, tickets, finance if shown, deliveries, inventory). Flag areas needing attention using counts only — no speculation beyond the summary.",
};

function formatCountMap(title: string, map?: Record<string, number>): string[] {
  if (!map) return [];
  const entries = Object.entries(map).filter(([, count]) => count > 0);
  if (entries.length === 0) return [];
  return [`${title}: ${entries.map(([key, count]) => `${key}=${count}`).join(", ")}`];
}

export function formatBusinessSummaryReadable(summary: SafeBusinessSummary): string {
  const lines: string[] = [`Summary scope: ${summary.scope}`];

  if (summary.leads) {
    lines.push(`Leads total: ${summary.leads.total}`);
    lines.push(...formatCountMap("Leads by status", summary.leads.byStatus));
  }
  if (summary.quotations) {
    lines.push(`Quotations total: ${summary.quotations.total}`);
  }
  if (summary.projects) {
    lines.push(`Projects total: ${summary.projects.total}`);
    lines.push(...formatCountMap("Projects by stage", summary.projects.byStage));
  }
  if (summary.invoices) {
    lines.push(
      `Invoices: count=${summary.invoices.totalCount}, totalAmount=${summary.invoices.totalAmount}, overdueCount=${summary.invoices.overdueCount}`
    );
  } else {
    lines.push("Invoices: not included in permitted summary");
  }
  if (summary.tickets) {
    lines.push(`Tickets: total=${summary.tickets.total}, open=${summary.tickets.open}`);
  }
  if (summary.serviceRequests) {
    lines.push(
      `Service requests: total=${summary.serviceRequests.total}, open=${summary.serviceRequests.open}`
    );
  }
  if (summary.deliveries) {
    lines.push(
      `Deliveries: total=${summary.deliveries.total}, pending=${summary.deliveries.pending}`
    );
  }
  if (summary.inventory) {
    lines.push(`Inventory low-stock count: ${summary.inventory.lowStockCount}`);
  }
  if (summary.tasks) {
    lines.push(
      `Tasks: today=${summary.tasks.today}, tomorrow=${summary.tasks.tomorrow}`
    );
  }
  if (summary.assignedJobs) {
    lines.push(
      `Assigned jobs: serviceRequests=${summary.assignedJobs.serviceRequests}, supportTickets=${summary.assignedJobs.supportTickets}, deliveries=${summary.assignedJobs.deliveries}`
    );
  }

  return lines.join("\n");
}

export function resolveAgentFocusGuidance(agentId: string): string {
  const key = agentId as BusinessInsightAgentId;
  return AGENT_FOCUS[key] ?? AGENT_FOCUS.support;
}

export function buildFinanceAvailabilityNote(
  agentId: string,
  summary: SafeBusinessSummary
): string | null {
  if (agentId !== "finance") return null;
  if (summary.invoices) return null;
  return "Finance data note: Invoice totals and overdue counts are not available in your permitted summary. When asked about invoices or payments, say finance data is not available for your role.";
}

export function buildBusinessInsightPrompt(input: BusinessInsightPromptInput): string {
  const { actorRole, agentId, summary } = input;
  const sections = [
    READ_ONLY_RULES,
    `Actor role: ${actorRole}`,
    `Selected agent: ${agentId}`,
    resolveAgentFocusGuidance(agentId),
    buildFinanceAvailabilityNote(agentId, summary),
    "Permitted business summary (counts and aggregates only):",
    formatBusinessSummaryReadable(summary),
    "When answering questions such as pending leads, installation-stage projects, open tickets, today's workload, overdue invoices, daily briefings, or areas needing attention — derive answers only from the summary above.",
  ].filter((section): section is string => Boolean(section));

  return sections.join("\n\n");
}

/** Ensures grouping keys in by-status / by-stage lines use only the safe bucket whitelist. */
export function assertPromptUsesOnlySafeBucketLabels(prompt: string): void {
  const safeSet = new Set<string>(SAFE_BUCKET_LABELS);
  const groupedLines = [
    prompt.match(/Leads by status: (.+)/)?.[1],
    prompt.match(/Projects by stage: (.+)/)?.[1],
  ];
  for (const line of groupedLines) {
    if (!line) continue;
    for (const part of line.split(",").map((segment) => segment.trim())) {
      const key = part.split("=")[0]?.trim();
      if (key && !safeSet.has(key)) {
        throw new Error(`Unsafe bucket label in prompt: ${key}`);
      }
    }
  }
}

export const BUSINESS_INSIGHT_PROMPT_MARKERS = {
  useOnlySummary: "Use only the permitted business summary",
  noMutations: "You cannot create, update, send",
  recommendationsOnly: "You may want to",
  insufficientData: "you do not have enough data",
  dailyBriefing: "3–6 short bullet points",
} as const;
