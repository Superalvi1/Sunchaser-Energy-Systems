/**
 * Roof geometry conversion + accept/reject bridge tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptSuggestionIntoStudio,
  rejectSuggestion,
  toRoofPlaneInput,
  toRoofPolygonDef,
  toRoofSiteInput,
  validateSuggestionPolygon,
  type StudioAcceptMutations,
} from "./RoofGeometryConversion.ts";
import { analyzeRoofSite } from "../roof/RoofGeometryEngine.ts";
import { validateRoofSite } from "../roof/RoofValidation.ts";
import { createRoofExtractionVersionStore } from "./RoofExtractionVersioning.ts";
import {
  VisionPipelineError,
  type ExtractedPolygon,
  type RoofExtractionSuggestion,
  type SatelliteImageRef,
} from "./VisionModels.ts";
import type { Point2D } from "../roof/RoofModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function image(overrides: Partial<SatelliteImageRef> = {}): SatelliteImageRef {
  return { imageId: "img-1", widthPx: 1000, heightPx: 800, metersPerPixel: 0.1, checksum: "abc", ...overrides };
}

function poly(id: string, box: [number, number, number, number], kind: "roof" | "obstacle" = "roof"): ExtractedPolygon {
  const [minX, minY, maxX, maxY] = box;
  return {
    polygonId: id,
    regionId: `${id}-r`,
    kind,
    verticesPx: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    confidence: 0.9,
    label: kind === "obstacle" ? "obstacle" : "roof",
    boundsPx: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
    areaPx2: (maxX - minX) * (maxY - minY),
  };
}

interface FakeStudioState {
  planes: { id: string; boundary: Point2D[]; obstacles: { id: string; vertices: Point2D[] }[] }[];
  selectedPlaneId: string | null;
  locked?: boolean;
}

function createFakeMutations(): {
  state: FakeStudioState;
  mutations: StudioAcceptMutations<FakeStudioState>;
  addPlaneCalls: number;
} {
  const state: FakeStudioState = { planes: [], selectedPlaneId: null };
  let addPlaneCalls = 0;
  let obsCounter = 0;
  const mutations: StudioAcceptMutations<FakeStudioState> = {
    addPlane: (s, boundary) => {
      if (s.locked) return s;
      addPlaneCalls += 1;
      const id = `plane-${addPlaneCalls}`;
      return {
        ...s,
        planes: [...s.planes, { id, boundary, obstacles: [] }],
        selectedPlaneId: id,
      };
    },
    addObstacle: (s, planeId, obstacle) => ({
      ...s,
      planes: s.planes.map((p) =>
        p.id === planeId ? { ...p, obstacles: [...p.obstacles, { id: obstacle.id, vertices: obstacle.vertices }] } : p
      ),
    }),
    nextObstacleId: () => {
      obsCounter += 1;
      return `obs-${obsCounter}`;
    },
    getSelectedOrLastPlaneId: (s) => s.selectedPlaneId ?? s.planes[s.planes.length - 1]?.id ?? null,
  };
  return {
    get state() {
      return state;
    },
    mutations,
    get addPlaneCalls() {
      return addPlaneCalls;
    },
  };
}

function suggestion(polygons: ExtractedPolygon[], status: RoofExtractionSuggestion["status"] = "proposed"): RoofExtractionSuggestion {
  return {
    suggestionId: "sug-1",
    version: 1,
    parentVersion: null,
    source: "ai",
    status,
    createdAt: "1970-01-01T00:00:00.000Z",
    imageId: "img-1",
    polygons,
    note: "test",
  };
}

check("toRoofPolygonDef preserves id", toRoofPolygonDef(poly("p1", [0, 0, 10, 10])).id === "p1");
check("toRoofPolygonDef preserves vertices in pixel space", (() => {
  const def = toRoofPolygonDef(poly("p1", [0, 0, 10, 20]));
  return def.vertices.length === 4 && def.vertices[2].x === 10 && def.vertices[2].y === 20;
})());

check("toRoofPlaneInput defaults pitch to 0 (flat)", toRoofPlaneInput(poly("p1", [0, 0, 10, 10])).pitchDeg === 0);
check("toRoofPlaneInput defaults azimuth to 180", toRoofPlaneInput(poly("p1", [0, 0, 10, 10])).azimuthDeg === 180);
check("toRoofPlaneInput honors global attribute defaults", (() => {
  const plane = toRoofPlaneInput(poly("p1", [0, 0, 10, 10]), { pitchDeg: 25, azimuthDeg: 90 });
  return plane.pitchDeg === 25 && plane.azimuthDeg === 90;
})());
check("toRoofPlaneInput honors per-polygon overrides", (() => {
  const plane = toRoofPlaneInput(poly("p1", [0, 0, 10, 10]), {
    pitchDeg: 10,
    perPolygon: { p1: { pitchDeg: 33 } },
  });
  return plane.pitchDeg === 33;
})());

check("toRoofSiteInput builds one plane per roof polygon", (() => {
  const site = toRoofSiteInput(image(), [poly("p1", [0, 0, 100, 100]), poly("p2", [200, 200, 300, 300])]);
  return site.planes.length === 2;
})());
check("toRoofSiteInput ignores obstacle-only sets for site planes", (() => {
  try {
    toRoofSiteInput(image(), [poly("o1", [0, 0, 10, 10], "obstacle")]);
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "NO_POLYGONS";
  }
})());
check("toRoofSiteInput carries metersPerPixel as metersPerUnit", (() => {
  const site = toRoofSiteInput(image({ metersPerPixel: 0.07 }), [poly("p1", [0, 0, 100, 100])]);
  return site.metersPerUnit === 0.07;
})());
check("toRoofSiteInput derives siteId from imageId", toRoofSiteInput(image({ imageId: "abc" }), [poly("p1", [0, 0, 100, 100])]).siteId === "roofsite-abc");
check("toRoofSiteInput throws for zero polygons", (() => {
  try {
    toRoofSiteInput(image(), []);
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "NO_POLYGONS";
  }
})());

check("converted site passes the engine's validateRoofSite", (() => {
  const site = toRoofSiteInput(image(), [poly("p1", [0, 0, 100, 100])]);
  return validateRoofSite(site).valid;
})());
check("converted site is analyzable by analyzeRoofSite", (() => {
  const site = toRoofSiteInput(image(), [poly("p1", [0, 0, 100, 100])]);
  const metrics = analyzeRoofSite(site);
  return metrics.planeCount === 1 && metrics.totalPlanAreaM2 > 0;
})());
check("engine area reflects the pixel→meter scale (100px @ 0.1 m/px = 10m square = 100 m²)", (() => {
  const site = toRoofSiteInput(image({ metersPerPixel: 0.1 }), [poly("p1", [0, 0, 100, 100])]);
  const metrics = analyzeRoofSite(site);
  return Math.abs(metrics.planes[0].planAreaM2 - 100) < 0.5;
})());
check("an L-shaped (concave) polygon converts and analyzes", (() => {
  const L: ExtractedPolygon = {
    polygonId: "L",
    regionId: "L-r",
    kind: "roof",
    verticesPx: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ],
    confidence: 0.8,
    label: "roof",
    boundsPx: { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 },
    areaPx2: 6400,
  };
  const site = toRoofSiteInput(image(), [L]);
  return analyzeRoofSite(site).planes[0].planAreaM2 > 0;
})());

check("validateSuggestionPolygon rejects <3 points", !validateSuggestionPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }]).ok);
check("validateSuggestionPolygon rejects self-intersecting bowtie", (() => {
  const r = validateSuggestionPolygon([
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ]);
  return !r.ok && r.code === "SELF_INTERSECTING_SUGGESTION";
})());
check("validateSuggestionPolygon accepts finite in-bounds square", validateSuggestionPolygon(poly("p1", [0, 0, 10, 10]).verticesPx).ok);

check("accept goes through studio addPlane only", (() => {
  const fake = createFakeMutations();
  const result = acceptSuggestionIntoStudio(fake.state, suggestion([poly("p1", [0, 0, 50, 50])]), fake.mutations);
  return result.ok && result.state.planes.length === 1 && fake.addPlaneCalls === 1;
})());
check("self-intersecting suggestion rejected by bridge without mutating state", (() => {
  const fake = createFakeMutations();
  const bad = poly("bad", [0, 0, 10, 10]);
  bad.verticesPx = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  const result = acceptSuggestionIntoStudio(fake.state, suggestion([bad]), fake.mutations);
  return !result.ok && result.code === "SELF_INTERSECTING_SUGGESTION" && result.state.planes.length === 0 && fake.addPlaneCalls === 0;
})());
check("reject does not mutate CAD state", (() => {
  const fake = createFakeMutations();
  const store = createRoofExtractionVersionStore("img-1");
  const sug = store.append({ source: "ai", polygons: [poly("p1", [0, 0, 10, 10])], note: "v1" });
  const before = fake.state;
  const result = rejectSuggestion(before, sug, store);
  return (
    result.ok &&
    Object.is(result.state, before) &&
    store.get(1)?.status === "proposed" &&
    store.get(2)?.status === "rejected" &&
    store.size() === 2
  );
})());
check("accept appends accepted transition without rewriting original", (() => {
  const fake = createFakeMutations();
  const store = createRoofExtractionVersionStore("img-1");
  const sug = store.append({ source: "ai", polygons: [poly("p1", [0, 0, 10, 10])], note: "v1" });
  const result = acceptSuggestionIntoStudio(fake.state, sug, fake.mutations, { versionStore: store });
  return (
    result.ok &&
    store.get(1)?.status === "proposed" &&
    store.get(2)?.status === "accepted" &&
    store.size() === 2
  );
})());
check("no NaN/Infinity in converted plane vertices", (() => {
  const site = toRoofSiteInput(image(), [poly("p1", [0, 0, 100, 100])]);
  return site.planes.every((p) => p.boundary.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)));
})());

check("vision sources do not reimplement polygonArea / pointInPolygon / self-intersection", (() => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  const files = [
    "PolygonExtraction.ts",
    "ConfidenceHeatmap.ts",
    "ManualCorrection.ts",
    "RoofGeometryConversion.ts",
    "RoofExtractionPipeline.ts",
    "RoofExtractionVersioning.ts",
  ].map((f) => join(root, f));
  const forbidden = [
    /function\s+polygonArea\s*\(/,
    /function\s+pointInPolygon\s*\(/,
    /function\s+detectPolygonSelfIntersections\s*\(/,
    /function\s+hasPolygonSelfIntersection\s*\(/,
  ];
  return files.every((file) => {
    const src = readFileSync(file, "utf8");
    return forbidden.every((re) => !re.test(src));
  });
})());

console.log(`\nRoofGeometryConversion tests: ${pass} passed`);
