import { strict as assert } from "node:assert";
import { test } from "node:test";
import { enforceOwnership, referencedRecords, OWNERSHIP_RULES, type OwnedTable } from "./ownershipGuard.ts";

const owners: Record<string, string> = {
  "leads:lead-a": "co_a", "leads:lead-b": "co_b", "invoices:inv-a": "co_a", "invoices:inv-b": "co_b",
  "customers:cust-a": "co_a", "customers:cust-b": "co_b", "quotations:q-a": "co_a", "quotations:q-b": "co_b",
  "delivery_challans:ch-b": "co_b", "projects:pr-b": "co_b",
};
const calls: string[] = [];
const readOwner = async (t: OwnedTable, id: string) => { calls.push(`${t}:${id}`); return owners[`${t}:${id}`] ?? null; };
const mk = (method: string, url: string, body?: Record<string, unknown>) => {
  const u = new URL(url, "http://x");
  const query: Record<string, unknown> = {}; u.searchParams.forEach((v, k) => (query[k] = v));
  return { method, path: u.pathname, url: u.pathname + u.search, query, body } as any;
};

test("another company's record in the path is replaced by an id that does not exist; the query string survives", async () => {
  const req = mk("GET", "/api/admin/invoices/inv-b/payments?x=1");
  const v = await enforceOwnership(req, "co_a", readOwner);
  assert.ok(v.ok && v.rewritten === 1);
  assert.match(req.url, /^\/api\/admin\/invoices\/denied-[0-9a-f]{18}\/payments\?x=1$/);
  assert.ok(!req.url.includes("inv-b"));
});

test("the caller's own record and a record that does not exist are left alone", async () => {
  const own = mk("PATCH", "/api/admin/invoices/inv-a"); await enforceOwnership(own, "co_a", readOwner);
  assert.equal(own.url, "/api/admin/invoices/inv-a");
  const missing = mk("PATCH", "/api/admin/invoices/inv-zzz"); await enforceOwnership(missing, "co_a", readOwner);
  assert.equal(missing.url, "/api/admin/invoices/inv-zzz");
});

test("a foreign id named in the body or the query is replaced", async () => {
  const up = mk("POST", "/api/admin/customer-documents/upload", { customerId: "cust-b", fileName: "x.pdf" });
  const v = await enforceOwnership(up, "co_a", readOwner);
  assert.ok(v.ok && v.rewritten === 1);
  assert.match(String(up.body.customerId), /^denied-/);
  assert.equal(up.body.fileName, "x.pdf");
  const pdf = mk("GET", "/api/export/pdf/manual-quote/lead-a?quoteId=q-b");
  await enforceOwnership(pdf, "co_a", readOwner);
  assert.match(pdf.url, /quoteId=denied-/);
  assert.match(String(pdf.query.quoteId), /^denied-/);
});

test("two ids in one path are both checked", async () => {
  const req = mk("DELETE", "/api/leads/lead-a/quotes/q-b");
  const v = await enforceOwnership(req, "co_a", readOwner);
  assert.ok(v.ok && v.rewritten === 1);
  assert.ok(req.url.startsWith("/api/leads/lead-a/quotes/denied-"));
});

test("fixed words of the API are never looked up, and unrelated paths are ignored", async () => {
  calls.length = 0;
  for (const u of ["/api/leads/deleted", "/api/admin/invoices/contracted-ready", "/api/admin/invoices/bulk-delete", "/api/admin/deliveries/dashboard/summary", "/api/state", "/api/leads"]) {
    await enforceOwnership(mk("GET", u), "co_a", readOwner);
  }
  assert.deepEqual(calls, []);
});

test("an owner lookup that fails refuses the request (fail closed)", async () => {
  const v = await enforceOwnership(mk("GET", "/api/leads/lead-a"), "co_a", async () => { throw new Error("db down"); });
  assert.equal(v.ok, false);
  assert.equal((v as any).status, 503);
});

test("odd ids cannot smuggle path pieces or query syntax", () => {
  assert.deepEqual(referencedRecords("GET", "/api/leads/..%2Fadmin", {}, undefined), []);
  assert.deepEqual(referencedRecords("GET", "/api/leads/a%20b", {}, undefined), []);
  assert.equal(referencedRecords("GET", "/api/leads/lead-a/smart-quote-versions", {}, undefined).length, 1);
});

test("every company-scoped core route family has a rule", () => {
  const probes: Array<[string, string, OwnedTable]> = [
    ["GET", "/api/leads/x", "leads"], ["POST", "/api/leads/x/create-quote", "leads"], ["GET", "/api/leads/x/smart-quote-versions", "leads"],
    ["GET", "/api/admin/invoices/x", "invoices"], ["POST", "/api/admin/invoices/x/payments", "invoices"], ["GET", "/api/export/pdf/invoice/x", "invoices"],
    ["GET", "/api/admin/customer-documents/x", "customers"], ["GET", "/api/admin/customers/x/warranty-certificate", "customers"],
    ["GET", "/api/export/pdf/manual-quote/x", "leads"], ["GET", "/api/export/pdf/x", "leads"], ["GET", "/api/admin/deliveries/x", "delivery_challans"],
  ];
  for (const [m, p, t] of probes) {
    const r = referencedRecords(m, p, {}, undefined);
    assert.ok(r.some((x) => x.table === t && x.id === "x"), `${m} ${p} should check a ${t}`);
  }
  assert.ok(OWNERSHIP_RULES.length > 10);
});
