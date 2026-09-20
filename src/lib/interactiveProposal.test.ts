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

assert.equal(catalogPanelUnitPrice(645), 26_445);
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
  boqRows: [{ type: "item", name: "JA Solar Panel", qty: 16, rate: 26_445, total: 423_120 }],
};
const frozenQuote = structuredClone(originalQuote);
const derived = quoteToInteractiveProposalDefinition(frozenQuote, { name: "Ahmed" });
assert.equal(derived.panel.unitPrice, 26_445);
assert.equal(derived.customerName, "Ahmed");
assert.equal(derived.basePrice, 1_050_000);
assert.deepEqual(frozenQuote, originalQuote);

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
