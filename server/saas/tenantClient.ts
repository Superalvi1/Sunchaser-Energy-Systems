import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isValidCompanyId } from "./multiCompany.ts";

/**
 * Builds the PostgREST fetch used by every client: supabase-js calls /rest/v1/..., plain PostgREST serves /...,
 * so the prefix is stripped and the host replaced. Extra headers (the company) are added on each request.
 */
export function createPostgrestFetch(baseUrl: string, extraHeaders: Record<string, string> = {}, inner: typeof fetch = fetch): typeof fetch {
  const targetBase = baseUrl.replace(/\/$/, "");
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const original = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(original);
    const marker = "/rest/v1";
    const headers = new Headers(init?.headers || (typeof input === "object" && "headers" in input ? (input as Request).headers : undefined));
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
    if (!parsed.pathname.startsWith(marker)) return inner(input, { ...init, headers });
    const target = new URL(targetBase + (parsed.pathname.slice(marker.length) || "/"));
    target.search = parsed.search;
    return inner(target, { ...init, headers });
  }) as typeof fetch;
}

const clients = new Map<string, SupabaseClient>();
const MAX_CACHED = 500;

/** A client bound to one company through the x-company-id header, authenticated as the non-bypass crm_tenant role. */
export function getTenantClient(companyId: string, env: NodeJS.ProcessEnv = process.env): SupabaseClient {
  if (!isValidCompanyId(companyId)) throw new Error("Invalid company id");
  const cached = clients.get(companyId);
  if (cached) return cached;
  const baseUrl = String(env.RAILWAY_POSTGREST_URL || "").trim();
  const key = String(env.CRM_TENANT_POSTGREST_KEY || "").trim();
  if (!baseUrl || !key) throw new Error("Multi-company mode needs RAILWAY_POSTGREST_URL and CRM_TENANT_POSTGREST_KEY.");
  const client = createClient("https://railway-postgrest.internal.invalid", key, {
    auth: { persistSession: false },
    global: { fetch: createPostgrestFetch(baseUrl, { "x-company-id": companyId }) },
  });
  if (clients.size >= MAX_CACHED) clients.delete(clients.keys().next().value as string);
  clients.set(companyId, client);
  return client;
}

export function clearTenantClientsForTests(): void {
  clients.clear();
}
