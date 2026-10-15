import type { CompanyStore } from "./companyResolver.ts";

export type LoginCompany = { id: string; name: string; role: string };

const OPEN = new Set(["trial", "active"]);

/** The companies a signed-in user can act for. Staff: active memberships. Portal customers: their customer's company. */
export async function listLoginCompanies(
  user: { id: string; role: string; customerId?: string },
  store: CompanyStore
): Promise<LoginCompany[]> {
  if (user.role === "Customer") {
    if (!user.customerId) return [];
    const id = await store.getCustomerCompanyId(user.customerId);
    const company = id ? await store.getCompany(id) : null;
    return company && OPEN.has(company.status) ? [{ id: company.id, name: company.name, role: "Customer" }] : [];
  }
  const out: LoginCompany[] = [];
  for (const m of (await store.listMemberships(user.id)).filter((x) => x.status === "active")) {
    const company = await store.getCompany(m.companyId);
    if (company && OPEN.has(company.status)) out.push({ id: company.id, name: company.name, role: m.role });
  }
  return out;
}
