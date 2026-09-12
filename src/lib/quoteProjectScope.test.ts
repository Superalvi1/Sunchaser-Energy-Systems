import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAcCableDetail,
  applyAcPanelDetail,
  applyCableTrayDetail,
  applyCivilFoundation,
  applyDcCableDetail,
  applyDcCombinerDetail,
  applyEarthConductorDetail,
  applyLightningDetail,
  applyScopeDependencies,
  BATTERY_ACCESSORY_IDS,
  buildPresetScope,
  buildQuoteCostSummary,
  buildResolvedScopeMatrix,
  buildScopeForClass,
  buildScopeMatrix,
  CIVIL_FOUNDATION_IDS,
  commitAiQuoteDraftToParent,
  describeAcCable,
  describeCivilFoundation,
  describeDcCable,
  displaySpec,
  emptyAcCableRun,
  emptyAcPanel,
  emptyCableTray,
  emptyCivilFoundation,
  emptyDcCableRun,
  emptyDcCombiner,
  emptyEarthConductor,
  emptyLightningDetail,
  finishAmount,
  freezeProjectScopeSnapshot,
  girderDesignLoadDisplay,
  inverterCatalogFields,
  isMsStructure,
  isValidFinishForMaterial,
  LIGHTNING_PATH_IDS,
  lineAmount,
  matrixAgreesWithBoq,
  panelCatalogFields,
  PENDING_STRUCTURAL_DESIGN,
  projectScopeToBoqRows,
  quotePersistsProjectScope,
  readCatalogSpec,
  readProjectScopeSnapshot,
  SCOPE_BOQ_ID_PREFIX,
  setLineState,
  suppressedGenericChargeIds,
  UNAVAILABLE_SPEC,
  validateProjectScope,
  type GenericChargeFlags,
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

function completeGirder(scope: ProjectScopeState, material: ProjectScopeState["girder"]["material"]): ProjectScopeState {
  return {
    ...scope,
    girder: {
      ...scope.girder,
      mainSection: "6x3",
      material,
      steelGrade: "ASTM A36",
      span: "12 ft",
      columnCount: 4,
      basePlateLength: "12",
      basePlateWidth: "12",
      basePlateThickness: "12",
      anchorBoltDiameter: "16mm",
      anchorBoltQty: 4,
    },
  };
}

function genericFlags(systemType: CommercialQuoteConfig["systemType"] = "Hybrid", patch: Partial<GenericChargeFlags> = {}): GenericChargeFlags {
  const charges = mergeOtherCharges(10, undefined, systemType);
  return {
    dcCable: charges.dcCable.enabled,
    acCable: charges.acCable.enabled,
    earthWire: charges.earthWire.enabled,
    netMetering: charges.netMetering.enabled,
    ...patch,
  };
}

function specifyDc(scope: ProjectScopeState, id: string, patch: Partial<ReturnType<typeof emptyDcCableRun>> = {}): ProjectScopeState {
  const polarity = id === "dc_pos" ? "positive" : id === "dc_neg" ? "negative" : "both";
  const detail = {
    ...emptyDcCableRun(id, polarity === "both" ? "" : polarity),
    conductor: "tinned_copper" as const,
    areaMm2: "6" as const,
    voltageRating: "1500v" as const,
    cableType: "PV1-F",
    lengthM: 40,
    runCount: 1,
    ratePerMeter: 280,
    polarity,
    ...patch,
  };
  const next = applyDcCableDetail(scope, id, detail);
  const qty = next.lines.find((l) => l.id === id)?.qty ?? 0;
  return includePriced(next, id, qty, detail.ratePerMeter);
}

function specifyAc(scope: ProjectScopeState, id: string, patch: Partial<ReturnType<typeof emptyAcCableRun>> = {}): ProjectScopeState {
  const detail = {
    ...emptyAcCableRun(id),
    phase: "three" as const,
    conductor: "copper" as const,
    cores: "4c" as const,
    areaMm2: "25" as const,
    construction: "xlpe" as const,
    voltageRating: "0.6_1kv" as const,
    lengthM: 32,
    runs: 1,
    ratePerMeter: 250,
    ...patch,
  };
  const next = applyAcCableDetail(scope, id, detail);
  const qty = next.lines.find((l) => l.id === id)?.qty ?? 0;
  return includePriced(next, id, qty, detail.ratePerMeter);
}

function specifyEarth(scope: ProjectScopeState, id: string, patch: Partial<ReturnType<typeof emptyEarthConductor>> = {}): ProjectScopeState {
  const detail = {
    ...emptyEarthConductor(id),
    conductorType: "bare_copper" as const,
    areaMm2: "16",
    lengthM: 12,
    ratePerMeter: 380,
    ...patch,
  };
  const next = applyEarthConductorDetail(scope, id, detail);
  const qty = next.lines.find((l) => l.id === id)?.qty ?? 0;
  return includePriced(next, id, qty, detail.ratePerMeter);
}

function completeLightning() {
  return {
    ...emptyLightningDetail(),
    airTerminalType: "Franklin rod",
    airTerminalQty: 2,
    mastQty: 1,
    downConductorType: "Bare copper",
    downConductorArea: "50 mm²",
    downConductorLength: 18,
    testJointQty: 2,
    earthPitQty: 1,
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

check("commercial advanced replaces generic DC only when replacement is enabled and schedule is complete", () => {
  let scope = specifyDc(buildPresetScope("commercial_standard"), "dc_pos");
  scope = specifyDc(scope, "dc_neg");
  scope = { ...scope, replaceGenericDc: true };
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

check("Apply carries frozen project scope snapshot including pending and unpriced docs", () => {
  const scope = applyScopeDependencies(buildPresetScope("commercial_standard"), ctx({ panelQuantity: 10 }));
  const apply = buildCommercialDraftApply({ ...base, panelQuantity: 10, projectScope: scope });
  assert.equal(apply.draftOnly, true);
  assert.ok(apply.projectScopeSnapshot);
  assert.equal(apply.projectScopeSnapshot!.projectClass, "commercial");
  assert.equal(apply.projectScopeSnapshot!.scopeMode, "advanced");
  assert.equal(apply.projectScopeSnapshot!.lines.some((l) => l.inclusionState === "pending"), true);
  const docs = apply.projectScopeSnapshot!.lines.filter((l) => l.section === "documentation" && l.inclusionState === "included");
  assert.ok(docs.length > 0);
  assert.equal(docs.every((d) => lineAmount(d) === 0), true);
  assert.equal(apply.boqRows.some((r) => String(r.id).startsWith(`${SCOPE_BOQ_ID_PREFIX}doc_`)), false);
  assert.equal(apply.boqRows.some((r) => String(r.id).includes("pending")), false);
  const parent = commitAiQuoteDraftToParent({ boqRows: [], projectScopeSnapshot: undefined }, apply);
  assert.equal(parent.projectScopeSnapshot!.girder.designLoadStatus, "pending_structural_design");
  assert.equal(parent.projectScopeSnapshot!.preset, "commercial_standard");
});

check("Close without Apply does not mutate parent BOQ or snapshot", () => {
  const parent = { boqRows: [{ id: "existing_row", type: "item" as const, total: 1 }], projectScopeSnapshot: undefined as ProjectScopeState | undefined };
  const draft = buildCommercialDraftApply({
    ...base,
    projectScope: applyScopeDependencies(buildPresetScope("commercial_standard"), ctx()),
  });
  assert.equal(parent.projectScopeSnapshot, undefined);
  assert.equal(parent.boqRows[0].id, "existing_row");
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../components/quoteAuthoring/AIQuoteBuilderModal.tsx"), "utf8");
  assert.equal(/onClick=\{handleApply\}[\s\S]{0,180}Close/.test(src), false);
  assert.equal(/onClick=\{onClose\}[\s\S]{0,180}Close/.test(src), true);
  assert.equal(src.includes("onApplyDraft(applyPayload)"), true);
  void draft;
});

check("Save/reload keeps project scope and later preset changes do not rewrite it", () => {
  const original = applyScopeDependencies(buildPresetScope("commercial_standard"), ctx());
  const apply = buildCommercialDraftApply({ ...base, projectScope: original });
  const saved = freezeProjectScopeSnapshot(apply.projectScopeSnapshot);
  original.projectClass = "industrial";
  original.lightningEnabled = true;
  original.preset = "industrial_standard";
  const laterPreset = buildPresetScope("industrial_standard");
  laterPreset.projectClass = "industrial";
  const reloaded = readProjectScopeSnapshot({ projectScopeSnapshot: saved });
  assert.equal(reloaded!.projectClass, "commercial");
  assert.equal(reloaded!.preset, "commercial_standard");
  assert.equal(reloaded!.lightningEnabled, false);
  assert.equal(reloaded!.scopeMode, "advanced");
  assert.notEqual(reloaded!.preset, laterPreset.preset);
});

check("legacy quote without project scope still loads", () => {
  const quote = { boqRows: [{ id: "panel_row", type: "item" as const, total: 100 }], id: "q-legacy" };
  assert.equal(readProjectScopeSnapshot(quote), undefined);
  assert.equal(quotePersistsProjectScope(quote), false);
  assert.equal(quote.boqRows.length, 1);
});

check("only DC positive entered does not suppress generic DC", () => {
  let scope = includePriced(buildPresetScope("commercial_standard"), "dc_pos", 40, 280);
  scope = { ...scope, replaceGenericDc: true };
  const resolved = applyScopeDependencies(scope, ctx());
  assert.equal(suppressedGenericChargeIds(resolved).has("dc_cable_row"), false);
  const apply = buildCommercialDraftApply({ ...base, projectScope: resolved });
  assert.equal(apply.boqRows.some((r) => r.id === "dc_cable_row"), true);
  const errors = validateProjectScope(resolved, ctx());
  assert.equal(errors.some((e) => /Replace standard DC cable/.test(e)), true);
});

check("DC positive + negative complete with replacement enabled suppresses generic DC", () => {
  let scope = specifyDc(buildPresetScope("commercial_standard"), "dc_pos");
  scope = specifyDc(scope, "dc_neg");
  scope = { ...scope, replaceGenericDc: true };
  const resolved = applyScopeDependencies(scope, ctx());
  assert.equal(suppressedGenericChargeIds(resolved).has("dc_cable_row"), true);
  const apply = buildCommercialDraftApply({ ...base, projectScope: resolved });
  assert.equal(apply.boqRows.some((r) => r.id === "dc_cable_row"), false);
  assert.equal(apply.boqRows.filter((r) => String(r.id).startsWith(`${SCOPE_BOQ_ID_PREFIX}dc_`)).length >= 2, true);
});

check("replacement flag off keeps generic even when detailed DC is complete", () => {
  let scope = specifyDc(buildPresetScope("commercial_standard"), "dc_pos");
  scope = specifyDc(scope, "dc_neg");
  assert.equal(scope.replaceGenericDc, false);
  const resolved = applyScopeDependencies(scope, ctx());
  assert.equal(suppressedGenericChargeIds(resolved).has("dc_cable_row"), false);
  const apply = buildCommercialDraftApply({ ...base, projectScope: resolved });
  assert.equal(apply.boqRows.some((r) => r.id === "dc_cable_row"), true);
  assert.equal(apply.boqRows.some((r) => r.id === `${SCOPE_BOQ_ID_PREFIX}dc_pos`), true);
});

check("only AC DB→LT entered does not silently drop inverter→DB allowance", () => {
  let scope = includePriced(buildPresetScope("commercial_standard"), "ac_db_lt", 20, 250);
  scope = {
    ...scope,
    replaceGenericAc: true,
    lines: scope.lines.map((l) => (l.id === "ac_inv_db" ? setLineState(l, "yes", "included", 0) : l)),
  };
  const resolved = applyScopeDependencies(scope, ctx());
  assert.equal(suppressedGenericChargeIds(resolved).has("ac_cable_row"), false);
  const apply = buildCommercialDraftApply({ ...base, projectScope: resolved });
  assert.equal(apply.boqRows.some((r) => r.id === "ac_cable_row"), true);
  assert.equal(validateProjectScope(resolved, ctx()).some((e) => /Replace standard AC cable/.test(e)), true);
});

check("incomplete earth detailed schedule retains generic earth", () => {
  let scope = includePriced(buildPresetScope("commercial_standard"), "earth_pv", 15, 380);
  scope = { ...scope, replaceGenericEarth: true };
  const resolved = applyScopeDependencies(scope, ctx());
  assert.equal(suppressedGenericChargeIds(resolved).has("earth_wire_row"), false);
  const apply = buildCommercialDraftApply({ ...base, projectScope: resolved });
  assert.equal(apply.boqRows.some((r) => r.id === "earth_wire_row"), true);
  assert.equal(validateProjectScope(resolved, ctx()).some((e) => /Replace standard earthing/.test(e)), true);
});

check("complete explicit replacement does not double-count DC/AC/earth", () => {
  let scope = specifyDc(buildPresetScope("commercial_standard"), "dc_pos");
  scope = specifyDc(scope, "dc_neg");
  scope = specifyAc(scope, "ac_inv_db");
  scope = specifyEarth(scope, "earth_pv");
  scope = specifyEarth(scope, "earth_inv", { lengthM: 8 });
  scope = { ...scope, replaceGenericDc: true, replaceGenericAc: true, replaceGenericEarth: true };
  const resolved = applyScopeDependencies(scope, ctx());
  const skip = suppressedGenericChargeIds(resolved);
  assert.equal(skip.has("dc_cable_row"), true);
  assert.equal(skip.has("ac_cable_row"), true);
  assert.equal(skip.has("earth_wire_row"), true);
  const apply = buildCommercialDraftApply({ ...base, projectScope: resolved });
  assert.equal(apply.boqRows.some((r) => r.id === "dc_cable_row"), false);
  assert.equal(apply.boqRows.some((r) => r.id === "ac_cable_row"), false);
  assert.equal(apply.boqRows.some((r) => r.id === "earth_wire_row"), false);
  assert.equal(apply.boqRows.some((r) => r.id === `${SCOPE_BOQ_ID_PREFIX}dc_pos`), true);
  assert.equal(apply.boqRows.some((r) => r.id === `${SCOPE_BOQ_ID_PREFIX}ac_inv_db`), true);
});

check("Elevated MS + no finish is blocked; Elevated MS + hot-dip is valid and not auto-charged", () => {
  let scope = buildPresetScope("commercial_standard");
  scope = { ...scope, elevated: { ...scope.elevated, material: "ms" }, finish: { ...scope.finish, finish: "" } };
  const elevatedCtx = ctx({ structureType: "elevated" });
  assert.equal(isMsStructure(scope, elevatedCtx), true);
  assert.equal(isValidFinishForMaterial("ms", ""), false);
  assert.equal(validateProjectScope(scope, elevatedCtx).some((e) => /coating \/ finish/.test(e)), true);
  scope = { ...scope, finish: { ...scope.finish, finish: "none" } };
  assert.equal(isValidFinishForMaterial("ms", "none"), false);
  assert.equal(validateProjectScope(scope, elevatedCtx).some((e) => /coating \/ finish/.test(e)), true);
  scope = { ...scope, finish: { ...scope.finish, finish: "hot_dip", amount: 0, rate: 0, surfaceArea: 0 } };
  assert.equal(isValidFinishForMaterial("ms", "hot_dip"), true);
  assert.equal(validateProjectScope(scope, elevatedCtx).some((e) => /coating \/ finish/.test(e)), false);
  assert.equal(finishAmount(scope.finish), 0);
  scope = { ...scope, finish: { ...scope.finish, finish: "anti_rust" } };
  assert.equal(validateProjectScope(scope, elevatedCtx).some((e) => /coating \/ finish/.test(e)), false);
});

check("Girder MS + no finish is blocked; Girder GI + none/existing galvanized is valid", () => {
  let ms = completeGirder(buildPresetScope("commercial_standard"), "ms");
  ms = { ...ms, finish: { ...ms.finish, finish: "" } };
  const girderCtx = ctx({ structureType: "girder" });
  assert.equal(isMsStructure(ms, girderCtx), true);
  assert.equal(validateProjectScope(ms, girderCtx).some((e) => /coating \/ finish/.test(e)), true);
  ms = { ...ms, finish: { ...ms.finish, finish: "none" } };
  assert.equal(validateProjectScope(ms, girderCtx).some((e) => /coating \/ finish/.test(e)), true);
  ms = { ...ms, finish: { ...ms.finish, finish: "hot_dip" } };
  assert.equal(validateProjectScope(ms, girderCtx).some((e) => /coating \/ finish/.test(e)), false);
  let gi = completeGirder(buildPresetScope("commercial_standard"), "gi");
  gi = { ...gi, finish: { ...gi.finish, finish: "none" } };
  assert.equal(isMsStructure(gi, girderCtx), false);
  assert.equal(isValidFinishForMaterial("gi", "none"), true);
  assert.equal(validateProjectScope(gi, girderCtx).some((e) => /coating \/ finish/.test(e)), false);
  let elevatedGi = buildPresetScope("commercial_standard");
  elevatedGi = { ...elevatedGi, elevated: { ...elevatedGi.elevated, material: "gi" }, finish: { ...elevatedGi.finish, finish: "none" } };
  assert.equal(validateProjectScope(elevatedGi, ctx({ structureType: "elevated" })).some((e) => /coating \/ finish/.test(e)), false);
});

check("no duplicate elevated/shared finish states", () => {
  const scope = buildPresetScope("commercial_standard");
  assert.equal("finish" in scope.elevated, false);
  assert.equal(typeof scope.finish.finish, "string");
  assert.equal(typeof scope.elevated.material, "string");
});

check("scope matrix agrees with generated BOQ for generic, NM, off-grid, pending lightning and replacement", () => {
  const onGridCtx = ctx({ systemType: "Hybrid" });
  const commercial = applyScopeDependencies(buildPresetScope("commercial_standard"), onGridCtx);
  const genericOn = genericFlags("Hybrid");
  const matrixGeneric = buildResolvedScopeMatrix({
    scope: commercial,
    ctx: onGridCtx,
    genericCharges: genericOn,
    suppressedGenericIds: suppressedGenericChargeIds(commercial),
  });
  assert.equal(matrixGeneric.included.includes("DC Cable"), true);
  assert.equal(matrixGeneric.included.includes("AC Cable"), true);
  assert.equal(matrixGeneric.included.includes("Earthing"), true);
  assert.equal(matrixGeneric.included.includes("Net Metering"), true);
  assert.equal(matrixGeneric.pending.some((p) => /Lightning/.test(p)), true);
  const boqGeneric = buildCommercialQuoteBoq({ ...base, projectScope: commercial });
  assert.equal(
    matrixAgreesWithBoq({
      matrix: matrixGeneric,
      boqRows: boqGeneric,
      genericCharges: genericOn,
      suppressedGenericIds: suppressedGenericChargeIds(commercial),
    }),
    true
  );

  const nmOff = genericFlags("Hybrid", { netMetering: false });
  const matrixNmOff = buildResolvedScopeMatrix({
    scope: commercial,
    ctx: onGridCtx,
    genericCharges: nmOff,
    suppressedGenericIds: [],
  });
  assert.equal(matrixNmOff.excluded.includes("Net Metering"), true);

  const offGridCtx = ctx({ systemType: "Off-grid" });
  const offGridScope = applyScopeDependencies(buildPresetScope("commercial_standard"), offGridCtx);
  const offGridFlags = genericFlags("Off-grid");
  assert.equal(offGridFlags.netMetering, false);
  const matrixOff = buildResolvedScopeMatrix({
    scope: offGridScope,
    ctx: offGridCtx,
    genericCharges: offGridFlags,
  });
  assert.equal(matrixOff.excluded.includes("Net Metering"), true);
  const boqOff = buildCommercialQuoteBoq({ ...base, systemType: "Off-grid", batteryEnabled: true, projectScope: offGridScope });
  assert.equal(boqOff.some((r) => r.id === "net_metering_row"), false);

  let replaced = specifyDc(buildPresetScope("commercial_standard"), "dc_pos");
  replaced = specifyDc(replaced, "dc_neg");
  replaced = { ...replaced, replaceGenericDc: true };
  const resolvedReplaced = applyScopeDependencies(replaced, onGridCtx);
  const skip = suppressedGenericChargeIds(resolvedReplaced);
  const matrixReplaced = buildResolvedScopeMatrix({
    scope: resolvedReplaced,
    ctx: onGridCtx,
    genericCharges: genericOn,
    suppressedGenericIds: skip,
  });
  assert.equal(matrixReplaced.included.includes("DC Cable"), true);
  const boqReplaced = buildCommercialQuoteBoq({ ...base, projectScope: resolvedReplaced });
  assert.equal(boqReplaced.some((r) => r.id === "dc_cable_row"), false);
  assert.equal(
    matrixAgreesWithBoq({
      matrix: matrixReplaced,
      boqRows: boqReplaced,
      genericCharges: genericOn,
      suppressedGenericIds: skip,
    }),
    true
  );
});

check("structured DC/AC descriptions keep typed fields and do not invent values", () => {
  const dc = {
    ...emptyDcCableRun("dc_pos", "positive"),
    conductor: "tinned_copper" as const,
    cableType: "PV1-F",
    areaMm2: "6" as const,
    voltageRating: "1500v" as const,
    lengthM: 40,
  };
  assert.equal(describeDcCable(dc), "6 mm² tinned copper PV1-F, 1500 V DC — positive run 40 m");
  const ac = {
    ...emptyAcCableRun("ac_inv_db"),
    cores: "4c" as const,
    areaMm2: "25" as const,
    conductor: "copper" as const,
    construction: "xlpe" as const,
    voltageRating: "0.6_1kv" as const,
    lengthM: 32,
  };
  assert.equal(describeAcCable(ac, { id: "ac_inv_db", name: "Inverter → AC DB Cable" } as any), "4C 25 mm² Cu XLPE, 0.6/1kV — inverter to AC DB, 32 m");
  const empty = emptyDcCableRun("dc_pos", "positive");
  assert.equal(describeDcCable(empty).includes("6 mm"), false);
  assert.equal(describeCivilFoundation(emptyCivilFoundation()), "Pending structural design / site survey");
});

check("lightning enabled requires structured path fields; unknown civil stays pending", () => {
  let scope = { ...buildPresetScope("commercial_standard"), lightningEnabled: true };
  scope = applyScopeDependencies(scope, ctx());
  const errors = validateProjectScope(scope, ctx());
  assert.equal(errors.some((e) => /air terminal type/i.test(e)), true);
  assert.equal(errors.some((e) => /air terminal quantity/i.test(e)), true);
  assert.equal(errors.some((e) => /down conductor type/i.test(e)), true);
  assert.equal(errors.some((e) => /down conductor area/i.test(e)), true);
  assert.equal(errors.some((e) => /down conductor length/i.test(e)), true);
  assert.equal(errors.some((e) => /test joint/i.test(e)), true);
  assert.equal(errors.some((e) => /earth pit/i.test(e)), true);
  scope = applyLightningDetail(scope, completeLightning());
  scope = applyScopeDependencies(scope, ctx());
  const ok = validateProjectScope(scope, ctx());
  assert.equal(ok.some((e) => /air terminal|down conductor|test joint|earth pit/i.test(e)), false);
});

check("structured technical objects exist on presets without invented sizes", () => {
  const scope = buildPresetScope("industrial_standard");
  assert.equal(scope.dcCables.dc_pos.areaMm2, "");
  assert.equal(scope.acCables.ac_inv_db.cores, "");
  assert.equal(scope.dcCombiner.numberOfStrings, 0);
  assert.equal(scope.acPanels.ac_solar_db.incomingCurrentA, "");
  assert.equal(scope.lightningDetail.airTerminalType, "");
  assert.equal(scope.cableTray.trayType, "");
  assert.equal(scope.earthConductors.earth_pv.conductorType, "");
  assert.equal(scope.civilFoundation.designStatus, "pending_structural_design");
  assert.equal(scope.replaceGenericDc, false);
  assert.equal(scope.replaceGenericAc, false);
  assert.equal(scope.replaceGenericEarth, false);
});

check("clearing structured DC length and rate zeros the linked ScopeLine", () => {
  let scope = specifyDc(buildPresetScope("commercial_standard"), "dc_pos", { lengthM: 40, ratePerMeter: 280 });
  assert.equal(scope.lines.find((l) => l.id === "dc_pos")?.qty, 40);
  assert.equal(scope.lines.find((l) => l.id === "dc_pos")?.rate, 280);
  scope = applyDcCableDetail(scope, "dc_pos", { ...scope.dcCables.dc_pos, lengthM: 0 });
  assert.equal(scope.lines.find((l) => l.id === "dc_pos")?.qty, 0);
  scope = applyDcCableDetail(scope, "dc_pos", { ...scope.dcCables.dc_pos, ratePerMeter: 0 });
  assert.equal(scope.lines.find((l) => l.id === "dc_pos")?.rate, 0);
});

check("clearing structured AC / earth / combiner / panel / tray zeros linked quantities", () => {
  let scope = specifyAc(buildPresetScope("commercial_standard"), "ac_inv_db", { lengthM: 32 });
  assert.equal(scope.lines.find((l) => l.id === "ac_inv_db")?.qty, 32);
  scope = applyAcCableDetail(scope, "ac_inv_db", { ...scope.acCables.ac_inv_db, lengthM: 0 });
  assert.equal(scope.lines.find((l) => l.id === "ac_inv_db")?.qty, 0);

  scope = specifyEarth(scope, "earth_pv", { lengthM: 20 });
  assert.equal(scope.lines.find((l) => l.id === "earth_pv")?.qty, 20);
  scope = applyEarthConductorDetail(scope, "earth_pv", { ...scope.earthConductors.earth_pv, lengthM: 0 });
  assert.equal(scope.lines.find((l) => l.id === "earth_pv")?.qty, 0);

  scope = applyDcCombinerDetail(scope, { ...emptyDcCombiner(), qty: 1, unitPrice: 18000 });
  assert.equal(scope.lines.find((l) => l.id === "dc_combiner")?.qty, 1);
  scope = applyDcCombinerDetail(scope, { ...scope.dcCombiner, qty: 0 });
  assert.equal(scope.lines.find((l) => l.id === "dc_combiner")?.qty, 0);

  scope = applyAcPanelDetail(scope, "ac_solar_db", { ...emptyAcPanel("ac_solar_db"), qty: 1, panelCost: 50000 });
  assert.equal(scope.lines.find((l) => l.id === "ac_solar_db")?.rate, 50000);
  scope = applyAcPanelDetail(scope, "ac_solar_db", { ...scope.acPanels.ac_solar_db, panelCost: 0 });
  assert.equal(scope.lines.find((l) => l.id === "ac_solar_db")?.rate, 0);

  scope = applyCableTrayDetail(scope, { ...emptyCableTray(), lengthM: 30, rate: 1200 });
  assert.equal(scope.lines.find((l) => l.id === "cm_tray")?.qty, 30);
  scope = applyCableTrayDetail(scope, { ...scope.cableTray, lengthM: 0 });
  assert.equal(scope.lines.find((l) => l.id === "cm_tray")?.qty, 0);
});

check("DC lengths without mm² / voltage / cable type do not suppress generic DC", () => {
  const cases: Array<[string, Partial<ReturnType<typeof emptyDcCableRun>>]> = [
    ["mm²", { areaMm2: "" }],
    ["voltage", { voltageRating: "" }],
    ["cable type", { cableType: "" }],
  ];
  for (const [label, patch] of cases) {
    let scope = specifyDc(buildPresetScope("commercial_standard"), "dc_pos", patch);
    scope = specifyDc(scope, "dc_neg", patch);
    scope = { ...scope, replaceGenericDc: true };
    const resolved = applyScopeDependencies(scope, ctx());
    assert.equal(suppressedGenericChargeIds(resolved).has("dc_cable_row"), false, label);
    const apply = buildCommercialDraftApply({ ...base, projectScope: resolved });
    assert.equal(apply.boqRows.some((r) => r.id === "dc_cable_row"), true, label);
    const errors = validateProjectScope(resolved, ctx());
    assert.equal(errors.some((e) => /Replace standard DC cable/.test(e)), true, label);
  }
  let full = specifyDc(buildPresetScope("commercial_standard"), "dc_pos");
  full = specifyDc(full, "dc_neg");
  full = { ...full, replaceGenericDc: true };
  const resolvedFull = applyScopeDependencies(full, ctx());
  assert.equal(suppressedGenericChargeIds(resolvedFull).has("dc_cable_row"), true);
  assert.equal(validateProjectScope(resolvedFull, ctx()).some((e) => /Replace standard DC cable/.test(e)), false);
});

check("AC length without phase / cores / area / construction / voltage is incomplete", () => {
  const cases: Array<[string, Partial<ReturnType<typeof emptyAcCableRun>>]> = [
    ["phase", { phase: "" }],
    ["cores", { cores: "" }],
    ["area", { areaMm2: "" }],
    ["construction", { construction: "" }],
    ["voltage", { voltageRating: "" }],
  ];
  for (const [label, patch] of cases) {
    let scope = specifyAc(buildPresetScope("commercial_standard"), "ac_inv_db", patch);
    scope = { ...scope, replaceGenericAc: true };
    const resolved = applyScopeDependencies(scope, ctx());
    assert.equal(suppressedGenericChargeIds(resolved).has("ac_cable_row"), false, label);
    assert.equal(validateProjectScope(resolved, ctx()).some((e) => /Replace standard AC cable/.test(e)), true, label);
  }
  let full = specifyAc(buildPresetScope("commercial_standard"), "ac_inv_db");
  full = { ...full, replaceGenericAc: true };
  const resolvedFull = applyScopeDependencies(full, ctx());
  assert.equal(suppressedGenericChargeIds(resolvedFull).has("ac_cable_row"), true);
  assert.equal(validateProjectScope(resolvedFull, ctx()).some((e) => /Replace standard AC cable/.test(e)), false);
});

check("earth length without conductor type or size is incomplete", () => {
  let missingType = specifyEarth(buildPresetScope("commercial_standard"), "earth_pv", { conductorType: "" });
  missingType = specifyEarth(missingType, "earth_inv", { conductorType: "" });
  missingType = { ...missingType, replaceGenericEarth: true };
  const resolvedType = applyScopeDependencies(missingType, ctx());
  assert.equal(suppressedGenericChargeIds(resolvedType).has("earth_wire_row"), false);
  assert.equal(validateProjectScope(resolvedType, ctx()).some((e) => /Replace standard earthing/.test(e)), true);

  let missingSize = specifyEarth(buildPresetScope("commercial_standard"), "earth_pv", { areaMm2: "", stripSize: "" });
  missingSize = specifyEarth(missingSize, "earth_inv", { areaMm2: "", stripSize: "" });
  missingSize = { ...missingSize, replaceGenericEarth: true };
  const resolvedSize = applyScopeDependencies(missingSize, ctx());
  assert.equal(suppressedGenericChargeIds(resolvedSize).has("earth_wire_row"), false);
  assert.equal(validateProjectScope(resolvedSize, ctx()).some((e) => /size/.test(e)), true);

  let full = specifyEarth(buildPresetScope("commercial_standard"), "earth_pv");
  full = specifyEarth(full, "earth_inv");
  full = { ...full, replaceGenericEarth: true };
  const resolvedFull = applyScopeDependencies(full, ctx());
  assert.equal(suppressedGenericChargeIds(resolvedFull).has("earth_wire_row"), true);
  assert.equal(validateProjectScope(resolvedFull, ctx()).some((e) => /Replace standard earthing/.test(e)), false);
});

check("lightning technical quantities sync to BOQ rows and zero length is blocked", () => {
  let scope = { ...buildPresetScope("commercial_standard"), lightningEnabled: true };
  scope = applyScopeDependencies(scope, ctx());
  scope = applyLightningDetail(scope, completeLightning());
  scope = applyScopeDependencies(scope, ctx());
  assert.equal(scope.lines.find((l) => l.id === "lp_air")?.qty, 2);
  assert.equal(scope.lines.find((l) => l.id === "lp_mast")?.qty, 1);
  assert.equal(scope.lines.find((l) => l.id === "lp_down")?.qty, 18);
  assert.equal(scope.lines.find((l) => l.id === "lp_test")?.qty, 2);
  assert.equal(scope.lines.find((l) => l.id === "lp_earth")?.qty, 1);
  scope = {
    ...scope,
    lines: scope.lines.map((l) =>
      l.id === "lp_air" || l.id === "lp_down" || l.id === "lp_test" || l.id === "lp_earth"
        ? { ...l, rate: 1000, rateSource: "manual" as const }
        : l
    ),
  };
  const rows = projectScopeToBoqRows(scope);
  assert.equal(rows.find((r) => r.id === `${SCOPE_BOQ_ID_PREFIX}lp_air`)?.qty, 2);
  assert.equal(rows.find((r) => r.id === `${SCOPE_BOQ_ID_PREFIX}lp_down`)?.qty, 18);

  const zeroQty = applyLightningDetail(scope, { ...completeLightning(), airTerminalQty: 0 });
  assert.equal(validateProjectScope(applyScopeDependencies(zeroQty, ctx()), ctx()).some((e) => /air terminal quantity/i.test(e)), true);
  const zeroLength = applyLightningDetail(scope, { ...completeLightning(), downConductorLength: 0 });
  assert.equal(validateProjectScope(applyScopeDependencies(zeroLength, ctx()), ctx()).some((e) => /down conductor length/i.test(e)), true);
  assert.equal(validateProjectScope(applyScopeDependencies(applyLightningDetail(scope, completeLightning()), ctx()), ctx()).some((e) => /air terminal|down conductor|test joint|earth pit/i.test(e)), false);
});

check("civil structured quantities feed BOQ and pending design does not fabricate qty", () => {
  let pending = { ...buildPresetScope("industrial_standard"), rccFoundationRequired: true };
  pending = applyScopeDependencies(pending, ctx({ structureType: "girder" }));
  assert.equal(pending.civilFoundation.designStatus, "pending_structural_design");
  assert.equal(pending.lines.find((l) => l.id === "cv_pads")?.qty, 0);
  assert.equal(pending.lines.find((l) => l.id === "cv_excavation")?.qty, 0);
  assert.equal(validateProjectScope(pending, ctx({ structureType: "girder" })).some((e) => /Foundation pad quantity/.test(e)), false);

  let provided = applyCivilFoundation(pending, {
    ...emptyCivilFoundation(),
    designStatus: "provided",
    designNote: "Engineer pack 12-A",
    foundationPadQty: 6,
    padLength: "2",
    padWidth: "2",
    padDepth: "1.5",
    excavationQty: 10,
    pccQty: 4,
    rccQty: 8,
    rebarKg: 120,
    formworkArea: 40,
    anchorBoltQty: 24,
  });
  provided = applyScopeDependencies(provided, ctx({ structureType: "girder" }));
  assert.equal(provided.lines.find((l) => l.id === "cv_pads")?.qty, 6);
  assert.equal(provided.lines.find((l) => l.id === "cv_excavation")?.qty, 10);
  assert.equal(provided.lines.find((l) => l.id === "cv_pcc")?.qty, 4);
  assert.equal(provided.lines.find((l) => l.id === "cv_rcc")?.qty, 8);
  assert.equal(provided.lines.find((l) => l.id === "cv_rebar")?.qty, 120);
  assert.equal(provided.lines.find((l) => l.id === "cv_formwork")?.qty, 40);
  assert.equal(provided.lines.find((l) => l.id === "cv_anchors")?.qty, 24);
  provided = {
    ...provided,
    lines: provided.lines.map((l) =>
      l.id === "cv_pads" ? { ...l, rate: 15000, rateSource: "manual" as const } : l
    ),
  };
  assert.equal(projectScopeToBoqRows(provided).find((r) => r.id === `${SCOPE_BOQ_ID_PREFIX}cv_pads`)?.qty, 6);

  let incomplete = applyCivilFoundation(pending, {
    ...emptyCivilFoundation(),
    designStatus: "provided",
    designNote: "missing pads",
    foundationPadQty: 0,
  });
  incomplete = applyScopeDependencies(incomplete, ctx({ structureType: "girder" }));
  assert.equal(validateProjectScope(incomplete, ctx({ structureType: "girder" })).some((e) => /Foundation pad quantity/.test(e)), true);
});

console.log(`\nAI project scope tests: ${pass} passed`);
