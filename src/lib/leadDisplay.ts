/** Demo placeholders from early seed data — never show as real values. */
const DEMO_LOCATIONS = new Set([
  "springfield",
  "shelbyville",
  "capital district",
  "westwood",
  "742 evergreen terrace, springfield",
]);

const DEMO_ADVISORS = new Set([
  "sarah connor",
  "michael scott",
  "alex admin",
]);

export function isDemoLocation(value?: string | null): boolean {
  const v = String(value || "").trim().toLowerCase();
  return !v || DEMO_LOCATIONS.has(v);
}

export function isDemoAdvisor(value?: string | null): boolean {
  const v = String(value || "").trim().toLowerCase();
  return !v || DEMO_ADVISORS.has(v);
}

export function formatLeadLocation(lead: {
  location?: string | null;
  address?: string | null;
}): string {
  const location = String(lead.location || "").trim();
  const address = String(lead.address || "").trim();

  if (location && !isDemoLocation(location)) return location;
  if (address && !isDemoLocation(address)) return address;
  return "Location not specified";
}

export function formatLeadAdvisor(advisor?: string | null): string {
  const value = String(advisor || "").trim();
  if (!value || isDemoAdvisor(value)) return "Unassigned";
  return value;
}

/** Normalize stored values before save (strip demo placeholders). */
export function sanitizeLeadLocationInput(value?: string | null): string {
  const v = String(value || "").trim();
  if (!v || isDemoLocation(v)) return "";
  return v;
}

export function sanitizeLeadAdvisorInput(value?: string | null): string {
  const v = String(value || "").trim();
  if (!v || isDemoAdvisor(v)) return "";
  return v;
}
