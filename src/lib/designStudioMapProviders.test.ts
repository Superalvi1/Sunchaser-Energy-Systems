/**
 * Map / Satellite Input V1 — provider-ready location layer tests.
 * No fake geocoding/satellite. Default providers unavailable.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAP_PROVIDER_NOT_CONNECTED,
  UPLOAD_OR_CONNECT_MAP_LABEL,
  INVALID_PROVIDER_COORDINATES,
  UnavailableGeocodingProvider,
  UnavailableSatelliteImageProvider,
  applyLocatePropertyResultToDraft,
  getGeocodingProvider,
  getSatelliteImageProvider,
  isSatelliteProviderConfigured,
  locateProperty,
  resetMapProvidersToUnavailable,
  setGeocodingProviderForTests,
  validateProviderCoordinates,
  type GeocodingProvider,
} from "./designStudioMapProviders.ts";
import { parseOptionalGpsAnchor } from "./roofStudioGeoReference.ts";
import {
  prefillAddressFromLead,
  DESIGN_WORKSPACE_DRAFT_ONLY_LABEL,
  canRunDesignStudioAutoLayout,
  DEFAULT_DESIGN_CONTROLS,
} from "./sunchaserDesignStudioClient.ts";
import { addPlane, createInitialRoofStudioState } from "./roofStudioClient.ts";
import { applyScaleCalibration } from "./roofStudioCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0;

function check(name: string, fn: () => boolean | Promise<boolean>) {
  return Promise.resolve()
    .then(fn)
    .then((ok) => {
      if (!ok) throw new Error(`FAIL: ${name}`);
      pass += 1;
      console.log(`  ✓ ${name}`);
    });
}

const RECT = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 240 },
  { x: 0, y: 240 },
];

function calibratedStateWithPlane() {
  let state = createInitialRoofStudioState("map-v1");
  state = addPlane(state, RECT, { pitchDeg: 15, azimuthDeg: 180 });
  const cal = applyScaleCalibration({ x: 0, y: 0 }, { x: 200, y: 0 }, "10 m");
  assert.ok(cal);
  return {
    ...state,
    metersPerUnit: cal!.metersPerUnit,
    scaleCalibration: cal!.calibration,
  };
}

async function main() {
  resetMapProvidersToUnavailable();

  await check("default geocoding provider is unavailable", () => {
    const p = getGeocodingProvider();
    return p instanceof UnavailableGeocodingProvider && p.configured === false;
  });

  await check("default satellite provider is unavailable", () => {
    const p = getSatelliteImageProvider();
    return p instanceof UnavailableSatelliteImageProvider && p.configured === false && !isSatelliteProviderConfigured();
  });

  await check("Locate Property without provider shows Map provider not connected yet", async () => {
    const result = await locateProperty("12 Gulberg Lahore");
    return (
      result.ok === false &&
      result.code === "MAP_PROVIDER_NOT_CONNECTED" &&
      result.message === MAP_PROVIDER_NOT_CONNECTED
    );
  });

  await check("Locate Property empty address fails closed", async () => {
    const result = await locateProperty("   ");
    return result.ok === false && result.code === "EMPTY_ADDRESS";
  });

  await check("unavailable geocoding never invents coordinates", async () => {
    const provider = new UnavailableGeocodingProvider();
    let threw = false;
    try {
      await provider.geocode({ address: "Anywhere" });
    } catch (e) {
      threw = e instanceof Error && e.message === MAP_PROVIDER_NOT_CONNECTED;
    }
    return threw;
  });

  await check("unavailable satellite never invents imagery", async () => {
    const provider = new UnavailableSatelliteImageProvider();
    let threw = false;
    try {
      await provider.fetchImage({ latitude: 31.5, longitude: 74.3 });
    } catch (e) {
      threw = e instanceof Error && e.message === MAP_PROVIDER_NOT_CONNECTED;
    }
    return threw;
  });

  await check("configured provider can return geocode (test hook only)", async () => {
    const mock: GeocodingProvider = {
      id: "test-mock",
      configured: true,
      async geocode() {
        return { latitude: 31.52, longitude: 74.35, provider: "test-mock" };
      },
    };
    setGeocodingProviderForTests(mock);
    const result = await locateProperty("12 Gulberg");
    resetMapProvidersToUnavailable();
    return result.ok === true && result.result.latitude === 31.52 && result.result.longitude === 74.35;
  });

  async function locateWithCoords(latitude: unknown, longitude: unknown) {
    setGeocodingProviderForTests({
      id: "bad-coords",
      configured: true,
      async geocode() {
        return { latitude, longitude, provider: "bad-coords" } as never;
      },
    });
    const result = await locateProperty("Somewhere");
    resetMapProvidersToUnavailable();
    return result;
  }

  await check("provider latitude Infinity fails closed", async () => {
    const result = await locateWithCoords(Infinity, 74);
    return result.ok === false && result.code === INVALID_PROVIDER_COORDINATES;
  });

  await check("provider latitude NaN fails closed", async () => {
    const result = await locateWithCoords(NaN, 74);
    return result.ok === false && result.code === INVALID_PROVIDER_COORDINATES;
  });

  await check("provider latitude 91 fails closed", async () => {
    const result = await locateWithCoords(91, 74);
    return result.ok === false && result.code === INVALID_PROVIDER_COORDINATES;
  });

  await check("provider latitude -91 fails closed", async () => {
    const result = await locateWithCoords(-91, 74);
    return result.ok === false && result.code === INVALID_PROVIDER_COORDINATES;
  });

  await check("provider longitude Infinity fails closed", async () => {
    const result = await locateWithCoords(31, Infinity);
    return result.ok === false && result.code === INVALID_PROVIDER_COORDINATES;
  });

  await check("provider longitude NaN fails closed", async () => {
    const result = await locateWithCoords(31, NaN);
    return result.ok === false && result.code === INVALID_PROVIDER_COORDINATES;
  });

  await check("provider longitude 181 fails closed", async () => {
    const result = await locateWithCoords(31, 181);
    return result.ok === false && result.code === INVALID_PROVIDER_COORDINATES;
  });

  await check("provider longitude -181 fails closed", async () => {
    const result = await locateWithCoords(31, -181);
    return result.ok === false && result.code === INVALID_PROVIDER_COORDINATES;
  });

  await check("provider string coordinates fail closed", async () => {
    const a = await locateWithCoords("31.5", "74.3");
    const b = await locateWithCoords(31.5, "74.3");
    const c = await locateWithCoords("31.5", 74.3);
    const d = await locateWithCoords(null, 74);
    const e = await locateWithCoords(31, undefined);
    return (
      a.ok === false &&
      a.code === INVALID_PROVIDER_COORDINATES &&
      b.ok === false &&
      c.ok === false &&
      d.ok === false &&
      e.ok === false &&
      validateProviderCoordinates("31", 74).ok === false
    );
  });

  await check("invalid provider coordinates do not update draft location", async () => {
    const draft = { latText: "31.52", lngText: "74.35" };
    const bad = await locateWithCoords(Infinity, 74);
    const next = applyLocatePropertyResultToDraft(draft, bad);
    return (
      bad.ok === false &&
      bad.code === INVALID_PROVIDER_COORDINATES &&
      next.latText === "31.52" &&
      next.lngText === "74.35"
    );
  });

  await check("valid provider coordinates still work", async () => {
    const draft = { latText: "", lngText: "" };
    setGeocodingProviderForTests({
      id: "good",
      configured: true,
      async geocode() {
        return { latitude: 31.5204, longitude: 74.3587, provider: "good" };
      },
    });
    const result = await locateProperty("Lahore");
    resetMapProvidersToUnavailable();
    const next = applyLocatePropertyResultToDraft(draft, result);
    return (
      result.ok === true &&
      result.result.latitude === 31.5204 &&
      result.result.longitude === 74.3587 &&
      next.latText === "31.5204" &&
      next.lngText === "74.3587"
    );
  });

  await check("invalid latitude fails closed", () => {
    const r = parseOptionalGpsAnchor("95", "74");
    return r.ok === false && r.error.includes("Latitude");
  });

  await check("invalid longitude fails closed", () => {
    const r = parseOptionalGpsAnchor("31", "181");
    return r.ok === false && r.error.includes("Longitude");
  });

  await check("lead address prefills location section helper", () => {
    return prefillAddressFromLead({ address: "12 Gulberg Lahore" }) === "12 Gulberg Lahore";
  });

  await check("Property Location section exists in left panel", () => {
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    return (
      left.includes('title="Property Location"') &&
      left.includes("property-location-address") &&
      left.includes("property-location-lat") &&
      left.includes("property-location-lng") &&
      left.includes("property-location-locate") &&
      left.includes("Locate Property") &&
      left.includes("DESIGN_WORKSPACE_DRAFT_ONLY_LABEL") &&
      DESIGN_WORKSPACE_DRAFT_ONLY_LABEL === "Draft only — not saved to CRM."
    );
  });

  await check("address edits are draft-only and do not call CRM update", () => {
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
    const studio = readFileSync(resolve(here, "../components/roofStudio/SunchaserDesignStudio.tsx"), "utf8");
    const providers = readFileSync(resolve(here, "designStudioMapProviders.ts"), "utf8");
    const forbidden = ["onUpdateLead", "persistAddress", "apiFetch", "saveQuote", "createQuote", "localStorage.setItem"];
    return forbidden.every(
      (t) => !left.includes(t) && !workspace.includes(t) && !studio.includes(t) && !providers.includes(t)
    );
  });

  await check("canvas empty state has no fake satellite image", () => {
    const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
    const studio = readFileSync(resolve(here, "../components/roofStudio/SunchaserDesignStudio.tsx"), "utf8");
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    const noFakeTiles =
      !workspace.includes("maps.googleapis.com") &&
      !studio.includes("maps.googleapis.com") &&
      !left.includes("maps.googleapis.com") &&
      !workspace.includes("tile.openstreetmap") &&
      !studio.includes("fake-satellite") &&
      !workspace.includes("fake-satellite");
    return (
      workspace.includes("UPLOAD_OR_CONNECT_MAP_LABEL") &&
      studio.includes("UPLOAD_OR_CONNECT_MAP_LABEL") &&
      workspace.includes("property-location-map-placeholder") &&
      studio.includes("property-location-map-placeholder") &&
      workspace.includes("Use Uploaded Image") &&
      studio.includes("Use Uploaded Image") &&
      UPLOAD_OR_CONNECT_MAP_LABEL === "Upload roof image or connect map provider" &&
      noFakeTiles
    );
  });

  await check("uploaded image path still wired as roof base layer", () => {
    const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    return (
      workspace.includes("openImagePicker") &&
      left.includes("Upload image") &&
      left.includes("onUploadImage")
    );
  });

  await check("Auto Layout still disabled until calibration + valid roof", () => {
    const uncalibrated = addPlane(createInitialRoofStudioState(), RECT);
    const gate = canRunDesignStudioAutoLayout({
      hasImage: true,
      calibrated: false,
      state: uncalibrated,
      controls: DEFAULT_DESIGN_CONTROLS,
    });
    const okGate = canRunDesignStudioAutoLayout({
      hasImage: true,
      calibrated: true,
      state: calibratedStateWithPlane(),
      controls: DEFAULT_DESIGN_CONTROLS,
    });
    return !gate.ok && okGate.ok;
  });

  await check("map providers module has no API/save/AI/PDF/localStorage calls", () => {
    const providers = readFileSync(resolve(here, "designStudioMapProviders.ts"), "utf8");
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    const forbidden = ["fetch(", "axios", "openai", "anthropic", "localStorage.setItem", "localStorage.getItem", "jspdf", "saveQuote"];
    return forbidden.every((t) => !providers.includes(t) && !left.includes(t));
  });

  await check("Locate Property UI wires locateProperty helper", () => {
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
    const studio = readFileSync(resolve(here, "../components/roofStudio/SunchaserDesignStudio.tsx"), "utf8");
    return (
      left.includes("locateProperty") &&
      left.includes("MAP_PROVIDER_NOT_CONNECTED") &&
      left.includes("onLocateResult") &&
      workspace.includes("applyLocatePropertyResultToDraft") &&
      studio.includes("applyLocatePropertyResultToDraft")
    );
  });

  console.log(`\ndesignStudioMapProviders tests: ${pass} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
