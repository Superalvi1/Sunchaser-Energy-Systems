import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CompanyContextMissingError, getCompanyContext, requireCompanyId, runAsFoundingCompany, runAsSystem, runWithCompany } from "./companyContext.ts";
import { assertMultiCompanyConfig, isMultiCompanyEnabled, isValidCompanyId } from "./multiCompany.ts";
import { clearTenantClientsForTests, createPostgrestFetch, getTenantClient } from "./tenantClient.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the flag is off unless explicitly true", () => {
  assert.equal(isMultiCompanyEnabled({}), false);
  assert.equal(isMultiCompanyEnabled({ MULTI_COMPANY_ENABLED: "false" }), false);
  assert.equal(isMultiCompanyEnabled({ MULTI_COMPANY_ENABLED: "1" }), false);
  assert.equal(isMultiCompanyEnabled({ MULTI_COMPANY_ENABLED: "TRUE" }), true);
});

test("boot check names what is missing when multi-company mode is on", () => {
  assert.doesNotThrow(() => assertMultiCompanyConfig({}));
  assert.throws(() => assertMultiCompanyConfig({ MULTI_COMPANY_ENABLED: "true" }), /RAILWAY_POSTGREST_URL.*SUPABASE_SERVICE_ROLE_KEY.*CRM_TENANT_POSTGREST_KEY/s);
  assert.doesNotThrow(() => assertMultiCompanyConfig({ MULTI_COMPANY_ENABLED: "true", RAILWAY_POSTGREST_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", CRM_TENANT_POSTGREST_KEY: "t" }));
});

test("company ids are validated (they end up in a request header)", () => {
  for (const ok of ["sunchaser", "co_alpha", "a1"]) assert.equal(isValidCompanyId(ok), true, ok);
  for (const bad of ["", "A", "1abc", "co-alpha", "co alpha", "a\r\nx-evil: 1", "x".repeat(60), "co_alpha;drop", 7, null]) assert.equal(isValidCompanyId(bad as any), false, String(bad));
});

test("concurrent requests keep their own company", async () => {
  const seen: string[] = [];
  await Promise.all(
    ["co_alpha", "co_beta", "sunchaser", "co_alpha", "co_beta"].map((id, i) =>
      runWithCompany({ companyId: id }, async () => {
        await sleep(5 * ((i * 7) % 5));
        seen.push(`${id}:${requireCompanyId()}`);
        await sleep(3);
        seen.push(`${id}:${requireCompanyId()}`);
      })
    )
  );
  assert.ok(seen.length === 10 && seen.every((s) => s.split(":")[0] === s.split(":")[1]), seen.join(" "));
});

test("no context outside a request, and a system context needs a reason", () => {
  assert.equal(getCompanyContext(), undefined);
  assert.throws(() => requireCompanyId(), CompanyContextMissingError);
  assert.throws(() => runAsSystem("", () => 1), /reason/);
  assert.equal(runAsSystem("billing job", () => getCompanyContext()?.kind), "system");
  assert.equal(runAsFoundingCompany(() => requireCompanyId()), "sunchaser");
  assert.throws(() => runWithCompany({ companyId: "Bad Id" }, () => 1), /Invalid company id/);
});

test("the tenant fetch strips /rest/v1, targets PostgREST and stamps the company header on every request", async () => {
  const calls: Array<{ url: string; company: string | null; auth: string | null }> = [];
  const fakeInner = (async (input: any, init?: any) => {
    calls.push({ url: String(input), company: new Headers(init?.headers).get("x-company-id"), auth: new Headers(init?.headers).get("authorization") });
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
  const f = createPostgrestFetch("http://postgrest.internal:3000/", { "x-company-id": "co_alpha" }, fakeInner);
  await f("https://railway-postgrest.internal.invalid/rest/v1/leads?select=id", { headers: { authorization: "Bearer k" } });
  assert.deepEqual(calls[0], { url: "http://postgrest.internal:3000/leads?select=id", company: "co_alpha", auth: "Bearer k" });
  // a caller cannot override the company header
  await f("https://railway-postgrest.internal.invalid/rest/v1/leads", { headers: { "x-company-id": "co_beta" } });
  assert.equal(calls[1].company, "co_alpha");
});

test("tenant clients are cached per company and refuse invalid ids or missing keys", () => {
  clearTenantClientsForTests();
  const env = { RAILWAY_POSTGREST_URL: "http://postgrest.internal:3000", CRM_TENANT_POSTGREST_KEY: "tenant-key" } as NodeJS.ProcessEnv;
  const a1 = getTenantClient("co_alpha", env), a2 = getTenantClient("co_alpha", env), b = getTenantClient("co_beta", env);
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.throws(() => getTenantClient("bad id", env), /Invalid company id/);
  assert.throws(() => getTenantClient("co_gamma", {} as NodeJS.ProcessEnv), /CRM_TENANT_POSTGREST_KEY/);
});
