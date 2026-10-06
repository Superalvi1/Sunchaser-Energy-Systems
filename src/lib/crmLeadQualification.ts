import type { Lead, DashboardStats } from "../types";
import { isSmartQuoteLead } from "./smartQuoteLead";

/** Keep historical enquiries in storage/inbox without treating them as qualified CRM clients. */
export function isQualifiedCrmLead(lead: Lead): boolean {
  if (isSmartQuoteLead(lead) || lead.quotes?.length) return true;
  if (!/^whatsapp shared inbox$/i.test(String(lead.leadSource || "").trim()))
    return true;
  // Staff-created links are explicit promotion; automatic links used this system actor.
  const actor = String(lead.notes || "").match(
    /Created from WhatsApp Shared Inbox conversation .+ by ([^\s.]+)\./,
  )?.[1];
  if (actor && actor !== "system_auto_link") return true;
  return !["New", "Contacted", ""].includes(String(lead.status || ""));
}

export function filterCrmState<
  T extends { leads: Lead[]; stats?: DashboardStats },
>(state: T): T {
  const leads = state.leads.filter(isQualifiedCrmLead);
  if (!state.stats) return { ...state, leads };
  const excluded = state.leads.filter(
    (l) => !isQualifiedCrmLead(l) && !l.deletedAt,
  );
  const leadsByStatus = { ...state.stats.leadsByStatus };
  for (const lead of excluded)
    leadsByStatus[lead.status] = Math.max(
      0,
      (leadsByStatus[lead.status] || 0) - 1,
    );
  return {
    ...state,
    leads,
    stats: {
      ...state.stats,
      totalLeads: Math.max(0, state.stats.totalLeads - excluded.length),
      pipelineCount: Math.max(0, state.stats.pipelineCount - excluded.length),
      leadsByStatus,
    },
  };
}
