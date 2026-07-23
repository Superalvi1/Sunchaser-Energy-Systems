/**
 * Google Maps Provider V1 — Geocoding + Static Maps satellite imagery.
 *
 * Enabled only when:
 *   VITE_ENABLE_GOOGLE_MAPS_PROVIDER=true
 *   and VITE_GOOGLE_MAPS_API_KEY is non-empty.
 *
 * Never invents coordinates or imagery. Never logs or returns the API key.
 * Draft-only. No CRM / AI / PDF / localStorage.
 */

import {
  GEOCODING_NO_RESULTS,
  GEOCODING_PROVIDER_ERROR,
  INVALID_PROVIDER_COORDINATES,
  INVALID_PROVIDER_IMAGE,
  PROVIDER_NOT_CONFIGURED,
  MAP_PROVIDER_NOT_CONNECTED,
  SATELLITE_PROVIDER_NOT_CONNECTED,
  UnavailableGeocodingProvider,
  UnavailableSatelliteImageProvider,
  validateProviderCoordinates,
  validateSatelliteImageUrl,
  type Address,
  type GeocodingProvider,
  type Location,
  type ProviderResult,
  type SatelliteImage,
  type SatelliteImageInput,
  type SatelliteImageProvider,
} from "./designStudioMapProviders.ts";
import { setMapProviderEnvResolver } from "./mapProviderEnvBridge.ts";

export const GOOGLE_MAPS_ENABLE_ENV_KEY = "VITE_ENABLE_GOOGLE_MAPS_PROVIDER";
export const GOOGLE_MAPS_API_KEY_ENV_KEY = "VITE_GOOGLE_MAPS_API_KEY";

export const GOOGLE_GEOCODING_PROVIDER_ID = "google-geocoding";
export const GOOGLE_SATELLITE_PROVIDER_ID = "google-satellite";

export const MIN_GEOCODE_ADDRESS_LENGTH = 3;
export const GOOGLE_STATIC_ZOOM_MIN = 16;
export const GOOGLE_STATIC_ZOOM_MAX = 22;
export const GOOGLE_STATIC_SIZE_MIN = 64;
export const GOOGLE_STATIC_SIZE_MAX = 640;
export const GOOGLE_STATIC_DEFAULT_ZOOM = 19;
export const GOOGLE_STATIC_DEFAULT_WIDTH = 640;
export const GOOGLE_STATIC_DEFAULT_HEIGHT = 640;

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const STATIC_MAP_ENDPOINT = "https://maps.googleapis.com/maps/api/staticmap";

export type GoogleMapsEnvConfig = {
  enabled: boolean;
  apiKey: string;
};

type EnvReader = () => Record<string, string | undefined>;

let envReaderOverride: EnvReader | null = null;

/** Test-only: inject env values without printing secrets. */
export function setGoogleMapsEnvReaderForTests(reader: EnvReader | null): void {
  envReaderOverride = reader;
}

function readViteEnv(): Record<string, string | undefined> {
  if (envReaderOverride) return envReaderOverride();
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
  return env;
}

export function readGoogleMapsEnvConfig(): GoogleMapsEnvConfig {
  const env = readViteEnv();
  const enabled = String(env[GOOGLE_MAPS_ENABLE_ENV_KEY] ?? "")
    .trim()
    .toLowerCase() === "true";
  const apiKey = String(env[GOOGLE_MAPS_API_KEY_ENV_KEY] ?? "").trim();
  return { enabled, apiKey };
}

/** True only when flag is exactly true AND key is non-empty. */
export function isGoogleMapsProviderConfigured(): boolean {
  const { enabled, apiKey } = readGoogleMapsEnvConfig();
  return enabled && apiKey.length > 0;
}

/** Redact API key query params from any string (errors, logs, tests). */
export function redactApiKey(text: string): string {
  return String(text ?? "")
    .replace(/([?&]key=)[^&]*/gi, "$1REDACTED")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "REDACTED_KEY");
}

export type GoogleFetch = (
  input: string,
  init?: { method?: string; signal?: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

function defaultFetch(input: string, init?: { method?: string; signal?: AbortSignal }) {
  return fetch(input, init);
}

export function validateGoogleStaticMapParams(input: {
  zoom?: number;
  width?: number;
  height?: number;
}):
  | { ok: true; zoom: number; width: number; height: number }
  | { ok: false; code: "INVALID_PROVIDER_IMAGE"; message: string } {
  const zoom = input.zoom === undefined ? GOOGLE_STATIC_DEFAULT_ZOOM : input.zoom;
  const width = input.width === undefined ? GOOGLE_STATIC_DEFAULT_WIDTH : input.width;
  const height = input.height === undefined ? GOOGLE_STATIC_DEFAULT_HEIGHT : input.height;

  if (
    typeof zoom !== "number" ||
    !Number.isFinite(zoom) ||
    zoom < GOOGLE_STATIC_ZOOM_MIN ||
    zoom > GOOGLE_STATIC_ZOOM_MAX ||
    !Number.isInteger(zoom)
  ) {
    return {
      ok: false,
      code: INVALID_PROVIDER_IMAGE,
      message: `Zoom must be an integer from ${GOOGLE_STATIC_ZOOM_MIN} to ${GOOGLE_STATIC_ZOOM_MAX}.`,
    };
  }
  if (
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    width < GOOGLE_STATIC_SIZE_MIN ||
    width > GOOGLE_STATIC_SIZE_MAX ||
    !Number.isInteger(width)
  ) {
    return {
      ok: false,
      code: INVALID_PROVIDER_IMAGE,
      message: `Width must be an integer from ${GOOGLE_STATIC_SIZE_MIN} to ${GOOGLE_STATIC_SIZE_MAX}.`,
    };
  }
  if (
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height < GOOGLE_STATIC_SIZE_MIN ||
    height > GOOGLE_STATIC_SIZE_MAX ||
    !Number.isInteger(height)
  ) {
    return {
      ok: false,
      code: INVALID_PROVIDER_IMAGE,
      message: `Height must be an integer from ${GOOGLE_STATIC_SIZE_MIN} to ${GOOGLE_STATIC_SIZE_MAX}.`,
    };
  }
  return { ok: true, zoom, width, height };
}

/**
 * Build Static Maps satellite URL. Caller must already validate lat/lng/zoom/size.
 * Key is embedded in the URL (Google requirement) but must never be logged.
 */
export function buildGoogleStaticSatelliteUrl(input: {
  latitude: number;
  longitude: number;
  zoom: number;
  width: number;
  height: number;
  apiKey: string;
}): string {
  const params = new URLSearchParams({
    center: `${input.latitude},${input.longitude}`,
    zoom: String(input.zoom),
    size: `${input.width}x${input.height}`,
    maptype: "satellite",
    scale: "2",
    key: input.apiKey,
  });
  return `${STATIC_MAP_ENDPOINT}?${params.toString()}`;
}

export function isSafeGoogleStaticMapUrl(url: string): boolean {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return false;
  const basic = validateSatelliteImageUrl(trimmed);
  if (!basic.ok) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "maps.googleapis.com") return false;
    if (!parsed.pathname.startsWith("/maps/api/staticmap")) return false;
    if (parsed.searchParams.get("maptype") !== "satellite") return false;
    return true;
  } catch {
    return false;
  }
}

function locationTypeConfidence(locationType: unknown): number | undefined {
  switch (locationType) {
    case "ROOFTOP":
      return 1;
    case "RANGE_INTERPOLATED":
      return 0.8;
    case "GEOMETRIC_CENTER":
      return 0.6;
    case "APPROXIMATE":
      return 0.4;
    default:
      return undefined;
  }
}

export class GoogleGeocodingProvider implements GeocodingProvider {
  readonly id = GOOGLE_GEOCODING_PROVIDER_ID;
  readonly configured = true;
  private readonly apiKey: string;
  private readonly fetchImpl: GoogleFetch;

  constructor(apiKey: string, opts?: { fetch?: GoogleFetch }) {
    this.apiKey = String(apiKey ?? "").trim();
    this.fetchImpl = opts?.fetch ?? defaultFetch;
  }

  async geocodeAddress(address: string): Promise<ProviderResult<Location>> {
    if (!this.apiKey) {
      return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: MAP_PROVIDER_NOT_CONNECTED };
    }
    const trimmed = String(address ?? "").trim();
    if (!trimmed || trimmed.length < MIN_GEOCODE_ADDRESS_LENGTH) {
      return {
        ok: false,
        code: "EMPTY_ADDRESS",
        message: `Enter an address of at least ${MIN_GEOCODE_ADDRESS_LENGTH} characters.`,
      };
    }

    const params = new URLSearchParams({ address: trimmed, key: this.apiKey });
    const url = `${GEOCODE_ENDPOINT}?${params.toString()}`;

    try {
      const res = await this.fetchImpl(url);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return {
          ok: false,
          code: GEOCODING_PROVIDER_ERROR,
          message: "Provider error — could not parse geocoding response.",
        };
      }

      const status = typeof (body as { status?: unknown })?.status === "string"
        ? (body as { status: string }).status
        : "";

      if (!res.ok || status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT" || status === "UNKNOWN_ERROR") {
        return {
          ok: false,
          code: GEOCODING_PROVIDER_ERROR,
          message: "Provider error — geocoding request failed.",
        };
      }
      if (status === "INVALID_REQUEST") {
        return {
          ok: false,
          code: GEOCODING_PROVIDER_ERROR,
          message: "Provider error — invalid geocoding request.",
        };
      }
      if (status === "ZERO_RESULTS") {
        return {
          ok: false,
          code: GEOCODING_NO_RESULTS,
          message: "No result found for that address.",
        };
      }
      if (status !== "OK") {
        return {
          ok: false,
          code: GEOCODING_PROVIDER_ERROR,
          message: "Provider error — unexpected geocoding status.",
        };
      }

      const results = (body as { results?: unknown }).results;
      if (!Array.isArray(results) || results.length === 0) {
        return {
          ok: false,
          code: GEOCODING_NO_RESULTS,
          message: "No result found for that address.",
        };
      }

      const first = results[0] as {
        formatted_address?: unknown;
        geometry?: { location?: { lat?: unknown; lng?: unknown }; location_type?: unknown };
      };
      const lat = first?.geometry?.location?.lat;
      const lng = first?.geometry?.location?.lng;
      const coords = validateProviderCoordinates(lat, lng);
      if (!coords.ok) {
        return { ok: false, code: INVALID_PROVIDER_COORDINATES, message: (coords as any).message };
      }

      const formattedAddress =
        typeof first.formatted_address === "string" ? first.formatted_address.trim() : undefined;

      return {
        ok: true,
        value: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          formattedAddress: formattedAddress || undefined,
          provider: "google",
          confidence: locationTypeConfidence(first?.geometry?.location_type),
        },
      };
    } catch (e) {
      return {
        ok: false,
        code: GEOCODING_PROVIDER_ERROR,
        message: redactApiKey(
          e instanceof Error ? `Provider error — ${e.message}` : "Provider error — geocoding failed."
        ),
      };
    }
  }

  async reverseGeocode(lat: number, lng: number): Promise<ProviderResult<Address>> {
    const coords = validateProviderCoordinates(lat, lng);
    if (!coords.ok) {
      return { ok: false, code: INVALID_PROVIDER_COORDINATES, message: (coords as any).message };
    }
    if (!this.apiKey) {
      return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: MAP_PROVIDER_NOT_CONNECTED };
    }
    const params = new URLSearchParams({
      latlng: `${coords.latitude},${coords.longitude}`,
      key: this.apiKey,
    });
    try {
      const res = await this.fetchImpl(`${GEOCODE_ENDPOINT}?${params.toString()}`);
      const body = (await res.json()) as { status?: string; results?: Array<{ formatted_address?: string }> };
      if (body.status === "ZERO_RESULTS" || !body.results?.length) {
        return { ok: false, code: GEOCODING_NO_RESULTS, message: "No result found for those coordinates." };
      }
      if (body.status !== "OK") {
        return { ok: false, code: GEOCODING_PROVIDER_ERROR, message: "Provider error — reverse geocoding failed." };
      }
      const formatted = String(body.results[0]?.formatted_address ?? "").trim();
      if (!formatted) {
        return { ok: false, code: GEOCODING_NO_RESULTS, message: "No result found for those coordinates." };
      }
      return { ok: true, value: { formattedAddress: formatted, provider: "google" } };
    } catch (e) {
      return {
        ok: false,
        code: GEOCODING_PROVIDER_ERROR,
        message: redactApiKey(
          e instanceof Error ? `Provider error — ${e.message}` : "Provider error — reverse geocoding failed."
        ),
      };
    }
  }
}

export class GoogleSatelliteImageProvider implements SatelliteImageProvider {
  readonly id = GOOGLE_SATELLITE_PROVIDER_ID;
  readonly configured = true;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = String(apiKey ?? "").trim();
  }

  async getSatelliteImage(input: SatelliteImageInput): Promise<ProviderResult<SatelliteImage>> {
    if (!this.apiKey) {
      return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: SATELLITE_PROVIDER_NOT_CONNECTED };
    }
    const coords = validateProviderCoordinates(input.latitude, input.longitude);
    if (!coords.ok) {
      return { ok: false, code: INVALID_PROVIDER_COORDINATES, message: (coords as any).message };
    }
    const size = validateGoogleStaticMapParams({
      zoom: input.zoom,
      width: input.width,
      height: input.height,
    });
    if (!size.ok) {
      return { ok: false, code: (size as any).code, message: (size as any).message };
    }

    const imageUrl = buildGoogleStaticSatelliteUrl({
      latitude: coords.latitude,
      longitude: coords.longitude,
      zoom: size.zoom,
      width: size.width,
      height: size.height,
      apiKey: this.apiKey,
    });

    if (!isSafeGoogleStaticMapUrl(imageUrl)) {
      return {
        ok: false,
        code: INVALID_PROVIDER_IMAGE,
        message: "Invalid provider response — unsafe satellite image URL.",
      };
    }

    return {
      ok: true,
      value: {
        imageUrl,
        latitude: coords.latitude,
        longitude: coords.longitude,
        zoom: size.zoom,
        provider: "google",
        attribution: "Google Maps",
      },
    };
  }
}

export function createGoogleGeocodingProvider(
  apiKey: string,
  opts?: { fetch?: GoogleFetch }
): GoogleGeocodingProvider {
  return new GoogleGeocodingProvider(apiKey, opts);
}

export function createGoogleSatelliteImageProvider(apiKey: string): GoogleSatelliteImageProvider {
  return new GoogleSatelliteImageProvider(apiKey);
}

/** Register env-backed Google providers with the shared registry (side-effect on import). */
setMapProviderEnvResolver({
  geocoding: () => {
    if (!isGoogleMapsProviderConfigured()) {
      return new UnavailableGeocodingProvider();
    }
    const { apiKey } = readGoogleMapsEnvConfig();
    return createGoogleGeocodingProvider(apiKey);
  },
  satellite: () => {
    if (!isGoogleMapsProviderConfigured()) {
      return new UnavailableSatelliteImageProvider();
    }
    const { apiKey } = readGoogleMapsEnvConfig();
    return createGoogleSatelliteImageProvider(apiKey);
  },
});
