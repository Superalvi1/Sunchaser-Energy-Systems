import { strict as assert } from "node:assert";
import { test } from "node:test";

const saved = { ...process.env };
test.after(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });

const { getSupabase, getSystemSupabase } = await import("../../dbManager.ts");
const { CompanyContextMissingError, runAsSystem, runWithCompany } = await import("./companyContext.ts");
const { clearTenantClientsForTests } = await import("./tenantClient.ts");

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
}

test("single-company mode returns the same service client everywhere, with or without a context", () => {
  setEnv({ MULTI_COMPANY_ENABLED: "false", RAILWAY_POSTGREST_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
  const base = getSupabase();
  assert.ok(base);
  assert.equal(getSupabase(), getSystemSupabase());
  assert.equal(runWithCompany({ companyId: "co_alpha" }, () => getSupabase()), base);
});

test("multi-company mode: no context fails closed instead of using the service role", () => {
  setEnv({ MULTI_COMPANY_ENABLED: "true", RAILWAY_POSTGREST_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRM_TENANT_POSTGREST_KEY: "tenant-key" });
  assert.throws(() => getSupabase(), CompanyContextMissingError);
});

test("multi-company mode: a company context gets a per-company tenant client, never the service client", () => {
  setEnv({ MULTI_COMPANY_ENABLED: "true", RAILWAY_POSTGREST_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRM_TENANT_POSTGREST_KEY: "tenant-key" });
  clearTenantClientsForTests();
  const system = getSystemSupabase();
  const a = runWithCompany({ companyId: "co_alpha" }, () => getSupabase());
  const b = runWithCompany({ companyId: "co_beta" }, () => getSupabase());
  assert.ok(a && b && system);
  assert.notEqual(a, system);
  assert.notEqual(a, b);
});

test("multi-company mode: explicit system work gets the service client", () => {
  setEnv({ MULTI_COMPANY_ENABLED: "true", RAILWAY_POSTGREST_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRM_TENANT_POSTGREST_KEY: "tenant-key" });
  assert.equal(runAsSystem("unit test", () => getSupabase()), getSystemSupabase());
});

test("multi-company mode without the tenant key refuses to hand out a client", () => {
  setEnv({ MULTI_COMPANY_ENABLED: "true", RAILWAY_POSTGREST_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRM_TENANT_POSTGREST_KEY: undefined });
  clearTenantClientsForTests();
  assert.throws(() => runWithCompany({ companyId: "co_alpha" }, () => getSupabase()), /CRM_TENANT_POSTGREST_KEY/);
});
