/**
 * Append-only version history safety tests.
 */

import assert from "node:assert/strict";
import {
  assertFiniteVisionResult,
  createRoofExtractionVersionStore,
} from "./RoofExtractionVersioning.ts";
import { VisionPipelineError, type ExtractedPolygon } from "./VisionModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function poly(id: string): ExtractedPolygon {
  return {
    polygonId: id,
    regionId: `${id}-r`,
    kind: "roof",
    verticesPx: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    confidence: 0.9,
    label: "roof",
    boundsPx: { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 },
    areaPx2: 100,
  };
}

function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as object).every(isDeeplyFrozen);
}

function hasNonFinite(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(hasNonFinite);
  if (typeof value === "object") return Object.values(value as object).some(hasNonFinite);
  return false;
}

check("store requires a non-empty imageId", (() => {
  try {
    createRoofExtractionVersionStore("");
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError;
  }
})());
check("new store is empty", createRoofExtractionVersionStore("img").size() === 0);
check("new store head is null", createRoofExtractionVersionStore("img").head() === null);

check("first append is version 1 with null parent", (() => {
  const store = createRoofExtractionVersionStore("img");
  const v = store.append({ source: "ai", polygons: [poly("a")], note: "initial" });
  return v.version === 1 && v.parentVersion === null && v.status === "proposed";
})());
check("first append source is preserved", (() => {
  const store = createRoofExtractionVersionStore("img");
  return store.append({ source: "ai", polygons: [poly("a")], note: "x" }).source === "ai";
})());
check("second append is version 2 with parent 1", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "initial" });
  const v2 = store.append({ source: "manual", polygons: [poly("a"), poly("b")], note: "edit" });
  return v2.version === 2 && v2.parentVersion === 1;
})());
check("append supports an explicit parentVersion (branching)", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  store.append({ source: "manual", polygons: [poly("a")], note: "v2" });
  const v3 = store.append({ source: "manual", polygons: [poly("a")], note: "branch", parentVersion: 1 });
  return v3.version === 3 && v3.parentVersion === 1;
})());
check("append throws for an out-of-range parentVersion", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  try {
    store.append({ source: "manual", polygons: [poly("a")], note: "x", parentVersion: 9 });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "INVALID_PARENT_VERSION";
  }
})());

check("accept appends new record and does not modify original", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  const before = structuredClone(store.get(1)!);
  const sizeBefore = store.size();
  const accepted = store.accept(1);
  const after = store.get(1)!;
  return (
    accepted.version === 2 &&
    accepted.status === "accepted" &&
    accepted.parentVersion === 1 &&
    store.size() === sizeBefore + 1 &&
    JSON.stringify(before) === JSON.stringify(after) &&
    after.status === "proposed"
  );
})());

check("reject appends new record and does not modify original", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  const before = structuredClone(store.get(1)!);
  const sizeBefore = store.size();
  const rejected = store.reject(1);
  const after = store.get(1)!;
  return (
    rejected.version === 2 &&
    rejected.status === "rejected" &&
    rejected.parentVersion === 1 &&
    store.size() === sizeBefore + 1 &&
    JSON.stringify(before) === JSON.stringify(after) &&
    after.status === "proposed"
  );
})());

check("correct appends new record and marks relation without changing original", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  const before = structuredClone(store.get(1)!);
  const sizeBefore = store.size();
  const corrected = store.correct([poly("a"), poly("b")], "manual fix");
  const after = store.get(1)!;
  return (
    corrected.version === 2 &&
    corrected.status === "corrected" &&
    corrected.source === "manual" &&
    corrected.parentVersion === 1 &&
    store.size() === sizeBefore + 1 &&
    JSON.stringify(before) === JSON.stringify(after) &&
    after.status === "proposed" &&
    !store.isActive(1) &&
    store.isActive(2)
  );
})());

check("history length increases after accept/reject/correct", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  const n0 = store.size();
  store.accept(1);
  const n1 = store.size();
  store.append({ source: "ai", polygons: [poly("b")], note: "v3" });
  store.reject(3);
  const n2 = store.size();
  store.append({ source: "ai", polygons: [poly("c")], note: "v5" });
  store.correct([poly("d")], "fix", 5);
  const n3 = store.size();
  return n1 === n0 + 1 && n2 === n1 + 2 && n3 === n2 + 2;
})());

check("previous record deep-equal before/after transition", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "stable" });
  const snap = JSON.stringify(store.get(1));
  store.accept(1);
  store.append({ source: "ai", polygons: [poly("b")], note: "other" });
  store.reject(3);
  return JSON.stringify(store.get(1)) === snap;
})());

check("reject keeps history and original remains proposed", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  store.reject(1);
  return store.size() === 2 && store.get(1)?.status === "proposed" && store.get(2)?.status === "rejected" && store.current().length === 0;
})());

check("accept leaves original proposed; transition is accepted", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  store.accept(1);
  return store.get(1)?.status === "proposed" && store.get(2)?.status === "accepted" && !store.isActive(1);
})());

check("current() returns only active proposed/corrected", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  store.correct([poly("b")], "fix");
  store.append({ source: "ai", polygons: [poly("c")], note: "extra" });
  store.reject(3);
  return store.current().map((s) => s.version).join(",") === "2";
})());

check("head returns the latest version", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  store.append({ source: "manual", polygons: [poly("b")], note: "v2" });
  return store.head()?.version === 2;
})());
check("get returns a specific version", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  store.append({ source: "manual", polygons: [poly("b")], note: "v2" });
  return store.get(1)?.note === "v1";
})());
check("get returns null out of range", createRoofExtractionVersionStore("img").get(1) === null);
check("history returns all versions in order", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  store.append({ source: "manual", polygons: [poly("b")], note: "v2" });
  return store.history().map((s) => s.version).join(",") === "1,2";
})());

check("get/history returns immutable (deeply frozen) copy", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  const g = store.get(1)!;
  const h = store.history()[0];
  return isDeeplyFrozen(g) && isDeeplyFrozen(h);
})());

check("external mutation cannot affect store", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  const copy = store.get(1)!;
  let threw = false;
  try {
    (copy as { note: string }).note = "hacked";
  } catch {
    threw = true;
  }
  try {
    (copy.polygons[0].verticesPx[0] as { x: number }).x = 999;
  } catch {
    threw = true;
  }
  const again = store.get(1)!;
  return threw && again.note === "v1" && again.polygons[0].verticesPx[0].x === 0;
})());

check("versions are immutable — mutating an input array does not change history", (() => {
  const store = createRoofExtractionVersionStore("img");
  const polys = [poly("a")];
  store.append({ source: "ai", polygons: polys, note: "v1" });
  polys.push(poly("z"));
  return store.get(1)!.polygons.length === 1;
})());
check("versions are immutable — mutating a stored polygon's vertices does not change history", (() => {
  const store = createRoofExtractionVersionStore("img");
  const p = poly("a");
  store.append({ source: "ai", polygons: [p], note: "v1" });
  p.verticesPx[0].x = 999;
  return store.get(1)!.polygons[0].verticesPx[0].x === 0;
})());

check("append rejects NaN vertex", (() => {
  const store = createRoofExtractionVersionStore("img");
  const bad = poly("a");
  bad.verticesPx[0] = { x: Number.NaN, y: 0 };
  try {
    store.append({ source: "ai", polygons: [bad], note: "bad" });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "INVALID_POLYGON_VERTEX" && store.size() === 0;
  }
})());
check("append rejects Infinity vertex", (() => {
  const store = createRoofExtractionVersionStore("img");
  const bad = poly("a");
  bad.verticesPx[1] = { x: Number.POSITIVE_INFINITY, y: 0 };
  try {
    store.append({ source: "ai", polygons: [bad], note: "bad" });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "INVALID_POLYGON_VERTEX" && store.size() === 0;
  }
})());
check("append rejects null vertex", (() => {
  const store = createRoofExtractionVersionStore("img");
  const bad = poly("a");
  (bad.verticesPx as unknown[])[2] = null;
  try {
    store.append({ source: "ai", polygons: [bad], note: "bad" });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "INVALID_POLYGON_VERTEX" && store.size() === 0;
  }
})());
check("append rejects <3 vertices", (() => {
  const store = createRoofExtractionVersionStore("img");
  const bad = poly("a");
  bad.verticesPx = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];
  try {
    store.append({ source: "ai", polygons: [bad], note: "bad" });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "INSUFFICIENT_VERTICES" && store.size() === 0;
  }
})());
check("append rejects self-intersecting polygon", (() => {
  const store = createRoofExtractionVersionStore("img");
  const bad = poly("a");
  bad.verticesPx = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  try {
    store.append({ source: "ai", polygons: [bad], note: "bad" });
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "SELF_INTERSECTING_SUGGESTION" && store.size() === 0;
  }
})());

check("successful history contains no NaN/Infinity recursively", (() => {
  const store = createRoofExtractionVersionStore("img");
  store.append({ source: "ai", polygons: [poly("a")], note: "v1" });
  store.correct([poly("b")], "fix");
  store.accept(2);
  const hist = store.history();
  assertFiniteVisionResult(hist);
  return !hasNonFinite(hist);
})());

check("createdAt uses the injected deterministic clock", (() => {
  const store = createRoofExtractionVersionStore("img", { now: () => "2026-03-03T00:00:00.000Z" });
  return store.append({ source: "ai", polygons: [poly("a")], note: "v1" }).createdAt === "2026-03-03T00:00:00.000Z";
})());
check("suggestionId embeds image id and version", (() => {
  const store = createRoofExtractionVersionStore("img-77");
  return store.append({ source: "ai", polygons: [poly("a")], note: "v1" }).suggestionId.includes("img-77-v1");
})());

console.log(`\nRoofExtractionVersioning tests: ${pass} passed`);
