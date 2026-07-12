/**
 * Google Places Provider V1 — mocked fetch tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearMapProviderOverrides,
  fetchAddressSuggestions,
  getConfiguredPlacesAutocompleteProvider,
  resetMapProvidersToUnavailable,
  resolvePlaceSuggestion,
  setPlacesAutocompleteProviderForTests,
} from "./designStudioMapProviders.ts";
import "./googleMapsProvider.ts";
import "./googlePlacesProvider.ts";
import {
  GOOGLE_PLACES_PROVIDER_ID,
  GooglePlacesAutocompleteProvider,
  createGooglePlacesAutocompleteProvider,
  setGooglePlacesFetchForTests,
} from "./googlePlacesProvider.ts";

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

function mockFetch(routes: Record<string, unknown>) {
  return async (url: string) => {
    const path = url.split("?")[0];
    const body = routes[path] ?? { status: "UNKNOWN_ERROR" };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

async function main() {
  resetMapProvidersToUnavailable();
  setGooglePlacesFetchForTests(null);

  await check("unconfigured places returns empty suggestions", async () => {
    const r = await fetchAddressSuggestions("12 Gulberg");
    return r.ok === true && r.value.length === 0;
  });

  await check("places autocomplete returns predictions", async () => {
    const provider = createGooglePlacesAutocompleteProvider(FAKE_KEY, {
      fetch: mockFetch({
        "https://maps.googleapis.com/maps/api/place/autocomplete/json": {
          status: "OK",
          predictions: [{ place_id: "abc123", description: "12 Gulberg, Lahore" }],
        },
      }),
    });
    const r = await provider.getSuggestions("12 Gul");
    return r.ok === true && r.value.length === 1 && r.value[0].placeId === "abc123";
  });

  await check("resolvePlace returns validated coordinates", async () => {
    const provider = createGooglePlacesAutocompleteProvider(FAKE_KEY, {
      fetch: mockFetch({
        "https://maps.googleapis.com/maps/api/place/details/json": {
          status: "OK",
          result: {
            formatted_address: "12 Gulberg, Lahore",
            geometry: { location: { lat: 31.52, lng: 74.35 } },
          },
        },
      }),
    });
    setPlacesAutocompleteProviderForTests(provider);
    const r = await resolvePlaceSuggestion("abc123");
    resetMapProvidersToUnavailable();
    return r.ok === true && r.result.latitude === 31.52 && r.result.longitude === 74.35;
  });

  await check("provider id is google-places", () => {
    const p = new GooglePlacesAutocompleteProvider(FAKE_KEY);
    return p.id === GOOGLE_PLACES_PROVIDER_ID && p.configured === true;
  });

  await check("PropertyAddressAutocomplete component exists", () => {
    const src = readFileSync(resolve(here, "../components/roofStudio/PropertyAddressAutocomplete.tsx"), "utf8");
    return src.includes("fetchAddressSuggestions") && src.includes("property-address-autocomplete");
  });

  await check("googlePlacesProvider has no localStorage or CRM calls", () => {
    const src = readFileSync(resolve(here, "googlePlacesProvider.ts"), "utf8");
    const forbidden = ["localStorage", "apiFetch", "saveQuote", "openai"];
    return forbidden.every((t) => !src.includes(t));
  });

  clearMapProviderOverrides();
  setGooglePlacesFetchForTests(null);
  resetMapProvidersToUnavailable();
  assert.ok(getConfiguredPlacesAutocompleteProvider().configured === false);
  console.log(`\ngooglePlacesProvider tests: ${pass} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
