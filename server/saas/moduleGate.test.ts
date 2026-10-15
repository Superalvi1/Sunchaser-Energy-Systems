import test from "node:test";
import assert from "node:assert/strict";
import { runWithCompany } from "./companyContext.ts";
import { moduleFlags, DESIGN_TOOLS_DISABLED_MESSAGE } from "./moduleGate.ts";
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

test("the WhatsApp inbox API is founding-only (it needs a WhatsApp connection, which only the founding company has)", () => {
  for (const p of ["/api/inbox/threads", "/api/inbox", "/api/conversations", "/api/conversations/c1/messages"]) assert.equal(resolveCompanyScope("GET", p), "founding_only", p);
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

test("design tools (interactive proposals, Proposal Studio, Roof Studio): off for another company, on for the founding company and in single-company mode", () => {
  runWithCompany({ companyId: "acme" }, () => assert.equal(moduleFlags(ON).designTools, false));
  runWithCompany({ companyId: "sunchaser" }, () => assert.equal(moduleFlags(ON).designTools, true));
  assert.equal(moduleFlags({}).designTools, true);
  assert.match(DESIGN_TOOLS_DISABLED_MESSAGE, /company-specific pricing/);
});

test("every design-tool API path is founding-only, so another company gets 'not found' before any handler runs", () => {
  const paths: Array<[string, string]> = [
    ["GET", "/api/interactive-proposals"], ["POST", "/api/interactive-proposals"], ["POST", "/api/interactive-proposals/ip1/revoke"],
    ["GET", "/api/leads/lead-1/design-session"], ["PUT", "/api/leads/lead-1/design-session"],
    ["POST", "/api/export/pdf/design-studio-proposal/download"], ["POST", "/api/export/pdf/design-studio-proposal"],
  ];
  for (const [m, p] of paths) assert.equal(resolveCompanyScope(m, p), "founding_only", `${m} ${p}`);
  // neighbours stay company-scoped
  for (const [m, p] of [["GET", "/api/leads"], ["GET", "/api/leads/lead-1"], ["PUT", "/api/leads/lead-1/quote"], ["GET", "/api/export/pdf/quotation/lead-1"]] as const) {
    assert.notEqual(resolveCompanyScope(m, p), "founding_only", `${m} ${p}`);
  }
});

test("no staff route registered in server.ts or the interactive-proposal router that mentions design, roof, proposal studio or interactive proposals escapes the gate", async () => {
  const fs = await import("node:fs");
  const files = ["../../server.ts", "../interactiveProposals/interactiveProposalRoutes.ts"].map((f) => fs.readFileSync(new URL(f, import.meta.url), "utf8"));
  const routes = files.flatMap((src) => [...src.matchAll(/^\s*app\.(get|post|put|patch|delete)\(\s*"(\/api[^"]*)"/gm)].map((m) => ({ method: m[1].toUpperCase(), path: m[2].replace(/:[A-Za-z]+/g, "x1") })));
  const related = routes.filter((r) => /design-session|design-studio|interactive-proposals|roof/i.test(r.path));
  assert.ok(related.length >= 6, `found ${related.length}`);
  // The public client page resolves by an unguessable token as the founding company (no pilot company can create such a token).
  const open = related.filter((r) => !r.path.startsWith("/api/public/interactive-proposals/") && resolveCompanyScope(r.method, r.path) !== "founding_only").map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(open, []);
});

test("assistants (AI widget, portal sizing wizard): off for another company, on for the founding company and in single-company mode", () => {
  runWithCompany({ companyId: "acme" }, () => assert.equal(moduleFlags(ON).assistants, false));
  runWithCompany({ companyId: "sunchaser" }, () => assert.equal(moduleFlags(ON).assistants, true));
  assert.equal(moduleFlags({}).assistants, true);
  for (const p of ["/api/ai/chat", "/api/gemini/chat", "/api/gemini/sizing-recommendations", "/api/gemini/generate-proposal"]) assert.equal(resolveCompanyScope("POST", p), "founding_only", p);
});
