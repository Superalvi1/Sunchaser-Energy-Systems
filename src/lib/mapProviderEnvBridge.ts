/**
 * Shared env-resolver slot for map providers.
 * No imports from provider modules — avoids circular init.
 */

export type MapProviderEnvResolver = {
  geocoding: () => unknown;
  satellite: () => unknown;
  places?: () => unknown;
  solar?: () => unknown;
};

let envResolver: MapProviderEnvResolver | null = null;

export function setMapProviderEnvResolver(resolver: MapProviderEnvResolver | null): void {
  envResolver = resolver;
}

export function getMapProviderEnvResolver(): MapProviderEnvResolver | null {
  return envResolver;
}
