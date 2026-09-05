import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCommercialDraftApply,
  buildCommercialQuoteBoq,
  catalogIdAfterBrandChange,
  catalogProductMatchesIdentity,
  validateCommercialQuoteConfig,
  type CommercialQuoteConfig,
} from "./aiQuoteCommercialDraft.ts";
import {
  calculateElevatedStructureTotal,
  calculateInstallationTotal,
  calculatePanelTotal,
  DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT,
  DEFAULT_INSTALLATION_RATE_PER_WATT,
} from "./quoteCommercialMath.ts";
import { L2_STRUCTURE_CUSTOMER_NAME, L3_STRUCTURE_CUSTOMER_NAME, STRUCTURE_L2_ROW_ID, STRUCTURE_L3_ROW_ID } from "./autoSizer/structureRecommendation.ts";
import { mergeEquipmentBrands, OTHER_CUSTOM_BRAND } from "./solarEquipmentBrands.ts";
import { compileThreePageQuotationHtml, THREE_PAGE_QUOTATION_PAGE_COUNT } from "./quoteThreePageRender.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

const base: CommercialQuoteConfig = {
  systemSizeKw: 10,
  systemType: "Hybrid",
  panelBrand: "Aiko Solar",
  panelModel: "Stellar 645W",
  panelWattage: 645,
  panelQuantity: 16,
  panelRatePerWatt: 42.5,
  panelCatalogProductId: "web_aiko-stellar-645",
  inverterBrand: "GoodWe",
  inverterModel: "GW10K",
  inverterCapacity: "10kW",
  inverterQuantity: 1,
  inverterUnitPrice: 400000,
  inverterCatalogProductId: "web_goodwe-10",
  batteryEnabled: true,
  batteryBrand: "Soluna",
  batteryModel: "EOS 5.12",
  batteryCapacityKwh: "5.12kWh",
  batteryQuantity: 1,
  batteryUnitPrice: 235000,
  batteryCatalogProductId: "web_soluna-512",
  structureType: "standard",
  installationRatePerWatt: DEFAULT_INSTALLATION_RATE_PER_WATT,
  elevatedStructureRatePerWatt: DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT,
  girderAmount: 180000,
  customStructureName: "Custom",
  customStructureDescription: "",
  customStructureAmount: 0,
};

check("panel / inverter / battery product ids survive AI draft → BOQ", () => {
  const rows = buildCommercialQuoteBoq(base);
  assert.equal(rows.find((r) => r.id === "panel_row")?.catalogProductId, "web_aiko-stellar-645");
  assert.equal(rows.find((r) => r.id === "inverter_row")?.catalogProductId, "web_goodwe-10");
  assert.equal(rows.find((r) => r.id === "battery_row")?.catalogProductId, "web_soluna-512");
});

check("website implied PKR/W is not forced as quote rate", () => {
  const apply = buildCommercialDraftApply({ ...base, panelRatePerWatt: 50 });
  const panel = apply.boqRows.find((r) => r.id === "panel_row")!;
  assert.equal(panel.rate, 645 * 50);
  assert.notEqual(panel.rate, 645 * 42.5);
});

check("custom brand works", () => {
  const brands = mergeEquipmentBrands("panel", ["Aiko Solar"]);
  assert.equal(brands.includes(OTHER_CUSTOM_BRAND), true);
  const apply = buildCommercialDraftApply({ ...base, panelBrand: "House Brand" });
  assert.match(apply.boqRows.find((r) => r.id === "panel_row")!.name, /House Brand/);
});

check("Standard structure uses L2/L3 and 10 panels remain 2 L3 + 2 L2", () => {
  const rows = buildCommercialQuoteBoq({ ...base, panelWattage: 580, panelQuantity: 10, structureType: "standard" });
  const l3 = rows.find((r) => r.id === STRUCTURE_L3_ROW_ID);
  const l2 = rows.find((r) => r.id === STRUCTURE_L2_ROW_ID);
  assert.equal(l3?.qty, 2);
  assert.equal(l2?.qty, 2);
  assert.equal(l3?.name, L3_STRUCTURE_CUSTOMER_NAME);
  assert.equal(l2?.name, L2_STRUCTURE_CUSTOMER_NAME);
});

check("Elevated structure uses 16/W and does not also create L2/L3", () => {
  const rows = buildCommercialQuoteBoq({ ...base, structureType: "elevated" });
  const elevated = rows.find((r) => r.id === "structure_row")!;
  assert.equal(elevated.total, calculateElevatedStructureTotal(645, 16, 16));
  assert.equal(rows.some((r) => r.id === STRUCTURE_L3_ROW_ID || r.id === STRUCTURE_L2_ROW_ID), false);
});

check("On-grid defaults no battery row", () => {
  const rows = buildCommercialQuoteBoq({ ...base, systemType: "On-grid", batteryEnabled: true });
  assert.equal(rows.some((r) => r.id === "battery_row"), false);
  const apply = buildCommercialDraftApply({ ...base, systemType: "On-grid", batteryEnabled: true });
  assert.equal(apply.batteryOption, "None");
});

check("manual rate overrides survive into BOQ totals", () => {
  const rows = buildCommercialQuoteBoq({
    ...base,
    panelRatePerWatt: 41,
    installationRatePerWatt: 5,
    elevatedStructureRatePerWatt: 18,
    structureType: "elevated",
  });
  assert.equal(rows.find((r) => r.id === "panel_row")?.total, calculatePanelTotal(645, 16, 41));
  assert.equal(rows.find((r) => r.id === "install_service_row")?.total, calculateInstallationTotal(645, 16, 5));
  assert.equal(rows.find((r) => r.id === "structure_row")?.total, calculateElevatedStructureTotal(645, 16, 18));
});

check("Apply Draft payload is draft-only and does not save CRM", () => {
  const apply = buildCommercialDraftApply(base);
  assert.equal(apply.draftOnly, true);
  const modal = readFileSync(join(__dirname, "../components/quoteAuthoring/AIQuoteBuilderModal.tsx"), "utf8");
  assert.match(modal, /Draft only/);
  assert.doesNotMatch(modal, /authorizedFetch|create-quote|sendWhatsApp|handleSaveQuote/);
  const sales = readFileSync(join(__dirname, "../components/SalesTeamApp.tsx"), "utf8");
  const handlerChunk = sales.slice(sales.indexOf("handleApplyAiQuoteDraft"), sales.indexOf("handleApplyAiQuoteDraft") + 900);
  assert.match(handlerChunk, /setBoqRows/);
  assert.doesNotMatch(handlerChunk, /create-quote|handleSaveQuote/);
});

check("shared 3-page renderer remains 3 pages", () => {
  const apply = buildCommercialDraftApply(base);
  const rendered = compileThreePageQuotationHtml(
    { id: "q-ai", clientName: "Draft Client", boqRows: apply.boqRows, systemType: apply.systemType, systemSizekW: apply.systemSizekW },
    { id: "lead-ai", name: "Draft Client" },
    { companyTerms: [{ termText: "Quotation validity: 3 days from date of issuance." }] }
  );
  assert.equal(rendered.pageCount, THREE_PAGE_QUOTATION_PAGE_COUNT);
  assert.equal(rendered.pageCount, 3);
});

check("installation row uses 4/W over actual array watts", () => {
  const row = buildCommercialQuoteBoq(base).find((r) => r.id === "install_service_row")!;
  assert.equal(row.total, 645 * 16 * 4);
  assert.match(String(row.description), /Rs\. 4\/W/);
});

check("negative commercial inputs are rejected", () => {
  const errors = validateCommercialQuoteConfig({ ...base, panelWattage: -645, panelRatePerWatt: -1, inverterQuantity: 0 });
  assert.equal(errors.length > 0, true);
  assert.equal(errors.some((e) => /wattage/i.test(e)), true);
});

check("zero installation rate is preserved instead of defaulting to 4", () => {
  const apply = buildCommercialDraftApply({ ...base, installationRatePerWatt: 0, elevatedStructureRatePerWatt: 0 });
  assert.equal(apply.installationRatePerWatt, 0);
  assert.equal(apply.elevatedStructureRatePerWatt, 0);
  assert.equal(apply.boqRows.find((r) => r.id === "install_service_row")?.total, 0);
});

check("Apply/config validation rejects invalid quote", () => {
  const errors = validateCommercialQuoteConfig({ ...base, systemSizeKw: 0, panelQuantity: 0 });
  assert.equal(errors.some((e) => /System size/.test(e)), true);
  assert.equal(errors.some((e) => /Panel quantity/.test(e)), true);
  const modal = readFileSync(join(__dirname, "../components/quoteAuthoring/AIQuoteBuilderModal.tsx"), "utf8");
  assert.match(modal, /validateCommercialQuoteConfig/);
  assert.match(modal, /disabled=\{validationErrors\.length > 0\}/);
  assert.match(modal, /catalogProductMatchesIdentity/);
  assert.match(modal, /catalogIdAfterBrandChange/);
  assert.match(modal, /Use website package system size/);
});

check("brand change clears mismatching panel product ID", () => {
  assert.equal(catalogIdAfterBrandChange("web_jinko", "JinkoSolar", "LONGi"), "");
  assert.equal(catalogIdAfterBrandChange("web_jinko", "JinkoSolar", "JinkoSolar"), "web_jinko");
});

check("brand change clears mismatching inverter product ID", () => {
  assert.equal(catalogIdAfterBrandChange("web_goodwe", "GoodWe", "Knox"), "");
});

check("brand change clears mismatching battery product ID", () => {
  assert.equal(catalogIdAfterBrandChange("web_soluna", "Soluna", "Pylontech"), "");
});

check("matching model keeps catalog product identity", () => {
  assert.equal(
    catalogProductMatchesIdentity({ brand: "JinkoSolar", model: "Tiger Neo 580" }, "JinkoSolar", "Tiger Neo 580"),
    true
  );
  assert.equal(
    catalogProductMatchesIdentity({ brand: "JinkoSolar", model: "Tiger Neo 580" }, "LONGi", "Tiger Neo 580"),
    false
  );
});

check("custom models work without catalog product", () => {
  const apply = buildCommercialDraftApply({
    ...base,
    panelBrand: "House Brand",
    panelModel: "Custom 645",
    panelCatalogProductId: "",
    inverterBrand: "House Inverter",
    inverterModel: "HX-10",
    inverterCatalogProductId: "",
    batteryBrand: "House Battery",
    batteryModel: "HB-5",
    batteryCatalogProductId: "",
  });
  assert.equal(apply.panelCatalogProductId, "");
  assert.equal(apply.inverterCatalogProductId, "");
  assert.match(apply.boqRows.find((r) => r.id === "panel_row")!.name, /Custom 645/);
  assert.match(apply.boqRows.find((r) => r.id === "inverter_row")!.name, /HX-10/);
});

console.log(`\nAI quote commercial draft tests: ${pass} passed`);
