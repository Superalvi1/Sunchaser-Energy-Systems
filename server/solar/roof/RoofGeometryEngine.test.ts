import assert from "node:assert/strict";
import { analyzeRoofSite } from "./RoofGeometryEngine.ts";
import {
  detectPolygonSelfIntersections,
  hasPolygonSelfIntersection,
  polygonArea,
  pointInPolygon,
  polygonIsSimpleConvex,
  insetPolygonTowardCentroid,
} from "./RoofPolygon.ts";
import {
  normalizePitchDeg,
  normalizeAzimuthDeg,
  orientationFromAzimuth,
  trueAreaFromPlanM2,
  azimuthDeviationFromOptimal,
  normalizeRoofPlane,
} from "./RoofPlane.ts";
import { normalizeObstacles, safeObstacleRect } from "./RoofObstacle.ts";
import { angleBetweenPointsDeg } from "./RoofMeasurement.ts";
import { mergeSetbackConfig, DEFAULT_ROOF_SETBACKS } from "./RoofSetbackRules.ts";
import { computeUsableArea } from "./RoofUsableArea.ts";
import {
  validateRoofSite,
  assertValidRoofSite,
  validateBoundaryVertices,
  validateRoofSiteStrict,
} from "./RoofValidation.ts";
import { normalizeCoordinateSystem, trueAzimuthFromPlan } from "./RoofCoordinateSystem.ts";
import { InvalidRoofBoundaryError, RoofGeometryError } from "./RoofModels.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function throwsInvalidBoundary(name: string, fn: () => void, code?: string) {
  try {
    fn();
    assert.fail(`FAILED: ${name} — expected throw`);
  } catch (e) {
    assert.ok(e instanceof InvalidRoofBoundaryError, `FAILED: ${name} — wrong error type`);
    if (code) assert.equal(e.errorCode, code, `FAILED: ${name} — wrong error code`);
    pass += 1;
    console.log(`PASS: ${name}`);
  }
}

const RECT = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 12 },
  { x: 0, y: 12 },
];

const L_SHAPE = [
  { x: 0, y: 0 },
  { x: 16, y: 0 },
  { x: 16, y: 8 },
  { x: 8, y: 8 },
  { x: 8, y: 16 },
  { x: 0, y: 16 },
];

const BOWTIE = [
  { x: 0, y: 0 },
  { x: 10, y: 10 },
  { x: 10, y: 0 },
  { x: 0, y: 10 },
];

check("polygonArea rectangle is 240", () => Math.abs(polygonArea(RECT) - 240) < 0.01);
check("pointInPolygon interior", () => pointInPolygon({ x: 10, y: 6 }, RECT));
check("rectangle is convex", () => polygonIsSimpleConvex(RECT));
check("L-shape is not convex", () => !polygonIsSimpleConvex(L_SHAPE));
check("inset reduces area", () => polygonArea(insetPolygonTowardCentroid(RECT, 1)) < polygonArea(RECT));
check("normalizePitch clamps 0-60", () => normalizePitchDeg(90) === 60 && normalizePitchDeg(-5) === 0);
check("normalizeAzimuth wraps", () => normalizeAzimuthDeg(370) === 10);
check("orientation south at 180", () => orientationFromAzimuth(180) === "south");
check("true area increases with pitch", () => trueAreaFromPlanM2(100, 20) > 100);
check("azimuth deviation optimal south", () => azimuthDeviationFromOptimal(180) === 0);
check("mergeSetbackConfig defaults", () => mergeSetbackConfig({}).edgeSetbackM === DEFAULT_ROOF_SETBACKS.edgeSetbackM);
check("coordinate system defaults when mpu omitted", () => normalizeCoordinateSystem(undefined, undefined).metersPerUnit === 1);
check("trueAzimuthFromPlan applies north offset", () => trueAzimuthFromPlan(180, normalizeCoordinateSystem(undefined, 1, 10)) === 190);

check("bowtie polygon self-intersects", () => hasPolygonSelfIntersection(BOWTIE));
check("rectangle has no self-intersection", () => !hasPolygonSelfIntersection(RECT));
check("self-intersection reports edge indexes and point", () => {
  const hits = detectPolygonSelfIntersections(BOWTIE);
  return (
    hits.length > 0 &&
    Array.isArray(hits[0].edgeIndexes) &&
    hits[0].edgeIndexes.length === 2 &&
    Number.isFinite(hits[0].intersectionPoint.x) &&
    Number.isFinite(hits[0].intersectionPoint.y)
  );
});

throwsInvalidBoundary("validateBoundaryVertices rejects bowtie before area use", () => {
  validateBoundaryVertices(BOWTIE, "bowtie");
}, "INVALID_SELF_INTERSECTION");

throwsInvalidBoundary("validateBoundaryVertices rejects NaN vertex", () => {
  validateBoundaryVertices(
    [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 0 },
      { x: 10, y: 10 },
    ],
    "nan-plane"
  );
}, "INVALID_VERTEX");

throwsInvalidBoundary("validateBoundaryVertices rejects Infinity vertex", () => {
  validateBoundaryVertices(
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: Number.POSITIVE_INFINITY, y: 12 },
      { x: 0, y: 12 },
    ],
    "inf-plane"
  );
}, "INVALID_VERTEX");

check("validateRoofSite rejects empty planes", () => {
  const r = validateRoofSite({ siteId: "s1", planes: [] });
  return !r.valid && r.issues.some((i) => i.code === "NO_PLANES");
});

check("assertValidRoofSite throws on empty planes", () => {
  try {
    assertValidRoofSite({ siteId: "s1", planes: [] });
    return false;
  } catch (e) {
    return e instanceof RoofGeometryError && e.code === "NO_PLANES";
  }
});

check("validateRoofSiteStrict rejects negative metersPerUnit", () => {
  try {
    validateRoofSiteStrict({
      siteId: "bad-scale",
      metersPerUnit: -1,
      planes: [{ id: "p", boundary: RECT, pitchDeg: 0, azimuthDeg: 180 }],
    });
    return false;
  } catch (e) {
    return e instanceof RoofGeometryError && e.code === "INVALID_SCALE";
  }
});

check("analyzeRoofSite throws on self-intersecting boundary", () => {
  try {
    analyzeRoofSite({
      siteId: "bowtie-site",
      metersPerUnit: 1,
      planes: [{ id: "p", boundary: BOWTIE, pitchDeg: 0, azimuthDeg: 180 }],
    });
    return false;
  } catch (e) {
    return e instanceof InvalidRoofBoundaryError && e.errorCode === "INVALID_SELF_INTERSECTION";
  }
});

check("analyzeRoofSite throws on NaN boundary vertex", () => {
  try {
    analyzeRoofSite({
      siteId: "nan-site",
      metersPerUnit: 1,
      planes: [{ id: "p", boundary: [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 10, y: 10 }], pitchDeg: 0, azimuthDeg: 180 }],
    });
    return false;
  } catch (e) {
    return e instanceof InvalidRoofBoundaryError && e.errorCode === "INVALID_VERTEX";
  }
});

check("validateRoofSiteStrict rejects invalid obstacle polygon", () => {
  try {
    validateRoofSiteStrict({
      siteId: "obs-site",
      metersPerUnit: 1,
      planes: [
        {
          id: "p",
          boundary: RECT,
          pitchDeg: 0,
          azimuthDeg: 180,
          obstacles: [{ id: "bad", polygon: [{ x: NaN, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] }],
        },
      ],
    });
    return false;
  } catch (e) {
    return e instanceof InvalidRoofBoundaryError;
  }
});

check("normalizeObstacles returns validated obstacles only", () => {
  const obs = normalizeObstacles(
    [{ id: "chimney", polygon: safeObstacleRect(10, 6, 2, 2) }],
    RECT
  );
  return obs.length === 1 && obs[0].areaUnits > 0;
});

check("safeObstacleRect rejects negative dimensions", () => safeObstacleRect(5, 5, -1, 2).length === 0);

check("computeUsableArea net less than plan", () => {
  const plane = normalizeRoofPlane({
    id: "p1",
    boundary: RECT,
    pitchDeg: 10,
    azimuthDeg: 180,
    obstacles: [{ id: "chimney", polygon: safeObstacleRect(10, 6, 2, 2) }],
  });
  const u = computeUsableArea(plane, 1);
  return u.netUsablePlanM2 < u.planAreaM2 && u.obstacleAreaM2 > 0;
});

check("analyzeRoofSite multi-plane totals", () => {
  const m = analyzeRoofSite({
    siteId: "site-a",
    metersPerUnit: 1,
    planes: [
      { id: "a", boundary: RECT, pitchDeg: 0, azimuthDeg: 180 },
      { id: "b", boundary: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], pitchDeg: 5, azimuthDeg: 90 },
    ],
  });
  return m.planeCount === 2 && m.totalPlanAreaM2 === 340 && m.totalNetUsableAreaM2 > 0;
});

check("ridge and valley lengths computed", () => {
  const m = analyzeRoofSite({
    siteId: "site-b",
    metersPerUnit: 1,
    planes: [
      {
        id: "main",
        boundary: RECT,
        pitchDeg: 15,
        azimuthDeg: 180,
        ridges: [{ id: "r1", start: { x: 0, y: 6 }, end: { x: 20, y: 6 } }],
        valleys: [{ id: "v1", start: { x: 10, y: 0 }, end: { x: 10, y: 12 } }],
      },
    ],
  });
  const p = m.planes[0];
  return p.ridgeLengthM === 20 && p.valleyLengthM === 12;
});

check("parapet reduces usable area", () => {
  const plain = analyzeRoofSite({
    siteId: "plain",
    metersPerUnit: 1,
    planes: [{ id: "p", boundary: RECT, pitchDeg: 0, azimuthDeg: 180 }],
  });
  const parapet = analyzeRoofSite({
    siteId: "parapet",
    metersPerUnit: 1,
    planes: [
      {
        id: "p",
        boundary: RECT,
        pitchDeg: 0,
        azimuthDeg: 180,
        parapets: [{ id: "par", edgeIndex: 0, heightM: 1, thicknessM: 0.5 }],
      },
    ],
  });
  return parapet.planes[0].netUsableAreaM2 < plain.planes[0].netUsableAreaM2;
});

check("walkway reduces usable area", () => {
  const m = analyzeRoofSite({
    siteId: "walk",
    metersPerUnit: 1,
    planes: [
      {
        id: "p",
        boundary: RECT,
        pitchDeg: 0,
        azimuthDeg: 180,
        walkways: [
          {
            id: "w1",
            widthM: 0.6,
            polygon: [
              { x: 2, y: 5 },
              { x: 18, y: 5 },
              { x: 18, y: 7 },
              { x: 2, y: 7 },
            ],
          },
        ],
      },
    ],
  });
  return m.planes[0].walkwayAreaM2 > 0 && m.planes[0].netUsableAreaM2 < 240;
});

check("deterministic timestamp", () => {
  const a = analyzeRoofSite({
    siteId: "d",
    metersPerUnit: 1,
    planes: [{ id: "p", boundary: RECT, pitchDeg: 0, azimuthDeg: 180 }],
  });
  const b = analyzeRoofSite({
    siteId: "d",
    metersPerUnit: 1,
    planes: [{ id: "p", boundary: RECT, pitchDeg: 0, azimuthDeg: 180 }],
  });
  return a.generatedAt === b.generatedAt && a.totalNetUsableAreaM2 === b.totalNetUsableAreaM2;
});

check("angleBetweenPointsDeg right angle is 90", () =>
  Math.abs(angleBetweenPointsDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }) - 90) < 1e-9
);
check("angleBetweenPointsDeg straight line is 180", () =>
  Math.abs(angleBetweenPointsDeg({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }) - 180) < 1e-9
);
check("angleBetweenPointsDeg 45 degrees", () =>
  Math.abs(angleBetweenPointsDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }) - 45) < 1e-9
);
check("angleBetweenPointsDeg degenerate returns 0", () =>
  angleBetweenPointsDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }) === 0
);
check("angleBetweenPointsDeg rejects non-finite input", () =>
  angleBetweenPointsDeg({ x: Number.NaN, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }) === 0
);

console.log(`\nRoof geometry unit tests: ${pass} passed`);
