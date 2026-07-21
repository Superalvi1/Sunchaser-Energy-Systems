import assert from "node:assert/strict";
import { extractPolygonFromRegion, extractPolygons, simplifyContour } from "./PolygonExtraction.ts";
import { VisionPipelineError, type SegmentationRegion } from "./VisionModels.ts";
import type { Point2D } from "../roof/RoofModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function region(overrides: Partial<SegmentationRegion> = {}): SegmentationRegion {
  return {
    regionId: "r1",
    contourPx: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    confidence: 0.8,
    label: "roof",
    ...overrides,
  };
}

// --- simplifyContour ---
check("simplifyContour drops a near-collinear midpoint", (() => {
  const pts: Point2D[] = [{ x: 0, y: 0 }, { x: 50, y: 0.5 }, { x: 100, y: 0 }];
  return simplifyContour(pts, 2).length === 2;
})());
check("simplifyContour keeps a sharp corner", (() => {
  const pts: Point2D[] = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }];
  return simplifyContour(pts, 2).length === 3;
})());
check("simplifyContour returns input when tolerance is 0", (() => {
  const pts: Point2D[] = [{ x: 0, y: 0 }, { x: 50, y: 0.5 }, { x: 100, y: 0 }];
  return simplifyContour(pts, 0).length === 3;
})());
check("simplifyContour is deterministic", (() => {
  const pts: Point2D[] = [{ x: 0, y: 0 }, { x: 25, y: 1 }, { x: 50, y: 0.5 }, { x: 75, y: 1 }, { x: 100, y: 0 }];
  return JSON.stringify(simplifyContour(pts, 2)) === JSON.stringify(simplifyContour(pts, 2));
})());
check("simplifyContour drops non-finite vertices", (() => {
  const pts = [{ x: 0, y: 0 }, { x: Number.NaN, y: 5 }, { x: 100, y: 0 }, { x: 100, y: 100 }] as Point2D[];
  return simplifyContour(pts, 0).length === 3;
})());

// --- extractPolygonFromRegion ---
check("extractPolygonFromRegion yields a polygon for a valid square", extractPolygonFromRegion(region()).verticesPx.length === 4);
check("extracted polygon echoes label", extractPolygonFromRegion(region()).label === "roof");
check("extracted polygon carries confidence", extractPolygonFromRegion(region({ confidence: 0.42 })).confidence === 0.42);
check("extracted polygon has computed bounds", (() => {
  const p = extractPolygonFromRegion(region());
  return p.boundsPx.width === 100 && p.boundsPx.height === 100;
})());
check("extracted polygon has positive area", extractPolygonFromRegion(region()).areaPx2 === 10000);
check("extracted polygon id derives from region id", extractPolygonFromRegion(region({ regionId: "abc" })).polygonId === "abc-poly");

check("extractPolygonFromRegion throws for a degenerate (2-point) region", (() => {
  try {
    extractPolygonFromRegion(region({ contourPx: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }));
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "REGION_NOT_EXTRACTABLE";
  }
})());
check("extractPolygonFromRegion throws for a self-intersecting region (bowtie)", (() => {
  try {
    extractPolygonFromRegion(
      region({ contourPx: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }] })
    );
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError;
  }
})());
check("extractPolygonFromRegion throws for a zero-area region", (() => {
  try {
    extractPolygonFromRegion(region({ contourPx: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }] }));
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError;
  }
})());
check("extractPolygonFromRegion throws below minAreaPx2", (() => {
  try {
    extractPolygonFromRegion(region(), { minAreaPx2: 999999 });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "REGION_TOO_SMALL";
  }
})());

// --- extractPolygons ---
check("extractPolygons keeps valid regions and skips invalid ones", (() => {
  const result = extractPolygons([
    region({ regionId: "good" }),
    region({ regionId: "bad", contourPx: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }),
  ]);
  return result.polygons.length === 1 && result.skipped.length === 1 && result.skipped[0].regionId === "bad";
})());
check("extractPolygons returns polygons ordered by regionId", (() => {
  const result = extractPolygons([region({ regionId: "b" }), region({ regionId: "a" })]);
  return result.polygons[0].regionId === "a" && result.polygons[1].regionId === "b";
})());
check("extractPolygons handles an all-invalid set without throwing", (() => {
  const result = extractPolygons([region({ regionId: "x", contourPx: [{ x: 0, y: 0 }] })]);
  return result.polygons.length === 0 && result.skipped.length === 1;
})());
check("extractPolygons on an L-shaped (concave) region succeeds", (() => {
  const L: Point2D[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 40, y: 40 },
    { x: 40, y: 100 },
    { x: 0, y: 100 },
  ];
  const result = extractPolygons([region({ regionId: "L", contourPx: L })]);
  return result.polygons.length === 1 && result.polygons[0].verticesPx.length === 6;
})());
check("extractPolygons is deterministic", (() => {
  const input = [region({ regionId: "a" }), region({ regionId: "b" })];
  return JSON.stringify(extractPolygons(input)) === JSON.stringify(extractPolygons(input));
})());

console.log(`\nPolygonExtraction tests: ${pass} passed`);
