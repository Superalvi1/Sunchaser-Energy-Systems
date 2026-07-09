import assert from "node:assert/strict";
import { addPolygon, addVertex, deletePolygon, deleteVertex, moveVertex } from "./ManualCorrection.ts";
import { VisionPipelineError, type ExtractedPolygon } from "./VisionModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function square(id = "p1"): ExtractedPolygon {
  return {
    polygonId: id,
    regionId: `${id}-r`,
    kind: "roof",
    verticesPx: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    confidence: 0.6,
    label: "roof",
    boundsPx: { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 },
    areaPx2: 10000,
  };
}

// --- moveVertex ---
check("moveVertex relocates the target vertex", (() => {
  const next = moveVertex([square()], "p1", 2, { x: 120, y: 120 });
  return next[0].verticesPx[2].x === 120 && next[0].verticesPx[2].y === 120;
})());
check("moveVertex recomputes bounds", (() => {
  const next = moveVertex([square()], "p1", 2, { x: 150, y: 150 });
  return next[0].boundsPx.maxX === 150 && next[0].boundsPx.maxY === 150;
})());
check("moveVertex sets confidence to 1 (operator-asserted)", moveVertex([square()], "p1", 0, { x: -10, y: -10 })[0].confidence === 1);
check("moveVertex does not mutate the input", (() => {
  const input = [square()];
  moveVertex(input, "p1", 2, { x: 999, y: 999 });
  return input[0].verticesPx[2].x === 100;
})());
check("moveVertex throws for an unknown polygon", (() => {
  try {
    moveVertex([square()], "missing", 0, { x: 0, y: 0 });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "POLYGON_NOT_FOUND";
  }
})());
check("moveVertex throws for an out-of-range index", (() => {
  try {
    moveVertex([square()], "p1", 9, { x: 0, y: 0 });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "INVALID_VERTEX_INDEX";
  }
})());
check("manual edit refuses a self-intersecting (bowtie) polygon", (() => {
  try {
    addPolygon(
      [],
      "bow",
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ]
    );
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "INVALID_EDIT";
  }
})());

// --- addVertex ---
check("addVertex inserts after the given index", (() => {
  const next = addVertex([square()], "p1", 0, { x: 50, y: -10 });
  return next[0].verticesPx.length === 5 && next[0].verticesPx[1].x === 50;
})());
check("addVertex at index -1 inserts at the start", (() => {
  const next = addVertex([square()], "p1", -1, { x: -5, y: 50 });
  return next[0].verticesPx[0].x === -5;
})());
check("addVertex throws for an out-of-range index", (() => {
  try {
    addVertex([square()], "p1", 9, { x: 0, y: 0 });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError;
  }
})());

// --- deleteVertex ---
check("deleteVertex removes the target vertex", (() => {
  const pentagon = square();
  pentagon.verticesPx = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 130 }, { x: 0, y: 100 }];
  const next = deleteVertex([pentagon], "p1", 3);
  return next[0].verticesPx.length === 4;
})());
check("deleteVertex refuses to drop below 3 vertices", (() => {
  const tri = square();
  tri.verticesPx = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
  try {
    deleteVertex([tri], "p1", 0);
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "MIN_VERTICES";
  }
})());

// --- addPolygon ---
check("addPolygon appends a new valid polygon", (() => {
  const next = addPolygon([square()], "p2", [{ x: 200, y: 200 }, { x: 260, y: 200 }, { x: 260, y: 260 }, { x: 200, y: 260 }]);
  return next.length === 2 && next[1].polygonId === "p2";
})());
check("addPolygon computes area/bounds for the new polygon", (() => {
  const next = addPolygon([], "p2", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
  return next[0].areaPx2 === 100 && next[0].boundsPx.width === 10;
})());
check("addPolygon throws for a duplicate id", (() => {
  try {
    addPolygon([square()], "p1", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "DUPLICATE_POLYGON_ID";
  }
})());
check("addPolygon throws for invalid geometry (2 vertices)", (() => {
  try {
    addPolygon([], "p2", [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "INVALID_EDIT";
  }
})());
check("addPolygon marks the new polygon at confidence 1", addPolygon([], "p2", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])[0].confidence === 1);

// --- deletePolygon ---
check("deletePolygon removes the target polygon", (() => {
  const next = deletePolygon([square("p1"), square("p2")], "p1");
  return next.length === 1 && next[0].polygonId === "p2";
})());
check("deletePolygon throws for an unknown polygon", (() => {
  try {
    deletePolygon([square()], "missing");
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "POLYGON_NOT_FOUND";
  }
})());
check("deletePolygon does not mutate the input", (() => {
  const input = [square("p1"), square("p2")];
  deletePolygon(input, "p1");
  return input.length === 2;
})());

console.log(`\nManualCorrection tests: ${pass} passed`);
