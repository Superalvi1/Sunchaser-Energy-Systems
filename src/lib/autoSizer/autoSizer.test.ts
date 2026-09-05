/**
 * AutoSizer presets, structure kits, manual overrides, totals, snapshot safety.
 */

import assert from "node:assert/strict";
import {
  AUTOSIZER_PRESETS,
  applyNamedRowFields,
  applyStructureKitOverride,
  authorizeAutoSizerPresetsAccess,
  batteryPresetSelectValue,
  generateRecommendedBoq,
  isLegacyPerPanelStructureSku,
  isOverridden,
  isQuoteStructureKitRow,
  L3_STRUCTURE_CUSTOMER_NAME,
  L2_STRUCTURE_CUSTOMER_NAME,
  LEGACY_PER_PANEL_STRUCTURE_PRODUCT_ID,
  liveCatalogProductId,
  markOverride,
  nearestAutoSizerPresetSize,
  parseCompanyAutoSizerPresets,
  patchLatestSettingsWithAutoSizerPresets,
  recommendStructures,
  recommendedBatteryOption,
  resolveAutoSizerPreset,
  shouldRegenerateField,
  snapshotHasItems,
  QUOTE_STRUCTURE_KIT_LINE_KIND,
} from "./index.ts";
import { canManageAutoSizerPresets } from "../roles.ts";
import {
  compileThreePageQuotationHtml,
  quoteBoqOverflow,
  quoteTermsOverflow,
  resolveDisplayedSystemType,
  resolveQuoteTermsClauses,
  THREE_PAGE_BOQ_OVERFLOW_MESSAGE,
  THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE,
  THREE_PAGE_QUOTATION_PAGE_COUNT,
  threePageRendererId,
} from "../quoteThreePageRender.ts";
import {
  EXISTING_COMPANY_VALIDITY_DAYS,
  parseValidityDaysFromText,
  resolveQuoteValidityDays,
} from "../quoteValidity.ts";


let pass = 0;
function check(name: string, fn: () => boolean | void) {
  const result = fn();
  if (result === false) throw new Error(`FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("6 kW preset resolves Jinko / Knox 6kW", () => {
  const p = resolveAutoSizerPreset(6);
  assert.equal(p.systemKw, 6);
  assert.equal(p.panel.brand, "Jinko");
  assert.equal(p.panel.wattage, 580);
  assert.equal(p.inverter.brand, "Knox");
  assert.equal(p.inverter.capacity, "6kW");
  assert.ok(p.cables.some((c) => c.kind === "dc" && c.size === "6mm"));
  assert.ok(p.cables.some((c) => c.kind === "ac"));
});

check("8 kW preset resolves inverter 8kW and DC cable qty from formula", () => {
  const p = resolveAutoSizerPreset(8);
  assert.equal(p.inverter.capacity, "8kW");
  const dc = p.cables.find((c) => c.kind === "dc");
  assert.equal(dc?.quantity, Math.round(8 * 15 + 40));
});

check("10 kW preset uses 10.24 kWh battery and 10kW inverter", () => {
  const p = resolveAutoSizerPreset(10);
  assert.equal(p.inverter.capacity, "10kW");
  assert.match(p.battery.option, /10\.24/);
  assert.equal(AUTOSIZER_PRESETS[10].systemKw, 10);
});

check("nearest preset maps 7.4 kW to 8", () => {
  assert.equal(nearestAutoSizerPresetSize(7.4), 8);
  assert.equal(nearestAutoSizerPresetSize(5.2), 6);
  assert.equal(nearestAutoSizerPresetSize(12), 10);
});

check("10 panels => 2 × L3 + 2 × L2", () => {
  const s = recommendStructures(10);
  assert.equal(s.l3, 2);
  assert.equal(s.l2, 2);
  assert.equal(s.remainder, 0);
  assert.equal(s.positions, 10);
});

check("16 panels => 4 × L3 + 2 × L2", () => {
  const s = recommendStructures(16);
  assert.equal(s.l3, 4);
  assert.equal(s.l2, 2);
  assert.equal(s.positions, 16);
});

check("9 panels => 3 × L3", () => {
  const s = recommendStructures(9);
  assert.equal(s.l3, 3);
  assert.equal(s.l2, 0);
});

check("AutoSizer 10 kW snapshot uses L2/L3 kit rows and 580W panel count", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 10, systemType: "Hybrid" });
  const expectedPanels = Math.ceil((10 * 1000) / 580);
  const expectedStructure = recommendStructures(expectedPanels);
  assert.equal(rec.panelCount, expectedPanels);
  assert.equal(rec.structure.l3, expectedStructure.l3);
  assert.equal(rec.structure.l2, expectedStructure.l2);
  const l3 = rec.rows.find((r) => r.id === "structure_l3_row");
  const l2 = rec.rows.find((r) => r.id === "structure_l2_row");
  if (expectedStructure.l3 > 0) {
    assert.ok(l3, "L3 row present");
    assert.equal(l3?.qty, rec.structure.l3);
  }
  if (expectedStructure.l2 > 0) {
    assert.ok(l2, "L2 row present");
    assert.equal(l2?.qty, rec.structure.l2);
  } else {
    assert.equal(l2, undefined);
  }
  const panel = rec.rows.find((r) => r.id === "panel_row");
  assert.equal(panel?.qty, expectedPanels);
  assert.match(String(panel?.name), /Jinko/);
});

check("10-panel forced wattage still recommends 2 L3 + 2 L2", () => {
  const rec = generateRecommendedBoq({
    systemSizeKw: 5.8,
    panelWattage: 580,
    panelBrand: "Jinko",
    systemType: "Hybrid",
  });
  assert.equal(rec.panelCount, 10);
  assert.equal(rec.structure.l3, 2);
  assert.equal(rec.structure.l2, 2);
});

check("manual structure override is not clobbered by later qty/price edits", () => {
  const generated = generateRecommendedBoq({
    systemSizeKw: 5.8,
    panelWattage: 580,
    systemType: "Hybrid",
  });
  assert.equal(generated.structure.l3, 2);
  assert.equal(generated.structure.l2, 2);

  let overrides = markOverride({}, "structure");
  const applied = applyStructureKitOverride(generated.rows, generated.panelCount, { l3: 1, l2: 4 });
  assert.equal(applied.structure.l3, 1);
  assert.equal(applied.structure.l2, 4);
  assert.equal(isOverridden(overrides, "structure"), true);
  assert.equal(shouldRegenerateField(overrides, "structure", false), false);
  assert.equal(shouldRegenerateField(overrides, "structure", true), true);

  const afterPanelEdit = applyNamedRowFields(applied.rows, "panel_row", { qty: 12, rate: 21000 });
  const l3 = afterPanelEdit.find((r) => r.id === "structure_l3_row");
  const l2 = afterPanelEdit.find((r) => r.id === "structure_l2_row");
  assert.equal(l3?.qty, 1);
  assert.equal(l2?.qty, 4);
});

check("panel and inverter edits persist on the snapshot", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 8, systemType: "Hybrid" });
  const withPanel = applyNamedRowFields(rec.rows, "panel_row", {
    name: "Longi 575W Mono-PERC Solar Panels",
    brand: "Longi",
    qty: 14,
    rate: 25215,
  });
  const withInv = applyNamedRowFields(withPanel, "inverter_row", {
    name: "Goodwe 8kW Smart Sync Inverter",
    brand: "Goodwe",
    qty: 1,
    rate: 400000,
  });
  assert.equal(withInv.find((r) => r.id === "panel_row")?.brand, "Longi");
  assert.equal(withInv.find((r) => r.id === "panel_row")?.qty, 14);
  assert.equal(withInv.find((r) => r.id === "inverter_row")?.brand, "Goodwe");
});

check("cable override keeps changed quantity after other row edits", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 6, systemType: "Hybrid" });
  const dcQty = rec.rows.find((r) => r.id === "dc_cable_row")!.qty;
  const changed = applyNamedRowFields(rec.rows, "dc_cable_row", { qty: dcQty + 25, name: "DC Solar Cable 10mm" });
  const afterInv = applyNamedRowFields(changed, "inverter_row", { qty: 1 });
  const dc = afterInv.find((r) => r.id === "dc_cable_row");
  assert.equal(dc?.qty, dcQty + 25);
  assert.match(String(dc?.name), /10mm/);
});

check("qty × rate updates item total and section subtotal", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 6, systemType: "On-grid", batteryOption: "None" });
  const edited = applyNamedRowFields(rec.rows, "panel_row", { qty: 2, rate: 1000 });
  const panel = edited.find((r) => r.id === "panel_row");
  assert.equal(panel?.total, 2000);
  const sub = edited.find((r) => r.id === "s-1");
  const importedSum = edited
    .filter((r) => r.type === "item" && ["panel_row", "inverter_row", "battery_row"].includes(r.id))
    .reduce((s, r) => s + r.total, 0);
  assert.equal(sub?.total, importedSum);
});

check("old quote without new metadata still generates 3-page HTML", () => {
  const oldQuote = {
    id: "q-legacy",
    clientName: "Legacy Customer",
    systemSizekW: 10,
    systemType: "Hybrid",
    grandTotal: 21000,
    boqItems: [
      { id: "legacy-1", type: "item", name: "Old panel line", description: "snapshot", brand: "Jinko", unit: "Pcs", qty: 1, rate: 21000, total: 21000 },
    ],
  };
  const lead = { id: "lead-1", name: "Legacy Customer", phone: "0300-0000000", location: "Lahore" };
  const rendered = compileThreePageQuotationHtml(oldQuote, lead, { companyTerms: [], quotePdfSettings: [] });
  assert.equal(rendered.pageCount, THREE_PAGE_QUOTATION_PAGE_COUNT);
  assert.equal((rendered.html.match(/class="page /g) || []).length, 3);
  assert.match(rendered.html, /Legacy Customer/);
  assert.match(rendered.html, /Old panel line/);
  assert.doesNotMatch(rendered.html, /Sunchaser Group Profile/);
  assert.doesNotMatch(rendered.html, /Why Partner with Sunchaser/);
  assert.equal(snapshotHasItems(oldQuote.boqItems as any), true);
});

check("auto and manual quotes use the same three-page renderer", () => {
  const auto = generateRecommendedBoq({ systemSizeKw: 8, systemType: "Hybrid" });
  const autoQuote = {
    id: "q-auto",
    quote_type: "auto_sizer",
    clientName: "Auto Client",
    systemSizekW: 8,
    systemType: "Hybrid",
    panelCount: auto.panelCount,
    boqRows: auto.rows,
    grandTotal: auto.subtotal,
  };
  const manualQuote = {
    id: "q-manual",
    quote_type: "manual_boq",
    clientName: "Manual Client",
    systemSizekW: 8,
    systemType: "Hybrid",
    panelCount: auto.panelCount,
    boqRows: auto.rows,
    grandTotal: auto.subtotal,
  };
  const lead = { id: "lead-2", name: "Client", phone: "0300-1111111" };
  const autoHtml = compileThreePageQuotationHtml(autoQuote, lead, { companyTerms: [{ term_text: "Clause one." }] });
  const manualHtml = compileThreePageQuotationHtml(manualQuote, lead, { companyTerms: [{ term_text: "Clause one." }] });
  assert.equal(autoHtml.pageCount, 3);
  assert.equal(manualHtml.pageCount, 3);
  assert.equal(threePageRendererId(), "sunchaser-three-page-quotation");
  assert.doesNotMatch(autoHtml.html, /sunchaserDownloadPdf/);
  assert.doesNotMatch(manualHtml.html, /pathname\.replace/);
  assert.match(autoHtml.html, /data-sunchaser-page-count="3"/);
  assert.match(manualHtml.html, /data-sunchaser-page-count="3"/);
  assert.match(autoHtml.html, /Commercial Quotation/);
  assert.match(manualHtml.html, /Commercial Quotation/);
  assert.match(autoHtml.html, /Terms & Conditions/);
  assert.match(autoHtml.html, /Clause one/);
});

check("validity is parsed from existing company terms, not invented", () => {
  assert.equal(parseValidityDaysFromText("This quotation is valid for three (3) calendar days from the date of issue."), 3);
  assert.equal(parseValidityDaysFromText("Quotation validity: 3 days from date of issuance."), 3);
  assert.equal(parseValidityDaysFromText("Quoted prices are valid for 3 days."), 3);
  assert.equal(EXISTING_COMPANY_VALIDITY_DAYS, 3);
  const fromQuote = resolveQuoteValidityDays({ validityDays: 7 });
  assert.equal(fromQuote.days, 7);
  assert.equal(fromQuote.source, "quote.validityDays");
  const fromCompany = resolveQuoteValidityDays(
    {},
    { companyTerms: [{ termText: "Quotation validity: 3 days from date of issuance." }] }
  );
  assert.equal(fromCompany.days, 3);
  assert.equal(fromCompany.source, "company_terms");
  const fallback = resolveQuoteValidityDays({});
  assert.equal(fallback.days, 3);
  assert.equal(fallback.source, "existing_company_default");
});

check("PDF cover uses saved quote validityDays", () => {
  const rendered = compileThreePageQuotationHtml(
    {
      id: "q-valid",
      clientName: "Validity Client",
      validityDays: 7,
      boqItems: [{ id: "p", type: "item", name: "Panel", qty: 1, rate: 1, total: 1 }],
    },
    { id: "lead-v", name: "Validity Client" },
    { companyTerms: [{ termText: "Quotation validity: 3 days from date of issuance." }] }
  );
  assert.equal(rendered.validityDays, 7);
  assert.match(rendered.html, /7 days/);
});

check("new L3/L2 kit rows are not the old per-panel structure_std SKU", () => {
  const rec = generateRecommendedBoq({
    systemSizeKw: 5.8,
    panelWattage: 580,
    panelBrand: "Jinko",
    systemType: "Hybrid",
  });
  const l3 = rec.rows.find((r) => r.id === "structure_l3_row");
  const l2 = rec.rows.find((r) => r.id === "structure_l2_row");
  assert.ok(l3);
  assert.ok(l2);
  assert.equal(l3?.name, L3_STRUCTURE_CUSTOMER_NAME);
  assert.equal(l2?.name, L2_STRUCTURE_CUSTOMER_NAME);
  assert.equal(l3?.quoteLineKind, QUOTE_STRUCTURE_KIT_LINE_KIND);
  assert.equal(l3?.catalogProductId, "");
  assert.equal(l3?.unit, "Section");
  assert.equal(isQuoteStructureKitRow(l3), true);
  assert.equal(isLegacyPerPanelStructureSku(l3 as any), false);
  assert.equal(
    isLegacyPerPanelStructureSku({
      id: LEGACY_PER_PANEL_STRUCTURE_PRODUCT_ID,
      catalogProductId: LEGACY_PER_PANEL_STRUCTURE_PRODUCT_ID,
      name: "Standard GI Structure L3",
      rate: 4800,
    }),
    true
  );
});

check("On-grid AutoSizer does not auto-add a hybrid battery", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 8, systemType: "On-grid" });
  assert.equal(recommendedBatteryOption("On-grid", "Lithium Battery Pack 5.12kWh"), "None");
  assert.equal(rec.preset.battery.option, "None");
  assert.equal(rec.rows.find((r) => r.id === "battery_row"), undefined);
});

check("8 kW Hybrid typed default remains 5.12 kWh from package library", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 8, systemType: "Hybrid" });
  assert.match(rec.preset.battery.option, /5\.12/);
  assert.match(String(AUTOSIZER_PRESETS[8].battery.option), /5\.12/);
});

check("saved admin preset overlays typed 8 kW battery with 10.24", () => {
  const rec = generateRecommendedBoq({
    systemSizeKw: 8,
    systemType: "Hybrid",
    settings: { autoSizerPresets: { "8": { batteryOption: "Lithium Battery Pack 10.24kWh" } } },
  });
  assert.match(rec.preset.battery.option, /10\.24/);
});

check("malformed admin AutoSizer settings fall back to typed preset", () => {
  assert.deepEqual(parseCompanyAutoSizerPresets({ autoSizerPresets: "nope" }), {});
  assert.deepEqual(parseCompanyAutoSizerPresets(null), {});
  const rec = generateRecommendedBoq({
    systemSizeKw: 8,
    systemType: "Hybrid",
    settings: { autoSizerPresets: ["bad"] },
  });
  assert.match(rec.preset.battery.option, /5\.12/);
});

check("manual battery and cable overrides stay on the snapshot", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 8, systemType: "Hybrid" });
  let overrides = markOverride({}, "battery");
  overrides = markOverride(overrides, "cables");
  const withBatt = applyNamedRowFields(rec.rows, "battery_row", { name: "Lithium Battery Pack 10.24kWh" });
  const withCable = applyNamedRowFields(withBatt, "dc_cable_row", { qty: 999 });
  assert.equal(isOverridden(overrides, "battery"), true);
  assert.equal(shouldRegenerateField(overrides, "battery", false), false);
  assert.equal(withCable.find((r) => r.id === "battery_row")?.name, "Lithium Battery Pack 10.24kWh");
  assert.equal(withCable.find((r) => r.id === "dc_cable_row")?.qty, 999);
});

check("BOQ overflow blocks final export but still lists every priced row in 3 pages", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    id: `overflow-${i}`,
    type: "item",
    name: `Overflow line ${i}`,
    description: "A deliberately long description so the compact weight budget is exceeded on purpose.",
    brand: "Test",
    unit: "Pcs",
    qty: 1,
    rate: 100,
    total: 100,
  }));
  const fit = quoteBoqOverflow(items as any);
  assert.equal(fit.overflow, true);
  assert.equal(fit.itemCount, 40);
  const rendered = compileThreePageQuotationHtml(
    { id: "q-overflow", clientName: "Overflow Client", boqRows: items, grandTotal: 4000 },
    { id: "lead-ov", name: "Overflow Client" },
    { companyTerms: [{ termText: "Quotation validity: 3 days from date of issuance." }] }
  );
  assert.equal(rendered.exportBlocked, true);
  assert.equal(rendered.boqOverflow, true);
  assert.equal(rendered.pageCount, 3);
  assert.equal((rendered.html.match(/class="page /g) || []).length, 3);
  assert.match(rendered.html, new RegExp(THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(rendered.html, new RegExp(THREE_PAGE_BOQ_OVERFLOW_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(rendered.html, /Overflow line 0/);
  assert.match(rendered.html, /Overflow line 39/);
  assert.match(rendered.html, /data-sunchaser-export-blocked="true"/);
  assert.doesNotMatch(rendered.html, /class="page page-4"/);
});

check("terms overflow does not truncate clauses and still stays 3 pages", () => {
  const terms = Array.from({ length: 20 }, (_, i) => `Legal clause ${i} ${"wording ".repeat(30)}`);
  const fit = quoteTermsOverflow(terms);
  assert.equal(fit.overflow, true);
  const rendered = compileThreePageQuotationHtml(
    { id: "q-terms", clientName: "Terms Client", boqRows: [{ id: "p", type: "item", name: "Panel", qty: 1, rate: 1, total: 1 }] },
    { id: "lead-t", name: "Terms Client" },
    { companyTerms: terms.map((termText, i) => ({ id: `t-${i}`, termText })) }
  );
  assert.equal(rendered.termsOverflow, true);
  assert.equal(rendered.exportBlocked, true);
  assert.equal(rendered.pageCount, 3);
  assert.match(rendered.html, /Legal clause 0/);
  assert.match(rendered.html, /Legal clause 19/);
});

check("saved quote terms beat newer company terms", () => {
  const rendered = compileThreePageQuotationHtml(
    {
      id: "q-old-terms",
      clientName: "Snapshot Client",
      termsAndConditions: "OLD TERM",
      boqItems: [{ id: "p", type: "item", name: "Panel", qty: 1, rate: 1, total: 1 }],
    },
    { id: "lead-snap", name: "Snapshot Client" },
    { companyTerms: [{ termText: "NEW TERM" }] }
  );
  assert.match(rendered.html, /OLD TERM/);
  assert.doesNotMatch(rendered.html, /NEW TERM/);
  const clauses = resolveQuoteTermsClauses(
    { termsAndConditions: "OLD TERM" },
    { companyTerms: [{ termText: "NEW TERM" }] }
  );
  assert.deepEqual(clauses, ["OLD TERM"]);
});

check("unauthorized staff cannot change AutoSizer presets", () => {
  const denied = [
    "Sales Executive",
    "Sales Advisor",
    "Sales Manager",
    "Accounts Manager",
    "Technician",
    "Survey Engineer",
    "Installation Team",
    "Customer",
    "Service Technician",
  ];
  for (const role of denied) {
    assert.equal(canManageAutoSizerPresets("staff", role), false, role);
    const auth = authorizeAutoSizerPresetsAccess({ username: "staff", role });
    assert.equal(auth.ok, false, role);
    if (!auth.ok) assert.equal(auth.status, 403, role);
  }
  const missing = authorizeAutoSizerPresetsAccess(null);
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.status, 401);
});

check("authorized admin can change AutoSizer presets", () => {
  for (const role of ["Super Admin", "Admin", "Director", "Technical CEO"]) {
    assert.equal(canManageAutoSizerPresets("owner", role), true, role);
    assert.equal(authorizeAutoSizerPresetsAccess({ username: "owner", role }).ok, true, role);
  }
});

check("AutoSizer preset save preserves unrelated latest server settings", () => {
  const latest = {
    companyName: "Sunchaser",
    someOtherSetting: "NEW VALUE",
    officeAddress: "DHA Phase 6",
  };
  const staleClient = {
    companyName: "Sunchaser",
    someOtherSetting: "OLD VALUE",
    autoSizerPresets: {
      "8": { panelProductId: "panel-live-1", batteryOption: "Lithium Battery Pack 10.24kWh" },
    },
  };
  const next = patchLatestSettingsWithAutoSizerPresets(latest, staleClient);
  assert.equal(next.companyName, "Sunchaser");
  assert.equal(next.someOtherSetting, "NEW VALUE");
  assert.equal(next.officeAddress, "DHA Phase 6");
  assert.equal(next.autoSizerPresets[8].panelProductId, "panel-live-1");
  assert.match(String(next.autoSizerPresets[8].batteryOption), /10\.24/);
});

const CATALOG = [
  { id: "panel-live-1", brand: "Longi", name: "Hi-MO 575W", category: "Solar Panels", wattageCapacity: "575W", price: 99 },
  { id: "inv-live-1", brand: "Goodwe", name: "GW8K", category: "Inverters", wattageCapacity: "8kW", price: 12 },
  { id: "batt-live-1", brand: "Soluna", name: "EOS 5.12", category: "Batteries", wattageCapacity: "5.12kWh", price: 7 },
  { id: "dc-live-1", brand: "Kehua", name: "DC 6mm", category: "Cables", model: "6mm DC", price: 3 },
  { id: "ac-live-1", brand: "Kehua", name: "AC 4-Core", category: "Cables", model: "4-Core AC", price: 4 },
];

check("selected panel/inverter/battery/DC/AC catalog IDs survive into generated rows", () => {
  const rec = generateRecommendedBoq({
    systemSizeKw: 8,
    systemType: "Hybrid",
    products: CATALOG,
    settings: {
      autoSizerPresets: {
        "8": {
          panelProductId: "panel-live-1",
          inverterProductId: "inv-live-1",
          batteryProductId: "batt-live-1",
          dcCableProductId: "dc-live-1",
          acCableProductId: "ac-live-1",
        },
      },
    },
  });
  assert.equal(rec.rows.find((r) => r.id === "panel_row")?.catalogProductId, "panel-live-1");
  assert.equal(rec.rows.find((r) => r.id === "inverter_row")?.catalogProductId, "inv-live-1");
  assert.equal(rec.rows.find((r) => r.id === "battery_row")?.catalogProductId, "batt-live-1");
  assert.equal(rec.rows.find((r) => r.id === "dc_cable_row")?.catalogProductId, "dc-live-1");
  assert.equal(rec.rows.find((r) => r.id === "ac_cable_row")?.catalogProductId, "ac-live-1");
});

check("catalog price does not override AutoSizer commercial rates", () => {
  const rec = generateRecommendedBoq({
    systemSizeKw: 8,
    systemType: "Hybrid",
    products: CATALOG,
    settings: {
      autoSizerPresets: {
        "8": { panelProductId: "panel-live-1", inverterProductId: "inv-live-1", batteryProductId: "batt-live-1" },
      },
    },
  });
  const panel = rec.rows.find((r) => r.id === "panel_row");
  const inverter = rec.rows.find((r) => r.id === "inverter_row");
  const battery = rec.rows.find((r) => r.id === "battery_row");
  assert.equal(panel?.catalogProductId, "panel-live-1");
  assert.equal(panel?.rate, 25215);
  assert.notEqual(panel?.rate, 99);
  assert.equal(inverter?.rate, 400000);
  assert.notEqual(inverter?.rate, 12);
  assert.equal(battery?.rate, 235000);
  assert.notEqual(battery?.rate, 7);
});

check("missing catalog product ID is not fabricated", () => {
  assert.equal(liveCatalogProductId(CATALOG, "ghost-panel"), "");
  assert.equal(liveCatalogProductId(undefined, "panel-live-1"), "");
  const rec = generateRecommendedBoq({
    systemSizeKw: 8,
    systemType: "Hybrid",
    products: CATALOG,
    settings: {
      autoSizerPresets: {
        "8": { panelProductId: "ghost-panel", inverterProductId: "ghost-inv" },
      },
    },
  });
  assert.equal(rec.rows.find((r) => r.id === "panel_row")?.catalogProductId, "");
  assert.equal(rec.rows.find((r) => r.id === "inverter_row")?.catalogProductId, "");
});

check("catalog battery preset reload prefers live product id over derived option text", () => {
  const products = [{ id: "batt-live-1", brand: "Soluna", name: "EOS 5.12", category: "Batteries" }];
  assert.equal(
    batteryPresetSelectValue(
      { batteryProductId: "batt-live-1", batteryOption: "Lithium Battery Pack 5.12kWh" },
      products
    ),
    "product:batt-live-1"
  );
  assert.equal(
    batteryPresetSelectValue({ batteryOption: "Lithium Battery Pack 5.12kWh" }, products),
    "Lithium Battery Pack 5.12kWh"
  );
  assert.equal(
    batteryPresetSelectValue({ batteryProductId: "ghost", batteryOption: "None" }, products),
    "None"
  );
});

check("missing systemType does not render as Hybrid", () => {
  assert.equal(resolveDisplayedSystemType({ id: "q-old" }, { systemType: "Not specified" }), "");
  const rendered = compileThreePageQuotationHtml(
    {
      id: "q-unknown-type",
      clientName: "Historical Client",
      systemSizekW: 10,
      boqItems: [{ id: "p", type: "item", name: "Panel", qty: 1, rate: 1, total: 1 }],
    },
    { id: "lead-hist", name: "Historical Client" },
    { companyTerms: [{ termText: "Quotation validity: 3 days from date of issuance." }] }
  );
  assert.doesNotMatch(rendered.html, /Hybrid/);
  assert.doesNotMatch(rendered.html, /Not specified Solar Power System/);
  assert.match(rendered.html, /Solar Power System/);
  assert.equal(rendered.pageCount, 3);
});

check("catalog-length AutoSizer BOQ consolidates to 3 pages without blocking export", () => {
  const rec = generateRecommendedBoq({
    systemSizeKw: 5.8,
    panelWattage: 580,
    panelBrand: "Jinko",
    systemType: "Hybrid",
  });
  assert.equal(rec.structure.l3, 2);
  assert.equal(rec.structure.l2, 2);
  const longSpec =
    "Approved live website catalog specification with wattage, model family, conductor size and enclosure rating.";
  const padded = rec.rows.map((row) =>
    row.type === "item" ? { ...row, description: `${row.description || "Item"} — ${longSpec}` } : row
  );
  const originalFit = quoteBoqOverflow(padded as any);
  assert.equal(originalFit.overflow, true);
  const snapshot = JSON.parse(JSON.stringify(padded));
  const rendered = compileThreePageQuotationHtml(
    {
      id: "q-consolidate",
      quote_type: "auto_sizer",
      clientName: "Consolidate Client",
      systemSizekW: 5.8,
      systemType: "Hybrid",
      panelCount: 10,
      boqRows: padded,
      grandTotal: rec.subtotal,
    },
    { id: "lead-con", name: "Consolidate Client" },
    { companyTerms: [{ termText: "Quotation validity: 3 days from date of issuance." }] }
  );
  assert.equal(rendered.pageCount, THREE_PAGE_QUOTATION_PAGE_COUNT);
  assert.equal(rendered.exportBlocked, false);
  assert.equal(rendered.boqOverflow, false);
  assert.equal(rendered.customerBoqConsolidated, true);
  assert.match(rendered.html, /Standard Mounting Structure/);
  assert.match(rendered.html, /2 × L3/);
  assert.match(rendered.html, /2 × L2/);
  assert.doesNotMatch(rendered.html, /sunchaserDownloadPdf/);
  assert.deepEqual(padded, snapshot);
  assert.equal(padded.filter((r) => r.id === "structure_l3_row" || r.id === "structure_l2_row").length, 2);
});

console.log(`\nAutoSizer / 3-page quotation tests: ${pass} passed`);
