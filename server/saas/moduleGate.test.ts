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
