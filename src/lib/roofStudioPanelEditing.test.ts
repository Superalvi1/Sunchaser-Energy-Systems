/**
 * Panel editing UX unit tests (client-only; no packing engine).
 */

import assert from "node:assert/strict";
import { createInitialRoofStudioState } from "./roofStudioClient.ts";
import { DEFAULT_PANEL_MODULE, type StudioPanelPlacement } from "./roofStudioPanels.ts";
import {
  PANEL_DUPLICATE_OFFSET_UNITS,
  beginPanelDragSession,
  copyPanelsToClipboard,
  duplicatePanels,
  evaluatePanelCollision,
  panelIdsInWorldRect,
  pastePanelsFromClipboard,
  removePanels,
  resolvePanelDragPlacements,
  rotatePanelInPlace,
  rotatePanels,
  snapPanelPosition,
  togglePanelIdSelection,
} from "./roofStudioPanelEditing.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const plane = {
  id: "p1",
  name: "Roof",
  boundary: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 120 },
    { x: 0, y: 120 },
  ],
  pitchDeg: 15,
  azimuthDeg: 180,
  obstacles: [],
  walkways: [],
  parapets: [],
  ridges: [],
  valleys: [],
};

const spec = DEFAULT_PANEL_MODULE;
const mpu = 0.05;

function panel(id: string, x: number, y: number, orientation: "portrait" | "landscape" = "portrait"): StudioPanelPlacement {
  return { id, planeId: "p1", x, y, orientation };
}

check("togglePanelIdSelection adds and removes ids", () => {
  const a = togglePanelIdSelection([], "a");
  const b = togglePanelIdSelection(a, "b");
  const c = togglePanelIdSelection(b, "a");
  return a.length === 1 && b.length === 2 && c.length === 1 && c[0] === "b";
});

check("evaluatePanelCollision detects overlapping panels", () => {
  const placements = [panel("a", 10, 10), panel("b", 12, 12)];
  const fb = evaluatePanelCollision(placements[1], placements, plane, spec, mpu);
  return fb.overlapsPanel && fb.colliding;
});

check("evaluatePanelCollision allows separated panels", () => {
  const placements = [panel("a", 10, 10), panel("b", 80, 10)];
  const fb = evaluatePanelCollision(placements[1], placements, plane, spec, mpu);
  return !fb.colliding;
});

check("snapPanelPosition snaps to roof left edge", () => {
  const p = panel("a", 3, 20);
  const snapped = snapPanelPosition(3, 20, p, plane, [p], spec, mpu, new Set(["a"]), 8);
  return snapped.snappedRoofEdge && snapped.x === 0;
});

check("snapPanelPosition snaps to adjacent panel", () => {
  const left = panel("a", 10, 20);
  const right = panel("b", 90, 20);
  const gapU = spec.gapM / mpu;
  const w = (spec.widthM / mpu);
  const targetX = left.x + w + gapU;
  const snapped = snapPanelPosition(targetX + 2, 20, right, plane, [left, right], spec, mpu, new Set(["b"]), 6);
  return snapped.snappedAdjacent && Math.abs(snapped.x - targetX) < 0.01;
});

check("rotatePanelInPlace keeps center and toggles orientation", () => {
  const p = panel("a", 20, 20, "portrait");
  const rotated = rotatePanelInPlace(p, spec, mpu);
  const oldW = spec.widthM / mpu;
  const oldH = spec.heightM / mpu;
  const cx = p.x + oldW / 2;
  const cy = p.y + oldH / 2;
  const newW = spec.heightM / mpu;
  const newH = spec.widthM / mpu;
  return (
    rotated.orientation === "landscape" &&
    Math.abs(rotated.x + newW / 2 - cx) < 0.01 &&
    Math.abs(rotated.y + newH / 2 - cy) < 0.01
  );
});

check("rotatePanels rotates only selected ids", () => {
  const placements = [panel("a", 10, 10), panel("b", 40, 10)];
  const next = rotatePanels(placements, new Set(["a"]), spec, mpu);
  return next[0].orientation === "landscape" && next[1].orientation === "portrait";
});

check("removePanels removes selected ids", () => {
  const placements = [panel("a", 10, 10), panel("b", 40, 10)];
  return removePanels(placements, new Set(["a"])).length === 1;
});

check("duplicatePanels offsets clones", () => {
  const placements = [panel("a", 10, 10)];
  const next = duplicatePanels(placements, new Set(["a"]));
  if (next.length !== 2) return false;
  const clone = next.find((p) => p.id !== "a");
  return (
    clone != null &&
    clone.x === 10 + PANEL_DUPLICATE_OFFSET_UNITS &&
    clone.y === 10 + PANEL_DUPLICATE_OFFSET_UNITS
  );
});

check("copy and paste clipboard preserves relative layout", () => {
  const placements = [panel("a", 10, 10), panel("b", 40, 20)];
  const clip = copyPanelsToClipboard(placements, new Set(["a", "b"]));
  const pasted = pastePanelsFromClipboard(clip, "p1", { x: 100, y: 100 });
  return pasted.length === 2 && pasted[0].x === 100 && pasted[1].x === 130;
});

check("panelIdsInWorldRect selects intersecting panels", () => {
  const placements = [panel("a", 10, 10), panel("b", 90, 90)];
  const ids = panelIdsInWorldRect(placements, spec, mpu, { minX: 0, minY: 0, maxX: 50, maxY: 50 });
  return ids.length === 1 && ids[0] === "a";
});

check("resolvePanelDragPlacements moves multiple selected panels", () => {
  const placements = [panel("a", 10, 10), panel("b", 40, 10)];
  const session = beginPanelDragSession(placements, "a", ["a", "b"], { x: 12, y: 12 });
  const { placements: next } = resolvePanelDragPlacements(
    session,
    placements,
    { x: 20, y: 20 },
    plane,
    spec,
    mpu
  );
  const movedA = next.find((p) => p.id === "a");
  const movedB = next.find((p) => p.id === "b");
  return movedA != null && movedB != null && movedA.x === 18 && movedB.x === 48;
});

check("resolvePanelDragPlacements flags collision when overlapping", () => {
  const placements = [panel("a", 10, 10), panel("b", 80, 10)];
  const session = beginPanelDragSession(placements, "b", ["b"], { x: 82, y: 12 });
  const { collidingIds } = resolvePanelDragPlacements(
    session,
    placements,
    { x: 12, y: 12 },
    plane,
    spec,
    mpu
  );
  return collidingIds.has("b");
});

check("createInitialRoofStudioState unchanged by panel editing module", () => {
  const s = createInitialRoofStudioState();
  return s.panelPlacements.length === 0 && s.panelSpec.orientation === "portrait";
});

console.log(`\nroofStudioPanelEditing tests: ${pass} passed`);
