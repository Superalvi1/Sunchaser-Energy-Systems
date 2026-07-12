/**
 * Google Places Autocomplete V1 — address suggestions + place details.
 *
 * Enabled when VITE_ENABLE_GOOGLE_MAPS_PROVIDER=true and API key is set.
 * Never invents coordinates. Never logs or returns the API key.
 */

import {
  GEOCODING_NO_RESULTS,
  GEOCODING_PROVIDER_ERROR,
  INVALID_PROVIDER_COORDINATES,
  PROVIDER_NOT_CONFIGURED,
  MAP_PROVIDER_NOT_CONNECTED,
  UnavailablePlacesAutocompleteProvider,
  validateProviderCoordinates,
  type Location,
  type PlaceSuggestion,
  type PlacesAutocompleteProvider,
  type ProviderResult,
} from "./designStudioMapProviders.ts";
import { getMapProviderEnvResolver, setMapProviderEnvResolver } from "./mapProviderEnvBridge.ts";
import {
  GOOGLE_MAPS_API_KEY_ENV_KEY,
  GOOGLE_MAPS_ENABLE_ENV_KEY,
  isGoogleMapsProviderConfigured,
  readGoogleMapsEnvConfig,
  redactApiKey,
  type GoogleFetch,
} from "./googleMapsProvider.ts";
import "./googleMapsProvider.ts";

export const GOOGLE_PLACES_PROVIDER_ID = "google-places";
export const PLACES_AUTOCOMPLETE_MIN_INPUT = 3;
export const PLACES_AUTOCOMPLETE_MAX_SUGGESTIONS = 5;

const AUTocomplete_ENDPOINT = "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const PLACE_DETAILS_ENDPOINT = "https://maps.googleapis.com/maps/api/place/details/json";

type EnvReader = () => Record<string, string | undefined>;

let envReaderOverride: EnvReader | null = null;
let fetchOverride: GoogleFetch | null = null;

export function setGooglePlacesEnvReaderForTests(reader: EnvReader | null): void {
  envReaderOverride = reader;
}

export function setGooglePlacesFetchForTests(fetchImpl: GoogleFetch | null): void {
  fetchOverride = fetchImpl;
}

function readViteEnv(): Record<string, string | undefined> {
  if (envReaderOverride) return envReaderOverride();
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
  return env;
}

export function isGooglePlacesProviderConfigured(): boolean {
  const enabled =
    String(readViteEnv()[GOOGLE_MAPS_ENABLE_ENV_KEY] ?? "")
      .trim()
      .toLowerCase() === "true";
  const apiKey = String(readViteEnv()[GOOGLE_MAPS_API_KEY_ENV_KEY] ?? "").trim();
  return enabled && apiKey.length > 0;
}

function defaultFetch(input: string, init?: { method?: string; signal?: AbortSignal }) {
  return fetch(input, init);
}

export class GooglePlacesAutocompleteProvider implements PlacesAutocompleteProvider {
  readonly id = GOOGLE_PLACES_PROVIDER_ID;
  readonly configured = true;
  private readonly apiKey: string;
  private readonly fetchImpl: GoogleFetch;

  constructor(apiKey: string, opts?: { fetch?: GoogleFetch }) {
    this.apiKey = String(apiKey ?? "").trim();
    this.fetchImpl = opts?.fetch ?? fetchOverride ?? defaultFetch;
  }

  async getSuggestions(input: string): Promise<ProviderResult<PlaceSuggestion[]>> {
    if (!this.apiKey) {
      return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: MAP_PROVIDER_NOT_CONNECTED };
    }
    const trimmed = String(input ?? "").trim();
    if (!trimmed || trimmed.length < PLACES_AUTOCOMPLETE_MIN_INPUT) {
      return { ok: true, value: [] };
    }

    const params = new URLSearchParams({
      input: trimmed,
      key: this.apiKey,
      types: "address",
    });
    const url = `${AUTocomplete_ENDPOINT}?${params.toString()}`;

    try {
      const res = await this.fetchImpl(url);
      const body = (await res.json()) as {
        status?: string;
        predictions?: Array<{ place_id?: string; description?: string }>;
      };
      const status = body.status ?? "";
      if (!res.ok || status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT" || status === "UNKNOWN_ERROR") {
        return {
          ok: false,
          code: GEOCODING_PROVIDER_ERROR,
          message: "Provider error — autocomplete request failed.",
        };
      }
      if (status === "ZERO_RESULTS") {
        return { ok: true, value: [] };
      }
      if (status !== "OK") {
        return {
          ok: false,
          code: GEOCODING_PROVIDER_ERROR,
          message: "Provider error — unexpected autocomplete status.",
        };
      }

      const suggestions: PlaceSuggestion[] = [];
      for (const p of body.predictions ?? []) {
        const placeId = typeof p.place_id === "string" ? p.place_id.trim() : "";
        const description = typeof p.description === "string" ? p.description.trim() : "";
        if (!placeId || !description) continue;
        suggestions.push({ placeId, description, provider: "google" });
        if (suggestions.length >= PLACES_AUTOCOMPLETE_MAX_SUGGESTIONS) break;
      }
      return { ok: true, value: suggestions };
    } catch (e) {
      return {
        ok: false,
        code: GEOCODING_PROVIDER_ERROR,
        message: redactApiKey(
          e instanceof Error ? `Provider error — ${e.message}` : "Provider error — autocomplete failed."
        ),
      };
    }
  }

  async resolvePlace(placeId: string): Promise<ProviderResult<Location>> {
    if (!this.apiKey) {
      return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: MAP_PROVIDER_NOT_CONNECTED };
    }
    const id = String(placeId ?? "").trim();
    if (!id) {
      return { ok: false, code: GEOCODING_NO_RESULTS, message: "No result found for that place." };
    }

    const params = new URLSearchParams({
      place_id: id,
      fields: "geometry,formatted_address",
      key: this.apiKey,
    });
    const url = `${PLACE_DETAILS_ENDPOINT}?${params.toString()}`;

    try {
      const res = await this.fetchImpl(url);
      const body = (await res.json()) as {
        status?: string;
        result?: {
          formatted_address?: string;
          geometry?: { location?: { lat?: unknown; lng?: unknown } };
        };
      };
      const status = body.status ?? "";
      if (status === "ZERO_RESULTS" || !body.result) {
        return { ok: false, code: GEOCODING_NO_RESULTS, message: "No result found for that place." };
      }
      if (!res.ok || status !== "OK") {
        return {
          ok: false,
          code: GEOCODING_PROVIDER_ERROR,
          message: "Provider error — place details request failed.",
        };
      }

      const lat = body.result.geometry?.location?.lat;
      const lng = body.result.geometry?.location?.lng;
      const coords = validateProviderCoordinates(lat, lng);
      if (!coords.ok) {
        return { ok: false, code: INVALID_PROVIDER_COORDINATES, message: coords.message };
      }

      const formattedAddress =
        typeof body.result.formatted_address === "string" ? body.result.formatted_address.trim() : undefined;

      return {
        ok: true,
        value: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          formattedAddress,
          provider: "google",
        },
      };
    } catch (e) {
      return {
        ok: false,
        code: GEOCODING_PROVIDER_ERROR,
        message: redactApiKey(
          e instanceof Error ? `Provider error — ${e.message}` : "Provider error — place details failed."
        ),
      };
    }
  }
}

export function createGooglePlacesAutocompleteProvider(
  apiKey: string,
  opts?: { fetch?: GoogleFetch }
): GooglePlacesAutocompleteProvider {
  return new GooglePlacesAutocompleteProvider(apiKey, opts);
}

const priorResolver = getMapProviderEnvResolver();

setMapProviderEnvResolver({
  geocoding: () => priorResolver?.geocoding(),
  satellite: () => priorResolver?.satellite(),
  places: () => {
    if (!isGoogleMapsProviderConfigured()) {
      return new UnavailablePlacesAutocompleteProvider();
    }
    const { apiKey } = readGoogleMapsEnvConfig();
    return createGooglePlacesAutocompleteProvider(apiKey);
  },
});
