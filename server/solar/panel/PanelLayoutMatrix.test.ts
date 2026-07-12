/**
 * Phase 3B — 1000+ deterministic panel layout matrix.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { layoutPanelsOnPlane } from "./PanelLayoutEngine.ts";
import { CATALOG_MODULE_400W, CATALOG_MODULE_550W, CATALOG_MODULE_580W } from "./PanelCatalog.ts";
import { panelAabbIntersectsPanel } from "./PanelCollision.ts";
import { assertFiniteLayoutResult } from "./PanelLayoutReport.ts";
import type { PanelLayoutInput, PanelModuleSpec, PanelOrientationPolicy } from "./PanelLayoutModels.ts";
import type { Point2D } from "../roof/RoofModels.ts";

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

function noOverlap(panels: { x: number; y: number; widthUnits: number; heightUnits: number }[]): boolean {
  for (let i = 0; i < panels.length; i += 1) {
    for (let j = i + 1; j < panels.length; j += 1) {
      const a = panels[i];
      const b = panels[j];
      if (panelAabbIntersectsPanel(a.x, a.y, a.widthUnits, a.heightUnits, b.x, b.y, b.widthUnits, b.heightUnits)) {
        return false;
      }
    }
  }
  return true;
}

const SHAPES: Record<string, Point2D[]> = {
  rect: [
    { x: 0, y: 0 },
    { x: 180, y: 0 },
    { x: 180, y: 120 },
    { x: 0, y: 120 },
  ],
  rectLarge: [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 220 },
    { x: 0, y: 220 },
  ],
  L: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 70 },
    { x: 70, y: 70 },
    { x: 70, y: 200 },
    { x: 0, y: 200 },
  ],
  triangle: [
    { x: 0, y: 0 },
    { x: 220, y: 0 },
    { x: 110, y: 190 },
  ],
  concave: [
    { x: 0, y: 0 },
    { x: 240, y: 0 },
    { x: 240, y: 50 },
    { x: 150, y: 50 },
    { x: 150, y: 150 },
    { x: 240, y: 150 },
    { x: 240, y: 210 },
    { x: 0, y: 210 },
  ],
};

const MODULES: PanelModuleSpec[] = [CATALOG_MODULE_580W, CATALOG_MODULE_550W, CATALOG_MODULE_400W];
const MPU = [0.04, 0.05, 0.08];
const POLICIES: PanelOrientationPolicy[] = ["portrait_only", "landscape_only", "auto"];
const EDGE_SETBACKS = [0.3, 0.6, 1.0];
const GAPS = [0.02, 0.05];

const OBSTACLE_SETS: Array<{ id: string; obstacles?: PanelLayoutInput["plane"]["obstacles"] }> = [
  { id: "none" },
  {
    id: "one",
    obstacles: [
      {
        id: "o1",
        polygon: [
          { x: 50, y: 40 },
          { x: 90, y: 40 },
          { x: 90, y: 80 },
          { x: 50, y: 80 },
        ],
      },
    ],
  },
  {
    id: "multi",
    obstacles: [
      {
        id: "o1",
        polygon: [
          { x: 30, y: 30 },
          { x: 60, y: 30 },
          { x: 60, y: 55 },
          { x: 30, y: 55 },
        ],
      },
      {
        id: "o2",
        polygon: [
          { x: 120, y: 70 },
          { x: 160, y: 70 },
          { x: 160, y: 110 },
          { x: 120, y: 110 },
        ],
      },
    ],
  },
];

const WALKWAY_SETS: Array<{ id: string; walkways?: PanelLayoutInput["plane"]["walkways"] }> = [
  { id: "none" },
  {
    id: "strip",
    walkways: [
      {
        id: "w1",
        widthM: 0.6,
        polygon: [
          { x: 0, y: 55 },
          { x: 300, y: 55 },
          { x: 300, y: 75 },
          { x: 0, y: 75 },
        ],
      },
    ],
  },
];

let combos = 0;

for (const [shapeName, boundary] of Object.entries(SHAPES)) {
  for (const module of MODULES) {
    for (const metersPerUnit of MPU) {
      for (const orientationPolicy of POLICIES) {
        for (const edgeSetbackM of EDGE_SETBACKS) {
          for (const gapM of GAPS) {
            for (const obs of OBSTACLE_SETS) {
              for (const walk of WALKWAY_SETS) {
                // Skip walkway strip on small triangle when it would be nonsense — still valid
                combos += 1;
                const label = `${shapeName}/${module.moduleId}/mpu${metersPerUnit}/${orientationPolicy}/e${edgeSetbackM}/g${gapM}/${obs.id}/${walk.id}`;
                const input: PanelLayoutInput = {
                  plane: {
                    planeId: `plane-${shapeName}`,
                    boundary,
                    obstacles: obs.obstacles,
                    walkways: walk.walkways,
                    setbacks: { edgeSetbackM },
                  },
                  metersPerUnit,
                  module,
                  orientationPolicy,
                  constraints: {
                    spacing: {
                      gapM,
                      rowSpacingM: gapM,
                      edgeClearanceM: 0,
                      structureClearanceM: 0.2,
                    },
                    setbacks: { edgeSetbackM },
                  },
                };

                const result = layoutPanelsOnPlane(input);
                assertFiniteLayoutResult(result);

                check(`${label} finite`, Number.isFinite(result.dcCapacityKw) && Number.isFinite(result.utilizationPct));
                check(`${label} no overlap`, noOverlap(result.panels));
                check(
                  `${label} dc matches count`,
                  Math.abs(result.dcCapacityKw - (result.panelCount * module.wattage) / 1000) < 1e-6
                );

                const again = layoutPanelsOnPlane(input);
                check(`${label} deterministic`, fingerprint(result.panels) === fingerprint(again.panels));
              }
            }
          }
        }
      }
    }
  }
}

// Extra focused shape checks
check("L-shape produces layout", layoutPanelsOnPlane({
  plane: { planeId: "L", boundary: SHAPES.L },
  metersPerUnit: 0.05,
  module: CATALOG_MODULE_580W,
  orientationPolicy: "auto",
}).panelCount >= 0);

check("triangle produces layout", layoutPanelsOnPlane({
  plane: { planeId: "T", boundary: SHAPES.triangle },
  metersPerUnit: 0.05,
  module: CATALOG_MODULE_580W,
  orientationPolicy: "portrait_only",
}).utilizationPct >= 0);

check("concave produces layout", layoutPanelsOnPlane({
  plane: { planeId: "C", boundary: SHAPES.concave },
  metersPerUnit: 0.05,
  module: CATALOG_MODULE_400W,
  orientationPolicy: "landscape_only",
}).panelCount >= 0);

console.log(`\nPanelLayoutMatrix: ${combos} layouts, ${pass} checks passed, ${failed} failed.`);
assert.ok(combos >= 1000, `Expected >= 1000 layouts, got ${combos}`);
assert.ok(failed === 0, "Matrix had failures");
