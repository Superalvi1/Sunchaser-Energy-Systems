/**
 * Design Studio Map / Satellite Input V1 — provider-ready location layer.
 *
 * Default providers are unavailable. No fake geocoding or satellite imagery.
 * No network calls unless a future configured adapter is wired.
 * Draft-only. No CRM / save / AI / PDF / localStorage.
 * Provider responses are untrusted — coordinates are validated before success.
 */

import { validateLatitude, validateLongitude } from "./roofStudioGeoReference.ts";

export const MAP_PROVIDER_NOT_CONNECTED = "Map provider not connected yet";
export const UPLOAD_OR_CONNECT_MAP_LABEL = "Upload roof image or connect map provider";
export const INVALID_PROVIDER_COORDINATES = "INVALID_PROVIDER_COORDINATES";
export const INVALID_PROVIDER_COORDINATES_MESSAGE =
  "Provider returned invalid coordinates. Latitude must be a finite number from -90 to 90; longitude from -180 to 180.";

export interface GeocodeRequest {
  address: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
  provider: string;
}

export interface GeocodingProvider {
  readonly id: string;
  readonly configured: boolean;
  geocode(request: GeocodeRequest): Promise<GeocodeResult>;
}

export interface SatelliteImageRequest {
  latitude: number;
  longitude: number;
  zoom?: number;
}

export interface SatelliteImageResult {
  imageUrl: string;
  provider: string;
  attribution?: string;
}

export interface SatelliteImageProvider {
  readonly id: string;
  readonly configured: boolean;
  fetchImage(request: SatelliteImageRequest): Promise<SatelliteImageResult>;
}

export class MapProviderNotConfiguredError extends Error {
  readonly code = "MAP_PROVIDER_NOT_CONNECTED" as const;
  constructor(message = MAP_PROVIDER_NOT_CONNECTED) {
    super(message);
    this.name = "MapProviderNotConfiguredError";
  }
}

/** Default geocoding adapter — always unavailable. Never invents coordinates. */
export class UnavailableGeocodingProvider implements GeocodingProvider {
  readonly id = "unavailable-geocoding";
  readonly configured = false;

  async geocode(_request: GeocodeRequest): Promise<GeocodeResult> {
    throw new MapProviderNotConfiguredError(MAP_PROVIDER_NOT_CONNECTED);
  }
}

/** Default satellite adapter — always unavailable. Never invents imagery. */
export class UnavailableSatelliteImageProvider implements SatelliteImageProvider {
  readonly id = "unavailable-satellite";
  readonly configured = false;

  async fetchImage(_request: SatelliteImageRequest): Promise<SatelliteImageResult> {
    throw new MapProviderNotConfiguredError(MAP_PROVIDER_NOT_CONNECTED);
  }
}

let activeGeocodingProvider: GeocodingProvider = new UnavailableGeocodingProvider();
let activeSatelliteProvider: SatelliteImageProvider = new UnavailableSatelliteImageProvider();

export function getGeocodingProvider(): GeocodingProvider {
  return activeGeocodingProvider;
}

export function getSatelliteImageProvider(): SatelliteImageProvider {
  return activeSatelliteProvider;
}

/** Test / future wiring only — production default remains unavailable. */
export function setGeocodingProviderForTests(provider: GeocodingProvider): void {
  activeGeocodingProvider = provider;
}

export function setSatelliteImageProviderForTests(provider: SatelliteImageProvider): void {
  activeSatelliteProvider = provider;
}

export function resetMapProvidersToUnavailable(): void {
  activeGeocodingProvider = new UnavailableGeocodingProvider();
  activeSatelliteProvider = new UnavailableSatelliteImageProvider();
}

export type LocatePropertyResult =
  | { ok: true; result: GeocodeResult }
  | {
      ok: false;
      code: "MAP_PROVIDER_NOT_CONNECTED" | "EMPTY_ADDRESS" | "GEOCODE_FAILED" | "INVALID_PROVIDER_COORDINATES";
      message: string;
    };

export type DraftLocationCoords = {
  latText: string;
  lngText: string;
};

/**
 * Treat provider-returned coordinates as untrusted.
 * Requires typeof number + finite + in-range (rejects NaN/Infinity/strings/null/undefined/OOB).
 */
export function validateProviderCoordinates(
  latitude: unknown,
  longitude: unknown
): { ok: true; latitude: number; longitude: number } | { ok: false; code: "INVALID_PROVIDER_COORDINATES"; message: string } {
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return {
      ok: false,
      code: INVALID_PROVIDER_COORDINATES,
      message: INVALID_PROVIDER_COORDINATES_MESSAGE,
    };
  }
  if (!validateLatitude(latitude) || !validateLongitude(longitude)) {
    return {
      ok: false,
      code: INVALID_PROVIDER_COORDINATES,
      message: INVALID_PROVIDER_COORDINATES_MESSAGE,
    };
  }
  return { ok: true, latitude, longitude };
}

/**
 * Apply locate result to draft lat/lng text only on validated success.
 * Invalid / failed results leave the previous draft unchanged.
 */
export function applyLocatePropertyResultToDraft(
  draft: DraftLocationCoords,
  result: LocatePropertyResult
): DraftLocationCoords {
  if (!result.ok) return draft;
  return {
    latText: String(result.result.latitude),
    lngText: String(result.result.longitude),
  };
}

/**
 * Locate Property — fail closed when provider is not configured.
 * Never invents lat/lng from address text.
 * Provider responses are validated before returning ok: true.
 */
export async function locateProperty(address: string): Promise<LocatePropertyResult> {
  const trimmed = String(address ?? "").trim();
  if (!trimmed) {
    return { ok: false, code: "EMPTY_ADDRESS", message: "Enter an address before locating the property." };
  }
  const provider = getGeocodingProvider();
  if (!provider.configured) {
    return { ok: false, code: "MAP_PROVIDER_NOT_CONNECTED", message: MAP_PROVIDER_NOT_CONNECTED };
  }
  try {
    const raw = await provider.geocode({ address: trimmed });
    const coords = validateProviderCoordinates(raw?.latitude, raw?.longitude);
    if (!coords.ok) {
      return { ok: false, code: coords.code, message: coords.message };
    }
    return {
      ok: true,
      result: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        formattedAddress: raw.formattedAddress,
        provider: raw.provider,
      },
    };
  } catch (e) {
    if (e instanceof MapProviderNotConfiguredError) {
      return { ok: false, code: "MAP_PROVIDER_NOT_CONNECTED", message: e.message };
    }
    return {
      ok: false,
      code: "GEOCODE_FAILED",
      message: e instanceof Error ? e.message : "Geocoding failed.",
    };
  }
}

export function isSatelliteProviderConfigured(): boolean {
  return getSatelliteImageProvider().configured;
}
