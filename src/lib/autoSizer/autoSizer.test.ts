/**
 * AutoSizer presets, structure kits, manual overrides, totals, snapshot safety.
 */

import assert from "node:assert/strict";
import {
  AUTOSIZER_PRESETS,
  applyNamedRowFields,
  applyStructureKitOverride,
  generateRecommendedBoq,
  isOverridden,
  markOverride,
  nearestAutoSizerPresetSize,
  recommendStructures,
  resolveAutoSizerPreset,
  shouldRegenerateField,
  snapshotHasItems,
} from "./index.ts";
import { compileThreePageQuotationHtml, THREE_PAGE_QUOTATION_PAGE_COUNT, threePageRendererId } from "../quoteThreePageRender.ts";


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
  assert.match(autoHtml.html, /data-sunchaser-page-count="3"/);
  assert.match(manualHtml.html, /data-sunchaser-page-count="3"/);
  assert.match(autoHtml.html, /Commercial Quotation/);
  assert.match(manualHtml.html, /Commercial Quotation/);
  assert.match(autoHtml.html, /Terms & Conditions/);
  assert.match(autoHtml.html, /Clause one/);
});

console.log(`\nAutoSizer / 3-page quotation tests: ${pass} passed`);
