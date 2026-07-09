/**
 * Roof Intelligence Studio client tests.
 * Verifies the CAD editor adapter delegates all geometry to RoofGeometryEngine,
 * and that history/layers/editing behave deterministically.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { applyScaleCalibration } from "./roofStudioCalibration.ts";
import {
  LAYER_ORDER,
  MAX_HISTORY,
  addObstacle,
  addParapet,
  addPlane,
  addRidge,
  addValley,
  addWalkway,
  analyzeStudio,
  canMutateLayer,
  canRedo,
  canUndo,
  circleVertices,
  clearLayer,
  commit,
  createHistory,
  createInitialRoofStudioState,
  createRoofBackgroundImageManager,
  deleteBoundaryVertex,
  deleteLayerContents,
  deleteObstacle,
  deleteParapet,
  deleteRidge,
  deleteValley,
  deleteVertex,
  deleteWalkway,
  insertBoundaryVertex,
  insertVertex,
  isLayerLocked,
  isLayerVisible,
  isSupportedRoofImageType,
  layerForTool,
  layersForPlanePatch,
  measureAngleDeg,
  measureAreaM2,
  tryMeasureAreaM2,
  RoofCalibrationError,
  measureDistanceM,
  moveBoundaryVertex,
  moveVertex,
  planeGeometryLocked,
  planePatchBlocked,
  planeSelfIntersects,
  redo,
  removePlane,
  renameLayer,
  setLayer,
  snapToGrid,
  snapToVertices,
  toggleLayerLock,
  toggleLayerVisibility,
  undo,
  updateLayer,
  updateObstacle,
  updateParapet,
  updatePlane,
  updateRidge,
  updateValley,
  updateWalkway,
  type RoofObjectUrlAdapter,
} from "./roofStudioClient.ts";
import { analyzeRoofSite } from "../../server/solar/roof/RoofGeometryEngine.ts";
import { angleBetweenPointsDeg } from "../../server/solar/roof/RoofMeasurement.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  const ok = fn();
  assert.ok(ok, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const rect = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 120 },
  { x: 0, y: 120 },
];

function calibrateState(state: ReturnType<typeof createInitialRoofStudioState>) {
  const result = applyScaleCalibration({ x: 0, y: 0 }, { x: 200, y: 0 }, "10 m");
  if (!result) throw new Error("calibration failed");
  return { ...state, metersPerUnit: result.metersPerUnit, scaleCalibration: result.calibration };
}

function stateWithRect() {
  return calibrateState(addPlane(createInitialRoofStudioState(), rect, { pitchDeg: 15, azimuthDeg: 180 }));
}

/* -------- geometry rendering: delegated to engine, no duplication -------- */
check("uncalibrated complete plane returns null metrics (no guessed capacity)", () => {
  const state = addPlane(createInitialRoofStudioState(), rect, { pitchDeg: 15, azimuthDeg: 180 });
  const studio = analyzeStudio(state);
  return studio.ok && studio.hasCompletePlane && studio.metrics === null && studio.statistics === null;
});

check("analyzeStudio delegates to RoofGeometryEngine (identical totals)", () => {
  const state = stateWithRect();
  const studio = analyzeStudio(state);
  const engine = analyzeRoofSite({
    siteId: state.siteId,
    metersPerUnit: state.metersPerUnit,
    northAzimuthDeg: state.northAzimuthDeg,
    planes: [
      { id: state.planes[0].id, boundary: rect, pitchDeg: 15, azimuthDeg: 180 },
    ],
  });
  return (
    studio.ok &&
    studio.metrics !== null &&
    studio.metrics.totalPlanAreaM2 === engine.totalPlanAreaM2 &&
    studio.metrics.totalTrueAreaM2 === engine.totalTrueAreaM2 &&
    studio.metrics.totalNetUsableAreaM2 === engine.totalNetUsableAreaM2
  );
});

check("statistics expose gross/usable/capacity from engine metrics", () => {
  const studio = analyzeStudio(stateWithRect());
  const s = studio.statistics!;
  return s.grossAreaM2 > 0 && s.usableAreaM2 >= 0 && s.capacityKw >= 0 && s.planeCount === 1;
});

check("no complete plane => null metrics, no error", () => {
  const studio = analyzeStudio(createInitialRoofStudioState());
  return studio.ok && !studio.hasCompletePlane && studio.metrics === null && studio.error === null;
});

/* -------- undo / redo -------- */
check("undo reverts a plane addition", () => {
  const h0 = createHistory(createInitialRoofStudioState());
  const h1 = commit(h0, addPlane(h0.present, rect));
  const back = undo(h1);
  return canUndo(h1) && !canUndo(back) && back.present.planes.length === 0 && h1.present.planes.length === 1;
});

check("redo restores an undone change", () => {
  const h0 = createHistory(createInitialRoofStudioState());
  const h1 = commit(h0, addPlane(h0.present, rect));
  const back = undo(h1);
  const forward = redo(back);
  return canRedo(back) && forward.present.planes.length === 1 && !canRedo(forward);
});

check("new commit clears the redo stack", () => {
  const h0 = createHistory(createInitialRoofStudioState());
  const h1 = commit(h0, addPlane(h0.present, rect));
  const back = undo(h1);
  const h2 = commit(back, addPlane(back.present, rect));
  return !canRedo(h2) && h2.present.planes.length === 1;
});

/* -------- polygon editing -------- */
check("insertVertex adds a point after the given edge", () => {
  const next = insertVertex(rect, 0, { x: 100, y: 0 });
  return next.length === 5 && next[1].x === 100 && next[1].y === 0;
});

check("moveVertex relocates a single vertex", () => {
  const next = moveVertex(rect, 2, { x: 250, y: 150 });
  return next.length === 4 && next[2].x === 250 && next[2].y === 150;
});

check("deleteVertex guards minimum triangle", () => {
  const four = deleteVertex(rect, 0);
  const triangle = deleteVertex(four, 0);
  return four.length === 3 && triangle.length === 3;
});

check("editing a plane boundary updates engine-computed area", () => {
  const state = stateWithRect();
  const before = analyzeStudio(state).statistics!.grossAreaM2;
  const bigger = updatePlane(state, state.planes[0].id, {
    boundary: [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 240 },
      { x: 0, y: 240 },
    ],
  });
  const after = analyzeStudio(bigger).statistics!.grossAreaM2;
  return after > before;
});

/* -------- layer visibility -------- */
check("toggleLayerVisibility flips and is reversible", () => {
  const s0 = createInitialRoofStudioState();
  const s1 = toggleLayerVisibility(s0, "obstacle");
  const s2 = toggleLayerVisibility(s1, "obstacle");
  return isLayerVisible(s0, "obstacle") && !isLayerVisible(s1, "obstacle") && isLayerVisible(s2, "obstacle");
});

check("clearLayer(plane) removes all planes; clearLayer(obstacle) clears obstacles", () => {
  let state = stateWithRect();
  state = updatePlane(state, state.planes[0].id, {
    obstacles: [{ id: "o1", name: "o", shape: "rect", vertices: circleVertices(50, 50, 10), rotationDeg: 0, heightM: 1, clearanceM: 0.3 }],
  });
  const clearedObs = clearLayer(state, "obstacle");
  const clearedPlanes = clearLayer(state, "plane");
  return clearedObs.planes[0].obstacles.length === 0 && clearedPlanes.planes.length === 0;
});

/* -------- invalid polygons -------- */
check("self-intersecting boundary surfaces engine error (no throw)", () => {
  const bowtie = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  const state = addPlane(createInitialRoofStudioState(), bowtie);
  const studio = analyzeStudio(state);
  return !studio.ok && studio.error !== null && studio.error.errorCode === "INVALID_SELF_INTERSECTION";
});

check("planeSelfIntersects detects a bowtie and passes a clean rect", () => {
  const bowtie = { id: "p", name: "p", boundary: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }], pitchDeg: 0, azimuthDeg: 0, obstacles: [], walkways: [], parapets: [], ridges: [], valleys: [] };
  const clean = { ...bowtie, boundary: rect };
  return planeSelfIntersects(bowtie as any) && !planeSelfIntersects(clean as any);
});

check("NaN vertex in boundary surfaces an engine error, never throws", () => {
  const state = addPlane(createInitialRoofStudioState(), [
    { x: 0, y: 0 },
    { x: Number.NaN, y: 0 },
    { x: 100, y: 100 },
  ]);
  const studio = analyzeStudio(state);
  return !studio.ok && studio.error !== null;
});

check("Infinity vertex in boundary surfaces an engine error, never throws", () => {
  const state = addPlane(createInitialRoofStudioState(), [
    { x: 0, y: 0 },
    { x: Number.POSITIVE_INFINITY, y: 0 },
    { x: 100, y: 100 },
  ]);
  const studio = analyzeStudio(state);
  return !studio.ok && studio.error !== null && studio.metrics === null;
});

check("empty state is safe: no planes, no error, no throw", () => {
  const studio = analyzeStudio(createInitialRoofStudioState());
  return studio.ok && !studio.hasCompletePlane && studio.statistics === null && studio.error === null;
});

/* -------- layer lock -------- */
check("toggleLayerLock flips and is reversible", () => {
  const s0 = createInitialRoofStudioState();
  const s1 = toggleLayerLock(s0, "plane");
  const s2 = toggleLayerLock(s1, "plane");
  return !isLayerLocked(s0, "plane") && isLayerLocked(s1, "plane") && !isLayerLocked(s2, "plane");
});

/* -------- local background image: object URL revoked -------- */
check("image type guard accepts images and rejects others", () => {
  return (
    isSupportedRoofImageType("image/png") &&
    isSupportedRoofImageType("image/jpeg") &&
    !isSupportedRoofImageType("application/pdf") &&
    !isSupportedRoofImageType(undefined)
  );
});

check("uploaded image object URL is revoked on replace and on clear", () => {
  let created = 0;
  const revoked: string[] = [];
  const adapter: RoofObjectUrlAdapter = {
    create: () => {
      created += 1;
      return `blob:mock-${created}`;
    },
    revoke: (url) => revoked.push(url),
  };
  const mgr = createRoofBackgroundImageManager(adapter);

  const first = mgr.set({}, "earth-1.png");
  const second = mgr.set({}, "earth-2.png"); // replacing must revoke the first URL
  mgr.clear(); // clearing must revoke the second URL

  return (
    first?.url === "blob:mock-1" &&
    second?.url === "blob:mock-2" &&
    revoked.length === 2 &&
    revoked[0] === "blob:mock-1" &&
    revoked[1] === "blob:mock-2" &&
    mgr.get() === null &&
    mgr.revokedCount() === 2
  );
});

check("image manager clear on empty is a no-op (nothing to revoke)", () => {
  const revoked: string[] = [];
  const mgr = createRoofBackgroundImageManager({ create: () => "blob:x", revoke: (u) => revoked.push(u) });
  mgr.clear();
  return revoked.length === 0 && mgr.revokedCount() === 0;
});

/* -------- safety: no network / no save / no AI in studio + adapter source -------- */
check("roof studio adapter + component contain no network/save/AI calls", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const adapterSrc = readFileSync(resolve(here, "roofStudioClient.ts"), "utf8");
  const componentSrc = readFileSync(
    resolve(here, "../components/roofStudio/RoofIntelligenceStudio.tsx"),
    "utf8"
  );
  const forbidden = [
    "apiFetch",
    "fetch(",
    "axios",
    "XMLHttpRequest",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "saveQuote",
    "createQuote",
    "/api/",
    "anthropic",
    "openai",
  ];
  return forbidden.every((token) => !adapterSrc.includes(token) && !componentSrc.includes(token));
});

/* -------- snapping -------- */
check("snapToGrid rounds to nearest grid multiple", () => {
  const p = snapToGrid({ x: 23, y: 57 }, 20);
  return p.x === 20 && p.y === 60;
});

check("snapToVertices returns nearest vertex within threshold", () => {
  const p = snapToVertices({ x: 3, y: 2 }, rect, 10);
  return p.x === 0 && p.y === 0;
});

/* -------- measurement tools delegate to engine primitives -------- */
check("measureDistanceM converts units to meters via engine", () => {
  const d = measureDistanceM({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.05);
  return Math.abs(d - 5) < 1e-6;
});

check("measureAreaM2 and measureAngleDeg produce expected values", () => {
  const area = measureAreaM2(rect, 0.05);
  const angle = measureAngleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 });
  return Math.abs(area - 200 * 120 * 0.0025) < 0.01 && Math.abs(angle - 90) < 1e-6;
});

check("area measurement before calibration shows warning only", () => {
  const result = tryMeasureAreaM2(rect, 0);
  return !result.ok && result.message === "Calibrate scale first";
});

check("measureAreaM2 throws for scale 0", () => {
  try {
    measureAreaM2(rect, 0);
    return false;
  } catch (e) {
    return e instanceof RoofCalibrationError;
  }
});

check("measureAreaM2 throws for scale NaN", () => {
  try {
    measureAreaM2(rect, Number.NaN);
    return false;
  } catch (e) {
    return e instanceof RoofCalibrationError;
  }
});

check("measureAreaM2 throws for scale Infinity", () => {
  try {
    measureAreaM2(rect, Number.POSITIVE_INFINITY);
    return false;
  } catch (e) {
    return e instanceof RoofCalibrationError;
  }
});

check("measure-area UI uses tryMeasureAreaM2 (no guessed scale fallback)", () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../components/roofStudio/RoofIntelligenceStudio.tsx"),
    "utf8"
  );
  const forbidden = [
    /metersPerUnit\s*>\s*0\s*\?\s*metersPerUnit\s*:\s*1/,
    /finiteNum\(metersPerUnit,\s*1\)/,
    /metersPerUnit:\s*0\.01/,
  ];
  return src.includes("tryMeasureAreaM2(pts, state.metersPerUnit)") && forbidden.every((re) => !re.test(src));
});

/* -------- large roof performance -------- */
check("large roof (many planes + vertices) analyzes under 400ms", () => {
  let state = createInitialRoofStudioState();
  for (let i = 0; i < 40; i += 1) {
    const ox = (i % 8) * 260;
    const oy = Math.floor(i / 8) * 160;
    state = addPlane(state, [
      { x: ox, y: oy },
      { x: ox + 240, y: oy },
      { x: ox + 240, y: oy + 140 },
      { x: ox, y: oy + 140 },
    ]);
  }
  state = calibrateState(state);
  const t0 = Date.now();
  const studio = analyzeStudio(state);
  const elapsed = Date.now() - t0;
  return studio.ok && studio.metrics!.planeCount === 40 && elapsed < 400;
});

/* -------- no memory leaks: history is capped -------- */
check("history depth is capped at MAX_HISTORY", () => {
  let h = createHistory(createInitialRoofStudioState());
  for (let i = 0; i < MAX_HISTORY + 40; i += 1) {
    h = commit(h, addPlane(h.present, rect));
  }
  return h.past.length <= MAX_HISTORY && h.future.length === 0;
});

check("undo/redo cycling does not grow arrays unbounded", () => {
  let h = createHistory(createInitialRoofStudioState());
  for (let i = 0; i < 10; i += 1) h = commit(h, addPlane(h.present, rect));
  for (let i = 0; i < 100; i += 1) {
    h = undo(h);
    h = redo(h);
  }
  return h.past.length <= MAX_HISTORY && h.future.length <= MAX_HISTORY;
});

/* -------- layer locking (adapter-level enforcement) -------- */
function obstacle(id = "o1") {
  return { id, name: "o", shape: "rect" as const, vertices: circleVertices(50, 50, 10), rotationDeg: 0, heightM: 1, clearanceM: 0.3 };
}
function walkway(id = "w1") {
  return { id, name: "w", vertices: rect, widthM: 0.6 };
}
function parapet(id = "pp1") {
  return { id, name: "pp", vertices: rect, heightM: 1, thicknessM: 0.3 };
}
function line(id = "l1") {
  return { id, name: "l", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
}

check("locked plane layer blocks addPlane", () => {
  const locked = toggleLayerLock(createInitialRoofStudioState(), "plane");
  return planeGeometryLocked(locked) && addPlane(locked, rect).planes.length === 0;
});

check("locked boundary layer blocks addPlane", () => {
  const locked = toggleLayerLock(createInitialRoofStudioState(), "boundary");
  return addPlane(locked, rect).planes.length === 0;
});

check("locked plane blocks updatePlane (name/pitch/boundary) and removePlane", () => {
  const base = stateWithRect();
  const id = base.planes[0].id;
  const locked = toggleLayerLock(base, "plane");
  const renamed = updatePlane(locked, id, { name: "changed" });
  const repitched = updatePlane(locked, id, { pitchDeg: 40 });
  const removed = removePlane(locked, id);
  return renamed.planes[0].name === base.planes[0].name && repitched.planes[0].pitchDeg === 15 && removed.planes.length === 1;
});

check("locked plane blocks vertex move/insert/delete via updatePlane(boundary)", () => {
  const base = stateWithRect();
  const id = base.planes[0].id;
  const locked = toggleLayerLock(base, "plane");
  const moved = updatePlane(locked, id, { boundary: moveVertex(base.planes[0].boundary, 0, { x: -50, y: -50 }) });
  const inserted = updatePlane(locked, id, { boundary: insertVertex(base.planes[0].boundary, 0, { x: 100, y: 0 }) });
  const deleted = updatePlane(locked, id, { boundary: deleteVertex(base.planes[0].boundary, 0) });
  return moved.planes[0].boundary.length === 4 && moved.planes[0].boundary[0].x === 0 && inserted.planes[0].boundary.length === 4 && deleted.planes[0].boundary.length === 4;
});

check("locked obstacle layer blocks add/update and clear", () => {
  let base = stateWithRect();
  const id = base.planes[0].id;
  base = updatePlane(base, id, { obstacles: [obstacle()] });
  const locked = toggleLayerLock(base, "obstacle");
  const added = updatePlane(locked, id, { obstacles: [obstacle("a"), obstacle("b")] });
  const cleared = clearLayer(locked, "obstacle");
  return added.planes[0].obstacles.length === 1 && cleared.planes[0].obstacles.length === 1;
});

check("locked walkway/parapet/ridge/valley layers block their mutations", () => {
  const base = stateWithRect();
  const id = base.planes[0].id;
  const lw = toggleLayerLock(base, "walkway");
  const lp = toggleLayerLock(base, "parapet");
  const lr = toggleLayerLock(base, "ridge");
  const lv = toggleLayerLock(base, "valley");
  return (
    updatePlane(lw, id, { walkways: [walkway()] }).planes[0].walkways.length === 0 &&
    updatePlane(lp, id, { parapets: [parapet()] }).planes[0].parapets.length === 0 &&
    updatePlane(lr, id, { ridges: [line()] }).planes[0].ridges.length === 0 &&
    updatePlane(lv, id, { valleys: [line()] }).planes[0].valleys.length === 0
  );
});

check("clearLayer respects lock for feature layers and plane layer", () => {
  let base = stateWithRect();
  const id = base.planes[0].id;
  base = updatePlane(base, id, { walkways: [walkway()] });
  const lockedWalk = toggleLayerLock(base, "walkway");
  const lockedPlane = toggleLayerLock(base, "plane");
  return clearLayer(lockedWalk, "walkway").planes[0].walkways.length === 1 && clearLayer(lockedPlane, "plane").planes.length === 1;
});

check("unlocked behavior is unchanged (add/update/clear all apply)", () => {
  let s = createInitialRoofStudioState();
  s = addPlane(s, rect);
  const id = s.planes[0].id;
  s = updatePlane(s, id, { pitchDeg: 22, obstacles: [obstacle()] });
  const clearedObs = clearLayer(s, "obstacle");
  return s.planes.length === 1 && s.planes[0].pitchDeg === 22 && s.planes[0].obstacles.length === 1 && clearedObs.planes[0].obstacles.length === 0;
});

check("planePatchBlocked / layersForPlanePatch map keys to layers", () => {
  const base = stateWithRect();
  const lockedObs = toggleLayerLock(base, "obstacle");
  return (
    JSON.stringify(layersForPlanePatch({ boundary: rect }).sort()) === JSON.stringify(["boundary", "plane"]) &&
    layersForPlanePatch({ obstacles: [] })[0] === "obstacle" &&
    planePatchBlocked(lockedObs, { obstacles: [obstacle()] }) &&
    !planePatchBlocked(lockedObs, { pitchDeg: 5 })
  );
});

check("layerForTool maps drawing tools and returns null for measurement tools", () => {
  return (
    layerForTool("plane") === "plane" &&
    layerForTool("obstacle-circle") === "obstacle" &&
    layerForTool("walkway") === "walkway" &&
    layerForTool("ridge") === "ridge" &&
    layerForTool("measure-angle") === null &&
    layerForTool("select") === null
  );
});

/* -------- locked-layer rename -------- */
check("locked layer cannot be renamed via client adapter", () => {
  const locked = toggleLayerLock(createInitialRoofStudioState(), "obstacle");
  const before = locked.layers.obstacle.name;
  const after = renameLayer(locked, "obstacle", "Chimneys");
  return after.layers.obstacle.name === before;
});

check("unlocked layer can be renamed via client adapter", () => {
  const s = renameLayer(createInitialRoofStudioState(), "obstacle", "Chimneys");
  return s.layers.obstacle.name === "Chimneys";
});

check("locked layer state remains deep-equal after rename attempt", () => {
  const locked = toggleLayerLock(createInitialRoofStudioState(), "ridge");
  const after = renameLayer(locked, "ridge", "Hips");
  assert.deepStrictEqual(after, locked);
  return true;
});

check("locked layer name input is disabled/read-only in UI", () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../components/roofStudio/RoofIntelligenceStudio.tsx"), "utf8");
  return /disabled=\{layer\.locked\}/.test(src) && /readOnly=\{layer\.locked\}/.test(src);
});

/* -------- measurement delegation -------- */
check("measureAngleDeg delegates to engine angleBetweenPointsDeg", () => {
  const cases: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }][] = [
    [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
    [{ x: 2, y: 3 }, { x: 1, y: 1 }, { x: -4, y: 2 }],
    [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }],
  ];
  return cases.every(([a, v, b]) => measureAngleDeg(a, v, b) === angleBetweenPointsDeg(a, v, b));
});

check("no duplicate local angle math remains in client (no Math.acos)", () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "roofStudioClient.ts"), "utf8");
  return !src.includes("Math.acos") && src.includes("angleBetweenPointsDeg");
});

/* -------- centralized mutation-guard architecture -------- */

/** Build a state with one of every feature, then lock every layer. */
function fullyLockedStateWithContent() {
  let s = stateWithRect();
  const id = s.planes[0].id;
  s = addObstacle(s, id, obstacle("o1"));
  s = addWalkway(s, id, walkway("w1"));
  s = addParapet(s, id, parapet("pp1"));
  s = addRidge(s, id, line("r1"));
  s = addValley(s, id, line("v1"));
  for (const t of LAYER_ORDER) s = toggleLayerLock(s, t);
  return s;
}

check("canMutateLayer is fail-closed for locked layers and plane geometry", () => {
  const base = stateWithRect();
  const lockedObs = toggleLayerLock(base, "obstacle");
  const lockedBoundary = toggleLayerLock(base, "boundary");
  return (
    canMutateLayer(base, "obstacle") &&
    !canMutateLayer(lockedObs, "obstacle") &&
    canMutateLayer(base, ["plane", "boundary"]) &&
    !canMutateLayer(lockedBoundary, "plane") &&
    !canMutateLayer(lockedBoundary, ["obstacle", "plane"])
  );
});

check("locked layers: EVERY state mutation leaves state byte-for-byte unchanged", () => {
  const locked = fullyLockedStateWithContent();
  const id = locked.planes[0].id;
  const attempts = [
    setLayer(locked, "obstacle", { name: "x" }),
    setLayer(locked, "obstacle", { visible: false }),
    updateLayer(locked, "obstacle", { name: "x" }),
    renameLayer(locked, "obstacle", "x"),
    toggleLayerVisibility(locked, "obstacle"),
    clearLayer(locked, "obstacle"),
    deleteLayerContents(locked, "walkway"),
    clearLayer(locked, "plane"),
    addPlane(locked, rect),
    removePlane(locked, id),
    updatePlane(locked, id, { pitchDeg: 99, obstacles: [] }),
    moveBoundaryVertex(locked, id, 0, { x: -1, y: -1 }),
    insertBoundaryVertex(locked, id, 0, { x: 5, y: 5 }),
    deleteBoundaryVertex(locked, id, 0),
    addObstacle(locked, id, obstacle("z")),
    updateObstacle(locked, id, "o1", { heightM: 9 }),
    deleteObstacle(locked, id, "o1"),
    addWalkway(locked, id, walkway("z")),
    updateWalkway(locked, id, "w1", { widthM: 9 }),
    deleteWalkway(locked, id, "w1"),
    addParapet(locked, id, parapet("z")),
    updateParapet(locked, id, "pp1", { heightM: 9 }),
    deleteParapet(locked, id, "pp1"),
    addRidge(locked, id, line("z")),
    updateRidge(locked, id, "r1", { name: "z" }),
    deleteRidge(locked, id, "r1"),
    addValley(locked, id, line("z")),
    updateValley(locked, id, "v1", { name: "z" }),
    deleteValley(locked, id, "v1"),
  ];
  // Blocked mutations return the SAME reference (strongest byte-for-byte guarantee).
  for (const a of attempts) assert.strictEqual(a, locked, "a blocked mutation did not return the unchanged state");
  return attempts.every((a) => a === locked);
});

check("only unlocking is permitted while locked (lock toggle is the escape hatch)", () => {
  const locked = toggleLayerLock(createInitialRoofStudioState(), "obstacle");
  const unlocked = toggleLayerLock(locked, "obstacle");
  return locked.layers.obstacle.locked && !unlocked.layers.obstacle.locked && canMutateLayer(unlocked, "obstacle");
});

check("unlocked feature CRUD via central helpers all apply", () => {
  let s = stateWithRect();
  const id = s.planes[0].id;
  s = addObstacle(s, id, obstacle("o1"));
  s = updateObstacle(s, id, "o1", { heightM: 4 });
  s = addWalkway(s, id, walkway("w1"));
  s = addParapet(s, id, parapet("pp1"));
  s = addRidge(s, id, line("r1"));
  s = addValley(s, id, line("v1"));
  s = moveBoundaryVertex(s, id, 0, { x: 5, y: 5 });
  const p = s.planes[0];
  return (
    p.obstacles.length === 1 && p.obstacles[0].heightM === 4 && p.walkways.length === 1 &&
    p.parapets.length === 1 && p.ridges.length === 1 && p.valleys.length === 1 && p.boundary[0].x === 5
  );
});

/* Static audit: every exported state-mutation routes through the ONE central guard. */
function bodyOf(src: string, name: string): string {
  const idx = src.search(new RegExp(`function ${name}\\(`));
  if (idx < 0) return "";
  const rest = src.slice(idx + `function ${name}`.length);
  const nextIdx = rest.search(/\n(?:export )?function /);
  return nextIdx < 0 ? rest : rest.slice(0, nextIdx);
}

check("architecture: single central guard, every mutation routes through it", () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "roofStudioClient.ts"), "utf8");

  // Exactly one guard implementation.
  const guardDefs = src.match(/export function canMutateLayer\(/g) ?? [];
  if (guardDefs.length !== 1) return false;

  // Primitive mutators reference the guard directly.
  const directGuard = ["setLayer", "clearLayer", "addPlane", "removePlane", "updatePlane", "mutatePlaneCollection"];
  if (!directGuard.every((fn) => bodyOf(src, fn).includes("canMutateLayer("))) return false;

  // Every feature CRUD + vertex mutator funnels through mutatePlaneCollection (which guards).
  const funnels = [
    "moveBoundaryVertex", "insertBoundaryVertex", "deleteBoundaryVertex",
    "addObstacle", "updateObstacle", "deleteObstacle",
    "addWalkway", "updateWalkway", "deleteWalkway",
    "addParapet", "updateParapet", "deleteParapet",
    "addRidge", "updateRidge", "deleteRidge",
    "addValley", "updateValley", "deleteValley",
  ];
  if (!funnels.every((fn) => bodyOf(src, fn).includes("mutatePlaneCollection("))) return false;

  // Completeness: every exported `(): RoofStudioState` mutation references an approved guarded path.
  const exportedMutations = [...src.matchAll(/export function (\w+)\([^)]*\):\s*RoofStudioState/g)].map((m) => m[1]);
  const notMutations = new Set(["createInitialRoofStudioState", "toggleLayerLock"]); // constructor + escape hatch
  const approved = ["canMutateLayer(", "mutatePlaneCollection(", "setLayer(", "clearLayer("];
  return exportedMutations
    .filter((fn) => !notMutations.has(fn))
    .every((fn) => approved.some((tok) => bodyOf(src, fn).includes(tok)));
});

console.log(`\nroofStudioClient tests: ${pass} passed`);
