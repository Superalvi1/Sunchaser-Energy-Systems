/**
 * Satellite Provider Adapter V1 — provider-ready layer tests.
 * No fake geocoding/satellite. Default providers unavailable.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAP_PROVIDER_NOT_CONNECTED,
  SATELLITE_PROVIDER_NOT_CONNECTED,
  UPLOAD_OR_CONNECT_MAP_LABEL,
  PROVIDER_NOT_CONFIGURED,
  INVALID_PROVIDER_COORDINATES,
  INVALID_PROVIDER_IMAGE,
  UnavailableGeocodingProvider,
  UnavailableSatelliteImageProvider,
  ManualLocationProvider,
  applyLocatePropertyResultToDraft,
  fetchSatelliteImage,
  getConfiguredGeocodingProvider,
  getConfiguredSatelliteImageProvider,
  getGeocodingProvider,
  getSatelliteImageProvider,
  hasValidManualCoordinates,
  isSatelliteProviderConfigured,
  locateProperty,
  resetMapProvidersToUnavailable,
  setGeocodingProviderForTests,
  setSatelliteImageProviderForTests,
  validateProviderCoordinates,
  validateSatelliteImageResponse,
  validateSatelliteImageUrl,
  type GeocodingProvider,
  type SatelliteImageProvider,
} from "./designStudioMapProviders.ts";
import "./googleMapsProvider.ts";
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

  await check("default geocoding provider returns PROVIDER_NOT_CONFIGURED", async () => {
    const p = getConfiguredGeocodingProvider();
    const r = await p.geocodeAddress("12 Gulberg");
    return (
      p instanceof UnavailableGeocodingProvider &&
      p.configured === false &&
      r.ok === false &&
      r.code === PROVIDER_NOT_CONFIGURED
    );
  });

  await check("default satellite provider returns PROVIDER_NOT_CONFIGURED", async () => {
    const p = getConfiguredSatelliteImageProvider();
    const r = await p.getSatelliteImage({ latitude: 31.5, longitude: 74.3 });
    return (
      p instanceof UnavailableSatelliteImageProvider &&
      p.configured === false &&
      !isSatelliteProviderConfigured() &&
      r.ok === false &&
      r.code === PROVIDER_NOT_CONFIGURED
    );
  });

  await check("Locate Property without provider shows provider-not-connected message", async () => {
    const result = await locateProperty("12 Gulberg Lahore");
    return (
      result.ok === false &&
      result.code === PROVIDER_NOT_CONFIGURED &&
      result.message === MAP_PROVIDER_NOT_CONNECTED
    );
  });

  await check("Fetch Satellite Image without provider shows provider-not-connected message", async () => {
    const result = await fetchSatelliteImage({ latitude: 31.52, longitude: 74.35 });
    return (
      result.ok === false &&
      result.code === PROVIDER_NOT_CONFIGURED &&
      result.message === SATELLITE_PROVIDER_NOT_CONNECTED
    );
  });

  await check("Locate Property empty address fails closed", async () => {
    const result = await locateProperty("   ");
    return result.ok === false && result.code === "EMPTY_ADDRESS";
  });

  await check("unavailable geocoding never invents coordinates", async () => {
    const provider = new UnavailableGeocodingProvider();
    const r = await provider.geocodeAddress("Anywhere");
    return r.ok === false && r.code === PROVIDER_NOT_CONFIGURED;
  });

  await check("unavailable satellite never invents imagery", async () => {
    const provider = new UnavailableSatelliteImageProvider();
    const r = await provider.getSatelliteImage({ latitude: 31.5, longitude: 74.3 });
    return r.ok === false && r.code === PROVIDER_NOT_CONFIGURED;
  });

  await check("manual valid lat/lng accepted", () => {
    const manual = new ManualLocationProvider();
    const r = manual.fromLatLngText("31.52", "74.35");
    return (
      r.ok === true &&
      r.value.latitude === 31.52 &&
      r.value.longitude === 74.35 &&
      hasValidManualCoordinates("31.52", "74.35")
    );
  });

  await check("invalid manual lat/lng fails closed", () => {
    const manual = new ManualLocationProvider();
    const a = manual.fromLatLngText("95", "74");
    const b = manual.fromLatLngText("31", "181");
    const c = manual.fromLatLngText("", "");
    return (
      a.ok === false &&
      b.ok === false &&
      c.ok === false &&
      !hasValidManualCoordinates("95", "74") &&
      !hasValidManualCoordinates("", "")
    );
  });

  await check("configured provider can return geocode (test hook only)", async () => {
    const mock: GeocodingProvider = {
      id: "test-mock",
      configured: true,
      async geocodeAddress() {
        return { ok: true, value: { latitude: 31.52, longitude: 74.35, provider: "test-mock" } };
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
      async geocodeAddress() {
        return { ok: true, value: { latitude, longitude, provider: "bad-coords" } as never };
      },
    });
    const result = await locateProperty("Somewhere");
    resetMapProvidersToUnavailable();
    return result;
  }

  await check("invalid provider lat/lng fails closed", async () => {
    const a = await locateWithCoords(Infinity, 74);
    const b = await locateWithCoords(91, 74);
    const c = await locateWithCoords(31, 181);
    return (
      a.ok === false &&
      a.code === INVALID_PROVIDER_COORDINATES &&
      b.ok === false &&
      c.ok === false
    );
  });

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
    return (
      a.ok === false &&
      a.code === INVALID_PROVIDER_COORDINATES &&
      validateProviderCoordinates("31", 74).ok === false
    );
  });

  await check("invalid provider coordinates do not update draft location", async () => {
    const draft = { latText: "31.52", lngText: "74.35" };
    const bad = await locateWithCoords(Infinity, 74);
    const next = applyLocatePropertyResultToDraft(draft, bad);
    return (
      bad.ok === false &&
      next.latText === "31.52" &&
      next.lngText === "74.35"
    );
  });

  await check("valid provider lat/lng works", async () => {
    const draft = { latText: "", lngText: "" };
    setGeocodingProviderForTests({
      id: "good",
      configured: true,
      async geocodeAddress() {
        return { ok: true, value: { latitude: 31.5204, longitude: 74.3587, provider: "good" } };
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

  await check("satellite button disabled without valid coordinates", () => {
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    return (
      left.includes("fetchSatelliteDisabled") &&
      left.includes("hasValidManualCoordinates") &&
      left.includes("satellite-fetch-button") &&
      left.includes("Fetch Satellite Image") &&
      !hasValidManualCoordinates("", "") &&
      !hasValidManualCoordinates("abc", "74") &&
      hasValidManualCoordinates("31.5", "74.3")
    );
  });

  await check("invalid satellite image URL fails closed", () => {
    const r = validateSatelliteImageResponse({
      latitude: 31.5,
      longitude: 74.3,
      zoom: 18,
      imageUrl: "",
      provider: "x",
    });
    return r.ok === false && r.code === INVALID_PROVIDER_IMAGE;
  });

  await check("javascript: satellite URL fails closed", () => {
    const r = validateSatelliteImageUrl("javascript:alert(1)");
    const full = validateSatelliteImageResponse({
      latitude: 31.5,
      longitude: 74.3,
      zoom: 18,
      imageUrl: "javascript:alert(1)",
    });
    return r.ok === false && full.ok === false && full.code === INVALID_PROVIDER_IMAGE;
  });

  await check("data:text/html satellite URL fails closed", () => {
    const r = validateSatelliteImageUrl("data:text/html,<script>x</script>");
    const full = validateSatelliteImageResponse({
      latitude: 31.5,
      longitude: 74.3,
      zoom: 18,
      imageUrl: "data:text/html,<h1>x</h1>",
    });
    return r.ok === false && full.ok === false && full.code === INVALID_PROVIDER_IMAGE;
  });

  await check("image data URL allowed only if image/*", () => {
    const ok = validateSatelliteImageResponse({
      latitude: 31.5,
      longitude: 74.3,
      zoom: 18,
      imageDataUrl: "data:image/png;base64,aaa",
      provider: "mock",
    });
    const bad = validateSatelliteImageResponse({
      latitude: 31.5,
      longitude: 74.3,
      zoom: 18,
      imageDataUrl: "data:application/json;base64,e30=",
    });
    return ok.ok === true && bad.ok === false && bad.code === INVALID_PROVIDER_IMAGE;
  });

  await check("invalid metersPerPixel fails closed", () => {
    const a = validateSatelliteImageResponse({
      latitude: 31.5,
      longitude: 74.3,
      zoom: 18,
      imageUrl: "https://example.com/sat.png",
      metersPerPixel: 0,
    });
    const b = validateSatelliteImageResponse({
      latitude: 31.5,
      longitude: 74.3,
      zoom: 18,
      imageUrl: "https://example.com/sat.png",
      metersPerPixel: -1,
    });
    const c = validateSatelliteImageResponse({
      latitude: 31.5,
      longitude: 74.3,
      zoom: 18,
      imageUrl: "https://example.com/sat.png",
      metersPerPixel: Infinity,
    });
    const d = validateSatelliteImageResponse({
      latitude: 31.5,
      longitude: 74.3,
      zoom: 18,
      imageUrl: "https://example.com/sat.png",
      metersPerPixel: NaN,
    });
    return a.ok === false && b.ok === false && c.ok === false && d.ok === false;
  });

  await check("fetchSatelliteImage validates provider payload", async () => {
    const bad: SatelliteImageProvider = {
      id: "bad-sat",
      configured: true,
      async getSatelliteImage() {
        return {
          ok: true,
          value: {
            latitude: 31.5,
            longitude: 74.3,
            zoom: 18,
            imageUrl: "javascript:evil",
            provider: "bad-sat",
          },
        };
      },
    };
    setSatelliteImageProviderForTests(bad);
    const result = await fetchSatelliteImage({ latitude: 31.5, longitude: 74.3 });
    resetMapProvidersToUnavailable();
    return result.ok === false && result.code === INVALID_PROVIDER_IMAGE;
  });

  await check("valid satellite fetch still requires calibration before Auto Layout", async () => {
    const good: SatelliteImageProvider = {
      id: "good-sat",
      configured: true,
      async getSatelliteImage() {
        return {
          ok: true,
          value: {
            latitude: 31.5,
            longitude: 74.3,
            zoom: 18,
            imageUrl: "https://example.com/roof.png",
            metersPerPixel: 0.25,
            provider: "good-sat",
          },
        };
      },
    };
    setSatelliteImageProviderForTests(good);
    const fetched = await fetchSatelliteImage({ latitude: 31.5, longitude: 74.3 });
    resetMapProvidersToUnavailable();
    const uncalibrated = addPlane(createInitialRoofStudioState(), RECT);
    const gate = canRunDesignStudioAutoLayout({
      hasImage: true,
      calibrated: false,
      state: uncalibrated,
      controls: DEFAULT_DESIGN_CONTROLS,
    });
    return fetched.ok === true && !gate.ok;
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
      left.includes('title="Satellite Image"') &&
      left.includes("property-location-address") &&
      left.includes("property-location-provider-status") &&
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
      UPLOAD_OR_CONNECT_MAP_LABEL === "Upload roof image or connect satellite provider" &&
      workspace.includes("Use Uploaded Image") &&
      noFakeTiles
    );
  });

  await check("uploaded image workflow still works", () => {
    const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    const studioApi = readFileSync(resolve(here, "../components/roofStudio/RoofIntelligenceStudio.tsx"), "utf8");
    return (
      workspace.includes("openImagePicker") &&
      left.includes("Upload image") &&
      left.includes("onUploadImage") &&
      studioApi.includes("setBackgroundImageFromUrl") &&
      workspace.includes("fetchSatelliteImage")
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
    const forbidden = [
      "fetch(",
      "axios",
      "openai",
      "anthropic",
      "localStorage.setItem",
      "localStorage.getItem",
      "sessionStorage",
      "jspdf",
      "saveQuote",
    ];
    return forbidden.every((t) => !providers.includes(t) && !left.includes(t));
  });

  await check("Locate Property UI wires locateProperty helper", () => {
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
    const studio = readFileSync(resolve(here, "../components/roofStudio/SunchaserDesignStudio.tsx"), "utf8");
    return (
      left.includes("locateProperty") &&
      left.includes("MAP_PROVIDER_NOT_CONNECTED") &&
      left.includes("SATELLITE_PROVIDER_NOT_CONNECTED") &&
      left.includes("onLocateResult") &&
      workspace.includes("applyLocatePropertyResultToDraft") &&
      studio.includes("applyLocatePropertyResultToDraft") &&
      getGeocodingProvider() instanceof UnavailableGeocodingProvider &&
      getSatelliteImageProvider() instanceof UnavailableSatelliteImageProvider
    );
  });

  console.log(`\ndesignStudioMapProviders tests: ${pass} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
