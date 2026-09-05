import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCommercialDraftApply,
  buildCommercialQuoteBoq,
  catalogIdAfterBatteryCapacityChange,
  catalogIdAfterBrandChange,
  catalogIdAfterInverterCapacityChange,
  catalogIdAfterWattageChange,
  catalogProductMatchesBatteryIdentity,
  catalogProductMatchesIdentity,
  catalogProductMatchesInverterIdentity,
  catalogProductMatchesPanelIdentity,
  catalogProductWattage,
  isQuickPanelWattage,
  L2_STRUCTURE_KIT_RATE,
  L3_STRUCTURE_KIT_RATE,
  QUICK_PANEL_WATTAGES,
  resolveStandardStructureSelection,
  standCapacityPanels,
  STRUCTURE_CAPACITY_WARNING,
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
import {
  L2_STRUCTURE_CUSTOMER_NAME,
  L3_STRUCTURE_CUSTOMER_NAME,
  STRUCTURE_L2_ROW_ID,
  STRUCTURE_L3_ROW_ID,
} from "./autoSizer/structureRecommendation.ts";
import {
  GLOBAL_BATTERY_BRANDS,
  GLOBAL_INVERTER_BRANDS,
  mergeEquipmentBrands,
  OTHER_CUSTOM_BRAND,
} from "./solarEquipmentBrands.ts";
import { compileThreePageQuotationHtml, THREE_PAGE_QUOTATION_PAGE_COUNT } from "./quoteThreePageRender.ts";
import { productsForType } from "./websiteCatalog/sync.ts";
import { WEBSITE_CATALOG_SOURCE } from "./websiteCatalog/allowlist.ts";
import type { Product } from "../types.ts";

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
  structureMode: "auto",
  installationRatePerWatt: DEFAULT_INSTALLATION_RATE_PER_WATT,
  elevatedStructureRatePerWatt: DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT,
  girderAmount: 180000,
  customStructureName: "Custom",
  customStructureDescription: "",
  customStructureAmount: 0,
};

const panel580 = {
  id: "web_jinko-580",
  brand: "JinkoSolar",
  model: "Tiger Neo 580W",
  name: "JinkoSolar Tiger Neo 580W",
  specifications: { panelWattage: "580" },
};
const inverter10 = {
  id: "web_goodwe-10",
  brand: "GoodWe",
  model: "GW10K",
  name: "GoodWe GW10K 10kW",
  specifications: { inverterKw: "10" },
};
const inverter8 = {
  id: "web_solis-8",
  brand: "Solis",
  model: "S8",
  name: "Solis 8kW",
  specifications: { inverterKw: "8" },
};
const battery512 = {
  id: "web_soluna-512",
  brand: "Soluna",
  model: "EOS 5.12",
  name: "Soluna EOS 5.12kWh",
  specifications: { batteryKwh: "5.12" },
};

function product(partial: Partial<Product> & { id: string; name: string; category: string }): Product {
  return {
    brand: "",
    model: "",
    sku: partial.id,
    price: 0,
    discount: 0,
    stock: 1,
    images: [],
    warrantyPeriod: "",
    specifications: {},
    installationRequired: false,
    serviceRequired: false,
    ...partial,
  };
}

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
  assert.match(modal, /catalogProductMatchesPanelIdentity/);
  assert.match(modal, /catalogIdAfterBrandChange/);
  assert.match(modal, /catalogIdAfterWattageChange/);
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

check("quick wattage 615 works", () => {
  assert.equal(isQuickPanelWattage(615), true);
  assert.equal(QUICK_PANEL_WATTAGES.includes(615), true);
  const apply = buildCommercialDraftApply({ ...base, panelWattage: 615, panelQuantity: 10 });
  assert.equal(apply.panelWattage, 615);
  assert.match(apply.boqRows.find((r) => r.id === "panel_row")!.name, /615W/);
});

check("quick wattage 645 works", () => {
  assert.equal(isQuickPanelWattage(645), true);
  const apply = buildCommercialDraftApply({ ...base, panelWattage: 645 });
  assert.equal(apply.panelWattage, 645);
  assert.match(apply.boqRows.find((r) => r.id === "panel_row")!.name, /645W/);
});

check("free custom wattage works", () => {
  assert.equal(isQuickPanelWattage(670), false);
  const apply = buildCommercialDraftApply({ ...base, panelWattage: 670, panelQuantity: 15 });
  assert.equal(apply.panelWattage, 670);
  assert.equal(apply.boqRows.find((r) => r.id === "panel_row")!.qty, 15);
  assert.match(apply.boqRows.find((r) => r.id === "panel_row")!.name, /670W/);
});

check("selected panel ID cleared when wattage no longer matches", () => {
  assert.equal(catalogProductWattage(panel580), 580);
  assert.equal(catalogIdAfterWattageChange("web_jinko-580", panel580, 580), "web_jinko-580");
  assert.equal(catalogIdAfterWattageChange("web_jinko-580", panel580, 645), "");
  assert.equal(catalogProductMatchesPanelIdentity(panel580, "JinkoSolar", "Tiger Neo 580W", 580), true);
  assert.equal(catalogProductMatchesPanelIdentity(panel580, "JinkoSolar", "Tiger Neo 580W", 645), false);
});

check("selected inverter ID cleared when capacity no longer matches", () => {
  assert.equal(catalogIdAfterInverterCapacityChange("web_goodwe-10", inverter10, "10kW"), "web_goodwe-10");
  assert.equal(catalogIdAfterInverterCapacityChange("web_goodwe-10", inverter10, "8kW"), "");
  assert.equal(catalogProductMatchesInverterIdentity(inverter10, "GoodWe", "GW10K", "10kW"), true);
  assert.equal(catalogProductMatchesInverterIdentity(inverter8, "GoodWe", "GW10K", "10kW"), false);
});

check("selected battery ID cleared when kWh no longer matches", () => {
  assert.equal(catalogIdAfterBatteryCapacityChange("web_soluna-512", battery512, "5.12kWh"), "web_soluna-512");
  assert.equal(catalogIdAfterBatteryCapacityChange("web_soluna-512", battery512, "10kWh"), "");
  assert.equal(catalogProductMatchesBatteryIdentity(battery512, "Soluna", "EOS 5.12", "5.12kWh"), true);
  assert.equal(catalogProductMatchesBatteryIdentity(battery512, "Soluna", "EOS 5.12", "10kWh"), false);
});

check("Standard Auto 10 panels → 2 L3 + 2 L2", () => {
  const selection = resolveStandardStructureSelection({ structureMode: "auto", panelQuantity: 10 });
  assert.equal(selection.mode, "auto");
  assert.equal(selection.l3, 2);
  assert.equal(selection.l2, 2);
  const rows = buildCommercialQuoteBoq({ ...base, panelQuantity: 10, structureType: "standard", structureMode: "auto" });
  assert.equal(rows.find((r) => r.id === STRUCTURE_L3_ROW_ID)?.qty, 2);
  assert.equal(rows.find((r) => r.id === STRUCTURE_L2_ROW_ID)?.qty, 2);
});

check("Standard Manual uses entered L3/L2 exactly", () => {
  const rows = buildCommercialQuoteBoq({
    ...base,
    panelQuantity: 10,
    structureType: "standard",
    structureMode: "manual",
    manualL3Quantity: 1,
    manualL2Quantity: 4,
  });
  assert.equal(rows.find((r) => r.id === STRUCTURE_L3_ROW_ID)?.qty, 1);
  assert.equal(rows.find((r) => r.id === STRUCTURE_L2_ROW_ID)?.qty, 4);
  const auto = buildCommercialQuoteBoq({ ...base, panelQuantity: 10, structureType: "standard", structureMode: "auto" });
  assert.notEqual(rows.find((r) => r.id === STRUCTURE_L3_ROW_ID)?.qty, auto.find((r) => r.id === STRUCTURE_L3_ROW_ID)?.qty);
});

check("Manual stand capacity less than panel qty blocks apply", () => {
  const errors = validateCommercialQuoteConfig({
    ...base,
    panelQuantity: 16,
    structureType: "standard",
    structureMode: "manual",
    manualL3Quantity: 2,
    manualL2Quantity: 2,
  });
  assert.equal(standCapacityPanels(2, 2), 10);
  assert.equal(errors.includes(STRUCTURE_CAPACITY_WARNING), true);
  const modal = readFileSync(join(__dirname, "../components/quoteAuthoring/AIQuoteBuilderModal.tsx"), "utf8");
  assert.match(modal, /disabled=\{validationErrors\.length > 0\}/);
  assert.match(modal, /STRUCTURE_CAPACITY_WARNING/);
});

check("Manual over-capacity allowed", () => {
  const errors = validateCommercialQuoteConfig({
    ...base,
    panelQuantity: 16,
    structureType: "standard",
    structureMode: "manual",
    manualL3Quantity: 6,
    manualL2Quantity: 0,
  });
  assert.equal(standCapacityPanels(6, 0), 18);
  assert.equal(errors.includes(STRUCTURE_CAPACITY_WARNING), false);
  const rows = buildCommercialQuoteBoq({
    ...base,
    panelQuantity: 16,
    structureType: "standard",
    structureMode: "manual",
    manualL3Quantity: 4,
    manualL2Quantity: 2,
  });
  assert.equal(rows.find((r) => r.id === STRUCTURE_L3_ROW_ID)?.qty, 4);
  assert.equal(rows.find((r) => r.id === STRUCTURE_L2_ROW_ID)?.qty, 2);
  assert.equal(standCapacityPanels(4, 2), 16);
});

check("manual L3/L2 totals use existing quotation kit rates", () => {
  const rows = buildCommercialQuoteBoq({
    ...base,
    panelQuantity: 10,
    structureType: "standard",
    structureMode: "manual",
    manualL3Quantity: 2,
    manualL2Quantity: 2,
  });
  const l3 = rows.find((r) => r.id === STRUCTURE_L3_ROW_ID)!;
  const l2 = rows.find((r) => r.id === STRUCTURE_L2_ROW_ID)!;
  assert.equal(l3.rate, L3_STRUCTURE_KIT_RATE);
  assert.equal(l2.rate, L2_STRUCTURE_KIT_RATE);
  assert.equal(l3.total, 2 * L3_STRUCTURE_KIT_RATE);
  assert.equal(l2.total, 2 * L2_STRUCTURE_KIT_RATE);
  assert.equal(l3.unit, "Section");
  assert.equal(l3.quoteLineKind, "quote_structure_kit");
});

check("Elevated excludes L2/L3", () => {
  const rows = buildCommercialQuoteBoq({ ...base, structureType: "elevated", structureMode: "manual", manualL3Quantity: 8, manualL2Quantity: 8 });
  assert.equal(rows.some((r) => r.id === STRUCTURE_L3_ROW_ID || r.id === STRUCTURE_L2_ROW_ID), false);
});

check("Elevated remains 16/W default", () => {
  assert.equal(DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT, 16);
  const rows = buildCommercialQuoteBoq({ ...base, structureType: "elevated" });
  assert.equal(rows.find((r) => r.id === "structure_row")?.total, 645 * 16 * 16);
});

check("Installation remains 4/W default", () => {
  assert.equal(DEFAULT_INSTALLATION_RATE_PER_WATT, 4);
  const rows = buildCommercialQuoteBoq(base);
  assert.equal(rows.find((r) => r.id === "install_service_row")?.total, 645 * 16 * 4);
});

check("website/CRM products rank ahead of global registry", () => {
  const brands = mergeEquipmentBrands("inverter", ["Sunchaser Inhouse", "GoodWe"]);
  assert.equal(brands[0], "Sunchaser Inhouse");
  assert.ok(brands.indexOf("Sunchaser Inhouse") < brands.indexOf("Huawei"));
  assert.equal(brands[brands.length - 1], OTHER_CUSTOM_BRAND);
  const ranked = productsForType(
    [
      product({ id: "crm-1", name: "CRM Panel", category: "Panels", productType: "panel", brand: "LONGi" }),
      product({
        id: "web-1",
        name: "Website Panel",
        category: "Panels",
        productType: "panel",
        brand: "Aiko",
        source: WEBSITE_CATALOG_SOURCE,
      }),
    ],
    "panel"
  );
  assert.equal(ranked[0].id, "web-1");
  assert.equal(ranked[1].id, "crm-1");
});

check("Other / Custom works", () => {
  const inverterBrands = mergeEquipmentBrands("inverter", []);
  const batteryBrands = mergeEquipmentBrands("battery", []);
  assert.equal(inverterBrands.includes(OTHER_CUSTOM_BRAND), true);
  assert.equal(batteryBrands.includes(OTHER_CUSTOM_BRAND), true);
  const apply = buildCommercialDraftApply({
    ...base,
    panelBrand: OTHER_CUSTOM_BRAND,
    panelModel: "Shop special",
    panelCatalogProductId: "",
  });
  assert.equal(apply.panelCatalogProductId, "");
  assert.match(apply.boqRows.find((r) => r.id === "panel_row")!.name, /Shop special/);
});

check("On-grid defaults battery None", () => {
  const apply = buildCommercialDraftApply({ ...base, systemType: "On-grid", batteryEnabled: false });
  assert.equal(apply.batteryOption, "None");
  assert.equal(apply.batteryCatalogProductId, "");
  assert.equal(apply.boqRows.some((r) => r.id === "battery_row"), false);
});

check("Hybrid lithium battery selectable", () => {
  const apply = buildCommercialDraftApply({ ...base, systemType: "Hybrid", batteryEnabled: true });
  assert.match(apply.batteryOption, /Soluna/);
  assert.equal(apply.boqRows.find((r) => r.id === "battery_row")?.catalogProductId, "web_soluna-512");
});

check("Apply draft remains draft-only", () => {
  const apply = buildCommercialDraftApply(base);
  assert.equal(apply.draftOnly, true);
  const modal = readFileSync(join(__dirname, "../components/quoteAuthoring/AIQuoteBuilderModal.tsx"), "utf8");
  assert.match(modal, /Draft only/);
  assert.match(modal, /no auto-save, no CRM mutation, no messaging/);
  assert.doesNotMatch(modal, /fetch\(|https?:\/\/|sitemap|scrape/i);
});

check("catalog IDs preserved when identity still matches", () => {
  assert.equal(catalogIdAfterWattageChange("web_jinko-580", panel580, 580), "web_jinko-580");
  assert.equal(catalogIdAfterInverterCapacityChange("web_goodwe-10", inverter10, "10 kW"), "web_goodwe-10");
  assert.equal(catalogIdAfterBatteryCapacityChange("web_soluna-512", battery512, "5.12"), "web_soluna-512");
  const apply = buildCommercialDraftApply(base);
  assert.equal(apply.panelCatalogProductId, "web_aiko-stellar-645");
  assert.equal(apply.inverterCatalogProductId, "web_goodwe-10");
  assert.equal(apply.batteryCatalogProductId, "web_soluna-512");
});

check("global inverter and battery fallback registries include owner brands", () => {
  const inverters = mergeEquipmentBrands("inverter", []);
  const batteries = mergeEquipmentBrands("battery", []);
  for (const brand of [
    "Huawei",
    "Sungrow",
    "Solis",
    "GoodWe",
    "Growatt",
    "Deye",
    "FoxESS",
    "SolaX",
    "SAJ",
    "SMA",
    "Fronius",
    "SolarEdge",
    "Victron",
    "Sofar",
    "Kehua",
    "KSTAR",
    "Delta",
    "Sineng",
    "FIMER / ABB",
    "INVT",
    "Hoymiles",
    "APsystems",
    "Solplanet",
    "Inverex",
    "Knox",
    "Nitrox",
    "Itel",
  ]) {
    assert.equal(inverters.includes(brand), true, brand);
  }
  for (const brand of [
    "Pylontech",
    "Dyness",
    "BYD",
    "Narada",
    "LG Energy Solution",
    "Tesla",
    "Enphase",
    "Felicity Solar",
    "CATL",
    "EVE",
  ]) {
    assert.equal(batteries.includes(brand), true, brand);
  }
  assert.equal(GLOBAL_INVERTER_BRANDS.includes("FIMER / ABB"), true);
  assert.equal(GLOBAL_BATTERY_BRANDS.includes("LG Energy Solution"), true);
});

check("girder and custom remain manual amounts without per-watt formulas", () => {
  const girder = buildCommercialQuoteBoq({ ...base, structureType: "girder", girderAmount: 222000 });
  assert.equal(girder.find((r) => r.id === "structure_row")?.total, 222000);
  assert.equal(girder.some((r) => r.id === STRUCTURE_L3_ROW_ID), false);
  const custom = buildCommercialQuoteBoq({
    ...base,
    structureType: "custom",
    customStructureName: "Roof rail",
    customStructureDescription: "Site-specific",
    customStructureAmount: 95000,
  });
  const row = custom.find((r) => r.id === "structure_row")!;
  assert.equal(row.name, "Roof rail");
  assert.equal(row.total, 95000);
  assert.match(String(row.description), /Site-specific/);
});

check("AI Quote Builder modal exposes wattage chips and standard structure modes", () => {
  const modal = readFileSync(join(__dirname, "../components/quoteAuthoring/AIQuoteBuilderModal.tsx"), "utf8");
  assert.match(modal, /QUICK_PANEL_WATTAGES/);
  assert.match(modal, /Auto Calculate/);
  assert.match(modal, /Standard L2\/L3/);
  assert.match(modal, /structureMode === "manual"/);
  assert.match(modal, /Live summary/);
  assert.match(modal, /kWp actual array/);
});

console.log(`\nAI quote commercial draft tests: ${pass} passed`);
