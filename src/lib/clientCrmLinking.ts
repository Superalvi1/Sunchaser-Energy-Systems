/**
 * Pure helpers that decide how a registered Customer user is linked to the
 * CRM `customers` + `leads` records the sales workspace actually lists.
 *
 * Registration historically wrote `users` (and sometimes `customers`) but the
 * CRM "Clients / Target Clients" list is `leads`. That is why a portal user
 * such as Hassan can appear in User Management and still be missing from CRM.
 */

export type ClientLinkUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  customerId?: string | null;
  customer_id?: string | null;
};

export type ClientLinkCustomer = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  user_id?: string | null;
  userId?: string | null;
  customer_code?: string | null;
};

export type ClientLinkLead = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  customer_id?: string | null;
  customerId?: string | null;
  deleted_at?: string | null;
  deletedAt?: string | null;
};

export type ProvisionDecision =
  | { action: "use-invitation"; customerId: string }
  | { action: "reuse-linked"; customerId: string }
  | { action: "reuse-unlinked"; customerId: string; reason: "email" | "phone" }
  | { action: "create"; customerId: string };

function normEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function digitsOnly(value: unknown): string {
  return String(value || "").replace(/\D+/g, "");
}

function customerUserId(c: ClientLinkCustomer): string {
  return String(c.user_id || c.userId || "").trim();
}

function leadCustomerId(l: ClientLinkLead): string {
  return String(l.customer_id || l.customerId || "").trim();
}

function isActiveLead(l: ClientLinkLead): boolean {
  return !l.deleted_at && !l.deletedAt;
}

export function userCustomerId(user: ClientLinkUser): string {
  return String(user.customer_id || user.customerId || "").trim();
}

export function findCustomerForUser(
  customers: ClientLinkCustomer[],
  user: ClientLinkUser
): ClientLinkCustomer | null {
  const uid = String(user.id || "").trim();
  if (uid) {
    const byUser = customers.find((c) => customerUserId(c) === uid);
    if (byUser) return byUser;
  }
  const cid = userCustomerId(user);
  if (cid) {
    const byId = customers.find((c) => c.id === cid);
    if (byId) {
      const owner = customerUserId(byId);
      if (!owner || owner === uid) return byId;
    }
  }
  return null;
}

export function findReusableCustomer(opts: {
  customers: ClientLinkCustomer[];
  userId: string;
  email?: string;
  phone?: string;
}): { customer: ClientLinkCustomer; reason: "email" | "phone" } | null {
  const email = normEmail(opts.email);
  const phone = digitsOnly(opts.phone);
  const uid = String(opts.userId || "").trim();

  if (email) {
    const matches = opts.customers.filter((c) => normEmail(c.email) === email);
    const unlinked = matches.find((c) => !customerUserId(c) || customerUserId(c) === uid);
    if (unlinked) return { customer: unlinked, reason: "email" };
  }

  if (phone && phone.length >= 10) {
    const matches = opts.customers.filter((c) => digitsOnly(c.phone) === phone);
    const unlinked = matches.find((c) => !customerUserId(c) || customerUserId(c) === uid);
    if (unlinked) return { customer: unlinked, reason: "phone" };
  }

  return null;
}

export function allocateCustomerId(user: ClientLinkUser, customers: ClientLinkCustomer[]): string {
  const uid = String(user.id || "").trim();
  const preferred = userCustomerId(user) || `cust-${uid.replace(/^u-/, "")}`;
  const existing = customers.find((c) => c.id === preferred);
  if (!existing) return preferred;
  const owner = customerUserId(existing);
  if (!owner || owner === uid) return preferred;
  const suffix = Date.now().toString(36);
  return `cust-${uid.replace(/^u-/, "") || "client"}-${suffix}`;
}

export function decideCustomerProvision(opts: {
  user: ClientLinkUser;
  customers: ClientLinkCustomer[];
  invitedCustomerId?: string | null;
}): ProvisionDecision {
  const invited = String(opts.invitedCustomerId || "").trim();
  if (invited) {
    const invitedCustomer = opts.customers.find((c) => c.id === invited);
    const owner = invitedCustomer ? customerUserId(invitedCustomer) : "";
    if (owner && owner !== String(opts.user.id || "").trim()) {
      const already = findCustomerForUser(opts.customers, opts.user);
      if (already) return { action: "reuse-linked", customerId: already.id };
      return { action: "create", customerId: allocateCustomerId(opts.user, opts.customers) };
    }
    return { action: "use-invitation", customerId: invited };
  }

  const already = findCustomerForUser(opts.customers, opts.user);
  if (already) {
    return { action: "reuse-linked", customerId: already.id };
  }

  const reusable = findReusableCustomer({
    customers: opts.customers,
    userId: opts.user.id,
    email: opts.user.email || undefined,
    phone: opts.user.phone || undefined,
  });
  if (reusable) {
    return { action: "reuse-unlinked", customerId: reusable.customer.id, reason: reusable.reason };
  }

  return { action: "create", customerId: allocateCustomerId(opts.user, opts.customers) };
}

export function findLeadForCustomer(
  leads: ClientLinkLead[],
  customerId: string,
  email?: string
): ClientLinkLead | null {
  const cid = String(customerId || "").trim();
  if (cid) {
    const byCustomer = leads.find((l) => isActiveLead(l) && leadCustomerId(l) === cid);
    if (byCustomer) return byCustomer;
  }
  const mail = normEmail(email);
  if (mail) {
    const byEmail = leads.find((l) => {
      if (!isActiveLead(l) || normEmail(l.email) !== mail) return false;
      const owner = leadCustomerId(l);
      return !owner || owner === cid;
    });
    if (byEmail) return byEmail;
  }
  return null;
}

export function buildRegistrationCustomerRow(opts: {
  customerId: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  customerCode: string;
  now?: string;
}) {
  return {
    id: opts.customerId,
    name: opts.name,
    email: opts.email,
    phone: opts.phone || null,
    address: null,
    customer_code: opts.customerCode,
    user_id: opts.userId,
    created_at: opts.now || new Date().toISOString(),
  };
}

export function buildRegistrationLeadRow(opts: {
  leadId?: string;
  customerId: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  now?: string;
}) {
  const now = opts.now || new Date().toISOString();
  const phone = String(opts.phone || "").trim() || "Pending";
  const address = String(opts.address || "").trim() || "Pending";
  return {
    id: opts.leadId || `lead-${opts.customerId.replace(/^cust-/, "")}`,
    customer_id: opts.customerId,
    name: opts.name,
    email: opts.email,
    phone,
    address,
    status: "New",
    monthly_bill: 0,
    monthly_units: 0,
    sanctioned_load: 0,
    roof_space: 0,
    shading: "None",
    rating: 3,
    assigned_salesperson: "",
    notes: "Created automatically from client portal registration.",
    lead_source: "Client Registration",
    engagement_level: "Medium",
    conversion_probability: 50,
    conversion_score: 50,
    created_at: now,
  };
}
