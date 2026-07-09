import assert from "node:assert/strict";
import { calculateCables } from "./CableCalculator.ts";
import { calculateProtection } from "./ProtectionCalculator.ts";
import { calculateStructure } from "./StructureCalculator.ts";
import { panelCountForSystem, dcCableDistanceMeters, complexityMultiplier } from "./SolarDesignRules.ts";
import { polygonBounds, pointInPolygon, defaultRoofBoundary } from "./RoofGeometry.ts";
import { layoutPanels } from "./PanelLayoutEngine.ts";
import { CABLE_ROLL_PRICE } from "./SolarProductCatalog.ts";
import { targetMarginPercent } from "./MarginEngine.ts";
import { buildBoq, assertBoqSectionOrder } from "./BoqGenerator.ts";
import { generateSolarProposal } from "./SolarProposalEngine.ts";
import {
  BOQ_SECTION_IDS,
  EQUIPMENT_TIERS,
  PROPOSAL_ENGINE_TIMESTAMP,
  STRUCTURE_TYPES,
  SUPPORTED_SYSTEM_SIZES_KW,
  SYSTEM_TYPES,
  SolarProposalError,
  SolarProposalValidationError,
  clampSiteComplexityScore,
} from "./SolarProposalModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
}

function expectValidationError(name: string, fn: () => unknown, code?: string): void {
  try {
    fn();
    assert.fail(`FAILED: ${name} — expected SolarProposalValidationError`);
  } catch (e) {
    assert.ok(e instanceof SolarProposalValidationError, `FAILED: ${name} — wrong error type`);
    if (code) assert.equal(e.code, code, `FAILED: ${name} — wrong code`);
    pass += 1;
    console.log(`PASS: ${name}`);
  }
}

const baseInput = {
  systemSizeKw: 5 as const,
  tier: "budget" as const,
  systemType: "on-grid" as const,
  structureType: "standard" as const,
};

check("panelCountForSystem 3kW yields 6 panels at 580W", panelCountForSystem(3) === 6);
check("panelCountForSystem 5kW yields 9 panels", panelCountForSystem(5) === 9);
check("panelCountForSystem 10kW yields 18 panels", panelCountForSystem(10) === 18);
check("panelCountForSystem 15kW yields 26 panels", panelCountForSystem(15) === 26);
check("dcCableDistanceMeters 8kW is 160m", dcCableDistanceMeters(8) === 160);
check("complexityMultiplier off-grid elevated > on-grid standard", (() => {
  const a = complexityMultiplier("on-grid", "standard", 0);
  const b = complexityMultiplier("off-grid", "elevated_hbeam", 5);
  return b > a;
})());
check("cable rolls use 20000 PKR per roll", (() => {
  const c = calculateCables(5, "on-grid", "standard", 0);
  return c.rollUnitPrice === CABLE_ROLL_PRICE && c.rollLineTotal === c.cableRolls * 20000;
})());
check("elevated structure costs more than standard for 10 panels", (() => {
  const std = calculateStructure(10, "standard");
  const elev = calculateStructure(10, "elevated_hbeam");
  return elev.lineTotalPrice > std.lineTotalPrice;
})());
check("standard structure scales per panel", (() => {
  const s5 = calculateStructure(5, "standard");
  const s10 = calculateStructure(10, "standard");
  return s10.lineTotalPrice === s5.lineTotalPrice * 2;
})());
check("hybrid protection adds battery fuse", (() => {
  const p = calculateProtection(6, "hybrid", "budget");
  return p.lines.some((l) => l.id === "battery_fuse");
})());
check("on-grid protection has no battery fuse", (() => {
  const p = calculateProtection(6, "on-grid", "budget");
  return !p.lines.some((l) => l.id === "battery_fuse");
})());
check("pointInPolygon detects inside default roof", (() => {
  const poly = defaultRoofBoundary();
  const b = polygonBounds(poly)!;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return pointInPolygon({ x: cx, y: cy }, poly);
})());
check("layoutPanels places panels on default roof for 3kW", (() => {
  const layout = layoutPanels({ systemSizeKw: 3 });
  return layout.placedPanels.length === 6 && layout.fitsOnRoof;
})());
check("BOQ has 7 sections in Sunchaser order", (() => {
  const boq = buildBoq(baseInput);
  return boq.sections.length === 7 && assertBoqSectionOrder(boq.sections);
})());
check("BOQ section ids match canonical list", (() => {
  const boq = buildBoq({ systemSizeKw: 8, tier: "premium", systemType: "hybrid", structureType: "elevated_hbeam" });
  return boq.sections.every((s, i) => s.id === BOQ_SECTION_IDS[i]);
})());
check("hybrid BOQ includes battery in imported equipment", (() => {
  const boq = buildBoq({ systemSizeKw: 6, tier: "budget", systemType: "hybrid", structureType: "standard" });
  const imported = boq.sections[0].lines;
  return imported.some((l) => l.name.toLowerCase().includes("battery"));
})());
check("on-grid 3kW excludes net metering when disabled", (() => {
  const boq = buildBoq({
    systemSizeKw: 3,
    tier: "budget",
    systemType: "on-grid",
    structureType: "standard",
    netMeteringRequired: false,
  });
  const services = boq.sections[6].lines;
  return !services.some((l) => l.name.toLowerCase().includes("net metering"));
})());
check("on-grid 10kW includes net metering by default", (() => {
  const boq = buildBoq({ systemSizeKw: 10, tier: "budget", systemType: "on-grid", structureType: "standard" });
  const services = boq.sections[6].lines;
  return services.some((l) => l.name.toLowerCase().includes("net metering"));
})());
check("generateSolarProposal returns deterministic timestamp", (() => {
  const a = generateSolarProposal(baseInput);
  const b = generateSolarProposal(baseInput);
  return a.draft.generatedAt === PROPOSAL_ENGINE_TIMESTAMP && a.draft.pricing.grandTotal === b.draft.pricing.grandTotal;
})());
check("template cover matches draft totals", (() => {
  const { draft, template } = generateSolarProposal({
    systemSizeKw: 15,
    tier: "premium",
    systemType: "off-grid",
    structureType: "elevated_hbeam",
  });
  return template.cover.grandTotal === draft.pricing.grandTotal && template.cover.panelCount === draft.panelCount;
})());
check("invalid size throws SolarProposalValidationError", (() => {
  try {
    generateSolarProposal({ systemSizeKw: 7 as 5, tier: "budget", systemType: "on-grid", structureType: "standard" });
    return false;
  } catch (e) {
    return e instanceof SolarProposalValidationError && e.code === "INVALID_SIZE";
  }
})());
check("premium tier grand total >= budget for same config", (() => {
  const budget = generateSolarProposal({ systemSizeKw: 8, tier: "budget", systemType: "on-grid", structureType: "standard" });
  const premium = generateSolarProposal({ systemSizeKw: 8, tier: "premium", systemType: "on-grid", structureType: "standard" });
  return premium.draft.pricing.grandTotal >= budget.draft.pricing.grandTotal;
})());
check("margin percent within 8-18 band", (() => {
  const m = targetMarginPercent("budget", "on-grid", 1_000_000);
  return m >= 8 && m <= 18;
})());

expectValidationError("panelWattage 0 rejected", () =>
  generateSolarProposal({ ...baseInput, panelWattage: 0 }), "INVALID_NUMERIC");

expectValidationError("panelWattage NaN rejected", () =>
  generateSolarProposal({ ...baseInput, panelWattage: Number.NaN }), "INVALID_NUMERIC");

expectValidationError("siteComplexityScore NaN rejected", () =>
  generateSolarProposal({ ...baseInput, siteComplexityScore: Number.NaN }), "INVALID_COMPLEXITY");

expectValidationError("panelWattage Infinity rejected", () =>
  generateSolarProposal({ ...baseInput, panelWattage: Number.POSITIVE_INFINITY }), "INVALID_NUMERIC");

expectValidationError("siteComplexityScore Infinity rejected", () =>
  generateSolarProposal({ ...baseInput, siteComplexityScore: Number.POSITIVE_INFINITY }), "INVALID_COMPLEXITY");

expectValidationError("systemSizeKw Infinity rejected", () =>
  generateSolarProposal({
    ...baseInput,
    systemSizeKw: Number.POSITIVE_INFINITY as 5,
  }), "INVALID_SIZE");

check("siteComplexityScore above 10 is clamped in output summary", (() => {
  const { draft } = generateSolarProposal({ ...baseInput, siteComplexityScore: 14 });
  return draft.inputSummary.siteComplexityScore === clampSiteComplexityScore(14);
})());

check("arbitrary PII fields not present in proposal JSON output", (() => {
  const malicious = {
    ...baseInput,
    customerName: "Fatima Shah",
    phone: "03001234567",
    privateNotes: "CNIC 35202-1234567-1",
    address: "House 12, Lahore",
  } as typeof baseInput & {
    customerName: string;
    phone: string;
    privateNotes: string;
    address: string;
  };
  const { draft, template } = generateSolarProposal(malicious);
  const blob = JSON.stringify({ draft, template });
  return (
    !blob.includes("Fatima") &&
    !blob.includes("03001234567") &&
    !blob.includes("CNIC") &&
    !blob.includes("House 12") &&
    !("input" in draft) &&
    Object.keys(draft.inputSummary).every((k) =>
      ["systemSizeKw", "tier", "systemType", "structureType", "panelWattage", "siteComplexityScore"].includes(k)
    )
  );
})());

check("inputSummary contains only allowed keys", (() => {
  const { draft } = generateSolarProposal(baseInput);
  const keys = Object.keys(draft.inputSummary).sort();
  const expected = ["panelWattage", "siteComplexityScore", "structureType", "systemSizeKw", "systemType", "tier"].sort();
  return JSON.stringify(keys) === JSON.stringify(expected);
})());

console.log(`\nSolar Proposal unit tests: ${pass} passed.`);
