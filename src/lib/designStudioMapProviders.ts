/**
 * Satellite Provider Adapter V1 — provider-ready geocoding + satellite layer.
 *
 * Default providers are unavailable. No fake geocoding or satellite imagery.
 * No network calls unless a future configured adapter is wired via registry.
 * Draft-only. No CRM / save / AI / PDF / localStorage.
 * Provider responses are untrusted — validated before success.
 */

import { parseOptionalGpsAnchor, validateLatitude, validateLongitude } from "./roofStudioGeoReference.ts";
import { getMapProviderEnvResolver, setMapProviderEnvResolver } from "./mapProviderEnvBridge.ts";

export type { MapProviderEnvResolver } from "./mapProviderEnvBridge.ts";
export { setMapProviderEnvResolver };

export const PROVIDER_NOT_CONFIGURED = "PROVIDER_NOT_CONFIGURED";
export const INVALID_PROVIDER_COORDINATES = "INVALID_PROVIDER_COORDINATES";
export const INVALID_PROVIDER_IMAGE = "INVALID_PROVIDER_IMAGE";
export const GEOCODING_NO_RESULTS = "GEOCODING_NO_RESULTS";
export const GEOCODING_PROVIDER_ERROR = "GEOCODING_PROVIDER_ERROR";

export const MAP_PROVIDER_NOT_CONNECTED = "Map provider not connected yet";
export const SATELLITE_PROVIDER_NOT_CONNECTED = "Satellite provider not connected yet";
export const UPLOAD_OR_CONNECT_MAP_LABEL = "Map / satellite / uploaded image canvas";
export const GOOGLE_MAPS_CONNECTED_LABEL = "Google Maps connected";
export const GEOCODING_NO_RESULTS_MESSAGE = "No result found for that address.";
export const GEOCODING_PROVIDER_ERROR_MESSAGE = "Provider error — geocoding request failed.";
export const INVALID_PROVIDER_RESPONSE_MESSAGE = "Invalid provider response.";

export const INVALID_PROVIDER_COORDINATES_MESSAGE =
  "Provider returned invalid coordinates. Latitude must be a finite number from -90 to 90; longitude from -180 to 180.";
export const INVALID_PROVIDER_IMAGE_MESSAGE =
  "Provider returned an invalid satellite image. Rejected unsafe or empty image URL / metersPerPixel.";

export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export interface Location {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
  provider?: string;
  confidence?: number;
}

export interface Address {
  formattedAddress: string;
  provider?: string;
}

export interface SatelliteImage {
  imageUrl?: string;
  imageDataUrl?: string;
  latitude: number;
  longitude: number;
  zoom: number;
  metersPerPixel?: number;
  attribution?: string;
  provider?: string;
}

export interface SatelliteImageInput {
  latitude: number;
  longitude: number;
  zoom?: number;
  width?: number;
  height?: number;
}

export interface GeocodingProvider {
  readonly id: string;
  readonly configured: boolean;
  geocodeAddress(address: string): Promise<ProviderResult<Location>>;
  reverseGeocode?(lat: number, lng: number): Promise<ProviderResult<Address>>;
}

export interface SatelliteImageProvider {
  readonly id: string;
  readonly configured: boolean;
  getSatelliteImage(input: SatelliteImageInput): Promise<ProviderResult<SatelliteImage>>;
}

export interface PlaceSuggestion {
  placeId: string;
  description: string;
  provider?: string;
}

export interface PlacesAutocompleteProvider {
  readonly id: string;
  readonly configured: boolean;
  getSuggestions(input: string): Promise<ProviderResult<PlaceSuggestion[]>>;
  resolvePlace(placeId: string): Promise<ProviderResult<Location>>;
}

/** Future-ready Google Solar API stub — not wired to network in V1. */
export interface SolarBuildingInsights {
  latitude: number;
  longitude: number;
  provider: string;
  status: "stub_not_configured";
}

export interface SolarBuildingInsightsProvider {
  readonly id: string;
  readonly configured: boolean;
  getBuildingInsights(latitude: number, longitude: number): Promise<ProviderResult<SolarBuildingInsights>>;
}

export const PLACES_PROVIDER_NOT_CONNECTED = "Places autocomplete not connected yet";
export const SOLAR_PROVIDER_NOT_CONNECTED = "Google Solar API not connected yet";

/** @deprecated Prefer GeocodingProvider.geocodeAddress — kept for older call sites. */
export interface GeocodeRequest {
  address: string;
}

/** @deprecated Prefer Location */
export type GeocodeResult = Location & { provider: string };

/** @deprecated Prefer SatelliteImageInput */
export type SatelliteImageRequest = SatelliteImageInput;

/** @deprecated Prefer SatelliteImage */
export type SatelliteImageResult = SatelliteImage & { imageUrl: string; provider: string };

export class MapProviderNotConfiguredError extends Error {
  readonly code = PROVIDER_NOT_CONFIGURED;
  constructor(message = MAP_PROVIDER_NOT_CONNECTED) {
    super(message);
    this.name = "MapProviderNotConfiguredError";
  }
}

/** Default geocoding adapter — always unavailable. Never invents coordinates. */
export class UnavailableGeocodingProvider implements GeocodingProvider {
  readonly id = "unavailable-geocoding";
  readonly configured = false;

  async geocodeAddress(_address: string): Promise<ProviderResult<Location>> {
    return {
      ok: false,
      code: PROVIDER_NOT_CONFIGURED,
      message: MAP_PROVIDER_NOT_CONNECTED,
    };
  }

  async reverseGeocode(_lat: number, _lng: number): Promise<ProviderResult<Address>> {
    return {
      ok: false,
      code: PROVIDER_NOT_CONFIGURED,
      message: MAP_PROVIDER_NOT_CONNECTED,
    };
  }

  /** Legacy throw-style API used by older tests — still fail-closed. */
  async geocode(_request: GeocodeRequest): Promise<GeocodeResult> {
    throw new MapProviderNotConfiguredError(MAP_PROVIDER_NOT_CONNECTED);
  }
}

/** Default Places adapter — unavailable when Google Maps flag/key off. */
export class UnavailablePlacesAutocompleteProvider implements PlacesAutocompleteProvider {
  readonly id = "unavailable-places";
  readonly configured = false;

  async getSuggestions(_input: string): Promise<ProviderResult<PlaceSuggestion[]>> {
    return { ok: true, value: [] };
  }

  async resolvePlace(_placeId: string): Promise<ProviderResult<Location>> {
    return {
      ok: false,
      code: PROVIDER_NOT_CONFIGURED,
      message: PLACES_PROVIDER_NOT_CONNECTED,
    };
  }
}

/** Default Google Solar stub — always unavailable in V1. */
export class UnavailableSolarBuildingInsightsProvider implements SolarBuildingInsightsProvider {
  readonly id = "unavailable-solar";
  readonly configured = false;

  async getBuildingInsights(_latitude: number, _longitude: number): Promise<ProviderResult<SolarBuildingInsights>> {
    return {
      ok: false,
      code: PROVIDER_NOT_CONFIGURED,
      message: SOLAR_PROVIDER_NOT_CONNECTED,
    };
  }
}

/** Default satellite adapter — always unavailable. Never invents imagery. */
export class UnavailableSatelliteImageProvider implements SatelliteImageProvider {
  readonly id = "unavailable-satellite";
  readonly configured = false;

  async getSatelliteImage(_input: SatelliteImageInput): Promise<ProviderResult<SatelliteImage>> {
    return {
      ok: false,
      code: PROVIDER_NOT_CONFIGURED,
      message: SATELLITE_PROVIDER_NOT_CONNECTED,
    };
  }

  /** Legacy throw-style API used by older tests — still fail-closed. */
  async fetchImage(_request: SatelliteImageRequest): Promise<SatelliteImageResult> {
    throw new MapProviderNotConfiguredError(SATELLITE_PROVIDER_NOT_CONNECTED);
  }
}

/**
 * Manual location helper — accepts user-entered lat/lng only after validation.
 * No API. No fake image.
 */
export class ManualLocationProvider {
  readonly id = "manual-location";
  readonly configured = true;

  fromLatLngText(latText: string, lngText: string): ProviderResult<Location> {
    const parsed = parseOptionalGpsAnchor(latText, lngText);
    if (!parsed.ok) {
      return { ok: false, code: INVALID_PROVIDER_COORDINATES, message: (parsed as any).error };
    }
    if (!parsed.anchor) {
      return {
        ok: false,
        code: INVALID_PROVIDER_COORDINATES,
        message: "Enter both latitude and longitude.",
      };
    }
    return {
      ok: true,
      value: {
        latitude: parsed.anchor.latitude,
        longitude: parsed.anchor.longitude,
        provider: this.id,
      },
    };
  }
}

let geocodingOverride: GeocodingProvider | null = null;
let satelliteOverride: SatelliteImageProvider | null = null;
let placesOverride: PlacesAutocompleteProvider | null = null;
let solarOverride: SolarBuildingInsightsProvider | null = null;

/**
 * Registry / factory — Google when env enabled + key present; otherwise unavailable.
 * Env resolver is registered by googleMapsProvider (import that module to enable Google).
 * Test overrides via setGeocodingProviderForTests / setSatelliteImageProviderForTests.
 */
export function getConfiguredGeocodingProvider(): GeocodingProvider {
  if (geocodingOverride) return geocodingOverride;
  try {
    const fromEnv = getMapProviderEnvResolver()?.geocoding();
    if (fromEnv && typeof fromEnv === "object" && "geocodeAddress" in (fromEnv as object)) {
      return fromEnv as GeocodingProvider;
    }
  } catch {
    /* fail closed */
  }
  return new UnavailableGeocodingProvider();
}

export function getConfiguredSatelliteImageProvider(): SatelliteImageProvider {
  if (satelliteOverride) return satelliteOverride;
  try {
    const fromEnv = getMapProviderEnvResolver()?.satellite();
    if (fromEnv && typeof fromEnv === "object" && "getSatelliteImage" in (fromEnv as object)) {
      return fromEnv as SatelliteImageProvider;
    }
  } catch {
    /* fail closed */
  }
  return new UnavailableSatelliteImageProvider();
}

export function getConfiguredPlacesAutocompleteProvider(): PlacesAutocompleteProvider {
  if (placesOverride) return placesOverride;
  try {
    const fromEnv = getMapProviderEnvResolver()?.places?.();
    if (fromEnv && typeof fromEnv === "object" && "getSuggestions" in (fromEnv as object)) {
      return fromEnv as PlacesAutocompleteProvider;
    }
  } catch {
    /* fail closed */
  }
  return new UnavailablePlacesAutocompleteProvider();
}

export function getConfiguredSolarBuildingInsightsProvider(): SolarBuildingInsightsProvider {
  if (solarOverride) return solarOverride;
  try {
    const fromEnv = getMapProviderEnvResolver()?.solar?.();
    if (fromEnv && typeof fromEnv === "object" && "getBuildingInsights" in (fromEnv as object)) {
      return fromEnv as SolarBuildingInsightsProvider;
    }
  } catch {
    /* fail closed */
  }
  return new UnavailableSolarBuildingInsightsProvider();
}

export function getGeocodingProvider(): GeocodingProvider {
  return getConfiguredGeocodingProvider();
}

export function getSatelliteImageProvider(): SatelliteImageProvider {
  return getConfiguredSatelliteImageProvider();
}

/** Test / future wiring only — production default resolves from env. */
export function setGeocodingProviderForTests(provider: GeocodingProvider): void {
  geocodingOverride = provider;
}

export function setSatelliteImageProviderForTests(provider: SatelliteImageProvider): void {
  satelliteOverride = provider;
}

export function setPlacesAutocompleteProviderForTests(provider: PlacesAutocompleteProvider): void {
  placesOverride = provider;
}

export function setSolarBuildingInsightsProviderForTests(provider: SolarBuildingInsightsProvider): void {
  solarOverride = provider;
}

export function resetMapProvidersToUnavailable(): void {
  geocodingOverride = new UnavailableGeocodingProvider();
  satelliteOverride = new UnavailableSatelliteImageProvider();
  placesOverride = new UnavailablePlacesAutocompleteProvider();
  solarOverride = new UnavailableSolarBuildingInsightsProvider();
}

/** Clear test overrides so registry resolves from env again. */
export function clearMapProviderOverrides(): void {
  geocodingOverride = null;
  satelliteOverride = null;
  placesOverride = null;
  solarOverride = null;
}

export function isGeocodingProviderConfigured(): boolean {
  return getConfiguredGeocodingProvider().configured;
}

export function isSatelliteProviderConfigured(): boolean {
  return getConfiguredSatelliteImageProvider().configured;
}

export function isPlacesAutocompleteConfigured(): boolean {
  return getConfiguredPlacesAutocompleteProvider().configured;
}

export function isSolarProviderConfigured(): boolean {
  return getConfiguredSolarBuildingInsightsProvider().configured;
}

export function getMapProviderStatusLabel(): string {
  const provider = getConfiguredGeocodingProvider();
  if (provider.configured && (provider.id === "google-geocoding" || provider.id.startsWith("google"))) {
    return GOOGLE_MAPS_CONNECTED_LABEL;
  }
  if (provider.configured) {
    return "Map provider connected";
  }
  return MAP_PROVIDER_NOT_CONNECTED;
}

export type LocatePropertyResult =
  | { ok: true; result: Location }
  | {
      ok: false;
      code:
        | "PROVIDER_NOT_CONFIGURED"
        | "MAP_PROVIDER_NOT_CONNECTED"
        | "EMPTY_ADDRESS"
        | "GEOCODE_FAILED"
        | "GEOCODING_NO_RESULTS"
        | "GEOCODING_PROVIDER_ERROR"
        | "INVALID_PROVIDER_COORDINATES";
      message: string;
    };

export type FetchSatelliteImageResult =
  | { ok: true; image: SatelliteImage }
  | {
      ok: false;
      code:
        | "PROVIDER_NOT_CONFIGURED"
        | "INVALID_COORDINATES"
        | "INVALID_PROVIDER_COORDINATES"
        | "INVALID_PROVIDER_IMAGE"
        | "SATELLITE_FETCH_FAILED";
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
):
  | { ok: true; latitude: number; longitude: number }
  | { ok: false; code: "INVALID_PROVIDER_COORDINATES"; message: string } {
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
 * Validate untrusted satellite image payload.
 * Rejects javascript:, data:text/html, empty URLs; data: only image/*; metersPerPixel finite > 0.
 */
export function validateSatelliteImageResponse(
  raw: unknown
):
  | { ok: true; image: SatelliteImage }
  | { ok: false; code: "INVALID_PROVIDER_IMAGE" | "INVALID_PROVIDER_COORDINATES"; message: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, code: INVALID_PROVIDER_IMAGE, message: INVALID_PROVIDER_IMAGE_MESSAGE };
  }
  const obj = raw as Record<string, unknown>;
  const coords = validateProviderCoordinates(obj.latitude, obj.longitude);
  if (!coords.ok) {
    return { ok: false, code: (coords as any).code, message: (coords as any).message };
  }

  const imageUrl = typeof obj.imageUrl === "string" ? obj.imageUrl.trim() : "";
  const imageDataUrl = typeof obj.imageDataUrl === "string" ? obj.imageDataUrl.trim() : "";
  const resolvedUrl = imageUrl || imageDataUrl;
  if (!resolvedUrl) {
    return { ok: false, code: INVALID_PROVIDER_IMAGE, message: INVALID_PROVIDER_IMAGE_MESSAGE };
  }

  const urlCheck = validateSatelliteImageUrl(resolvedUrl);
  if (!urlCheck.ok) {
    return { ok: false, code: INVALID_PROVIDER_IMAGE, message: (urlCheck as any).error || INVALID_PROVIDER_IMAGE_MESSAGE };
  }

  let zoom = 18;
  if (obj.zoom !== undefined && obj.zoom !== null) {
    if (typeof obj.zoom !== "number" || !Number.isFinite(obj.zoom) || obj.zoom < 0 || obj.zoom > 24) {
      return { ok: false, code: INVALID_PROVIDER_IMAGE, message: INVALID_PROVIDER_IMAGE_MESSAGE };
    }
    zoom = obj.zoom;
  }

  let metersPerPixel: number | undefined;
  if (obj.metersPerPixel !== undefined && obj.metersPerPixel !== null) {
    if (typeof obj.metersPerPixel !== "number" || !Number.isFinite(obj.metersPerPixel) || obj.metersPerPixel <= 0) {
      return { ok: false, code: INVALID_PROVIDER_IMAGE, message: INVALID_PROVIDER_IMAGE_MESSAGE };
    }
    metersPerPixel = obj.metersPerPixel;
  }

  const image: SatelliteImage = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    zoom,
    metersPerPixel,
    attribution: typeof obj.attribution === "string" ? obj.attribution : undefined,
    provider: typeof obj.provider === "string" ? obj.provider : undefined,
  };
  if (imageDataUrl && (!imageUrl || imageUrl.startsWith("data:"))) {
    image.imageDataUrl = resolvedUrl;
  } else {
    image.imageUrl = resolvedUrl;
  }
  return { ok: true, image };
}

export function validateSatelliteImageUrl(
  url: string
): { ok: true } | { ok: false; code: "INVALID_PROVIDER_IMAGE"; message: string } {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) {
    return { ok: false, code: INVALID_PROVIDER_IMAGE, message: INVALID_PROVIDER_IMAGE_MESSAGE };
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:")) {
    return { ok: false, code: INVALID_PROVIDER_IMAGE, message: INVALID_PROVIDER_IMAGE_MESSAGE };
  }
  if (lower.startsWith("data:text/html")) {
    return { ok: false, code: INVALID_PROVIDER_IMAGE, message: INVALID_PROVIDER_IMAGE_MESSAGE };
  }
  if (lower.startsWith("data:")) {
    // Only allow image/* data URLs (e.g. data:image/png;base64,...)
    if (!/^data:image\/[a-z0-9.+-]+(;|,)/i.test(trimmed)) {
      return { ok: false, code: INVALID_PROVIDER_IMAGE, message: INVALID_PROVIDER_IMAGE_MESSAGE };
    }
  }
  return { ok: true };
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
  const provider = getConfiguredGeocodingProvider();
  if (!provider.configured) {
    return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: MAP_PROVIDER_NOT_CONNECTED };
  }
  try {
    const raw = await provider.geocodeAddress(trimmed);
    if (!raw.ok) {
      const err = raw as any;
      if (err.code === INVALID_PROVIDER_COORDINATES) {
        return { ok: false, code: INVALID_PROVIDER_COORDINATES, message: err.message || INVALID_PROVIDER_RESPONSE_MESSAGE };
      }
      if (err.code === GEOCODING_NO_RESULTS) {
        return { ok: false, code: GEOCODING_NO_RESULTS, message: err.message || GEOCODING_NO_RESULTS_MESSAGE };
      }
      if (err.code === GEOCODING_PROVIDER_ERROR || err.code === "EMPTY_ADDRESS") {
        if (err.code === "EMPTY_ADDRESS") {
          return { ok: false, code: "EMPTY_ADDRESS", message: err.message };
        }
        return {
          ok: false,
          code: GEOCODING_PROVIDER_ERROR,
          message: err.message || GEOCODING_PROVIDER_ERROR_MESSAGE,
        };
      }
      return { ok: false, code: "GEOCODE_FAILED", message: err.message || "Geocoding failed." };
    }
    const coords = validateProviderCoordinates(raw.value.latitude, raw.value.longitude);
    if (!coords.ok) {
      return { ok: false, code: (coords as any).code, message: (coords as any).message };
    }
    return {
      ok: true,
      result: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        formattedAddress: raw.value.formattedAddress,
        provider: raw.value.provider ?? provider.id,
        confidence: raw.value.confidence,
      },
    };
  } catch (e) {
    if (e instanceof MapProviderNotConfiguredError) {
      return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: e.message };
    }
    return {
      ok: false,
      code: "GEOCODE_FAILED",
      message: e instanceof Error ? e.message : "Geocoding failed.",
    };
  }
}

/**
 * Fetch satellite image — fail closed when provider unavailable or response invalid.
 * Does not invent imagery. Does not unlock calibration by itself.
 */
export async function fetchSatelliteImage(input: {
  latitude: number;
  longitude: number;
  zoom?: number;
  width?: number;
  height?: number;
}): Promise<FetchSatelliteImageResult> {
  const coords = validateProviderCoordinates(input.latitude, input.longitude);
  if (!coords.ok) {
    return { ok: false, code: "INVALID_COORDINATES", message: (coords as any).message };
  }
  const provider = getConfiguredSatelliteImageProvider();
  if (!provider.configured) {
    return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: SATELLITE_PROVIDER_NOT_CONNECTED };
  }
  try {
    const raw = await provider.getSatelliteImage({
      latitude: coords.latitude,
      longitude: coords.longitude,
      zoom: input.zoom,
      width: input.width,
      height: input.height,
    });
    if (!raw.ok) {
      const err = raw as any;
      if (err.code === PROVIDER_NOT_CONFIGURED) {
        return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: err.message || SATELLITE_PROVIDER_NOT_CONNECTED };
      }
      if (err.code === INVALID_PROVIDER_IMAGE) {
        return { ok: false, code: INVALID_PROVIDER_IMAGE, message: err.message };
      }
      if (err.code === INVALID_PROVIDER_COORDINATES) {
        return { ok: false, code: INVALID_PROVIDER_COORDINATES, message: err.message };
      }
      return { ok: false, code: "SATELLITE_FETCH_FAILED", message: err.message || "Satellite image fetch failed." };
    }
    const validated = validateSatelliteImageResponse(raw.value);
    if (!validated.ok) {
      return { ok: false, code: (validated as any).code, message: (validated as any).message };
    }
    return { ok: true, image: validated.image };
  } catch (e) {
    if (e instanceof MapProviderNotConfiguredError) {
      return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: e.message };
    }
    return {
      ok: false,
      code: "SATELLITE_FETCH_FAILED",
      message: e instanceof Error ? e.message : "Satellite image fetch failed.",
    };
  }
}

/** True when draft lat/lng text parses to a valid GPS anchor (enables Fetch Satellite). */
export function hasValidManualCoordinates(latText: string, lngText: string): boolean {
  const parsed = parseOptionalGpsAnchor(latText, lngText);
  return parsed.ok && Boolean(parsed.anchor);
}

export function resolveSatelliteDisplayUrl(image: SatelliteImage): string | null {
  const url = (image.imageUrl || image.imageDataUrl || "").trim();
  if (!url) return null;
  return validateSatelliteImageUrl(url).ok ? url : null;
}

export async function fetchAddressSuggestions(input: string): Promise<ProviderResult<PlaceSuggestion[]>> {
  const provider = getConfiguredPlacesAutocompleteProvider();
  if (!provider.configured) {
    return { ok: true, value: [] };
  }
  try {
    return await provider.getSuggestions(input);
  } catch (e) {
    return {
      ok: false,
      code: GEOCODING_PROVIDER_ERROR,
      message: e instanceof Error ? e.message : "Autocomplete failed.",
    };
  }
}

export async function resolvePlaceSuggestion(placeId: string): Promise<LocatePropertyResult> {
  const provider = getConfiguredPlacesAutocompleteProvider();
  if (!provider.configured) {
    return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: PLACES_PROVIDER_NOT_CONNECTED };
  }
  try {
    const raw = await provider.resolvePlace(placeId);
    if (!raw.ok) {
      const err = raw as any;
      if (err.code === PROVIDER_NOT_CONFIGURED) {
        return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: err.message };
      }
      if (err.code === GEOCODING_NO_RESULTS) {
        return { ok: false, code: GEOCODING_NO_RESULTS, message: err.message || GEOCODING_NO_RESULTS_MESSAGE };
      }
      return { ok: false, code: GEOCODING_PROVIDER_ERROR, message: err.message || GEOCODING_PROVIDER_ERROR_MESSAGE };
    }
    const coords = validateProviderCoordinates(raw.value.latitude, raw.value.longitude);
    if (!coords.ok) {
      return { ok: false, code: (coords as any).code, message: (coords as any).message };
    }
    return {
      ok: true,
      result: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        formattedAddress: raw.value.formattedAddress,
        provider: raw.value.provider ?? provider.id,
      },
    };
  } catch (e) {
    return {
      ok: false,
      code: "GEOCODE_FAILED",
      message: e instanceof Error ? e.message : "Place resolution failed.",
    };
  }
}

/** Future-ready stub — always fail-closed in V1. */
export async function fetchSolarBuildingInsightsStub(input: {
  latitude: number;
  longitude: number;
}): Promise<ProviderResult<SolarBuildingInsights>> {
  const coords = validateProviderCoordinates(input.latitude, input.longitude);
  if (!coords.ok) {
    return { ok: false, code: INVALID_PROVIDER_COORDINATES, message: (coords as any).message };
  }
  const provider = getConfiguredSolarBuildingInsightsProvider();
  if (!provider.configured) {
    return { ok: false, code: PROVIDER_NOT_CONFIGURED, message: SOLAR_PROVIDER_NOT_CONNECTED };
  }
  return provider.getBuildingInsights(coords.latitude, coords.longitude);
}
