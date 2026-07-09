import assert from "node:assert/strict";
import { planSolarQuote, assertSolarQuoteDraftSafe } from "./SolarQuotePlanner.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const MALICIOUS_NAME = "Fatima Shah CNIC 35202-1234567-1";
const MALICIOUS_LOCATION = "House 12 Private Street 03001234567 IBAN PK36";

check("5kW on-grid draft is valid with panels and no battery", () => {
  const draft = planSolarQuote({
    systemSizeKw: 5,
    systemType: "on-grid",
    location: "Lahore",
  });
  return (
    draft.valid &&
    draft.draftOnly === true &&
    draft.systemType === "on-grid" &&
    draft.panelCountEstimate === 9 &&
    draft.batterySuggestion === null &&
    draft.boqDraft.length >= 5
  );
});

check("10kW on-grid draft uses mid-tier inverter", () => {
  const draft = planSolarQuote({ systemSizeKw: 10, systemType: "on-grid", location: "Islamabad" });
  return (
    draft.valid &&
    draft.inverterSuggestion.includes("Knox") &&
    draft.panelCountEstimate === 18 &&
    draft.warnings.every((w) => !w.includes("Off-grid"))
  );
});

check("15kW on-grid draft flags large-system review", () => {
  const draft = planSolarQuote({ systemSizeKw: 15, systemType: "on-grid", location: "Karachi" });
  return (
    draft.valid &&
    draft.panelBrandSuggestion === "Canadian Solar" &&
    draft.warnings.some((w) => w.includes("20 kW"))
  );
});

check("hybrid draft includes battery suggestion", () => {
  const draft = planSolarQuote({
    systemSizeKw: 8,
    systemType: "hybrid",
    location: "Lahore",
    backupRequirement: "partial backup for lights and fans",
  });
  return (
    draft.valid &&
    draft.batterySuggestion !== null &&
    draft.batterySuggestion.includes("10.24") &&
    draft.boqDraft.some((line) => line.id === "boq-battery") &&
    draft.warnings.some((w) => w.includes("Hybrid"))
  );
});

check("off-grid draft includes off-grid warning", () => {
  const draft = planSolarQuote({
    systemSizeKw: 6,
    systemType: "off-grid",
    location: "Rural Punjab",
    backupRequirement: "full home backup",
  });
  return (
    draft.valid &&
    draft.batterySuggestion !== null &&
    draft.warnings.some((w) => w.toLowerCase().includes("off-grid")) &&
    draft.structureProtectionNotes.some((n) => n.toLowerCase().includes("off-grid"))
  );
});

check("invalid size returns errors without throwing", () => {
  const draft = planSolarQuote({ systemSizeKw: 0, systemType: "on-grid" });
  return draft.valid === false && draft.errors.length > 0 && draft.boqDraft.length === 0;
});

check("oversized system is rejected", () => {
  const draft = planSolarQuote({ systemSizeKw: 75, systemType: "on-grid" });
  return draft.valid === false && draft.errors.some((e) => e.includes("50"));
});

check("malicious customer name and location are not echoed in draft JSON", () => {
  const draft = planSolarQuote({
    customerName: MALICIOUS_NAME,
    systemSizeKw: 10,
    systemType: "hybrid",
    location: MALICIOUS_LOCATION,
    monthlyBill: 85000,
    backupRequirement: "bank account wire 998877",
  });
  const forbidden = [MALICIOUS_NAME, "35202", "03001234567", "Private Street", "IBAN", "bank account"];
  return (
    draft.valid &&
    assertSolarQuoteDraftSafe(draft, forbidden) &&
    draft.locationLabel === "Specified installation region" &&
    !JSON.stringify(draft).includes("Fatima")
  );
});

check("draft is marked draftOnly and assumptions mention no CRM save", () => {
  const draft = planSolarQuote({ systemSizeKw: 5, systemType: "on-grid" });
  return (
    draft.draftOnly === true &&
    draft.assumptions.some((a) => a.toLowerCase().includes("not saved")) &&
    draft.nextSteps.some((s) => s.toLowerCase().includes("manually"))
  );
});

check("monthly bill informs assumptions without exposing raw bill in summary", () => {
  const draft = planSolarQuote({
    systemSizeKw: 10,
    systemType: "on-grid",
    monthlyBill: 42000,
  });
  const blob = JSON.stringify(draft);
  return draft.valid && draft.assumptions.some((a) => a.includes("kW")) && !blob.includes("42000");
});

console.log(`\nSolarQuotePlanner tests: ${pass} passed`);
