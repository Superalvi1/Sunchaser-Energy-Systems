/**
 * Roof Studio calibration — distance parsing and scale math.
 */

import assert from "node:assert/strict";
import {
  applyScaleCalibration,
  formatFeetInches,
  isScaleCalibrated,
  isValidScale,
  metersPerUnitFromCalibration,
  parseRealWorldDistance,
  requireValidScale,
  RoofCalibrationError,
} from "./roofStudioCalibration.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  const ok = fn();
  assert.ok(ok, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check('parseRealWorldDistance parses "15 m"', () => {
  const m = parseRealWorldDistance("15 m");
  return m !== null && Math.abs(m - 15) < 1e-6;
});

check('parseRealWorldDistance parses "51 ft 9 in"', () => {
  const m = parseRealWorldDistance("51 ft 9 in");
  return m !== null && Math.abs(m - (51 * 0.3048 + 9 * 0.0254)) < 1e-4;
});

check("metersPerUnitFromCalibration converts pixel line to meters per unit", () => {
  const mpu = metersPerUnitFromCalibration({ x: 0, y: 0 }, { x: 200, y: 0 }, 10);
  return Math.abs(mpu - 0.05) < 1e-6;
});

check("applyScaleCalibration returns calibration + metersPerUnit", () => {
  const result = applyScaleCalibration({ x: 0, y: 0 }, { x: 100, y: 0 }, "5 m");
  return result !== null && result.calibration.calibrated && result.metersPerUnit === 0.05;
});

check("requireValidScale throws RoofCalibrationError for invalid scale", () => {
  try {
    requireValidScale(0);
    return false;
  } catch (e) {
    return e instanceof RoofCalibrationError && e.message === "Scale not calibrated";
  }
});

check("isValidScale matches requireValidScale acceptance", () => {
  return isValidScale(0.05) && !isValidScale(0) && !isValidScale(Number.NaN);
});

check("isScaleCalibrated requires positive metersPerUnit and calibration flag", () => {
  const result = applyScaleCalibration({ x: 0, y: 0 }, { x: 100, y: 0 }, "5 m");
  return result !== null && isScaleCalibrated(result.calibration, result.metersPerUnit) && !isScaleCalibrated(null, 0);
});

check("formatFeetInches renders feet and inches", () => {
  const label = formatFeetInches(15.77);
  return label.includes("ft") && label.includes("in");
});

console.log(`\nroofStudioCalibration tests: ${pass} passed`);
