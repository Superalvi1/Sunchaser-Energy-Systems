import assert from "node:assert/strict";
import { test } from "node:test";
import { filterCrmState, isQualifiedCrmLead } from "./crmLeadQualification";
import type { Lead } from "../types";
const enquiry = {
  id: "wa",
  leadSource: "WhatsApp Shared Inbox",
  status: "New",
  notes:
    "Created from WhatsApp Shared Inbox conversation c_1 by system_auto_link.",
} as Lead;
test("historical automatic enquiries are hidden", () => {
  assert.equal(isQualifiedCrmLead(enquiry), false);
  assert.equal(isQualifiedCrmLead({ ...enquiry, status: "Contacted" }), false);
});
test("manual and Smart Quote clients remain visible", () => {
  for (const leadSource of ["Direct/Referral", "Smart Quote", "Website"])
    assert.equal(isQualifiedCrmLead({ ...enquiry, leadSource }), true);
  assert.equal(
    isQualifiedCrmLead({
      ...enquiry,
      notes:
        "Created from WhatsApp Shared Inbox conversation c_1 by allauddin.",
    }),
    true,
  );
});
test("existing quotations and converted clients are preserved", () => {
  assert.equal(
    isQualifiedCrmLead({ ...enquiry, quotes: [{ id: "quote" }] as any }),
    true,
  );
  assert.equal(isQualifiedCrmLead({ ...enquiry, status: "Installed" }), true);
});
test("filter does not delete records or mutate state and adjusts lead counts", () => {
  const manual = { ...enquiry, id: "manual", leadSource: "Direct/Referral" };
  const state = {
    leads: [enquiry, manual],
    stats: {
      totalLeads: 2,
      pipelineCount: 2,
      totalRevenue: 500,
      pendingRevenue: 300,
      installedCount: 0,
      contractedCount: 0,
      leadsByStatus: { New: 2 },
    },
  };
  const filtered = filterCrmState(state);
  assert.deepEqual(filtered.leads, [manual]);
  assert.equal(state.leads.length, 2);
  assert.equal(state.stats.leadsByStatus.New, 2);
  assert.equal(filtered.stats.totalLeads, 1);
  assert.equal(filtered.stats.pipelineCount, 1);
  assert.equal(filtered.stats.leadsByStatus.New, 1);
  assert.equal(filtered.stats.totalRevenue, 500);
});
