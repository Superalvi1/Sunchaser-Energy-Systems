/**
 * Google Maps Provider V1 — unit tests (mocked fetch; no real network; no real keys).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GEOCODING_NO_RESULTS,
  GEOCODING_PROVIDER_ERROR,
  INVALID_PROVIDER_COORDINATES,
  INVALID_PROVIDER_IMAGE,
  clearMapProviderOverrides,
  getConfiguredGeocodingProvider,
  getConfiguredSatelliteImageProvider,
  getMapProviderStatusLabel,
  GOOGLE_MAPS_CONNECTED_LABEL,
  MAP_PROVIDER_NOT_CONNECTED,
  resetMapProvidersToUnavailable,
} from "./designStudioMapProviders.ts";
import {
  GOOGLE_GEOCODING_PROVIDER_ID,
  GOOGLE_MAPS_API_KEY_ENV_KEY,
  GOOGLE_MAPS_ENABLE_ENV_KEY,
  GOOGLE_SATELLITE_PROVIDER_ID,
  GoogleSatelliteImageProvider,
  buildGoogleStaticSatelliteUrl,
  createGoogleGeocodingProvider,
  isSafeGoogleStaticMapUrl,
  redactApiKey,
  setGoogleMapsEnvReaderForTests,
  validateGoogleStaticMapParams,
} from "./googleMapsProvider.ts";
import { canRunDesignStudioAutoLayout, DEFAULT_DESIGN_CONTROLS } from "./sunchaserDesignStudioClient.ts";
import { addPlane, createInitialRoofStudioState } from "./roofStudioClient.ts";

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

const FAKE_KEY = "test-key-not-real";

function mockJsonFetch(body: unknown, status = 200): typeof fetch extends never ? never : any {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

async function main() {
  resetMapProvidersToUnavailable();
  setGoogleMapsEnvReaderForTests(null);

  await check("env disabled returns unavailable provider", () => {
    clearMapProviderOverrides();
    setGoogleMapsEnvReaderForTests(() => ({
      [GOOGLE_MAPS_ENABLE_ENV_KEY]: "false",
      [GOOGLE_MAPS_API_KEY_ENV_KEY]: FAKE_KEY,
    }));
    const ok =
      getConfiguredGeocodingProvider().configured === false &&
      getConfiguredSatelliteImageProvider().configured === false;
    setGoogleMapsEnvReaderForTests(null);
    resetMapProvidersToUnavailable();
    return ok;
  });

  await check("env disabled (flag false) yields unavailable from registry", () => {
    clearMapProviderOverrides();
    setGoogleMapsEnvReaderForTests(() => ({
      [GOOGLE_MAPS_ENABLE_ENV_KEY]: "false",
      [GOOGLE_MAPS_API_KEY_ENV_KEY]: FAKE_KEY,
    }));
    const ok =
      getConfiguredGeocodingProvider().configured === false &&
      getConfiguredSatelliteImageProvider().configured === false &&
      getMapProviderStatusLabel() === MAP_PROVIDER_NOT_CONNECTED;
    setGoogleMapsEnvReaderForTests(null);
    resetMapProvidersToUnavailable();
    return ok;
  });

  await check("env enabled but key missing returns unavailable provider", () => {
    clearMapProviderOverrides();
    setGoogleMapsEnvReaderForTests(() => ({
      [GOOGLE_MAPS_ENABLE_ENV_KEY]: "true",
      [GOOGLE_MAPS_API_KEY_ENV_KEY]: "",
    }));
    const ok =
      getConfiguredGeocodingProvider().configured === false &&
      getConfiguredSatelliteImageProvider().configured === false;
    setGoogleMapsEnvReaderForTests(null);
    resetMapProvidersToUnavailable();
    return ok;
  });

  await check("env enabled with key returns Google providers", () => {
    clearMapProviderOverrides();
    setGoogleMapsEnvReaderForTests(() => ({
      [GOOGLE_MAPS_ENABLE_ENV_KEY]: "true",
      [GOOGLE_MAPS_API_KEY_ENV_KEY]: FAKE_KEY,
    }));
    const geo = getConfiguredGeocodingProvider();
    const sat = getConfiguredSatelliteImageProvider();
    const ok =
      geo.configured === true &&
      sat.configured === true &&
      geo.id === GOOGLE_GEOCODING_PROVIDER_ID &&
      sat.id === GOOGLE_SATELLITE_PROVIDER_ID &&
      getMapProviderStatusLabel() === GOOGLE_MAPS_CONNECTED_LABEL;
    setGoogleMapsEnvReaderForTests(null);
    resetMapProvidersToUnavailable();
    return ok;
  });

  await check("geocoding empty address fails closed", async () => {
    const p = createGoogleGeocodingProvider(FAKE_KEY, {
      fetch: mockJsonFetch({ status: "OK", results: [] }),
    });
    const a = await p.geocodeAddress("");
    const b = await p.geocodeAddress("ab");
    return a.ok === false && b.ok === false;
  });

  await check("geocoding no results fails closed", async () => {
    const p = createGoogleGeocodingProvider(FAKE_KEY, {
      fetch: mockJsonFetch({ status: "ZERO_RESULTS", results: [] }),
    });
    const r = await p.geocodeAddress("Nowhere Street 999");
    return r.ok === false && r.code === GEOCODING_NO_RESULTS;
  });

  await check("geocoding provider error fails closed", async () => {
    const p = createGoogleGeocodingProvider(FAKE_KEY, {
      fetch: mockJsonFetch({ status: "REQUEST_DENIED", error_message: "denied" }),
    });
    const r = await p.geocodeAddress("12 Gulberg Lahore");
    return r.ok === false && r.code === GEOCODING_PROVIDER_ERROR && !JSON.stringify(r).includes(FAKE_KEY);
  });

  await check("geocoding invalid provider coordinates fails closed", async () => {
    const p = createGoogleGeocodingProvider(FAKE_KEY, {
      fetch: mockJsonFetch({
        status: "OK",
        results: [
          {
            formatted_address: "Bad",
            geometry: { location: { lat: 999, lng: 74 }, location_type: "ROOFTOP" },
          },
        ],
      }),
    });
    const r = await p.geocodeAddress("Somewhere");
    return r.ok === false && r.code === INVALID_PROVIDER_COORDINATES;
  });

  await check("geocoding valid response works", async () => {
    const p = createGoogleGeocodingProvider(FAKE_KEY, {
      fetch: mockJsonFetch({
        status: "OK",
        results: [
          {
            formatted_address: "12 Gulberg, Lahore",
            geometry: { location: { lat: 31.52, lng: 74.35 }, location_type: "ROOFTOP" },
          },
        ],
      }),
    });
    const r = await p.geocodeAddress("12 Gulberg Lahore");
    return (
      r.ok === true &&
      r.value.latitude === 31.52 &&
      r.value.longitude === 74.35 &&
      r.value.formattedAddress === "12 Gulberg, Lahore" &&
      r.value.provider === "google" &&
      r.value.confidence === 1
    );
  });

  await check("satellite invalid lat/lng fails closed", async () => {
    const p = new GoogleSatelliteImageProvider(FAKE_KEY);
    const r = await p.getSatelliteImage({ latitude: 91, longitude: 74, zoom: 19 });
    return r.ok === false && r.code === INVALID_PROVIDER_COORDINATES;
  });

  await check("satellite invalid zoom fails closed", async () => {
    const p = new GoogleSatelliteImageProvider(FAKE_KEY);
    const a = await p.getSatelliteImage({ latitude: 31.5, longitude: 74.3, zoom: 10 });
    const b = await p.getSatelliteImage({ latitude: 31.5, longitude: 74.3, zoom: 25 });
    const c = validateGoogleStaticMapParams({ zoom: 15 });
    return a.ok === false && b.ok === false && c.ok === false && a.code === INVALID_PROVIDER_IMAGE;
  });

  await check("satellite invalid width/height fails closed", async () => {
    const p = new GoogleSatelliteImageProvider(FAKE_KEY);
    const a = await p.getSatelliteImage({ latitude: 31.5, longitude: 74.3, zoom: 19, width: 10, height: 640 });
    const b = await p.getSatelliteImage({ latitude: 31.5, longitude: 74.3, zoom: 19, width: 640, height: 9999 });
    return a.ok === false && b.ok === false && a.code === INVALID_PROVIDER_IMAGE;
  });

  await check("satellite URL does not expose unsafe schemes", async () => {
    const p = new GoogleSatelliteImageProvider(FAKE_KEY);
    const r = await p.getSatelliteImage({ latitude: 31.5, longitude: 74.3, zoom: 19, width: 640, height: 640 });
    assert.ok(r.ok);
    const url = r.value.imageUrl ?? "";
    return (
      url.startsWith("https://maps.googleapis.com/maps/api/staticmap") &&
      isSafeGoogleStaticMapUrl(url) &&
      !url.toLowerCase().startsWith("javascript:") &&
      !url.toLowerCase().startsWith("data:text/html") &&
      !isSafeGoogleStaticMapUrl("javascript:alert(1)") &&
      !isSafeGoogleStaticMapUrl("http://evil.example/staticmap")
    );
  });

  await check("redactApiKey never leaves key material in messages", () => {
    const raw = `error https://maps.googleapis.com/maps/api/geocode/json?address=x&key=${FAKE_KEY}`;
    const redacted = redactApiKey(raw);
    return !redacted.includes(FAKE_KEY) && redacted.includes("REDACTED");
  });

  await check("buildGoogleStaticSatelliteUrl is https satellite staticmap", () => {
    const url = buildGoogleStaticSatelliteUrl({
      latitude: 31.5,
      longitude: 74.3,
      zoom: 19,
      width: 640,
      height: 640,
      apiKey: FAKE_KEY,
    });
    return (
      isSafeGoogleStaticMapUrl(url) &&
      url.includes("maptype=satellite") &&
      !url.includes("javascript:")
    );
  });

  await check("satellite image still requires calibration before Auto Layout", async () => {
    const p = new GoogleSatelliteImageProvider(FAKE_KEY);
    const r = await p.getSatelliteImage({ latitude: 31.5, longitude: 74.3 });
    const uncalibrated = addPlane(createInitialRoofStudioState(), [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 240 },
      { x: 0, y: 240 },
    ]);
    const gate = canRunDesignStudioAutoLayout({
      hasImage: true,
      calibrated: false,
      state: uncalibrated,
      controls: DEFAULT_DESIGN_CONTROLS,
    });
    return r.ok === true && !gate.ok;
  });

  await check("uploaded image fallback still works in UI sources", () => {
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
    return left.includes("Upload image") && workspace.includes("openImagePicker") && workspace.includes("Use Uploaded Image");
  });

  await check("no CRM mutation/save/AI/PDF/localStorage in Google provider", () => {
    const src = readFileSync(resolve(here, "googleMapsProvider.ts"), "utf8");
    const forbidden = [
      "onUpdateLead",
      "saveQuote",
      "createQuote",
      "localStorage.setItem",
      "localStorage.getItem",
      "sessionStorage.setItem",
      "sessionStorage.getItem",
      "openai",
      "anthropic",
      "jspdf",
      "apiFetch",
    ];
    return forbidden.every((t) => !src.includes(t));
  });

  await check(".env.example documents Google Maps provider keys as placeholders", () => {
    const env = readFileSync(resolve(here, "../../.env.example"), "utf8");
    return (
      env.includes("VITE_ENABLE_GOOGLE_MAPS_PROVIDER=false") &&
      env.includes("VITE_GOOGLE_MAPS_API_KEY=") &&
      !env.includes("AIza")
    );
  });

  await check("UI shows Google Maps connected or not-connected status", () => {
    const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
    return left.includes("getMapProviderStatusLabel") && left.includes("GOOGLE_MAPS_CONNECTED_LABEL") === false
      ? left.includes("providerStatusLabel")
      : left.includes("getMapProviderStatusLabel");
  });

  setGoogleMapsEnvReaderForTests(null);
  resetMapProvidersToUnavailable();
  console.log(`\ngoogleMapsProvider tests: ${pass} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
