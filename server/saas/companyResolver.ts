import { FOUNDING_COMPANY_ID } from "./multiCompany.ts";
import type { CompanyScope } from "./companyScopePolicy.ts";

export type MembershipRow = { id: string; companyId: string; userId: string; role: string; status: string };
export type CompanyRow = { id: string; name: string; status: string };

export interface CompanyStore {
  listMemberships(userId: string): Promise<MembershipRow[]>;
  getCompany(companyId: string): Promise<CompanyRow | null>;
  getCustomerCompanyId(customerId: string): Promise<string | null>;
}

export type ResolverActor = { id: string; role: string; customerId?: string; isPlatformAdmin?: boolean };

export type Resolution =
  | { ok: true; companyId: string; role: string; membershipId?: string }
  | { ok: false; status: 401 | 403 | 404 | 409; code: string; error: string };

const ACTIVE_COMPANY = new Set(["trial", "active"]);

const deny = (status: 401 | 403 | 404 | 409, code: string, error: string): Resolution => ({ ok: false, status, code, error });

/**
 * Decides which company a request acts for. Never trusts the request body, query or headers: the company comes from
 * the caller's active membership (staff) or from their customer record (portal customers). The token may only
 * choose between memberships the caller really has.
 */
export async function resolveCompany(
  input: { actor: ResolverActor; tokenCompanyId?: string | null; scope: CompanyScope },
  store: CompanyStore
): Promise<Resolution> {
  const { actor, scope } = input;

  if (scope === "platform") {
    return actor.isPlatformAdmin ? { ok: true, companyId: FOUNDING_COMPANY_ID, role: actor.role } : deny(403, "platform_only", "Platform administrators only.");
  }

  let companyId: string;
  let role = actor.role;
  let membershipId: string | undefined;

  if (actor.role === "Customer") {
    if (!actor.customerId) return deny(403, "no_company_access", "This account is not linked to a company.");
    const owner = await store.getCustomerCompanyId(actor.customerId);
    if (!owner) return deny(403, "no_company_access", "This account is not linked to a company.");
    companyId = owner;
  } else {
    const active = (await store.listMemberships(actor.id)).filter((m) => m.status === "active");
    if (input.tokenCompanyId) {
      const chosen = active.find((m) => m.companyId === input.tokenCompanyId);
      if (!chosen) return deny(403, "not_a_member", "You are not a member of this company.");
      ({ companyId, role, id: membershipId } = { companyId: chosen.companyId, role: chosen.role, id: chosen.id });
    } else if (active.length === 1) {
      ({ companyId, role, id: membershipId } = { companyId: active[0].companyId, role: active[0].role, id: active[0].id });
    } else if (active.length === 0) {
      return deny(403, "no_company_access", "You do not belong to any active company.");
    } else {
      return deny(409, "company_selection_required", "Choose a company to continue.");
    }
  }

  const company = await store.getCompany(companyId);
  if (!company) return deny(403, "no_company_access", "This account is not linked to a company.");
  if (!ACTIVE_COMPANY.has(company.status)) {
    return deny(403, "company_inactive", "This company account is not active. Contact support.");
  }

  // Features not yet scoped per company exist for the founding company only. Hide them from everyone else.
  if (scope === "founding_only" && companyId !== FOUNDING_COMPANY_ID) {
    return deny(404, "not_available", "Not found.");
  }

  return { ok: true, companyId, role, membershipId };
}
