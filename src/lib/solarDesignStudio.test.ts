import assert from "node:assert/strict";
import {
  DESIGN_INCOMPLETE_MESSAGE,
  PROPOSAL_CLIENT_PREVIEW_LABEL,
  SYSTEM_SIZE_PRESETS,
  normalizeObstacles,
  pointInPolygon,
  polygonArea,
  proposalClientPreviewLabel,
  buildIncompleteProposalPreviewPages,
} from "./solarDesignStudio.ts";
import { SUPPORTED_SYSTEM_SIZES_KW } from "../../server/solar/proposal/SolarProposalModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const rectangle: { x: number; y: number }[] = [
  { x: 50, y: 50 },
  { x: 750, y: 50 },
  { x: 750, y: 450 },
  { x: 50, y: 450 },
];

check("polygonArea returns positive area for rectangle", polygonArea(rectangle) > 0);

check(
  "pointInPolygon detects interior point",
  pointInPolygon({ x: 400, y: 250 }, rectangle) && !pointInPolygon({ x: 10, y: 10 }, rectangle)
);

check("NaN and Infinity obstacles are ignored", () => {
  const normalized = normalizeObstacles(
    [
      { id: "nan", x: NaN, y: 50, w: 40, h: 40 },
      { id: "inf", x: 100, y: 100, w: Infinity, h: 40 },
    ],
    { canvasWidth: 800, canvasHeight: 500, roofBoundary: rectangle }
  );
  return normalized.length === 0;
});

check("negative obstacle dimensions are ignored", () => {
  const normalized = normalizeObstacles(
    [
      { id: "neg-w", x: 100, y: 100, w: -50, h: 40 },
      { id: "neg-h", x: 100, y: 100, w: 40, h: -30 },
    ],
    { canvasWidth: 800, canvasHeight: 500, roofBoundary: rectangle }
  );
  return normalized.length === 0;
});

check("valid obstacles clamp inside roof bounds", () => {
  const normalized = normalizeObstacles(
    [{ id: "big", x: 700, y: 400, w: 200, h: 200 }],
    { canvasWidth: 800, canvasHeight: 500, roofBoundary: rectangle }
  );
  return (
    normalized.length === 1 &&
    normalized[0].x + normalized[0].w <= 750 &&
    normalized[0].y + normalized[0].h <= 450
  );
});

check("proposalClientPreviewLabel never echoes raw client name", () => {
  return (
    proposalClientPreviewLabel("Fatima Shah CNIC 35202") === PROPOSAL_CLIENT_PREVIEW_LABEL &&
    !proposalClientPreviewLabel("Fatima Shah CNIC 35202").includes("Fatima")
  );
});

check("incomplete proposal pages show design incomplete message", () => {
  const pages = buildIncompleteProposalPreviewPages();
  return pages.length === 1 && pages[0].sections.some((s) => s.lines.includes(DESIGN_INCOMPLETE_MESSAGE));
});

check("SYSTEM_SIZE_PRESETS align with engine supported sizes", () => {
  return JSON.stringify(SYSTEM_SIZE_PRESETS) === JSON.stringify(SUPPORTED_SYSTEM_SIZES_KW);
});

console.log(`\nsolarDesignStudio tests: ${pass} passed`);
