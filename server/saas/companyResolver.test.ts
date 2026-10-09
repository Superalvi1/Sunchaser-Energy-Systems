import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveCompany, type CompanyStore, type MembershipRow, type Resolution } from "./companyResolver.ts";

// tsconfig is not strict, so the ok/!ok union does not narrow: read the failure fields through a helper.
const why = (r: Resolution): [number, string] | null => (r.ok ? null : [(r as any).status, (r as any).code]);

function store(opts: { memberships?: MembershipRow[]; companies?: Record<string, string>; customers?: Record<string, string> }): CompanyStore {
  const companies = opts.companies ?? { sunchaser: "active", co_alpha: "active", co_beta: "active" };
  return {
    async listMemberships(userId) { return (opts.memberships ?? []).filter((m) => m.userId === userId); },
    async getCompany(id) { return id in companies ? { id, name: id, status: companies[id] } : null; },
    async getCustomerCompanyId(id) { return opts.customers?.[id] ?? null; },
  };
}
const m = (company: string, user = "u1", role = "Admin", status = "active"): MembershipRow => ({ id: `m-${company}-${user}`, companyId: company, userId: user, role, status });
const staff = { id: "u1", role: "Super Admin" };

test("single membership selects that company and uses the membership role, not the global role", async () => {
  const r = await resolveCompany({ actor: staff, scope: "company" }, store({ memberships: [m("co_alpha", "u1", "Sales Executive")] }));
  assert.deepEqual(r, { ok: true, companyId: "co_alpha", role: "Sales Executive", membershipId: "m-co_alpha-u1" });
});

test("a token company must be one the user really belongs to", async () => {
  const s = store({ memberships: [m("co_alpha")] });
  const bad = await resolveCompany({ actor: staff, tokenCompanyId: "co_beta", scope: "company" }, s);
  assert.deepEqual(why(bad), [403, "not_a_member"]);
  const good = await resolveCompany({ actor: staff, tokenCompanyId: "co_alpha", scope: "company" }, s);
  assert.equal((good as any).companyId, "co_alpha");
});

test("several memberships need an explicit choice; the token picks among them", async () => {
  const s = store({ memberships: [m("co_alpha"), m("co_beta")] });
  const none = await resolveCompany({ actor: staff, scope: "company" }, s);
  assert.deepEqual(why(none), [409, "company_selection_required"]);
  const picked = await resolveCompany({ actor: staff, tokenCompanyId: "co_beta", scope: "company" }, s);
  assert.equal((picked as any).companyId, "co_beta");
});

test("suspended, invited and removed memberships grant nothing", async () => {
  for (const status of ["suspended", "invited", "removed"]) {
    const r = await resolveCompany({ actor: staff, scope: "company" }, store({ memberships: [m("co_alpha", "u1", "Admin", status)] }));
    assert.deepEqual(why(r)?.[1], "no_company_access", status);
  }
});

test("a global Super Admin without a membership gets no company access", async () => {
  const r = await resolveCompany({ actor: { id: "boss", role: "Super Admin" }, scope: "company" }, store({}));
  assert.equal(r.ok, false);
});

test("an inactive company blocks everyone in it", async () => {
  for (const status of ["suspended", "cancelled"]) {
    const r = await resolveCompany({ actor: staff, scope: "company" }, store({ memberships: [m("co_alpha")], companies: { co_alpha: status } }));
    assert.deepEqual(why(r), [403, "company_inactive"], status);
  }
  const trial = await resolveCompany({ actor: staff, scope: "company" }, store({ memberships: [m("co_alpha")], companies: { co_alpha: "trial" } }));
  assert.equal(trial.ok, true);
});

test("founding-only features are invisible (404) to other companies and open to the founding one", async () => {
  const other = await resolveCompany({ actor: staff, scope: "founding_only" }, store({ memberships: [m("co_alpha")] }));
  assert.deepEqual(why(other), [404, "not_available"]);
  const founder = await resolveCompany({ actor: staff, scope: "founding_only" }, store({ memberships: [m("sunchaser")] }));
  assert.equal((founder as any).companyId, "sunchaser");
});

test("portal customers act for the company that owns their customer record", async () => {
  const customer = { id: "u9", role: "Customer", customerId: "cust-1" };
  const r = await resolveCompany({ actor: customer, scope: "company" }, store({ customers: { "cust-1": "co_beta" } }));
  assert.deepEqual(r, { ok: true, companyId: "co_beta", role: "Customer", membershipId: undefined });
  const unlinked = await resolveCompany({ actor: { id: "u9", role: "Customer" }, scope: "company" }, store({}));
  assert.equal(unlinked.ok, false);
  // A token claiming another company cannot move a customer: tokenCompanyId is ignored for customers.
  const forged = await resolveCompany({ actor: customer, tokenCompanyId: "co_alpha", scope: "company" }, store({ customers: { "cust-1": "co_beta" } }));
  assert.equal((forged as any).companyId, "co_beta");
});

test("platform routes need the platform flag", async () => {
  assert.equal((await resolveCompany({ actor: staff, scope: "platform" }, store({}))).ok, false);
  assert.equal((await resolveCompany({ actor: { ...staff, isPlatformAdmin: true }, scope: "platform" }, store({}))).ok, true);
});
