/**
 * Roof Studio scale fail-closed regression tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyScaleCalibration, requireValidScale, RoofCalibrationError } from "./roofStudioCalibration.ts";
import { analyzeStudio, addPlane, createInitialRoofStudioState, measureDistanceM } from "./roofStudioClient.ts";
import { buildLayoutReportPages } from "./roofStudioReport.ts";
import { DEFAULT_PANEL_MODULE, autoFillPanelsOnPlane, hitTestPanel, panelFootprintUnits } from "./roofStudioPanels.ts";
import { memberLengthM } from "./roofStudioStructure.ts";
import { boqFromPlacements } from "./roofStudioBoq.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  const ok = fn();
  assert.ok(ok, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const rect = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 120 },
  { x: 0, y: 120 },
];

const plane = {
  id: "p1",
  name: "Roof",
  boundary: rect,
  pitchDeg: 15,
  azimuthDeg: 180,
  obstacles: [],
  walkways: [],
  parapets: [],
  ridges: [],
  valleys: [],
};

function throwsCalibration(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof RoofCalibrationError;
  }
}

for (const badScale of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
  check(`requireValidScale rejects scale ${String(badScale)}`, () => throwsCalibration(() => requireValidScale(badScale)));

  check(`panelFootprintUnits rejects scale ${String(badScale)}`, () =>
    throwsCalibration(() => panelFootprintUnits(DEFAULT_PANEL_MODULE, "portrait", badScale))
  );

  check(`autoFillPanelsOnPlane rejects scale ${String(badScale)}`, () =>
    throwsCalibration(() => autoFillPanelsOnPlane(plane, DEFAULT_PANEL_MODULE, badScale))
  );

  check(`hitTestPanel rejects scale ${String(badScale)}`, () =>
    throwsCalibration(() => hitTestPanel([], DEFAULT_PANEL_MODULE, badScale, { x: 0, y: 0 }))
  );

  check(`measureDistanceM rejects scale ${String(badScale)}`, () =>
    throwsCalibration(() => measureDistanceM({ x: 0, y: 0 }, { x: 10, y: 0 }, badScale))
  );

  check(`memberLengthM rejects scale ${String(badScale)}`, () =>
    throwsCalibration(() =>
      memberLengthM(
        { id: "s1", type: "h-beam", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, label: "H", heightM: 3 },
        badScale
      )
    )
  );

  check(`buildLayoutReportPages rejects scale ${String(badScale)}`, () =>
    throwsCalibration(() =>
      buildLayoutReportPages({
        planes: [plane],
        metersPerUnit: badScale,
        calibration: null,
        geoReference: { siteLabel: "", latitude: null, longitude: null, mapZoom: null },
        northAzimuthDeg: 0,
        dimensions: [],
        panelPlacements: [],
        panelSpec: DEFAULT_PANEL_MODULE,
        structure: { structureHeightM: 3, airPassageM: 0.6, cleaningSpaceM: 0.45, civilLabels: [], members: [] },
        boqLines: [],
      })
    )
  );
}

check("uncalibrated analyzeStudio returns no metrics/statistics for scale 0", () => {
  const state = addPlane(createInitialRoofStudioState(), rect);
  const studio = analyzeStudio(state);
  return studio.ok && studio.hasCompletePlane && studio.metrics === null && studio.statistics === null;
});

check("uncalibrated analyzeStudio returns no metrics for NaN scale", () => {
  const state = { ...addPlane(createInitialRoofStudioState(), rect), metersPerUnit: Number.NaN };
  const studio = analyzeStudio(state);
  return studio.metrics === null && studio.statistics === null;
});

check("uncalibrated analyzeStudio returns no metrics for Infinity scale", () => {
  const state = { ...addPlane(createInitialRoofStudioState(), rect), metersPerUnit: Number.POSITIVE_INFINITY };
  const studio = analyzeStudio(state);
  return studio.metrics === null && studio.statistics === null;
});

check("calibrated scale enables panel geometry", () => {
  const cal = applyScaleCalibration({ x: 0, y: 0 }, { x: 200, y: 0 }, "10 m");
  if (!cal) return false;
  const fp = panelFootprintUnits(DEFAULT_PANEL_MODULE, "portrait", cal.metersPerUnit);
  return fp.w > 0 && fp.h > 0;
});

check("boqFromPlacements works without scale (count-based draft)", () => {
  const lines = boqFromPlacements([], { structureHeightM: 3, airPassageM: 0.6, cleaningSpaceM: 0.45, civilLabels: [], members: [] }, 580);
  return Array.isArray(lines);
});

check("roof studio sources contain no hidden scale fallback patterns", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  const files = [
    join(root, "roofStudioClient.ts"),
    join(root, "roofStudioPanels.ts"),
    join(root, "roofStudioCalibration.ts"),
    join(root, "roofStudioReport.ts"),
    join(root, "roofStudioStructure.ts"),
    join(root, "roofStudioDimensions.ts"),
    join(root, "roofStudioBoq.ts"),
    resolve(root, "../components/roofStudio/RoofIntelligenceStudio.tsx"),
    resolve(root, "../components/roofStudio/RoofStudioMeasurementPanels.tsx"),
    resolve(root, "../../server/solar/roof/RoofMeasurement.ts"),
    resolve(root, "../../server/solar/roof/RoofUsableArea.ts"),
    resolve(root, "../../server/solar/roof/RoofCoordinateSystem.ts"),
    resolve(root, "../../server/solar/roof/RoofObstacle.ts"),
  ];
  const forbidden = [
    /metersPerUnit\s*>\s*0\s*\?\s*metersPerUnit\s*:\s*1/,
    /finiteNum\(metersPerUnit,\s*1\)/,
    /metersPerUnit:\s*0\.01/,
    /mpu\s*>\s*0\s*\?\s*mpu\s*:\s*1/,
  ];
  return files.every((file) => {
    const src = readFileSync(file, "utf8");
    return forbidden.every((re) => !re.test(src));
  });
});

console.log(`\nroofStudioScale tests: ${pass} passed`);
