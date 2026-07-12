/**
 * Phase 3B panel layout engine unit tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { layoutPanelsOnPlane } from "./PanelLayoutEngine.ts";
import { CATALOG_MODULE_580W, validatePanelModule } from "./PanelCatalog.ts";
import { panelAabbIntersectsPanel, panelOutsideUsablePolygon } from "./PanelCollision.ts";
import { panelFootprintUnits } from "./PanelGeometry.ts";
import { PanelLayoutError, type PanelLayoutInput } from "./PanelLayoutModels.ts";
import { assertFiniteLayoutResult } from "./PanelLayoutReport.ts";
import type { Point2D } from "../roof/RoofModels.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  const ok = fn();
  assert.ok(ok, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const RECT: Point2D[] = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 150 },
  { x: 0, y: 150 },
];

const L_SHAPE: Point2D[] = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 80 },
  { x: 80, y: 80 },
  { x: 80, y: 200 },
  { x: 0, y: 200 },
];

const TRIANGLE: Point2D[] = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 100, y: 180 },
];

const CONCAVE: Point2D[] = [
  { x: 0, y: 0 },
  { x: 220, y: 0 },
  { x: 220, y: 60 },
  { x: 140, y: 60 },
  { x: 140, y: 140 },
  { x: 220, y: 140 },
  { x: 220, y: 200 },
  { x: 0, y: 200 },
];

function baseInput(boundary: Point2D[], overrides: Partial<PanelLayoutInput> = {}): PanelLayoutInput {
  return {
    plane: { planeId: "p1", boundary, ...(overrides.plane ?? {}) },
    metersPerUnit: 0.05,
    module: CATALOG_MODULE_580W,
    orientationPolicy: "portrait_only",
    ...overrides,
    plane: {
      planeId: "p1",
      boundary,
      ...(overrides.plane ?? {}),
    },
  };
}

check("catalog module validates", () => {
  validatePanelModule(CATALOG_MODULE_580W);
  return true;
});

check("rejects invalid module dimensions", () => {
  try {
    validatePanelModule({ ...CATALOG_MODULE_580W, widthM: Number.NaN });
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "INVALID_MODULE";
  }
});

check("rejects NaN metersPerUnit", () => {
  try {
    layoutPanelsOnPlane(baseInput(RECT, { metersPerUnit: Number.NaN }));
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "INVALID_METERS_PER_UNIT";
  }
});

check("rejects Infinity metersPerUnit", () => {
  try {
    layoutPanelsOnPlane(baseInput(RECT, { metersPerUnit: Number.POSITIVE_INFINITY }));
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError;
  }
});

check("NaN roof vertex rejected", () => {
  try {
    layoutPanelsOnPlane(
      baseInput([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ])
    );
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "NON_FINITE";
  }
});

check("Infinity roof vertex rejected", () => {
  try {
    layoutPanelsOnPlane(
      baseInput([
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ])
    );
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "NON_FINITE";
  }
});

check("null roof vertex rejected", () => {
  try {
    layoutPanelsOnPlane(baseInput([
      { x: 0, y: 0 },
      null as unknown as Point2D,
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]));
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "NON_FINITE";
  }
});

check("rejects self-intersecting roof", () => {
  const bowtie: Point2D[] = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  try {
    layoutPanelsOnPlane(baseInput(bowtie));
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "SELF_INTERSECTING_ROOF";
  }
});

check("rejects zero-area roof", () => {
  try {
    layoutPanelsOnPlane(
      baseInput([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 0 },
      ])
    );
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && (e.code === "ZERO_AREA_ROOF" || e.code === "SELF_INTERSECTING_ROOF");
  }
});

check("rejects <3 vertices", () => {
  try {
    layoutPanelsOnPlane(baseInput([{ x: 0, y: 0 }, { x: 1, y: 1 }]));
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "INSUFFICIENT_VERTICES";
  }
});

check("NaN obstacle vertex rejected", () => {
  try {
    layoutPanelsOnPlane(
      baseInput(RECT, {
        plane: {
          planeId: "p1",
          boundary: RECT,
          obstacles: [
            {
              id: "o1",
              polygon: [
                { x: 10, y: 10 },
                { x: Number.NaN, y: 10 },
                { x: 40, y: 40 },
                { x: 10, y: 40 },
              ],
            },
          ],
        },
      })
    );
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "NON_FINITE";
  }
});

check("Infinity obstacle vertex rejected", () => {
  try {
    layoutPanelsOnPlane(
      baseInput(RECT, {
        plane: {
          planeId: "p1",
          boundary: RECT,
          obstacles: [
            {
              id: "o1",
              polygon: [
                { x: 10, y: 10 },
                { x: Number.POSITIVE_INFINITY, y: 10 },
                { x: 40, y: 40 },
                { x: 10, y: 40 },
              ],
            },
          ],
        },
      })
    );
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "NON_FINITE";
  }
});

check("invalid walkway vertex rejected", () => {
  try {
    layoutPanelsOnPlane(
      baseInput(RECT, {
        plane: {
          planeId: "p1",
          boundary: RECT,
          walkways: [
            {
              id: "w1",
              widthM: 0.6,
              polygon: [
                { x: 0, y: 60 },
                { x: null as unknown as number, y: 60 },
                { x: 200, y: 90 },
                { x: 0, y: 90 },
              ],
            },
          ],
        },
      })
    );
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "NON_FINITE";
  }
});

check("obstacles as non-array rejected", () => {
  try {
    layoutPanelsOnPlane(
      baseInput(RECT, {
        plane: {
          planeId: "p1",
          boundary: RECT,
          obstacles: { id: "bad" } as unknown as PanelLayoutInput["plane"]["obstacles"],
        },
      })
    );
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "INVALID_OBSTACLE";
  }
});

check("walkways as non-array rejected", () => {
  try {
    layoutPanelsOnPlane(
      baseInput(RECT, {
        plane: {
          planeId: "p1",
          boundary: RECT,
          walkways: "strip" as unknown as PanelLayoutInput["plane"]["walkways"],
        },
      })
    );
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "INVALID_WALKWAY";
  }
});

check("unknown orientation policy rejected", () => {
  try {
    layoutPanelsOnPlane(
      baseInput(RECT, { orientationPolicy: "diagonal" as PanelLayoutInput["orientationPolicy"] })
    );
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "INVALID_ORIENTATION_POLICY";
  }
});

check("mixed throws MIXED_NOT_IMPLEMENTED", () => {
  try {
    layoutPanelsOnPlane(baseInput(RECT, { orientationPolicy: "mixed" }));
    return false;
  } catch (e) {
    return e instanceof PanelLayoutError && e.code === "MIXED_NOT_IMPLEMENTED";
  }
});

check("invalid obstruction does not silently disappear", () => {
  const clear = layoutPanelsOnPlane(baseInput(RECT));
  let threw = false;
  try {
    layoutPanelsOnPlane(
      baseInput(RECT, {
        plane: {
          planeId: "p1",
          boundary: RECT,
          obstacles: [
            {
              id: "ghost",
              polygon: [
                { x: 40, y: 40 },
                { x: Number.NaN, y: 40 },
                { x: 120, y: 110 },
                { x: 40, y: 110 },
              ],
            },
          ],
        },
      })
    );
  } catch (e) {
    threw = e instanceof PanelLayoutError;
  }
  // Must fail — must not return a successful layout equal to the clear roof
  return threw && clear.panelCount > 0;
});

check("no placement occurs after validation failure", () => {
  let result: ReturnType<typeof layoutPanelsOnPlane> | null = null;
  try {
    result = layoutPanelsOnPlane(
      baseInput([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0 },
        { x: 100, y: 50 },
      ])
    );
  } catch (e) {
    return e instanceof PanelLayoutError && result === null;
  }
  return false;
});

check("successful output recursively finite", () => {
  const r = layoutPanelsOnPlane(baseInput(RECT, { orientationPolicy: "auto" }));
  assertFiniteLayoutResult(r);
  return true;
});

check("portrait layout places panels with finite metrics", () => {
  const r = layoutPanelsOnPlane(baseInput(RECT, { orientationPolicy: "portrait_only" }));
  assertFiniteLayoutResult(r);
  return r.panelCount > 0 && r.dcCapacityKw > 0 && r.orientationUsed === "portrait";
});

check("landscape layout places panels", () => {
  const r = layoutPanelsOnPlane(baseInput(RECT, { orientationPolicy: "landscape_only" }));
  return r.panelCount > 0 && r.orientationUsed === "landscape";
});

check("auto orientation maximizes DC capacity", () => {
  const portrait = layoutPanelsOnPlane(baseInput(RECT, { orientationPolicy: "portrait_only" }));
  const landscape = layoutPanelsOnPlane(baseInput(RECT, { orientationPolicy: "landscape_only" }));
  const auto = layoutPanelsOnPlane(baseInput(RECT, { orientationPolicy: "auto" }));
  const best = Math.max(portrait.dcCapacityKw, landscape.dcCapacityKw);
  return Math.abs(auto.dcCapacityKw - best) < 1e-6;
});

check("L-shape roof packs without overlap", () => {
  const r = layoutPanelsOnPlane(baseInput(L_SHAPE));
  for (let i = 0; i < r.panels.length; i += 1) {
    for (let j = i + 1; j < r.panels.length; j += 1) {
      const a = r.panels[i];
      const b = r.panels[j];
      if (panelAabbIntersectsPanel(a.x, a.y, a.widthUnits, a.heightUnits, b.x, b.y, b.widthUnits, b.heightUnits)) {
        return false;
      }
    }
  }
  return r.panelCount >= 0;
});

check("triangle roof packs finite", () => {
  const r = layoutPanelsOnPlane(baseInput(TRIANGLE));
  assertFiniteLayoutResult(r);
  return Number.isFinite(r.utilizationPct);
});

check("concave roof packs finite", () => {
  const r = layoutPanelsOnPlane(baseInput(CONCAVE));
  assertFiniteLayoutResult(r);
  return true;
});

check("obstacles reduce panel count", () => {
  const clear = layoutPanelsOnPlane(baseInput(RECT));
  const blocked = layoutPanelsOnPlane(
    baseInput(RECT, {
      plane: {
        planeId: "p1",
        boundary: RECT,
        obstacles: [
          {
            id: "o1",
            polygon: [
              { x: 40, y: 40 },
              { x: 120, y: 40 },
              { x: 120, y: 110 },
              { x: 40, y: 110 },
            ],
            setbackM: 0.5,
          },
        ],
      },
    })
  );
  return blocked.panelCount < clear.panelCount;
});

check("walkways reduce panel count", () => {
  const clear = layoutPanelsOnPlane(baseInput(RECT));
  const withWalk = layoutPanelsOnPlane(
    baseInput(RECT, {
      plane: {
        planeId: "p1",
        boundary: RECT,
        walkways: [
          {
            id: "w1",
            widthM: 0.6,
            polygon: [
              { x: 0, y: 60 },
              { x: 200, y: 60 },
              { x: 200, y: 90 },
              { x: 0, y: 90 },
            ],
          },
        ],
      },
    })
  );
  return withWalk.panelCount < clear.panelCount;
});

check("fire setbacks reduce usable packing", () => {
  const tight = layoutPanelsOnPlane(
    baseInput(RECT, {
      constraints: { setbacks: { edgeSetbackM: 0.1 }, spacing: { gapM: 0.02, rowSpacingM: 0.02, edgeClearanceM: 0, structureClearanceM: 0.1 } },
    })
  );
  const fire = layoutPanelsOnPlane(
    baseInput(RECT, {
      constraints: { setbacks: { edgeSetbackM: 2.0 }, spacing: { gapM: 0.02, rowSpacingM: 0.02, edgeClearanceM: 0, structureClearanceM: 0.1 } },
    })
  );
  return fire.panelCount <= tight.panelCount;
});

check("exact collision: panels never overlap", () => {
  const r = layoutPanelsOnPlane(baseInput(RECT, { orientationPolicy: "auto" }));
  for (let i = 0; i < r.panels.length; i += 1) {
    for (let j = i + 1; j < r.panels.length; j += 1) {
      const a = r.panels[i];
      const b = r.panels[j];
      if (panelAabbIntersectsPanel(a.x, a.y, a.widthUnits, a.heightUnits, b.x, b.y, b.widthUnits, b.heightUnits)) {
        return false;
      }
    }
  }
  return true;
});

check("panels stay inside usable inset (corners)", () => {
  const r = layoutPanelsOnPlane(baseInput(RECT));
  // After packing, each panel's corners must be inside original boundary at least
  return r.panels.every((p) => !panelOutsideUsablePolygon(RECT, p.x, p.y, p.widthUnits, p.heightUnits));
});

check("DC capacity equals panelCount * wattage / 1000", () => {
  const r = layoutPanelsOnPlane(baseInput(RECT));
  const expected = Math.round((r.panelCount * CATALOG_MODULE_580W.wattage) / 1000 * 10000) / 10000;
  return Math.abs(r.dcCapacityKw - expected) < 1e-6;
});

check("deterministic repeat output", () => {
  const a = layoutPanelsOnPlane(baseInput(RECT, { orientationPolicy: "auto" }));
  const b = layoutPanelsOnPlane(baseInput(RECT, { orientationPolicy: "auto" }));
  return JSON.stringify(a.panels) === JSON.stringify(b.panels) && a.dcCapacityKw === b.dcCapacityKw;
});

check("portrait footprint differs from landscape", () => {
  const p = panelFootprintUnits(CATALOG_MODULE_580W, "portrait", 0.05);
  const l = panelFootprintUnits(CATALOG_MODULE_580W, "landscape", 0.05);
  return p.widthUnits !== l.widthUnits && p.heightUnits !== l.heightUnits;
});

check("no duplicated polygonArea / pointInPolygon / filterFiniteVertices in panel engine sources", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  const files = [
    "PanelLayoutEngine.ts",
    "PanelPackingSolver.ts",
    "PanelCollision.ts",
    "PanelGeometry.ts",
    "PanelPlacement.ts",
    "PanelLayoutReport.ts",
    "PanelConstraints.ts",
    "PanelCatalog.ts",
  ].map((f) => join(root, f));
  const forbidden = [
    /function\s+polygonArea\s*\(/,
    /function\s+pointInPolygon\s*\(/,
    /function\s+hasPolygonSelfIntersection\s*\(/,
    /function\s+detectPolygonSelfIntersections\s*\(/,
    /filterFiniteVertices/,
  ];
  return files.every((file) => {
    const src = readFileSync(file, "utf8");
    return forbidden.every((re) => !re.test(src));
  });
});

console.log(`\nPanelLayoutEngine tests: ${pass} passed`);
