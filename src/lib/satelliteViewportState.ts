/**
 * Satellite viewport state — pan/zoom/recenter for Static Maps preview.
 * Draft-only. No roof geometry. No fake imagery.
 */

import {
  GOOGLE_STATIC_DEFAULT_HEIGHT,
  GOOGLE_STATIC_DEFAULT_WIDTH,
  GOOGLE_STATIC_DEFAULT_ZOOM,
  GOOGLE_STATIC_ZOOM_MAX,
  GOOGLE_STATIC_ZOOM_MIN,
} from "./googleMapsProvider.ts";

export type PanDirection = "north" | "south" | "east" | "west";

export type SatelliteViewportState = {
  centerLat: number;
  centerLng: number;
  zoom: number;
  width: number;
  height: number;
  /** Original property anchor for recenter. */
  anchorLat: number;
  anchorLng: number;
};

export const SATELLITE_VIEWPORT_PAN_PIXELS = 80;

export function clampSatelliteZoom(zoom: number): number {
  const z = Math.round(zoom);
  return Math.min(GOOGLE_STATIC_ZOOM_MAX, Math.max(GOOGLE_STATIC_ZOOM_MIN, z));
}

export function createSatelliteViewportState(input: {
  latitude: number;
  longitude: number;
  zoom?: number;
  width?: number;
  height?: number;
}): SatelliteViewportState {
  return {
    centerLat: input.latitude,
    centerLng: input.longitude,
    anchorLat: input.latitude,
    anchorLng: input.longitude,
    zoom: clampSatelliteZoom(input.zoom ?? GOOGLE_STATIC_DEFAULT_ZOOM),
    width: input.width ?? GOOGLE_STATIC_DEFAULT_WIDTH,
    height: input.height ?? GOOGLE_STATIC_DEFAULT_HEIGHT,
  };
}

/** Approximate meters per pixel at latitude for Google Static Maps (scale=2). */
export function metersPerPixelAtZoom(latitude: number, zoom: number): number {
  const latRad = (latitude * Math.PI) / 180;
  return (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom) / 2;
}

export function panViewport(
  state: SatelliteViewportState,
  direction: PanDirection,
  pixels = SATELLITE_VIEWPORT_PAN_PIXELS
): SatelliteViewportState {
  const mpp = metersPerPixelAtZoom(state.centerLat, state.zoom);
  const meters = pixels * mpp;
  const latDelta = meters / 111_320;
  const lngScale = Math.cos((state.centerLat * Math.PI) / 180) || 1e-6;
  const lngDelta = meters / (111_320 * lngScale);

  let centerLat = state.centerLat;
  let centerLng = state.centerLng;
  switch (direction) {
    case "north":
      centerLat += latDelta;
      break;
    case "south":
      centerLat -= latDelta;
      break;
    case "east":
      centerLng += lngDelta;
      break;
    case "west":
      centerLng -= lngDelta;
      break;
  }
  return { ...state, centerLat, centerLng };
}

export function zoomViewport(state: SatelliteViewportState, delta: 1 | -1): SatelliteViewportState {
  return { ...state, zoom: clampSatelliteZoom(state.zoom + delta) };
}

export function recenterViewport(state: SatelliteViewportState): SatelliteViewportState {
  return {
    ...state,
    centerLat: state.anchorLat,
    centerLng: state.anchorLng,
  };
}

export function updateViewportAnchor(
  state: SatelliteViewportState,
  latitude: number,
  longitude: number,
  resetCenter = true
): SatelliteViewportState {
  return {
    ...state,
    anchorLat: latitude,
    anchorLng: longitude,
    centerLat: resetCenter ? latitude : state.centerLat,
    centerLng: resetCenter ? longitude : state.centerLng,
  };
}

export function viewportFetchInput(state: SatelliteViewportState) {
  return {
    latitude: state.centerLat,
    longitude: state.centerLng,
    zoom: state.zoom,
    width: state.width,
    height: state.height,
  };
}

export function isViewportRecentered(state: SatelliteViewportState): boolean {
  const eps = 1e-7;
  return (
    Math.abs(state.centerLat - state.anchorLat) < eps && Math.abs(state.centerLng - state.anchorLng) < eps
  );
}
