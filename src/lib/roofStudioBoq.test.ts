/**
 * Roof Studio BOQ validation tests.
 */

import assert from "node:assert/strict";
import {
  boqGrandTotal,
  isValidBoqMargin,
  isValidBoqQty,
  isValidBoqRate,
  lineTotal,
  updateBoqLine,
  type EditableBoqLine,
} from "./roofStudioBoq.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  const ok = fn();
  assert.ok(ok, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const baseLine: EditableBoqLine = {
  id: "b1",
  section: "PV",
  item: "Module",
  brand: "Test",
  qty: 10,
  unit: "pcs",
  rate: 1000,
  marginPercent: 10,
  overridden: false,
};

check("BOQ qty negative rejected", () => {
  const result = updateBoqLine([baseLine], "b1", { qty: -1 });
  return result.lines[0].qty === 10 && result.warning !== null;
});

check("BOQ qty NaN rejected", () => {
  const result = updateBoqLine([baseLine], "b1", { qty: Number.NaN });
  return result.lines[0].qty === 10 && result.warning !== null;
});

check("BOQ qty Infinity rejected", () => {
  const result = updateBoqLine([baseLine], "b1", { qty: Number.POSITIVE_INFINITY });
  return result.lines[0].qty === 10 && result.warning !== null;
});

check("BOQ rate negative rejected", () => {
  const result = updateBoqLine([baseLine], "b1", { rate: -50 });
  return result.lines[0].rate === 1000 && result.warning !== null;
});

check("BOQ rate NaN rejected", () => {
  const result = updateBoqLine([baseLine], "b1", { rate: Number.NaN });
  return result.lines[0].rate === 1000 && result.warning !== null;
});

check("BOQ rate Infinity rejected", () => {
  const result = updateBoqLine([baseLine], "b1", { rate: Number.NEGATIVE_INFINITY });
  return result.lines[0].rate === 1000 && result.warning !== null;
});

check("BOQ margin negative rejected", () => {
  const result = updateBoqLine([baseLine], "b1", { marginPercent: -5 });
  return result.lines[0].marginPercent === 10 && result.warning !== null;
});

check("BOQ margin Infinity rejected", () => {
  const result = updateBoqLine([baseLine], "b1", { marginPercent: Number.POSITIVE_INFINITY });
  return result.lines[0].marginPercent === 10 && result.warning !== null;
});

check("lineTotal never negative/non-finite", () => {
  const corrupt: EditableBoqLine = {
    ...baseLine,
    qty: Number.NaN,
    rate: -100,
    marginPercent: Number.POSITIVE_INFINITY,
  };
  const total = lineTotal(corrupt);
  return Number.isFinite(total) && total >= 0;
});

check("invalid BOQ edit preserves previous safe value", () => {
  const result = updateBoqLine([baseLine], "b1", { qty: -3, rate: Number.NaN, marginPercent: 500 });
  const line = result.lines[0];
  return line.qty === 10 && line.rate === 1000 && line.marginPercent === 10;
});

check("boqGrandTotal stays finite with corrupt lines", () => {
  const lines: EditableBoqLine[] = [
    baseLine,
    { ...baseLine, id: "b2", qty: Number.NaN, rate: Number.POSITIVE_INFINITY, marginPercent: -99 },
  ];
  const total = boqGrandTotal(lines);
  return Number.isFinite(total) && total >= 0 && total === lineTotal(baseLine);
});

check("validators accept safe values", () => {
  return isValidBoqQty(0) && isValidBoqRate(0) && isValidBoqMargin(0) && isValidBoqMargin(100);
});

console.log(`\nroofStudioBoq tests: ${pass} passed`);
