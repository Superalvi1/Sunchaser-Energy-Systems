import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRoofExtractionPipeline } from "./RoofExtractionPipeline.ts";
import { createProviderRegistry } from "./VisionProvider.ts";
import { createFixtureSegmentationProvider } from "./providers/FixtureSegmentationProvider.ts";
import { toRoofSiteInput } from "./RoofGeometryConversion.ts";
import { analyzeRoofSite } from "../roof/RoofGeometryEngine.ts";
import { addVertex, deletePolygon, moveVertex } from "./ManualCorrection.ts";
import type { SatelliteImageRef, SegmentationRegion } from "./VisionModels.ts";

let pass = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  try {
    assert.ok(condition, `FAILED: ${name}`);
    pass += 1;
  } catch (e) {
    failed += 1;
    throw e;
  }
}

function fingerprint(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

const WIDTHS = [400, 800, 1200];
const HEIGHTS = [300, 600];
const METERS_PER_PIXEL = [0.05, 0.1, 0.25];
const CELL_SIZES = [16, 32, 64];

// Deterministic in-bounds, valid rectangular boxes as fractions of the image.
const BOX_FRACTIONS: [number, number, number, number][] = [
  [0.1, 0.1, 0.9, 0.9],
  [0.05, 0.05, 0.5, 0.5],
  [0.5, 0.5, 0.95, 0.95],
  [0.2, 0.1, 0.8, 0.4],
  [0.1, 0.2, 0.4, 0.8],
  [0.25, 0.25, 0.75, 0.75],
  [0.0, 0.0, 0.6, 0.3],
  [0.4, 0.0, 1.0, 0.6],
  [0.15, 0.35, 0.85, 0.65],
  [0.3, 0.3, 0.7, 0.9],
];

function boxToRegion(
  frac: [number, number, number, number],
  widthPx: number,
  heightPx: number,
  index: number
): SegmentationRegion {
  const minX = Math.round(frac[0] * widthPx);
  const minY = Math.round(frac[1] * heightPx);
  const maxX = Math.round(frac[2] * widthPx);
  const maxY = Math.round(frac[3] * heightPx);
  return {
    regionId: `m-${index}`,
    contourPx: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    confidence: 0.5 + (index % 5) * 0.1,
    label: "roof",
  };
}

let combos = 0;
for (const widthPx of WIDTHS) {
  for (const heightPx of HEIGHTS) {
    for (const metersPerPixel of METERS_PER_PIXEL) {
      for (let bi = 0; bi < BOX_FRACTIONS.length; bi++) {
        const region = boxToRegion(BOX_FRACTIONS[bi], widthPx, heightPx, bi);
        for (const cellSizePx of CELL_SIZES) {
          combos += 1;
          const label = `${widthPx}x${heightPx}/mpp${metersPerPixel}/box${bi}/cell${cellSizePx}`;
          const image: SatelliteImageRef = {
            imageId: `img-${widthPx}-${heightPx}-${bi}`,
            widthPx,
            heightPx,
            metersPerPixel,
            checksum: `chk-${label}`,
          };
          const provider = createFixtureSegmentationProvider({ fixtures: { [image.imageId]: [region] } });
          const pipeline = createRoofExtractionPipeline({
            registry: createProviderRegistry([provider]),
            heatmap: { cellSizePx },
          });

          const run = pipeline.extract(image);

          // 1. Exactly one polygon extracted from one region.
          check(`${label} one polygon`, run.polygons.length === 1);

          // 2. Heatmap grid dimensions are correct and deterministic.
          check(
            `${label} heatmap grid`,
            run.heatmap.cols === Math.ceil(widthPx / cellSizePx) && run.heatmap.rows === Math.ceil(heightPx / cellSizePx)
          );

          // 3. Deterministic fingerprint (re-run identical).
          const run2 = pipeline.extract(image);
          check(`${label} deterministic`, fingerprint(run.polygons) === fingerprint(run2.polygons));

          // 4. Converts into the existing engine and yields positive true area.
          const site = toRoofSiteInput(run.image, run.suggestion.polygons);
          const metrics = analyzeRoofSite(site);
          check(`${label} analyzable area > 0`, metrics.planeCount === 1 && metrics.totalPlanAreaM2 > 0);
        }
      }
    }
  }
}

// Area monotonicity: same box, larger metersPerPixel ⇒ larger true area.
for (const widthPx of WIDTHS) {
  for (let bi = 0; bi < BOX_FRACTIONS.length; bi++) {
    const heightPx = 600;
    const region = boxToRegion(BOX_FRACTIONS[bi], widthPx, heightPx, bi);
    let prevArea = -1;
    let monotonic = true;
    for (const metersPerPixel of METERS_PER_PIXEL) {
      const image: SatelliteImageRef = {
        imageId: `mono-${widthPx}-${bi}`,
        widthPx,
        heightPx,
        metersPerPixel,
        checksum: `mono-${widthPx}-${bi}-${metersPerPixel}`,
      };
      const provider = createFixtureSegmentationProvider({ fixtures: { [image.imageId]: [region] } });
      const run = createRoofExtractionPipeline({ registry: createProviderRegistry([provider]) }).extract(image);
      const metrics = analyzeRoofSite(toRoofSiteInput(run.image, run.suggestion.polygons));
      const area = metrics.totalPlanAreaM2;
      if (area <= prevArea) monotonic = false;
      prevArea = area;
    }
    check(`area monotonic in metersPerPixel width${widthPx}/box${bi}`, monotonic);
  }
}

// Manual-correction matrix: edits stay valid and versionable across many boxes.
for (const widthPx of WIDTHS) {
  for (let bi = 0; bi < BOX_FRACTIONS.length; bi++) {
    const heightPx = 600;
    const region = boxToRegion(BOX_FRACTIONS[bi], widthPx, heightPx, bi);
    const image: SatelliteImageRef = {
      imageId: `edit-${widthPx}-${bi}`,
      widthPx,
      heightPx,
      metersPerPixel: 0.1,
      checksum: `edit-${widthPx}-${bi}`,
    };
    const provider = createFixtureSegmentationProvider({ fixtures: { [image.imageId]: [region] } });
    const run = createRoofExtractionPipeline({ registry: createProviderRegistry([provider]) }).extract(image);
    const store = run.versionStore;
    const base = run.suggestion.polygons;

    // Nudge a vertex outward — stays valid, appends a manual version.
    const v0 = base[0].verticesPx[0];
    const moved = moveVertex(base, base[0].polygonId, 0, { x: v0.x - 1, y: v0.y - 1 });
    const v2 = store.append({ source: "manual", polygons: moved, note: "nudge" });
    check(`edit ${widthPx}/${bi} moveVertex versioned`, v2.version === 2 && v2.source === "manual");

    // Add a vertex — still a valid polygon.
    const withVertex = addVertex(moved, moved[0].polygonId, 0, {
      x: (moved[0].verticesPx[0].x + moved[0].verticesPx[1].x) / 2,
      y: moved[0].verticesPx[0].y - 2,
    });
    check(`edit ${widthPx}/${bi} addVertex valid`, withVertex[0].verticesPx.length === base[0].verticesPx.length + 1);

    // Delete the whole polygon — set becomes empty, history preserved.
    const emptied = deletePolygon(withVertex, withVertex[0].polygonId);
    check(`edit ${widthPx}/${bi} deletePolygon + history intact`, emptied.length === 0 && store.get(1)!.polygons.length === 1);
  }
}

console.log(`\nRoof extraction matrix: ${combos} pipeline combos, ${pass} checks passed, ${failed} failed.`);
