import test from "node:test";
import assert from "node:assert/strict";
import { runWithCompany } from "./companyContext.ts";
import { moduleFlags } from "./moduleGate.ts";
import { resolveCompanyScope } from "./companyScopePolicy.ts";

const ON = { MULTI_COMPANY_ENABLED: "true" } as NodeJS.ProcessEnv;

test("AutoSizer: off for another company, on for the founding company and in single-company mode", () => {
  runWithCompany({ companyId: "acme" }, () => assert.equal(moduleFlags(ON).autoSizer, false));
  runWithCompany({ companyId: "sunchaser" }, () => assert.equal(moduleFlags(ON).autoSizer, true));
  runWithCompany({ companyId: "acme" }, () => assert.equal(moduleFlags({}).autoSizer, true));
});

test("AutoSizer API paths are founding-only, so another company gets 'not found' before any handler runs", () => {
  for (const [m, p] of [["GET", "/api/admin/autosizer-presets"], ["PUT", "/api/admin/autosizer-presets"],
    ["GET", "/api/export/pdf/auto-sizer/lead-1"], ["GET", "/api/export/pdf/auto-sizer/lead-1/download"]] as const) {
    assert.equal(resolveCompanyScope(m, p), "founding_only", `${m} ${p}`);
  }
  assert.equal(resolveCompanyScope("GET", "/api/export/pdf/quotation/lead-1"), "company"); // other PDFs are unaffected
});

test("after-sales (delivery, warranty, handover) is off for another company and on for the founding company", () => {
  runWithCompany({ companyId: "acme" }, () => assert.equal(moduleFlags(ON).afterSales, false));
  runWithCompany({ companyId: "sunchaser" }, () => assert.equal(moduleFlags(ON).afterSales, true));
  assert.equal(moduleFlags({}).afterSales, true);
});

test("every after-sales API path is founding-only, so another company gets 'not found' before any handler runs", () => {
  const paths = [
    "/api/admin/deliveries", "/api/admin/deliveries/dch-1", "/api/admin/deliveries/dch-1/challan-pdf", "/api/admin/deliveries/dch-1/certificate",
    "/api/admin/deliveries/dashboard/summary", "/api/admin/delivery-dashboard/contracted-customers", "/api/admin/invoices/inv-1/deliveries",
    "/api/admin/invoices/inv-1/delivery-summary", "/api/admin/project-deliveries", "/api/admin/project-deliveries/p1/items",
    "/api/admin/project-completion/gaps", "/api/admin/customer-warranties", "/api/admin/customers/c1/warranty-certificate",
    "/api/admin/warranty-claims", "/api/admin/warranty-claims/w1", "/api/customer-portal/deliveries/me", "/api/customer-portal/deliveries/d1/certificate",
    "/api/customer-portal/project-delivery/me", "/api/customer-portal/warranties/me", "/api/customer-portal/warranty-certificate/me",
    "/api/customer-portal/warranty-claim", "/api/customer-portal/warranty-handover/me", "/api/export/pdf/warranty-handover/d1",
    "/api/technical/project-deliveries/me", "/api/technical/project-deliveries/p1/completion-media", "/api/warranties/w1/claims", "/api/warranties/w1/claims/c1/status",
  ];
  for (const p of paths) assert.equal(resolveCompanyScope("GET", p), "founding_only", p);
  // paths that merely look similar stay company-scoped
  for (const p of ["/api/admin/invoices", "/api/admin/invoices/inv-1/payments", "/api/customer-portal/invoices/me", "/api/export/pdf/invoice/inv-1", "/api/technical/tasks"]) {
    assert.notEqual(resolveCompanyScope("GET", p), "founding_only", p);
  }
});

test("no after-sales route registered in server.ts escapes the gate (a new route with these words must be gated or listed here)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../server.ts", import.meta.url), "utf8");
  const routes = [...src.matchAll(/^app\.(get|post|put|patch|delete)\("(\/api[^"]*)"/gm)].map((m) => ({ method: m[1].toUpperCase(), path: m[2].replace(/:[A-Za-z]+/g, "x1") }));
  const related = routes.filter((r) => /deliver|warrant|handover|completion|certificate/i.test(r.path));
  assert.ok(related.length > 30, `found ${related.length}`);
  // Public delivery verification is token-based and resolves as the founding company; onboarding completion is unrelated.
  const allowed = (p: string) => p.startsWith("/api/public/delivery/") || p === "/api/onboarding/complete";
  const open = related.filter((r) => !allowed(r.path) && resolveCompanyScope(r.method, r.path) !== "founding_only").map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(open, []);
});
