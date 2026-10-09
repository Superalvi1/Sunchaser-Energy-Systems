import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Request, Response } from "express";

process.env.JWT_SECRET = "saas-authorization-test-secret-32-chars-min";
process.env.JWT_EXPIRES_IN = "1h";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.RAILWAY_POSTGREST_URL;

const { signAccessToken } = await import("../auth/jwt.ts");
const { createAuthorizationMiddleware } = await import("../middleware/authorization.ts");
const { getCompanyContext } = await import("./companyContext.ts");

const users = [
  { id: "u-alpha", username: "alpha_admin", name: "Alpha Admin", email: "a@x.test", role: "Admin", account_status: "Approved" },
  { id: "u-both", username: "both_user", name: "Both", email: "b@x.test", role: "Admin", account_status: "Approved" },
  { id: "u-none", username: "nobody", name: "No Company", email: "n@x.test", role: "Super Admin", account_status: "Approved" },
  { id: "u-sun", username: "sun_admin", name: "Sun Admin", email: "s@x.test", role: "Super Admin", account_status: "Approved" },
  { id: "u-portal", username: "portal_user", name: "Portal", email: "p@x.test", role: "Customer", account_status: "Approved", customerId: "cust-b1" },
];
const memberships = [
  { id: "m1", companyId: "co_alpha", userId: "u-alpha", role: "Sales Manager", status: "active" },
  { id: "m2", companyId: "co_alpha", userId: "u-both", role: "Admin", status: "active" },
  { id: "m3", companyId: "co_beta", userId: "u-both", role: "Sales Executive", status: "active" },
  { id: "m4", companyId: "sunchaser", userId: "u-sun", role: "Super Admin", status: "active" },
];
let failStore = false;
const store = {
  async listMemberships(userId: string) { if (failStore) throw new Error("db down"); return memberships.filter((m) => m.userId === userId); },
  async getCompany(id: string) { return ["sunchaser", "co_alpha", "co_beta"].includes(id) ? { id, name: id, status: "active" } : null; },
  async getCustomerCompanyId(id: string) { return id === "cust-b1" ? "co_beta" : null; },
};

function run(method: string, path: string, user?: (typeof users)[number], cid?: string, multi = true) {
  process.env.MULTI_COMPANY_ENABLED = multi ? "true" : "false";
  const mw = createAuthorizationMiddleware({ resolveLocalDb: () => ({ users } as any), companyStore: store });
  const headers: Record<string, string> = {};
  if (user) headers.authorization = `Bearer ${signAccessToken({ userId: user.id, username: user.username, role: user.role, companyId: cid })}`;
  const req = { method, path, headers, socket: { remoteAddress: "127.0.0.1" } } as unknown as Request;
  const res = { statusCode: 200, body: null as any, status(c: number) { this.statusCode = c; return this; }, json(p: unknown) { this.body = p; return this; } };
  let nextCtx: ReturnType<typeof getCompanyContext> | "not called" = "not called";
  return mw(req, res as unknown as Response, () => { nextCtx = getCompanyContext(); }).then(() => ({ req, res, nextCtx }));
}
const [alpha, both, none, sun, portal] = users;

test("flag off: nothing changes (no company context is created)", async () => {
  const r = await run("GET", "/api/leads", alpha, undefined, false);
  assert.equal(r.nextCtx, undefined);
  assert.equal(r.res.statusCode, 200);
});

test("a route with no scope rule is refused", async () => {
  const r = await run("GET", "/api/brand-new-module", alpha);
  assert.equal(r.res.statusCode, 403);
  assert.equal(r.nextCtx, "not called");
});

test("a member's request runs inside their company with the role they hold there", async () => {
  const r = await run("GET", "/api/leads", alpha);
  assert.equal(r.res.statusCode, 200);
  assert.deepEqual(r.nextCtx, { kind: "company", companyId: "co_alpha", userId: "u-alpha", role: "Sales Manager", membershipId: "m1" });
  assert.equal(r.req.actor?.role, "Sales Manager"); // not the global "Admin"
  assert.equal(r.req.actor?.companyId, "co_alpha");
});

test("a token cannot name a company the user does not belong to", async () => {
  const r = await run("GET", "/api/leads", alpha, "co_beta");
  assert.equal(r.res.statusCode, 403);
  assert.equal((r.res.body as any).code, "not_a_member");
  assert.equal(r.nextCtx, "not called");
});

test("a user in two companies must choose; the token chooses among their own", async () => {
  const ask = await run("GET", "/api/leads", both);
  assert.equal(ask.res.statusCode, 409);
  assert.equal((ask.res.body as any).code, "company_selection_required");
  const beta = await run("GET", "/api/leads", both, "co_beta");
  assert.deepEqual((beta.nextCtx as any).companyId, "co_beta");
  assert.equal(beta.req.actor?.role, "Sales Executive");
});

test("a global Super Admin without a membership gets nothing", async () => {
  const r = await run("GET", "/api/leads", none);
  assert.equal(r.res.statusCode, 403);
  assert.equal((r.res.body as any).code, "no_company_access");
});

test("founding-only features answer 404 to other companies and work for the founding company", async () => {
  const other = await run("GET", "/api/marketplace/admin/products", alpha);
  assert.equal(other.res.statusCode, 404);
  const founder = await run("GET", "/api/admin/users", sun);
  assert.equal(founder.res.statusCode, 200);
  assert.equal((founder.nextCtx as any).companyId, "sunchaser");
});

test("public intake runs as the founding company until it is resolved per company", async () => {
  const r = await run("POST", "/api/public/smart-quotes");
  assert.equal(r.res.statusCode, 200);
  assert.deepEqual(r.nextCtx, { kind: "company", companyId: "sunchaser" });
});

test("identity routes need no company", async () => {
  const r = await run("GET", "/api/auth/me", alpha);
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.nextCtx, undefined);
});

test("portal customers are bound to their customer's company and kept off staff routes", async () => {
  const ok = await run("GET", "/api/customer-portal/me", portal);
  assert.equal(ok.res.statusCode, 200);
  assert.equal((ok.nextCtx as any).companyId, "co_beta");
  const staff = await run("GET", "/api/leads", portal);
  assert.equal(staff.res.statusCode, 403);
});

test("a company lookup failure is a 503, never an unscoped pass-through", async () => {
  failStore = true;
  try {
    const r = await run("GET", "/api/leads", alpha);
    assert.equal(r.res.statusCode, 503);
    assert.equal(r.nextCtx, "not called");
  } finally { failStore = false; }
});
