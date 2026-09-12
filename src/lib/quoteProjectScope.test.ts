import assert from "node:assert/strict";
import {
  applyScopeDependencies,
  BATTERY_ACCESSORY_IDS,
  buildPresetScope,
  buildQuoteCostSummary,
  buildScopeForClass,
  buildScopeMatrix,
  CIVIL_FOUNDATION_IDS,
  displaySpec,
  finishAmount,
  girderDesignLoadDisplay,
  inverterCatalogFields,
  isMsStructure,
  LIGHTNING_PATH_IDS,
  lineAmount,
  panelCatalogFields,
  PENDING_STRUCTURAL_DESIGN,
  projectScopeToBoqRows,
  readCatalogSpec,
  SCOPE_BOQ_ID_PREFIX,
  setLineState,
  suppressedGenericChargeIds,
  UNAVAILABLE_SPEC,
  validateProjectScope,
  type ProjectScopeState,
  type ScopeContext,
} from "./quoteProjectScope";
import {
  buildCommercialDraftApply,
  buildCommercialQuoteBoq,
  mergeOtherCharges,
  optionalChargeTotal,
  validateCommercialQuoteConfig,
  type CommercialQuoteConfig,
} from "./aiQuoteCommercialDraft.ts";
import {
  DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT,
  DEFAULT_INSTALLATION_RATE_PER_WATT,
} from "./quoteCommercialMath.ts";
import { STRUCTURE_L2_ROW_ID, STRUCTURE_L3_ROW_ID, recommendStructures } from "./autoSizer/structureRecommendation.ts";
import { resolveCustomerFacingBoq, sumPricedBoqItems } from "./quoteCustomerBoq.ts";
import type { Product } from "../types.ts";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

const ctx = (partial: Partial<ScopeContext> = {}): ScopeContext => ({
  systemType: "Hybrid",
  structureType: "standard",
  batteryEnabled: true,
  panelQuantity: 10,
  ...partial,
});

const base: CommercialQuoteConfig = {
  systemSizeKw: 10,
  systemType: "Hybrid",
  panelBrand: "Aiko Solar",
  panelModel: "Stellar 645W",
  panelWattage: 645,
  panelQuantity: 10,
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

function includePriced(scope: ProjectScopeState, id: string, qty: number, rate: number): ProjectScopeState {
  return {
    ...scope,
    lines: scope.lines.map((line) =>
      line.id === id ? setLineState({ ...line, rate, rateSource: "manual" }, "yes", "included", qty) : line
    ),
  };
}

function product(partial: Partial<Product> & { id: string; name: string }): Product {
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
    category: "Solar Panels",
    ...partial,
  };
}

check("residential preset is standard mode and keeps documentation included without extra priced lines", () => {
  const scope = buildPresetScope("residential_standard");
  assert.equal(scope.projectClass, "residential");
  assert.equal(scope.scopeMode, "standard");
  assert.equal(scope.lightningEnabled, false);
  assert.equal(scope.craneEnabled, false);
  assert.equal(scope.scadaEnabled, false);
  const docs = scope.lines.filter((l) => l.section === "documentation" && l.id !== "doc_utility");
  assert.equal(docs.every((l) => l.inclusionState === "included"), true);
  assert.equal(projectScopeToBoqRows(scope).length, 0);
  const hardwareDetailed = scope.lines.filter((l) => l.section === "hardware" && !l.groupedResidential);
  assert.equal(hardwareDetailed.every((l) => l.inclusionState === "excluded"), true);
});

check("commercial preset opens advanced with extra AC/DC/earth/tray/engineering sections", () => {
  const scope = buildPresetScope("commercial_standard");
  assert.equal(scope.scopeMode, "advanced");
  assert.equal(scope.projectClass, "commercial");
  assert.equal(scope.lines.find((l) => l.id === "dc_pos")?.inclusionState, "included");
  assert.equal(scope.lines.find((l) => l.id === "ac_inv_db")?.inclusionState, "included");
  assert.equal(scope.lines.find((l) => l.id === "cm_tray")?.inclusionState, "pending");
  assert.equal(scope.lines.find((l) => l.id === "ac_solar_db")?.inclusionState, "pending");
  assert.equal(scope.lines.find((l) => l.id === "sv_electrical")?.inclusionState, "pending");
});

check("industrial preset adds SCADA, crane, civil and documentation extras as pending", () => {
  const scope = buildPresetScope("industrial_standard");
  assert.equal(scope.scopeMode, "advanced");
  assert.equal(scope.scadaEnabled, true);
  assert.equal(scope.craneEnabled, true);
  const resolved = applyScopeDependencies(scope, ctx({ systemType: "Hybrid", batteryEnabled: true }));
  assert.equal(resolved.lines.find((l) => l.id === "log_crane")?.inclusionState, "included");
  assert.equal(resolved.lines.find((l) => l.id === "mon_scada_gw")?.inclusionState, "pending");
  assert.equal(resolved.lines.find((l) => l.id === "sv_struct_design")?.inclusionState, "pending");
  assert.equal(resolved.lines.find((l) => l.id === "cv_excavation")?.inclusionState, "pending");
});

check("class helper maps residential / commercial / industrial / custom", () => {
  assert.equal(buildScopeForClass("residential").preset, "residential_standard");
  assert.equal(buildScopeForClass("commercial").preset, "commercial_standard");
  assert.equal(buildScopeForClass("industrial").preset, "industrial_standard");
  assert.equal(buildScopeForClass("custom").preset, "custom");
  assert.equal(buildScopeForClass("custom").scopeMode, "advanced");
});

check("standard L2/L3: 10 panels → 2 L3 + 2 L2", () => {
  const rec = recommendStructures(10);
  assert.equal(rec.l3, 2);
  assert.equal(rec.l2, 2);
  const rows = buildCommercialQuoteBoq({ ...base, panelQuantity: 10, structureType: "standard", structureMode: "auto" });
  assert.equal(rows.find((r) => r.id === STRUCTURE_L3_ROW_ID)?.qty, 2);
  assert.equal(rows.find((r) => r.id === STRUCTURE_L2_ROW_ID)?.qty, 2);
});

check("elevated excludes L2/L3 rows", () => {
  const rows = buildCommercialQuoteBoq({ ...base, structureType: "elevated" });
  assert.equal(rows.some((r) => r.id === STRUCTURE_L3_ROW_ID || r.id === STRUCTURE_L2_ROW_ID), false);
  assert.equal(rows.some((r) => r.id === "structure_row" && /Elevated/.test(r.name)), true);
});

check("girder default design load is pending structural design — never invented", () => {
  const scope = buildPresetScope("commercial_standard");
  assert.equal(scope.girder.designLoadStatus, "pending_structural_design");
  assert.equal(girderDesignLoadDisplay(scope.girder), PENDING_STRUCTURAL_DESIGN);
  assert.equal(String(scope.girder.designLoadNote || "").trim(), "");
});

check("girder advanced validation requires structural details", () => {
  const scope = buildPresetScope("commercial_standard");
  const errors = validateProjectScope(scope, ctx({ structureType: "girder" }));
  assert.equal(errors.some((e) => /Girder main section/.test(e)), true);
  assert.equal(errors.some((e) => /steel grade/.test(e)), true);
  assert.equal(errors.some((e) => /span/.test(e)), true);
  assert.equal(errors.some((e) => /column count/.test(e)), true);
  assert.equal(errors.some((e) => /base plate/.test(e)), true);
  assert.equal(errors.some((e) => /anchor bolt/.test(e)), true);
});

check("MS girder requires explicit finish selection", () => {
  let scope = buildPresetScope("commercial_standard");
  scope = {
    ...scope,
    girder: {
      ...scope.girder,
      mainSection: "6x3",
      material: "ms",
      steelGrade: "ASTM A36",
      span: "12 ft",
      columnCount: 4,
      basePlateLength: "12",
      basePlateWidth: "12",
      basePlateThickness: "12",
      anchorBoltDiameter: "16mm",
      anchorBoltQty: 4,
    },
    finish: { ...scope.finish, finish: "" },
  };
  assert.equal(isMsStructure(scope, ctx({ structureType: "girder" })), true);
  const errors = validateProjectScope(scope, ctx({ structureType: "girder" }));
  assert.equal(errors.some((e) => /coating \/ finish/.test(e)), true);
});

check("hot-dip finish is not auto-charged as paint", () => {
  const scope = buildPresetScope("residential_standard");
  const amount = finishAmount({ finish: "hot_dip", surfaceArea: 0, coatSystem: "", coats: 0, rate: 0, amount: 0 });
  assert.equal(amount, 0);
});

check("battery off excludes accessories; battery on makes them available", () => {
  const off = applyScopeDependencies(includePriced(buildPresetScope("commercial_standard"), "batt_rack", 1, 25000), ctx({ batteryEnabled: false, systemType: "On-grid" }));
  assert.equal(off.lines.find((l) => l.id === "batt_rack")?.inclusionState, "excluded");
  let on = buildPresetScope("commercial_standard");
  on = includePriced(on, "batt_rack", 1, 25000);
  on = applyScopeDependencies(on, ctx({ batteryEnabled: true, systemType: "Hybrid" }));
  assert.equal(on.lines.find((l) => l.id === "batt_rack")?.inclusionState, "included");
  assert.equal(lineAmount(on.lines.find((l) => l.id === "batt_rack")!), 25000);
  for (const id of BATTERY_ACCESSORY_IDS) {
    assert.equal(typeof on.lines.find((l) => l.id === id), "object");
  }
});

check("off-grid net metering extras default off unless explicitly included", () => {
  const scope = applyScopeDependencies(buildPresetScope("commercial_standard"), ctx({ systemType: "Off-grid" }));
  assert.equal(scope.lines.filter((l) => l.section === "net_metering").every((l) => l.inclusionState === "excluded"), true);
  let forced = buildPresetScope("commercial_standard");
  forced = includePriced(forced, "nm_docs", 1, 5000);
  forced = applyScopeDependencies(forced, ctx({ systemType: "Off-grid" }));
  assert.equal(forced.lines.find((l) => l.id === "nm_docs")?.inclusionState, "included");
  const rows = buildCommercialQuoteBoq({ ...base, systemType: "Off-grid", batteryEnabled: true, projectScope: forced });
  assert.equal(rows.some((r) => r.id === "net_metering_row"), false);
});

check("lightning protection dependency exposes air terminal + down conductor + test joint + earth path", () => {
  let scope = { ...buildPresetScope("commercial_standard"), lightningEnabled: true };
  scope = applyScopeDependencies(scope, ctx());
  for (const id of LIGHTNING_PATH_IDS) {
    assert.equal(scope.lines.find((l) => l.id === id)?.inclusionState, "included");
  }
  const incomplete = {
    ...scope,
    lines: scope.lines.map((l) => (l.id === "lp_down" ? setLineState(l, "no", "excluded", 0) : l)),
  };
  const errors = validateProjectScope(incomplete, ctx());
  assert.equal(errors.some((e) => /Lightning protection requires/.test(e)), true);
});

check("RCC foundation dependency includes civil foundation lines", () => {
  let scope = { ...buildPresetScope("industrial_standard"), rccFoundationRequired: true };
  scope = applyScopeDependencies(scope, ctx({ structureType: "girder" }));
  for (const id of CIVIL_FOUNDATION_IDS) {
    assert.equal(scope.lines.find((l) => l.id === id)?.inclusionState, "included");
  }
});

check("crane dependency includes logistics crane line", () => {
  const on = applyScopeDependencies({ ...buildPresetScope("residential_standard"), craneEnabled: true, scopeMode: "advanced" }, ctx());
  assert.equal(on.lines.find((l) => l.id === "log_crane")?.inclusionState, "included");
  const off = applyScopeDependencies({ ...buildPresetScope("industrial_standard"), craneEnabled: false }, ctx());
  assert.equal(off.lines.find((l) => l.id === "log_crane")?.inclusionState, "excluded");
});

check("catalog equipment id survives on scope BOQ rows", () => {
  let scope = buildPresetScope("commercial_standard");
  scope = {
    ...scope,
    lines: scope.lines.map((l) =>
      l.id === "dc_pos" ? { ...setLineState(l, "yes", "included", 20), rate: 280, catalogProductId: "web_dc-6mm", rateSource: "catalog" as const } : l
    ),
  };
  const rows = projectScopeToBoqRows(scope);
  assert.equal(rows.find((r) => r.id === `${SCOPE_BOQ_ID_PREFIX}dc_pos`)?.catalogProductId, "web_dc-6mm");
});

check("unknown catalog spec remains Not available in catalog — never fabricated", () => {
  const blank = product({ id: "p1", name: "Panel" });
  assert.equal(readCatalogSpec(blank, ["efficiency"]), "");
  assert.equal(displaySpec(""), UNAVAILABLE_SPEC);
  assert.equal(panelCatalogFields(blank).efficiency, UNAVAILABLE_SPEC);
  assert.equal(inverterCatalogFields(blank).europeanEfficiency, UNAVAILABLE_SPEC);
  const known = product({
    id: "p2",
    name: "Panel",
    specifications: { efficiency: "21.8%", technology: "N-type" },
  });
  assert.equal(panelCatalogFields(known).efficiency, "21.8%");
  assert.equal(panelCatalogFields(known).technology, "N-type");
});

check("no fabricated engineering load values", () => {
  const scope = buildPresetScope("industrial_standard");
  assert.equal(girderDesignLoadDisplay(scope.girder), PENDING_STRUCTURAL_DESIGN);
  assert.equal(/\d/.test(girderDesignLoadDisplay(scope.girder)), false);
});

check("no fabricated prices on new equipment lines", () => {
  const scope = buildPresetScope("industrial_standard");
  const scada = scope.lines.find((l) => l.id === "mon_scada_gw")!;
  assert.equal(scada.rate, 0);
  assert.equal(scada.rateSource, "none");
  const tray = scope.lines.find((l) => l.id === "cm_tray")!;
  assert.equal(tray.rate, 0);
});

check("excluded item is not priced", () => {
  let scope = includePriced(buildPresetScope("commercial_standard"), "cm_tray", 10, 1500);
  scope = {
    ...scope,
    lines: scope.lines.map((l) => (l.id === "cm_tray" ? setLineState(l, "no", "excluded", 10) : l)),
  };
  assert.equal(lineAmount(scope.lines.find((l) => l.id === "cm_tray")!), 0);
  assert.equal(projectScopeToBoqRows(scope).some((r) => r.id.endsWith("cm_tray")), false);
});

check("pending conditional item is not included in total", () => {
  let scope = buildPresetScope("commercial_standard");
  scope = {
    ...scope,
    lines: scope.lines.map((l) =>
      l.id === "cm_tray" ? setLineState({ ...l, rate: 9000 }, "conditional", "pending", 12) : l
    ),
  };
  assert.equal(lineAmount(scope.lines.find((l) => l.id === "cm_tray")!), 0);
  const rows = projectScopeToBoqRows(scope);
  assert.equal(rows.some((r) => r.id.includes("cm_tray")), false);
  assert.equal(rows.reduce((s, r) => s + (Number(r.total) || 0), 0), 0);
});

check("residential standard Apply does not add advanced BOQ rows", () => {
  const apply = buildCommercialDraftApply({
    ...base,
    projectScope: buildPresetScope("residential_standard"),
  });
  assert.equal(apply.draftOnly, true);
  assert.equal(apply.boqRows.some((r) => String(r.id).startsWith(SCOPE_BOQ_ID_PREFIX)), false);
  assert.equal(apply.boqRows.some((r) => r.id === "dc_cable_row"), true);
});

check("commercial advanced replaces generic DC when detailed DC is included, extras appear on Apply", () => {
  let scope = buildPresetScope("commercial_standard");
  scope = includePriced(scope, "dc_pos", 40, 280);
  scope = includePriced(scope, "dc_neg", 40, 280);
  const resolved = applyScopeDependencies(scope, ctx({ panelQuantity: 10 }));
  assert.equal(suppressedGenericChargeIds(resolved).has("dc_cable_row"), true);
  const apply = buildCommercialDraftApply({ ...base, panelQuantity: 10, projectScope: resolved });
  assert.equal(apply.draftOnly, true);
  assert.equal(apply.boqRows.some((r) => r.id === "dc_cable_row"), false);
  assert.equal(apply.boqRows.some((r) => r.id === `${SCOPE_BOQ_ID_PREFIX}dc_pos`), true);
  assert.equal(apply.boqRows.find((r) => r.id === `${SCOPE_BOQ_ID_PREFIX}dc_pos`)?.total, 40 * 280);
});

check("cost summary totals equal BOQ priced item totals", () => {
  let scope = includePriced(buildPresetScope("commercial_standard"), "dc_pos", 10, 280);
  scope = includePriced(scope, "ac_inv_db", 15, 250);
  const config = { ...base, panelQuantity: 10, projectScope: scope };
  const rows = buildCommercialQuoteBoq(config);
  const boqTotal = rows.filter((r) => r.type === "item").reduce((s, r) => s + (Number(r.total) || 0), 0);
  const charges = mergeOtherCharges(config.systemSizeKw, config.otherCharges, config.systemType);
  const resolved = applyScopeDependencies(scope, ctx({ panelQuantity: 10 }));
  const skip = suppressedGenericChargeIds(resolved);
  const panelRow = rows.find((r) => r.id === "panel_row")!;
  const invRow = rows.find((r) => r.id === "inverter_row")!;
  const battRow = rows.find((r) => r.id === "battery_row")!;
  const l3 = rows.find((r) => r.id === STRUCTURE_L3_ROW_ID);
  const l2 = rows.find((r) => r.id === STRUCTURE_L2_ROW_ID);
  const install = rows.find((r) => r.id === "install_service_row")!;
  const summary = buildQuoteCostSummary({
    panelTotal: Number(panelRow.total),
    inverterTotal: Number(invRow.total),
    batteryTotal: Number(battRow.total),
    structureTotal: Number(l3?.total || 0) + Number(l2?.total || 0),
    installationTotal: Number(install.total),
    charges: {
      dcCable: optionalChargeTotal(charges.dcCable),
      acCable: optionalChargeTotal(charges.acCable),
      earthWire: optionalChargeTotal(charges.earthWire),
      dbBox: optionalChargeTotal(charges.dbBox),
      earthingBore: optionalChargeTotal(charges.earthingBore),
      civilWork: optionalChargeTotal(charges.civilWork),
      freight: optionalChargeTotal(charges.freight),
      netMetering: optionalChargeTotal(charges.netMetering),
      surveyDesign: optionalChargeTotal(charges.surveyDesign),
    },
    suppressedGenericIds: skip,
    scope: resolved,
  });
  assert.equal(Math.round(summary.subtotal), Math.round(boqTotal));
});

check("customer 3-page grouping total equals original BOQ total", () => {
  let scope = includePriced(buildPresetScope("industrial_standard"), "dc_pos", 25, 280);
  scope = includePriced(scope, "dc_neg", 25, 280);
  scope = includePriced(scope, "cm_tray", 8, 1200);
  scope = includePriced(scope, "log_crane", 1, 45000);
  const rows = buildCommercialQuoteBoq({ ...base, panelQuantity: 10, projectScope: applyScopeDependencies(scope, ctx({ panelQuantity: 10 })) });
  const resolved = resolveCustomerFacingBoq(rows);
  assert.equal(resolved.totalsPreserved, true);
  assert.equal(Math.abs(sumPricedBoqItems(rows) - resolved.customerTotal) <= 1, true);
});

check("scope matrix lists included / excluded / pending major sections", () => {
  const scope = applyScopeDependencies(buildPresetScope("industrial_standard"), ctx({ structureType: "standard", batteryEnabled: true }));
  const matrix = buildScopeMatrix(scope, ctx({ batteryEnabled: true }));
  assert.equal(matrix.included.includes("Panels"), true);
  assert.equal(matrix.included.includes("Inverter"), true);
  assert.equal(matrix.included.includes("Battery"), true);
  assert.equal(matrix.excluded.includes("Lightning Protection") || matrix.pending.some((p) => /Lightning/.test(p)), true);
});

check("commercial config validation still passes without project scope", () => {
  assert.equal(validateCommercialQuoteConfig(base).length, 0);
});

check("Apply remains draft-only with advanced scope attached", () => {
  const apply = buildCommercialDraftApply({
    ...base,
    projectScope: applyScopeDependencies(buildPresetScope("industrial_standard"), ctx()),
  });
  assert.equal(apply.draftOnly, true);
});

console.log(`\nAI project scope tests: ${pass} passed`);
