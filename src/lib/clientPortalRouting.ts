/** Client-portal routing helpers shared by web and Capacitor shells. */

export function customerMustSkipMandatoryWizard(role: string | null | undefined): boolean {
  return String(role || "") === "Customer";
}

export function isClientProfilePending(payload: {
  profilePending?: boolean;
  customer?: { id?: string | null } | null;
} | null | undefined): boolean {
  if (!payload) return false;
  if (payload.profilePending) return true;
  return !String(payload.customer?.id || "").trim();
}

export function readInteractiveProposalTokenFromLocation(location: {
  pathname?: string;
  hash?: string;
  search?: string;
} | null | undefined): string | null {
  if (!location) return null;
  const hash = String(location.hash || "").replace(/^#/, "");
  const search = new URLSearchParams(String(location.search || ""));
  const candidates = [
    String(location.pathname || ""),
    hash,
    String(search.get("proposal") || ""),
  ];
  for (const value of candidates) {
    const match = value.match(/(?:^|\/)proposal\/([A-Za-z0-9_-]{40,80})\/?$/);
    if (match?.[1]) return match[1];
  }
  const queryToken = String(search.get("proposal") || "").trim();
  if (/^[A-Za-z0-9_-]{40,80}$/.test(queryToken)) return queryToken;
  return null;
}

export function staffLeadCustomerId(lead: { customerId?: string | null; customer_id?: string | null } | null | undefined): string {
  if (!lead) return "";
  return String(lead.customerId || lead.customer_id || "").trim();
}

export function buildPendingCustomerPortalPayload(actor: {
  name?: string | null;
  email?: string | null;
}) {
  return {
    profilePending: true as const,
    customer: {
      id: null as string | null,
      name: actor.name || "Client",
      email: actor.email || "",
    },
    lead: null,
    project: null,
    dashboard: { projectStatus: "Profile setup pending" },
    tracker: null,
  };
}
