#!/usr/bin/env node
/**
 * Verify lead location/advisor no longer use demo defaults.
 * Usage: API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-lead-display-fix.mjs
 */
const BASE = (process.env.API_BASE || "http://localhost:3000").replace(/\/$/, "");

async function main() {
  console.log(`\n=== Lead display fix verify @ ${BASE} ===\n`);
  const res = await fetch(`${BASE}/api/state`);
  const state = await res.json();
  const results = [];

  const testLead = {
    name: `LeadDisplayTest-${Date.now()}`,
    email: `lead-display-${Date.now()}@test.local`,
    phone: "+923001234567",
    address: "Plot 12, DHA Phase 6",
    location: "Lahore",
    monthlyBill: 15000,
    roofSpace: 900,
    shading: "Low",
    leadSource: "Verify Script",
    engagementLevel: "Medium",
    notes: "verify-lead-display-fix",
  };

  const create = await fetch(`${BASE}/api/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testLead),
  });
  const created = await create.json().catch(() => ({}));
  results.push({
    step: "create lead Lahore / no advisor",
    ok: create.status === 201 && created.location === "Lahore" && !created.assignedSalesperson,
    msg: `status=${create.status} location=${created.location} advisor=${created.assignedSalesperson || "(empty)"}`,
  });

  if (created.id) {
    const assign = await fetch(`${BASE}/api/leads/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedSalesperson: "Muhammad Allauddin" }),
    });
    const assigned = await assign.json().catch(() => ({}));
    results.push({
      step: "assign advisor",
      ok: assign.status === 200 && assigned.assignedSalesperson === "Muhammad Allauddin",
      msg: assigned.assignedSalesperson || assign.status,
    });

    await fetch(`${BASE}/api/leads/${created.id}`, { method: "DELETE" });
  }

  const abdullah = (state.leads || []).find((l) => /dr abdullah/i.test(l.name || ""));
  if (abdullah) {
    const demoLoc = String(abdullah.location || "").toLowerCase() === "springfield";
    const demoAdv = String(abdullah.assignedSalesperson || "").toLowerCase() === "sarah connor";
    results.push({
      step: "Dr Abdullah legacy row (needs SQL cleanup if still demo)",
      ok: !demoLoc && !demoAdv,
      msg: `location=${abdullah.location || "(empty)"} advisor=${abdullah.assignedSalesperson || "(empty)"} address=${abdullah.address || "(empty)"}`,
    });
  }

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.step}: ${r.msg}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===\n`);
  process.exit(failed.some((r) => r.step.includes("create") || r.step.includes("assign")) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
