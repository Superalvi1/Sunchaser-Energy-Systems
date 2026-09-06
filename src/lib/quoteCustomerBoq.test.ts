/**
 * PDF-only customer BOQ consolidation for the standard 3-page quotation.
 * Saved snapshots must stay detailed; only the customer presentation changes.
 */

import assert from "node:assert/strict";
import {
  generateRecommendedBoq,
  recommendStructures,
} from "./autoSizer/index.ts";
import {
  quoteBoqOverflow,
} from "./quoteBoqPdf.ts";
import {
  assertCustomerBoqTotalsPreserved,
  buildCustomerFacingBoqRows,
  customerBoqTotalsPreserved,
  resolveCustomerFacingBoq,
  sumPricedBoqItems,
  THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE,
  THREE_PAGE_BOQ_TOTAL_MISMATCH_MESSAGE,
} from "./quoteCustomerBoq.ts";
import { compileThreePageQuotationHtml } from "./quoteThreePageRender.ts";
import { computeNetProposalValue, resolveQuoteDiscountAmount } from "./quoteDiscount.ts";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

const LONG_CATALOG =
  "Approved live website catalog specification with wattage, model family, conductor size, enclosure rating and finish notes for customer documentation.";

function padCatalogDescriptions<T extends { type?: string; description?: string }>(rows: T[]): T[] {
  return rows.map((row) => {
    if (String(row.type || "") !== "item") return row;
    return { ...row, description: `${row.description || "Item"} — ${LONG_CATALOG}` };
  });
}

function tenPanelHybrid() {
  return generateRecommendedBoq({
    systemSizeKw: 5.8,
    panelWattage: 580,
    panelBrand: "Jinko",
    systemType: "Hybrid",
  });
}

function quoteFromRows(id: string, clientName: string, rows: any[], extra: Record<string, unknown> = {}) {
  return {
    id,
    clientName,
    quote_type: "auto_sizer",
    systemSizekW: 5.8,
    systemType: "Hybrid",
    panelCount: 10,
    boqRows: rows,
    grandTotal: sumPricedBoqItems(rows),
    ...extra,
  };
}

const lead = { id: "lead-boq", name: "Overflow Client", phone: "0300-0000000", location: "Lahore" };
const state = { companyTerms: [{ termText: "Quotation validity: 3 days from date of issuance." }] };

check("standard AutoSizer headings/subtotals consume enough weight that catalog-length descriptions overflow", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 10, systemType: "Hybrid" });
  const ids = rec.rows.filter((r) => r.type === "item").map((r) => r.id);
  for (const required of [
    "panel_row",
    "inverter_row",
    "battery_row",
    "dc_cable_row",
    "ac_cable_row",
    "earth_wire_row",
    "db_box_row",
    "supplies_row",
    "earthing_bore_row",
    "structure_l3_row",
    "civil_work_row",
    "install_service_row",
    "freight_row",
    "net_metering_row",
    "survey_design_row",
  ]) {
    assert.ok(ids.includes(required), `missing ${required}`);
  }
  assert.ok(rec.rows.some((r) => r.type === "heading"));
  assert.ok(rec.rows.some((r) => r.type === "subtotal"));
  const originalFit = quoteBoqOverflow(rec.rows as any);
  assert.equal(originalFit.overflow, false, "short factory descriptions still fit the 3-page budget");
  const padded = padCatalogDescriptions(rec.rows);
  const paddedFit = quoteBoqOverflow(padded as any);
  assert.equal(paddedFit.overflow, true);
  assert.ok(paddedFit.weight > 36);
});

check("10-panel snapshot stays 2 × L3 + 2 × L2 internally", () => {
  const rec = tenPanelHybrid();
  assert.equal(rec.panelCount, 10);
  const expected = recommendStructures(10);
  assert.equal(expected.l3, 2);
  assert.equal(expected.l2, 2);
  assert.equal(rec.structure.l3, 2);
  assert.equal(rec.structure.l2, 2);
  const l3 = rec.rows.find((r) => r.id === "structure_l3_row");
  const l2 = rec.rows.find((r) => r.id === "structure_l2_row");
  assert.equal(l3?.qty, 2);
  assert.equal(l2?.qty, 2);
  assert.equal(rec.rows.filter((r) => r.id === "structure_l3_row" || r.id === "structure_l2_row").length, 2);
});

check("customer transform collapses Standard L2/L3 into one structure row without mutating snapshot", () => {
  const rec = tenPanelHybrid();
  const snapshot = JSON.parse(JSON.stringify(rec.rows));
  const customer = buildCustomerFacingBoqRows(rec.rows as any);
  const structure = customer.filter((r) => String(r.name) === "Standard Mounting Structure");
  assert.equal(structure.length, 1);
  assert.match(String(structure[0].description), /2 × L3/);
  assert.match(String(structure[0].description), /2 × L2/);
  const l3 = rec.rows.find((r) => r.id === "structure_l3_row")!;
  const l2 = rec.rows.find((r) => r.id === "structure_l2_row")!;
  assert.equal(Number(structure[0].total), Number(l3.total) + Number(l2.total));
  assert.deepEqual(rec.rows, snapshot);
  assert.equal(rec.rows.filter((r) => r.id === "structure_l3_row" || r.id === "structure_l2_row").length, 2);
});

check("customer totals match original priced items within 1 PKR", () => {
  const rec = tenPanelHybrid();
  const customer = buildCustomerFacingBoqRows(rec.rows as any);
  assertCustomerBoqTotalsPreserved(rec.rows as any, customer);
  assert.equal(customerBoqTotalsPreserved(rec.rows as any, customer), true);
  assert.equal(sumPricedBoqItems(customer), sumPricedBoqItems(rec.rows as any));
});

check("overflowing AutoSizer quote consolidates, stays 3 pages, and does not block export", () => {
  const rec = tenPanelHybrid();
  const padded = padCatalogDescriptions(rec.rows);
  const snapshot = JSON.parse(JSON.stringify(padded));
  const resolved = resolveCustomerFacingBoq(padded as any);
  assert.equal(resolved.originalOverflow, true);
  assert.equal(resolved.consolidated, true);
  assert.equal(resolved.blocked, false);
  assert.equal(resolved.totalsPreserved, true);
  assert.equal(resolved.originalTotal, resolved.customerTotal);
  const rendered = compileThreePageQuotationHtml(quoteFromRows("q-fit", "Fit Client", padded), lead, state);
  assert.equal(rendered.pageCount, 3);
  assert.equal(rendered.exportBlocked, false);
  assert.equal(rendered.boqOverflow, false);
  assert.equal(rendered.customerBoqConsolidated, true);
  assert.equal(rendered.originalBoqOverflow, true);
  assert.equal((rendered.html.match(/class="page /g) || []).length, 3);
  assert.match(rendered.html, /data-sunchaser-page-count="3"/);
  assert.match(rendered.html, /data-sunchaser-export-blocked="false"/);
  assert.match(rendered.html, /data-sunchaser-boq-consolidated="true"/);
  assert.match(rendered.html, /Standard Mounting Structure/);
  assert.match(rendered.html, /2 × L3/);
  assert.match(rendered.html, /2 × L2/);
  assert.doesNotMatch(rendered.html, /data-sunchaser-overflow="boq"/);
  assert.doesNotMatch(rendered.html, /This quotation still exceeds the standard 3-page customer format/);
  assert.doesNotMatch(rendered.html, /Please consolidate or group items before generating the final PDF/);
  assert.doesNotMatch(rendered.html, /class="page page-4"/);
  assert.deepEqual(padded, snapshot);
});

check("preview and download compile the same resolved customer rows", () => {
  const rec = tenPanelHybrid();
  const padded = padCatalogDescriptions(rec.rows);
  const quote = quoteFromRows("q-same", "Same Client", padded);
  const preview = compileThreePageQuotationHtml(quote, lead, state, { mode: "auto" });
  const download = compileThreePageQuotationHtml(quote, lead, state, { mode: "auto", hideActionBar: true });
  assert.equal(preview.customerBoqConsolidated, download.customerBoqConsolidated);
  assert.equal(preview.exportBlocked, download.exportBlocked);
  assert.equal(preview.itemCount, download.itemCount);
  assert.match(preview.html, /Standard Mounting Structure/);
  assert.match(download.html, /Standard Mounting Structure/);
  const previewBody = preview.html.split('class="boq-table"')[1]?.split("</table>")[0] || "";
  const downloadBody = download.html.split('class="boq-table"')[1]?.split("</table>")[0] || "";
  assert.equal(previewBody, downloadBody);
});

check("discount, tax and society charges stay on original gross after grouping", () => {
  const rec = tenPanelHybrid();
  const padded = padCatalogDescriptions(rec.rows);
  const gross = sumPricedBoqItems(padded as any);
  const discount = resolveQuoteDiscountAmount(gross, { discountType: "percentage", discountValue: 5 });
  const taxAmount = Math.round(gross * 0.05);
  const societyCharges = 15000;
  const net = computeNetProposalValue(gross, discount.discountAmount, { taxAmount, societyCharges });
  const rendered = compileThreePageQuotationHtml(
    quoteFromRows("q-commercial", "Commercial Client", padded, {
      discountType: "percentage",
      discountValue: 5,
      taxEnabled: true,
      taxRate: 5,
      taxAmount,
      societyCharges,
    }),
    lead,
    state
  );
  assert.equal(rendered.exportBlocked, false);
  assert.match(rendered.html, /Discount \(5%\)/);
  assert.match(rendered.html, /Sales Tax \(5%\)/);
  assert.match(rendered.html, /Society Approval \/ Dues/);
  const expectedNet = "Rs. " + Math.round(net).toLocaleString("en-US");
  assert.match(rendered.html, new RegExp(expectedNet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

check("On-grid AutoSizer has no battery row after grouping", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 6, systemType: "On-grid", batteryOption: "None" });
  assert.equal(rec.rows.some((r) => r.id === "battery_row"), false);
  const customer = buildCustomerFacingBoqRows(rec.rows as any);
  assert.equal(customer.some((r) => String(r.id) === "battery_row" || String(r.id) === "customer-battery"), false);
  assert.equal(customer.some((r) => /battery/i.test(String(r.name))), false);
});

check("Hybrid battery is preserved as its own customer row", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 8, systemType: "Hybrid" });
  const battery = rec.rows.find((r) => r.id === "battery_row");
  assert.ok(battery);
  const customer = buildCustomerFacingBoqRows(rec.rows as any);
  const kept = customer.find((r) => r.id === "battery_row" || r.id === "customer-battery");
  assert.ok(kept);
  assert.equal(Number(kept?.total), Number(battery?.total));
  assert.equal(String(kept?.name), String(battery?.name));
});

check("Elevated / Girder / Custom structure stay as their own job rows", () => {
  const elevated = generateRecommendedBoq({ systemSizeKw: 8, systemType: "Hybrid", structureType: "elevated" });
  const girder = generateRecommendedBoq({ systemSizeKw: 8, systemType: "Hybrid", structureType: "girder" });
  const custom = generateRecommendedBoq({ systemSizeKw: 8, systemType: "Hybrid", structureType: "custom" });
  const eCust = buildCustomerFacingBoqRows(elevated.rows as any);
  const gCust = buildCustomerFacingBoqRows(girder.rows as any);
  const cCust = buildCustomerFacingBoqRows(custom.rows as any);
  assert.ok(eCust.some((r) => /Elevated/i.test(String(r.name))));
  assert.ok(gCust.some((r) => /Girder/i.test(String(r.name))));
  assert.ok(cCust.some((r) => /Custom Mounting Structure/i.test(String(r.name))));
  assert.equal(eCust.filter((r) => String(r.name) === "Standard Mounting Structure").length, 0);
});

check("unknown manual custom rows are not merged", () => {
  const rec = tenPanelHybrid();
  const custom = {
    id: "manual-custom-balcony",
    type: "item",
    name: "Balcony safety rail",
    description: "Site-specific custom fabrication",
    unit: "Job",
    qty: 1,
    rate: 45000,
    total: 45000,
  };
  const rows = [...rec.rows, custom];
  const customer = buildCustomerFacingBoqRows(rows as any);
  const kept = customer.filter((r) => r.id === "manual-custom-balcony" || r.name === "Balcony safety rail");
  assert.equal(kept.length, 1);
  assert.equal(Number(kept[0].total), 45000);
  assert.equal(customer.filter((r) => String(r.name) === "Standard Mounting Structure").length, 1);
});

check("fitting original AutoSizer snapshot is rendered without grouping", () => {
  const rec = generateRecommendedBoq({ systemSizeKw: 6, systemType: "Hybrid" });
  const fit = quoteBoqOverflow(rec.rows as any);
  assert.equal(fit.overflow, false);
  const rendered = compileThreePageQuotationHtml(
    quoteFromRows("q-original", "Original Client", rec.rows, { systemSizekW: 6, panelCount: rec.panelCount }),
    lead,
    state
  );
  assert.equal(rendered.customerBoqConsolidated, false);
  assert.equal(rendered.exportBlocked, false);
  assert.match(rendered.html, /IMPORTED EQUIPMENT/);
  assert.match(rendered.html, /L3 Structure/);
});

check("40 unknown custom rows still overflow after grouping with the new message", () => {
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
  const resolved = resolveCustomerFacingBoq(items as any);
  assert.equal(resolved.originalOverflow, true);
  assert.equal(resolved.consolidated, true);
  assert.equal(resolved.blocked, true);
  assert.equal(resolved.message, THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE);
  const rendered = compileThreePageQuotationHtml(
    { id: "q-overflow", clientName: "Overflow Client", boqRows: items, grandTotal: 4000 },
    lead,
    state
  );
  assert.equal(rendered.exportBlocked, true);
  assert.equal(rendered.pageCount, 3);
  assert.match(rendered.html, /Overflow line 0/);
  assert.match(rendered.html, /Overflow line 39/);
  assert.match(rendered.html, new RegExp(THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(rendered.html, /class="page page-4"/);
});

check("consolidated AutoSizer customer BOQ displays sequential serial numbers with no gaps", () => {
  const rec = tenPanelHybrid();
  const snapshot = JSON.parse(JSON.stringify(rec.rows));
  const padded = padCatalogDescriptions(rec.rows);
  const resolved = resolveCustomerFacingBoq(padded as any);
  assert.equal(resolved.consolidated, true);
  assert.equal(resolved.blocked, false);
  const customerItems = resolved.rows.filter((r) => String(r.type) === "item");
  assert.ok(customerItems.length > 1);
  customerItems.forEach((row, index) => {
    assert.equal(String(row.srNo), String(index + 1));
  });
  const serials = customerItems.map((row) => Number(row.srNo));
  assert.deepEqual(serials, customerItems.map((_, i) => i + 1));
  assert.equal(new Set(serials).size, serials.length);

  const rendered = compileThreePageQuotationHtml(quoteFromRows("q-sr", "Serial Client", padded), lead, state);
  assert.equal(rendered.customerBoqConsolidated, true);
  const htmlSerials = [...rendered.html.matchAll(/<tr class="boq-item-row">[\s\S]*?<td[^>]*>([^<]*)<\/td>/g)].map(
    (match) => String(match[1]).trim()
  );
  assert.equal(htmlSerials.length, customerItems.length);
  assert.deepEqual(htmlSerials, customerItems.map((_, i) => String(i + 1)));
  assert.deepEqual(rec.rows, snapshot);
});

check("assertCustomerBoqTotalsPreserved throws on drift", () => {
  const original = [{ id: "a", type: "item", total: 1000 }];
  const drifted = [{ id: "a", type: "item", total: 900 }];
  assert.throws(() => assertCustomerBoqTotalsPreserved(original as any, drifted as any));
  assert.equal(THREE_PAGE_BOQ_TOTAL_MISMATCH_MESSAGE.includes("totals could not be verified"), true);
});

check("standard 3-page HTML still has Print only — no unauthenticated Download", () => {
  const rec = tenPanelHybrid();
  const rendered = compileThreePageQuotationHtml(quoteFromRows("q-print", "Print Client", rec.rows), lead, state);
  assert.doesNotMatch(rendered.html, /sunchaserDownloadPdf/);
  assert.doesNotMatch(rendered.html, /pathname\.replace/);
  assert.match(rendered.html, /sunchaserPrintDeck/);
});

console.log(`\ncustomer BOQ consolidation tests: ${pass} passed`);
