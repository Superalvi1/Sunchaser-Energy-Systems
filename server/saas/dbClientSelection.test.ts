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

test("single-company mode with the isolation guard closed: the service client is NOT handed out (no unfiltered access, no null that means 'use the local file')", async () => {
  const { isolationGuard, TenantIsolationError } = await import("./tenantIsolationGuard.ts");
  const { getUnguardedSystemSupabase, isSupabaseActive } = await import("../../dbManager.ts");
  setEnv({ MULTI_COMPANY_ENABLED: "false", RAILWAY_POSTGREST_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
  isolationGuard.setDeps({ probe: async () => ({ otherCompanies: 2 }) });
  await isolationGuard.refresh(); isolationGuard.arm();
  try {
    assert.throws(() => getSystemSupabase(), TenantIsolationError);
    assert.throws(() => getSupabase(), TenantIsolationError);
    assert.throws(() => runWithCompany({ companyId: "sunchaser" }, () => getSupabase()), TenantIsolationError, "a founding-company context does not open it either");
    assert.ok(getUnguardedSystemSupabase(), "the guard's own probe still has a client");
    assert.equal(isSupabaseActive(), true, "'is a database configured' stays true, so no code falls back to the local JSON file");
    // the flag on: the tenant role's row-level policies isolate; the guard stands aside
    setEnv({ MULTI_COMPANY_ENABLED: "true", CRM_TENANT_POSTGREST_KEY: "tenant-key" });
    assert.doesNotThrow(() => runAsSystem("test", () => getSupabase()));
  } finally { isolationGuard.stop(); isolationGuard.setDeps({ flagOn: () => false, probe: async () => ({ tablesMissing: true }) }); await isolationGuard.refresh(); }
});
