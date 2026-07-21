import assert from "node:assert/strict";
import { buildConfidenceHeatmap } from "./ConfidenceHeatmap.ts";
import { extractPolygonFromRegion } from "./PolygonExtraction.ts";
import { VisionPipelineError, type ExtractedPolygon, type SegmentationRegion } from "./VisionModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function polygon(regionId: string, box: [number, number, number, number], confidence: number): ExtractedPolygon {
  const [minX, minY, maxX, maxY] = box;
  const region: SegmentationRegion = {
    regionId,
    contourPx: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }],
    confidence,
    label: "roof",
  };
  return extractPolygonFromRegion(region);
}

check("heatmap grid dimensions match cols/rows", (() => {
  const hm = buildConfidenceHeatmap(100, 100, [], { cellSizePx: 50 });
  return hm.cols === 2 && hm.rows === 2 && hm.cells.length === 4;
})());
check("heatmap rounds up partial cells", (() => {
  const hm = buildConfidenceHeatmap(120, 100, [], { cellSizePx: 50 });
  return hm.cols === 3 && hm.rows === 2;
})());
check("empty polygon set yields all-zero cells", (() => {
  const hm = buildConfidenceHeatmap(100, 100, [], { cellSizePx: 50 });
  return hm.cells.every((c) => c.value === 0);
})());
check("empty polygon set has meanConfidence 0", buildConfidenceHeatmap(100, 100, [], { cellSizePx: 50 }).meanConfidence === 0);

check("a full-cover polygon sets every covered cell to its confidence", (() => {
  const hm = buildConfidenceHeatmap(100, 100, [polygon("r", [0, 0, 100, 100], 0.7)], { cellSizePx: 50 });
  return hm.cells.every((c) => c.value === 0.7);
})());
check("meanConfidence reflects the covering polygon", (() => {
  const hm = buildConfidenceHeatmap(100, 100, [polygon("r", [0, 0, 100, 100], 0.7)], { cellSizePx: 50 });
  return hm.meanConfidence === 0.7;
})());
check("overlapping polygons take the max confidence per cell", (() => {
  const hm = buildConfidenceHeatmap(100, 100, [
    polygon("a", [0, 0, 100, 100], 0.4),
    polygon("b", [0, 0, 100, 100], 0.9),
  ], { cellSizePx: 50 });
  return hm.cells.every((c) => c.value === 0.9);
})());
check("a partial polygon leaves uncovered cells at 0", (() => {
  const hm = buildConfidenceHeatmap(100, 100, [polygon("r", [0, 0, 50, 50], 0.8)], { cellSizePx: 50 });
  const covered = hm.cells.filter((c) => c.value > 0);
  return covered.length === 1 && covered[0].col === 0 && covered[0].row === 0;
})());

check("cells carry pixel geometry", (() => {
  const hm = buildConfidenceHeatmap(100, 100, [], { cellSizePx: 50 });
  const cell = hm.cells.find((c) => c.col === 1 && c.row === 1)!;
  return cell.x === 50 && cell.y === 50 && cell.width === 50 && cell.height === 50;
})());
check("edge cells are clipped to image bounds", (() => {
  const hm = buildConfidenceHeatmap(120, 100, [], { cellSizePx: 50 });
  const edge = hm.cells.find((c) => c.col === 2 && c.row === 0)!;
  return edge.width === 20;
})());

check("heatmap is deterministic", (() => {
  const polys = [polygon("r", [0, 0, 100, 100], 0.5)];
  return (
    JSON.stringify(buildConfidenceHeatmap(200, 200, polys)) === JSON.stringify(buildConfidenceHeatmap(200, 200, polys))
  );
})());

check("throws for non-positive width", (() => {
  try {
    buildConfidenceHeatmap(0, 100, []);
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError;
  }
})());
check("throws for non-positive cell size", (() => {
  try {
    buildConfidenceHeatmap(100, 100, [], { cellSizePx: 0 });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError;
  }
})());

console.log(`\nConfidenceHeatmap tests: ${pass} passed`);
