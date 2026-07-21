/**
 * Geo-Calibrated Roof Studio — coordinate reference tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyScaleCalibration } from "./roofStudioCalibration.ts";
import { measureDistanceM } from "./roofStudioClient.ts";
import { dimensionLabel } from "./roofStudioDimensions.ts";
import {
  canvasUnitsToGps,
  canvasUnitsToLocalMeters,
  canEnterWizardStep,
  COMPLETE_PREVIOUS_STEP_MESSAGE,
  DEFAULT_SITE_GEO,
  deriveWizardProgress,
  gpsToLocalMeters,
  isDesignWorkspaceUnlocked,
  localMetersToCanvasUnits,
  localMetersToGps,
  parseOptionalGpsAnchor,
  RoofGeoCalibrationError,
  tryApplyGpsAnchorTexts,
  validateLatitude,
  validateLongitude,
  validateNorthAzimuth,
  validateSiteGeoReference,
} from "./roofStudioGeoReference.ts";
import { requireValidScale, RoofCalibrationError } from "./roofStudioCalibration.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  const ok = fn();
  assert.ok(ok, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function throwsGeo(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof RoofGeoCalibrationError;
  }
}

const frame = {
  metersPerUnit: 0.05,
  northAzimuthDeg: 0,
  geo: { siteLabel: "Test site", latitude: 31.52, longitude: 74.35, mapZoom: 18 },
};

check("parseOptionalGpsAnchor empty fields => undefined anchor", () => {
  const r = parseOptionalGpsAnchor("", "");
  return r.ok && r.anchor === undefined;
});

check("parseOptionalGpsAnchor out-of-range latitude fails", () => {
  const r = parseOptionalGpsAnchor("95", "74");
  return !r.ok && r.error.length > 0;
});

check("parseOptionalGpsAnchor out-of-range longitude fails", () => {
  const r = parseOptionalGpsAnchor("31", "181");
  return !r.ok && r.error.length > 0;
});

check("parseOptionalGpsAnchor non-numeric latitude fails", () => {
  const r = parseOptionalGpsAnchor("abc", "74");
  return !r.ok && r.error.length > 0;
});

check("parseOptionalGpsAnchor non-numeric longitude fails", () => {
  const r = parseOptionalGpsAnchor("31", "abc");
  return !r.ok && r.error.length > 0;
});

check("parseOptionalGpsAnchor partial latitude fails", () => {
  const r = parseOptionalGpsAnchor("31", "");
  return !r.ok && r.error.length > 0;
});

check("parseOptionalGpsAnchor partial longitude fails", () => {
  const r = parseOptionalGpsAnchor("", "74");
  return !r.ok && r.error.length > 0;
});

check("parseOptionalGpsAnchor valid pair succeeds", () => {
  const r = parseOptionalGpsAnchor("31.52", "74.35");
  return r.ok && r.anchor?.latitude === 31.52 && r.anchor?.longitude === 74.35;
});

check("invalid GPS anchor update keeps previous anchor unchanged", () => {
  const geo = { siteLabel: "Site", latitude: 31, longitude: 74, mapZoom: null };
  const failed = tryApplyGpsAnchorTexts(geo, "95", "74");
  return !failed.ok && failed.geo.latitude === 31 && failed.geo.longitude === 74;
});

check("coordinates finite — latitude bounds", () => {
  return validateLatitude(31.5) && !validateLatitude(91) && !validateLatitude(Number.NaN);
});

check("coordinates finite — longitude bounds", () => {
  return validateLongitude(74.3) && !validateLongitude(181) && !validateLongitude(Number.POSITIVE_INFINITY);
});

check("north rotation valid", () => {
  return validateNorthAzimuth(0) && validateNorthAzimuth(359.9) && !validateNorthAzimuth(Number.NaN);
});

check("scale calibration valid", () => {
  const cal = applyScaleCalibration({ x: 0, y: 0 }, { x: 200, y: 0 }, "10 m");
  return cal !== null && requireValidScale(cal.metersPerUnit) === 0.05;
});

check("invalid calibration fails", () => {
  return applyScaleCalibration({ x: 0, y: 0 }, { x: 0, y: 0 }, "10 m") === null;
});

check("no fallback scale for 0/NaN/Infinity", () => {
  return [0, Number.NaN, Number.POSITIVE_INFINITY].every((s) => {
    try {
      requireValidScale(s);
      return false;
    } catch (e) {
      return e instanceof RoofCalibrationError;
    }
  });
});

check("canvas ↔ local meters reversible", () => {
  const canvas = { x: 100, y: 50 };
  const local = canvasUnitsToLocalMeters(canvas, frame);
  const back = localMetersToCanvasUnits(local, frame);
  return Math.abs(back.x - canvas.x) < 1e-6 && Math.abs(back.y - canvas.y) < 1e-6;
});

check("dimensions match calibration", () => {
  const cal = applyScaleCalibration({ x: 0, y: 0 }, { x: 200, y: 0 }, "10 m");
  if (!cal) return false;
  const dist = measureDistanceM({ x: 0, y: 0 }, { x: 200, y: 0 }, cal.metersPerUnit);
  const label = dimensionLabel(
    { id: "d1", start: { x: 0, y: 0 }, end: { x: 200, y: 0 } },
    cal.metersPerUnit
  );
  return Math.abs(dist - 10) < 0.01 && label.includes("m");
});

check("GPS anchor round-trip local meters", () => {
  const anchor = { latitude: 31.52, longitude: 74.35 };
  const local = { eastM: 12.5, northM: -8.2 };
  const gps = localMetersToGps(local, anchor);
  const back = gpsToLocalMeters(gps, anchor);
  return Math.abs(back.eastM - local.eastM) < 0.01 && Math.abs(back.northM - local.northM) < 0.01;
});

check("canvas to GPS when anchor set", () => {
  const gps = canvasUnitsToGps({ x: 0, y: 0 }, frame);
  return gps !== null && validateLatitude(gps.latitude) && validateLongitude(gps.longitude);
});

check("successful localMetersToGps always in legal bounds", () => {
  const anchor = { latitude: 31.52, longitude: 74.35 };
  const offsets = [
    { eastM: 0, northM: 0 },
    { eastM: 500, northM: -300 },
    { eastM: -1200, northM: 800 },
  ];
  return offsets.every((local) => {
    const gps = localMetersToGps(local, anchor);
    return validateLatitude(gps.latitude) && validateLongitude(gps.longitude);
  });
});

check("successful canvasUnitsToGps always in legal bounds", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 200, y: -150 },
    { x: -80, y: 300 },
  ];
  return points.every((canvas) => {
    const gps = canvasUnitsToGps(canvas, frame);
    return gps !== null && validateLatitude(gps.latitude) && validateLongitude(gps.longitude);
  });
});

check("localMetersToGps huge offset fails closed", () => {
  const anchor = { latitude: 31.52, longitude: 74.35 };
  return throwsGeo(() => localMetersToGps({ eastM: 0, northM: 20_000_000 }, anchor));
});

check("canvasUnitsToGps huge offset fails closed", () => {
  return throwsGeo(() => canvasUnitsToGps({ x: 0, y: -500_000_000 }, frame));
});

check("invalid coordinates fail closed", () => {
  return (
    validateSiteGeoReference({ siteLabel: "x", latitude: 95, longitude: 74, mapZoom: null }) !== null &&
    validateSiteGeoReference({ siteLabel: "x", latitude: 31, longitude: null, mapZoom: null }) !== null &&
    validateSiteGeoReference(DEFAULT_SITE_GEO) === null
  );
});

check("wizard progress follows upload → calibrate → draw → panels → BOQ → proposal", () => {
  const s1 = deriveWizardProgress({ hasImage: false, calibrated: false, hasCompletePlane: false, hasPanels: false });
  const s2 = deriveWizardProgress({ hasImage: true, calibrated: false, hasCompletePlane: false, hasPanels: false });
  const s3 = deriveWizardProgress({ hasImage: true, calibrated: true, hasCompletePlane: false, hasPanels: false });
  const s4 = deriveWizardProgress({ hasImage: true, calibrated: true, hasCompletePlane: true, hasPanels: false });
  const s5 = deriveWizardProgress({ hasImage: true, calibrated: true, hasCompletePlane: true, hasPanels: true, hasBoq: false });
  const s6 = deriveWizardProgress({ hasImage: true, calibrated: true, hasCompletePlane: true, hasPanels: true, hasBoq: true });
  return (
    s1.currentStep === 1 &&
    s2.currentStep === 2 &&
    s3.currentStep === 3 &&
    s4.currentStep === 4 &&
    s5.currentStep === 5 &&
    s6.currentStep === 6
  );
});

check("design unlock requires image and calibrated scale", () => {
  return (
    !isDesignWorkspaceUnlocked(false, true) &&
    !isDesignWorkspaceUnlocked(true, false) &&
    isDesignWorkspaceUnlocked(true, true)
  );
});

check("wizard step gating blocks ahead of progress", () => {
  const early = { hasImage: true, calibrated: false, hasCompletePlane: false, hasPanels: false, hasBoq: false };
  const afterCal = { hasImage: true, calibrated: true, hasCompletePlane: false, hasPanels: false, hasBoq: false };
  const afterRoof = { hasImage: true, calibrated: true, hasCompletePlane: true, hasPanels: false, hasBoq: false };
  return (
    canEnterWizardStep(1, early) &&
    canEnterWizardStep(2, early) &&
    !canEnterWizardStep(3, early) &&
    canEnterWizardStep(3, afterCal) &&
    !canEnterWizardStep(4, afterCal) &&
    canEnterWizardStep(4, afterRoof) &&
    !canEnterWizardStep(5, afterRoof) &&
    COMPLETE_PREVIOUS_STEP_MESSAGE === "Complete previous step first."
  );
});

check("geo coordinate parsing sources forbid null-out invalid patterns", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  const files = [
    join(root, "roofStudioGeoReference.ts"),
    resolve(root, "../components/roofStudio/RoofStudioMeasurementPanels.tsx"),
  ];
  const forbidden = [
    /Number\([^)]+\)\s*\|\|\s*null/,
    /parseFloat\([^)]+\)\s*\|\|\s*null/,
    /isFinite\([^)]+\)\s*\?[^:]+\s*:\s*null/,
    /parseOptionalLatitude/,
    /parseOptionalLongitude/,
    /function\s+parseOptionalLatitude/,
    /function\s+parseOptionalLongitude/,
    /latitude:\s*parseOptional/,
    /longitude:\s*parseOptional/,
  ];
  return files.every((file) => {
    const src = readFileSync(file, "utf8");
    return forbidden.every((re) => !re.test(src));
  });
});

console.log(`\nroofStudioGeoReference tests: ${pass} passed`);
