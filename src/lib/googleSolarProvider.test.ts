/**
 * Google Solar API stub tests — future-ready abstraction only.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOLAR_PROVIDER_NOT_CONNECTED,
  clearMapProviderOverrides,
  fetchSolarBuildingInsightsStub,
  getConfiguredSolarBuildingInsightsProvider,
  resetMapProvidersToUnavailable,
} from "./designStudioMapProviders.ts";
import "./googleMapsProvider.ts";
import "./googlePlacesProvider.ts";
import "./googleSolarProvider.ts";
import { GOOGLE_SOLAR_PROVIDER_ID } from "./googleSolarProvider.ts";

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

async function main() {
  clearMapProviderOverrides();

  await check("solar stub provider is registered from env chain", () => {
    const p = getConfiguredSolarBuildingInsightsProvider();
    return p.id === GOOGLE_SOLAR_PROVIDER_ID && p.configured === false;
  });

  await check("fetchSolarBuildingInsightsStub fail-closed", async () => {
    const r = await fetchSolarBuildingInsightsStub({ latitude: 31.5, longitude: 74.3 });
    return r.ok === false && r.message === SOLAR_PROVIDER_NOT_CONNECTED;
  });

  await check("googleSolarProvider has no network fetch", () => {
    const src = readFileSync(resolve(here, "googleSolarProvider.ts"), "utf8");
    return !src.includes("fetch(") && src.includes("GoogleSolarBuildingInsightsStubProvider");
  });

  console.log(`\ngoogleSolarProvider tests: ${pass} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
