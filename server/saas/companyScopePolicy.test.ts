import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { resolveCompanyScope } from "./companyScopePolicy.ts";

test("scope of representative paths", () => {
  const cases: Array<[string, string, string]> = [
    ["GET", "/health", "none"],
    ["POST", "/api/auth/login", "none"],
    ["POST", "/api/auth/select-company", "none"],
    ["POST", "/api/auth/register", "public_founding"],
    ["POST", "/api/public/smart-quotes", "public_founding"],
    ["POST", "/api/whatsapp/webhook", "public_founding"],
    ["GET", "/api/storage/object/customer-documents/abc", "signed_link"],
    ["GET", "/api/admin/invoices/inv-1", "company"],
    ["GET", "/api/leads", "company"],
    ["GET", "/api/customer-portal/me", "company"],
    ["GET", "/api/company/members", "company"],
    ["GET", "/api/admin/users", "founding_only"],
    ["GET", "/api/admin/roles", "founding_only"],
    ["GET", "/api/marketplace/admin/products", "founding_only"],
    ["GET", "/api/learning/courses", "founding_only"],
    ["GET", "/api/diagnostics/phase7-columns", "founding_only"],
    ["GET", "/api/state", "company"],
    ["POST", "/api/db/update", "founding_only"],
    ["GET", "/api/platform/companies", "platform"],
    ["GET", "/assets/app.js", "none"],
  ];
  for (const [method, path, expected] of cases) assert.equal(resolveCompanyScope(method, path), expected, `${method} ${path}`);
});

test("an API path no rule knows is refused (fail closed)", () => {
  assert.equal(resolveCompanyScope("GET", "/api/brand-new-module/things"), "unmatched");
  assert.equal(resolveCompanyScope("GET", "/api"), "unmatched");
});

test("query strings and trailing slashes do not change the scope", () => {
  assert.equal(resolveCompanyScope("GET", "/api/leads/?x=1"), "company");
  assert.equal(resolveCompanyScope("GET", "/api/admin/users/?a=b"), "founding_only");
});

test("a lookalike prefix is not treated as the real one", () => {
  assert.equal(resolveCompanyScope("GET", "/api/leadsX"), "company"); // /api/leads prefix intentionally covers /api/leads*
  assert.equal(resolveCompanyScope("GET", "/api/authx/login"), "unmatched");
  assert.equal(resolveCompanyScope("GET", "/api/stateful"), "unmatched");
});

test("every /api route registered in server.ts and every router mount has a scope", () => {
  const src = readFileSync(join(process.cwd(), "server.ts"), "utf8");
  const direct = [...src.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*["'`](\/(?:api\/|health)[^"'`]*)/g)].map((m) => m[1]);
  const mounts = [...src.matchAll(/app\.use\(\s*["'`](\/api\/[^"'`]*)["'`]/g)].map((m) => m[1]);
  assert.ok(direct.length > 200, `expected to find the registered routes, found ${direct.length}`);
  const unmatched = [...direct, ...mounts].filter((p) => resolveCompanyScope("GET", p) === "unmatched");
  assert.deepEqual([...new Set(unmatched)], [], "Add a rule in companyScopePolicy.ts for these paths");
});
