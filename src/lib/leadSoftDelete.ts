/** Returns true when lead is visible in active CRM lists. */
export function isActiveLead(lead: { deletedAt?: string | null; deleted_at?: string | null } | null | undefined): boolean {
  if (!lead) return false;
  return !lead.deletedAt && !lead.deleted_at;
}

export function filterActiveLeads<T extends { deletedAt?: string | null; deleted_at?: string | null }>(
  leads: T[] | null | undefined
): T[] {
  return (leads || []).filter(isActiveLead);
}

export function filterDeletedLeads<T extends { deletedAt?: string | null; deleted_at?: string | null }>(
  leads: T[] | null | undefined
): T[] {
  return (leads || []).filter((l) => !isActiveLead(l));
}
