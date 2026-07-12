/**
 * Satellite viewport state tests.
 */

import assert from "node:assert/strict";
import {
  clampSatelliteZoom,
  createSatelliteViewportState,
  isViewportRecentered,
  panViewport,
  recenterViewport,
  viewportFetchInput,
  zoomViewport,
} from "./satelliteViewportState.ts";

let pass = 0;

function check(name: string, fn: () => boolean) {
  if (!fn()) throw new Error(`FAIL: ${name}`);
  pass += 1;
  console.log(`  ✓ ${name}`);
}

check("clampSatelliteZoom enforces Google static bounds", () => {
  return clampSatelliteZoom(10) === 16 && clampSatelliteZoom(30) === 22 && clampSatelliteZoom(19.4) === 19;
});

check("createSatelliteViewportState sets anchor", () => {
  const s = createSatelliteViewportState({ latitude: 31.5, longitude: 74.3, zoom: 18 });
  return s.anchorLat === 31.5 && s.anchorLng === 74.3 && s.centerLat === 31.5 && s.zoom === 18;
});

check("panViewport shifts center", () => {
  const s = createSatelliteViewportState({ latitude: 31.5, longitude: 74.3, zoom: 19 });
  const north = panViewport(s, "north");
  return north.centerLat > s.centerLat && Math.abs(north.centerLng - s.centerLng) < 1e-9;
});

check("zoomViewport changes zoom within bounds", () => {
  const s = createSatelliteViewportState({ latitude: 31.5, longitude: 74.3, zoom: 19 });
  const z = zoomViewport(s, 1);
  return z.zoom === 20;
});

check("recenterViewport restores anchor", () => {
  let s = createSatelliteViewportState({ latitude: 31.5, longitude: 74.3, zoom: 19 });
  s = panViewport(s, "east");
  s = recenterViewport(s);
  return isViewportRecentered(s);
});

check("viewportFetchInput exposes fetch params", () => {
  const s = createSatelliteViewportState({ latitude: 31.5, longitude: 74.3, zoom: 20 });
  const input = viewportFetchInput(s);
  return input.latitude === 31.5 && input.longitude === 74.3 && input.zoom === 20;
});

console.log(`\nsatelliteViewportState tests: ${pass} passed`);
