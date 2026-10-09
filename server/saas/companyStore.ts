import { getSystemSupabase } from "../../dbManager.ts";
import type { CompanyRow, CompanyStore, MembershipRow } from "./companyResolver.ts";

type Cached<T> = { at: number; value: T };
const TTL_MS = 5_000;

/** Reads memberships and companies with the service role (identity data is not visible to the tenant role). */
export function createPostgrestCompanyStore(ttlMs: number = TTL_MS): CompanyStore & { invalidate(userId?: string): void } {
  const memberships = new Map<string, Cached<MembershipRow[]>>();
  const companies = new Map<string, Cached<CompanyRow | null>>();
  const fresh = <T>(c: Cached<T> | undefined): c is Cached<T> => !!c && Date.now() - c.at < ttlMs;

  return {
    async listMemberships(userId) {
      const hit = memberships.get(userId);
      if (fresh(hit)) return hit.value;
      const { data, error } = await getSystemSupabase()!.from("company_memberships").select("id, company_id, user_id, role, status").eq("user_id", userId);
      if (error) throw new Error(`Could not load company memberships: ${error.message}`);
      const rows = (data || []).map((r: any) => ({ id: r.id, companyId: r.company_id, userId: r.user_id, role: r.role, status: r.status }));
      memberships.set(userId, { at: Date.now(), value: rows });
      return rows;
    },
    async getCompany(companyId) {
      const hit = companies.get(companyId);
      if (fresh(hit)) return hit.value;
      const { data, error } = await getSystemSupabase()!.from("companies").select("id, name, status").eq("id", companyId).maybeSingle();
      if (error) throw new Error(`Could not load company: ${error.message}`);
      const row = data ? { id: data.id, name: data.name, status: data.status } : null;
      companies.set(companyId, { at: Date.now(), value: row });
      return row;
    },
    async getCustomerCompanyId(customerId) {
      const { data, error } = await getSystemSupabase()!.from("customers").select("company_id").eq("id", customerId).maybeSingle();
      if (error) throw new Error(`Could not load customer company: ${error.message}`);
      return data?.company_id ?? null;
    },
    invalidate(userId?: string) {
      if (userId) memberships.delete(userId);
      else { memberships.clear(); companies.clear(); }
    },
  };
}

/** User ids with an active membership in a company (used to keep name/username lookups inside one company). */
export async function listCompanyMemberUserIds(companyId: string): Promise<string[]> {
  const { data, error } = await getSystemSupabase()!.from("company_memberships").select("user_id").eq("company_id", companyId).eq("status", "active");
  if (error) throw new Error(`Could not load company members: ${error.message}`);
  return (data || []).map((r: any) => r.user_id);
}
