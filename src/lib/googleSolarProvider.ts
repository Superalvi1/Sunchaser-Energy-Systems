/**
 * Google Solar API stub V1 — future-ready provider abstraction only.
 * No network calls. No fake building insights.
 */

import {
  PROVIDER_NOT_CONFIGURED,
  SOLAR_PROVIDER_NOT_CONNECTED,
  UnavailablePlacesAutocompleteProvider,
  validateProviderCoordinates,
  type ProviderResult,
  type SolarBuildingInsights,
  type SolarBuildingInsightsProvider,
} from "./designStudioMapProviders.ts";
import { getMapProviderEnvResolver, setMapProviderEnvResolver } from "./mapProviderEnvBridge.ts";
import "./googlePlacesProvider.ts";

export const GOOGLE_SOLAR_PROVIDER_ID = "google-solar-stub";

export class GoogleSolarBuildingInsightsStubProvider implements SolarBuildingInsightsProvider {
  readonly id = GOOGLE_SOLAR_PROVIDER_ID;
  readonly configured = false;

  async getBuildingInsights(
    latitude: number,
    longitude: number
  ): Promise<ProviderResult<SolarBuildingInsights>> {
    const coords = validateProviderCoordinates(latitude, longitude);
    if (!coords.ok) {
      return { ok: false, code: coords.code, message: coords.message };
    }
    return {
      ok: false,
      code: PROVIDER_NOT_CONFIGURED,
      message: SOLAR_PROVIDER_NOT_CONNECTED,
    };
  }
}

export function createGoogleSolarBuildingInsightsStubProvider(): GoogleSolarBuildingInsightsStubProvider {
  return new GoogleSolarBuildingInsightsStubProvider();
}

const prior = getMapProviderEnvResolver();
setMapProviderEnvResolver({
  geocoding: () => prior?.geocoding(),
  satellite: () => prior?.satellite(),
  places: () => prior?.places?.() ?? new UnavailablePlacesAutocompleteProvider(),
  solar: () => createGoogleSolarBuildingInsightsStubProvider(),
});
