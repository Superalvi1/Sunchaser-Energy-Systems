import assert from "node:assert/strict";
import {
  calculateInteractiveProposal,
  defaultInteractiveProposalConfig,
  normalizeInteractiveProposalDefinition,
  publicInteractiveProposalDefinition,
  quoteToInteractiveProposalDefinition,
} from "./interactiveProposal.ts";
import {
  catalogOptionAdjustment,
  catalogPackagePrice,
  catalogPanelUnitPrice,
  snapshotOriginalQuotation,
  SUNCHASER_PACKAGE_PRICES,
} from "./interactiveProposalCatalog.ts";
import {
  createMemoryInteractiveProposalStore,
  hashInteractiveProposalToken,
  InteractiveProposalConflictError,
  type InteractiveProposalRecord,
} from "../../server/interactiveProposals/interactiveProposalRepository.ts";

const definition = normalizeInteractiveProposalDefinition({
  title: "8 kW Hybrid Proposal",
  customerName: "Ahmed",
  sourceQuoteId: "quote-1",
  basePrice: 1_000_000,
  panel: {
    label: "JA 585W",
    wattage: 585,
    baseCount: 16,
    minCount: 14,
    maxCount: 20,
    step: 1,
    unitPrice: 30_000,
  },
  inverter: {
    selectedId: "goodwe-8",
    options: [
      { id: "goodwe-8", label: "GoodWe 8 kW Hybrid", priceAdjustment: 0, capacityKw: 8 },
      { id: "goodwe-10", label: "GoodWe 10 kW Hybrid", priceAdjustment: 90_000, capacityKw: 10 },
    ],
  },
  battery: {
    selectedId: "dyness-10",
    options: [
      { id: "dyness-10", label: "Dyness 10 kWh", priceAdjustment: 0 },
      { id: "dyness-16", label: "Dyness 16 kWh", priceAdjustment: 180_000 },
    ],
  },
  structure: {
    selectedId: "standard",
    options: [
      { id: "standard", label: "Standard structure", priceAdjustment: 0 },
      { id: "elevated", label: "Elevated structure", priceAdjustment: 120_000 },
    ],
  },
});

const base = calculateInteractiveProposal(definition, defaultInteractiveProposalConfig(definition));
assert.equal(base.totalPrice, 1_000_000);
assert.equal(base.panelCapacityKwp, 9.36);

const upgraded = calculateInteractiveProposal(definition, {
  panelCount: 18,
  inverterId: "goodwe-10",
  batteryId: "dyness-16",
  structureId: "elevated",
});
assert.equal(upgraded.totalPrice, 1_450_000);
assert.equal(upgraded.priceDifference, 450_000);
assert.equal(upgraded.panelCapacityKwp, 10.53);

const clamped = calculateInteractiveProposal(definition, {
  panelCount: 99,
  inverterId: "unknown",
});
assert.equal(clamped.configuration.panelCount, 20);
assert.equal(clamped.configuration.inverterId, "goodwe-8");

assert.equal(catalogPanelUnitPrice(645), 27_735);
assert.equal(catalogPackagePrice(6, "standard", 5), 820_000);
assert.equal(catalogPackagePrice(6, "elevated", 5), 900_000);
assert.equal(catalogPackagePrice(8, "elevated", 5), 1_080_000);
assert.equal(catalogPackagePrice(10, "standard", 5), 1_215_000);
assert.equal(catalogPackagePrice(10, "elevated", 5), 1_325_000);
assert.equal(catalogPackagePrice(10, "standard", 16), 1_575_000);
assert.equal(catalogPackagePrice(10, "elevated", 16), 1_690_000);
assert.equal(SUNCHASER_PACKAGE_PRICES.length, 7);
assert.equal(catalogOptionAdjustment(900_000, 820_000), 80_000);

const catalogDef = normalizeInteractiveProposalDefinition({
  title: "6 kW catalog",
  customerName: "Hassan",
  sourceQuoteId: "quote-6",
  basePrice: 820_000,
  panel: { wattage: 645, baseCount: 10, minCount: 10, maxCount: 10, unitPrice: catalogPanelUnitPrice(645) },
  inverter: { selectedId: "inv-6", options: [{ id: "inv-6", label: "6 kW", priceAdjustment: 0, capacityKw: 6 }] },
  battery: {
    selectedId: "bat-5",
    options: [
      { id: "bat-5", label: "5 kWh", priceAdjustment: 0 },
      { id: "bat-16", label: "16 kWh", priceAdjustment: catalogOptionAdjustment(1_575_000, 1_215_000) },
    ],
  },
  structure: {
    selectedId: "standard",
    options: [
      { id: "standard", label: "Standard", priceAdjustment: 0 },
      { id: "elevated", label: "Elevated", priceAdjustment: catalogOptionAdjustment(900_000, 820_000) },
    ],
  },
});
assert.equal(calculateInteractiveProposal(catalogDef, { structureId: "elevated" }).totalPrice, 900_000);

const originalQuote = {
  id: "q-22",
  status: "Pending",
  systemSizekW: 8,
  panelCount: 16,
  panelWattage: 645,
  panelBrand: "JA",
  inverterBrand: "GoodWe",
  inverterCapacity: "8 kW",
  batteryOption: "Dyness 10 kWh",
  selectedStructure: "standard",
  netTotal: 1_050_000,
  boqRows: [
    { type: "item", name: "JA Solar Panel", qty: 16, rate: 26_445, total: 423_120 },
    { type: "item", name: "GoodWe inverter", qty: 1, rate: 305_000, total: 305_000 },
    { type: "item", name: "Dyness lithium battery", qty: 1, rate: 500_000, total: 500_000 },
    { type: "item", name: "Standard structure", qty: 1, rate: 36_000, total: 36_000 },
  ],
};
const frozenQuote = structuredClone(originalQuote);
const derived = quoteToInteractiveProposalDefinition(frozenQuote, { name: "Ahmed" });
assert.equal(derived.panel.unitPrice, 26_445);
assert.equal(derived.customerName, "Ahmed");
assert.equal(derived.basePrice, 1_050_000);
assert.equal(derived.panel.options?.some((item) => item.id === "panel-canadian-625-20bb"), true);
assert.equal(
  derived.inverter.options.filter((item) => /GoodWe.*8 kW/i.test(item.label)).every((item) => item.priceAdjustment === 0),
  true
);
assert.equal(derived.battery.options.some((item) => item.capacityKwh === 16), true);
assert.deepEqual(frozenQuote, originalQuote);

const standardL2 = calculateInteractiveProposal(derived, {
  ...defaultInteractiveProposalConfig(derived),
  structureId: "structure-standard-l2",
});
assert.equal(standardL2.structureStandCount, 8);
assert.equal(standardL2.totalPrice, derived.basePrice);

const foxQuote = {
  ...originalQuote,
  id: "q-fox",
  systemSizekW: 12,
  inverterBrand: "GoodWe",
  inverterCapacity: "12 kW",
  panelCount: 19,
  netTotal: 2_000_000,
  boqRows: [
    { type: "item", name: "JA Solar Panel", qty: 19, rate: 26_445, total: 502_455 },
    { type: "item", name: "GoodWe inverter", qty: 1, rate: 480_000, total: 480_000 },
    { type: "item", name: "Dyness lithium battery", qty: 1, rate: 500_000, total: 500_000 },
    { type: "item", name: "Elevated structure", qty: 1, rate: 196_080, total: 196_080 },
  ],
};
const foxDefinition = quoteToInteractiveProposalDefinition(foxQuote, { name: "Ahmed" });
const foxBundle = foxDefinition.inverter.options.find(
  (item) => item.id === "inverter-fox-12-ip66-hv-bundle"
);
assert.ok(foxBundle);
const foxCalculation = calculateInteractiveProposal(foxDefinition, {
  ...defaultInteractiveProposalConfig(foxDefinition),
  inverterId: foxBundle.id,
  batteryId: "battery-invent-5",
});
assert.equal(foxCalculation.configuration.batteryId, "battery-fox-10-2-ip66-hv");
assert.equal(foxCalculation.totalPrice, 1_990_000);
assert.equal(foxCalculation.summary.some((item) => /10\.2 kWh.*included/i.test(item)), true);

const snapshot = snapshotOriginalQuotation(originalQuote);
const publicDef = publicInteractiveProposalDefinition({
  ...derived,
  originalQuoteSnapshot: snapshot,
} as any);
assert.equal("sourceQuoteId" in publicDef, false);
assert.equal("originalQuoteSnapshot" in publicDef, false);
assert.equal((publicDef as any).basePrice, derived.basePrice);

const records: InteractiveProposalRecord[] = [];
const store = createMemoryInteractiveProposalStore(records);
const created = await store.create({
  leadId: "lead-1",
  quotationId: "quote-1",
  definition: { ...derived, originalQuoteSnapshot: snapshot } as any,
  initialConfig: defaultInteractiveProposalConfig(derived),
  createdBy: "sales-user",
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});
assert.equal(records.length, 1);
assert.notEqual(records[0].tokenHash, created.token);
assert.equal(records[0].tokenHash, hashInteractiveProposalToken(created.token));
assert.equal(created.token.includes(records[0].tokenHash), false);
const found = await store.findByToken(created.token);
assert.equal(found?.quotationId, "quote-1");
const listed = await store.listForQuote("lead-1", "quote-1");
assert.equal(listed.length, 1);

const viewed = await store.markViewed(records[0]);
assert.equal(viewed.status, "Viewed");
const modified = await store.savePreview(records[0], upgraded.configuration, upgraded);
assert.equal(modified.status, "Modified");
const accepted = await store.accept(records[0], upgraded, "Ahmed");
assert.equal(accepted.status, "Accepted");
assert.equal(accepted.acceptedCalculation?.totalPrice, 1_450_000);
assert.deepEqual(originalQuote, frozenQuote);
await assert.rejects(
  () => store.accept(records[0], upgraded, "Ahmed"),
  (error: unknown) => error instanceof InteractiveProposalConflictError
);

const expiredRecords: InteractiveProposalRecord[] = [];
const expiredStore = createMemoryInteractiveProposalStore(expiredRecords);
const expiredCreated = await expiredStore.create({
  leadId: "lead-1",
  quotationId: "quote-1",
  definition,
  initialConfig: defaultInteractiveProposalConfig(definition),
  createdBy: "sales-user",
  expiresAt: new Date(Date.now() - 1000).toISOString(),
});
const expired = await expiredStore.findByToken(expiredCreated.token);
assert.equal(expired?.status, "Expired");
await assert.rejects(
  () => expiredStore.accept(expiredRecords[0], base, "Ahmed"),
  (error: unknown) => error instanceof InteractiveProposalConflictError
);

const revokeRecords: InteractiveProposalRecord[] = [];
const revokeStore = createMemoryInteractiveProposalStore(revokeRecords);
const live = await revokeStore.create({
  leadId: "lead-1",
  quotationId: "quote-1",
  definition,
  initialConfig: defaultInteractiveProposalConfig(definition),
  createdBy: "sales-user",
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});
const revoked = await revokeStore.revoke(revokeRecords[0]);
assert.equal(revoked.status, "Revoked");
const hidden = await revokeStore.findByToken(live.token);
assert.equal(hidden?.status, "Revoked");
await assert.rejects(
  () => revokeStore.accept(revokeRecords[0], base, "Ahmed"),
  (error: unknown) => error instanceof InteractiveProposalConflictError
);

console.log("PASS interactive proposal pricing, token hashing, expiry, and revocation");
