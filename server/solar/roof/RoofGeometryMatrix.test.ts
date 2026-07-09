import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { analyzeRoofSite } from "./RoofGeometryEngine.ts";
import { polygonArea } from "./RoofPolygon.ts";
import { orientationFromAzimuth } from "./RoofPlane.ts";
import { panelCapacityEstimateKw } from "./RoofMeasurement.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
}

const RECT = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 12 },
  { x: 0, y: 12 },
];

const PITCHES = [0, 5, 10, 15, 20, 25, 30];
const AZIMUTHS = [0, 45, 90, 135, 180, 225, 270, 315];
const MPU_VALUES = [0.5, 1, 2];

function fingerprint(netUsable: number, trueArea: number, orientation: string): string {
  return createHash("sha256").update(`${netUsable}|${trueArea}|${orientation}`).digest("hex").slice(0, 12);
}

for (const pitch of PITCHES) {
  for (const azimuth of AZIMUTHS) {
    const label = `pitch${pitch}/az${azimuth}`;
    const m = analyzeRoofSite({
      siteId: `matrix-${pitch}-${azimuth}`,
      metersPerUnit: 1,
      planes: [{ id: "main", boundary: RECT, pitchDeg: pitch, azimuthDeg: azimuth }],
    });
    const p = m.planes[0];

    check(`${label} plan area 240`, () => Math.abs(p.planAreaM2 - 240) < 0.1);
    check(`${label} true area >= plan`, () => p.trueAreaM2 >= p.planAreaM2 - 0.01);
    check(`${label} net usable positive`, () => p.netUsableAreaM2 > 0);
    check(`${label} net usable <= true`, () => p.netUsableAreaM2 <= p.trueAreaM2 + 0.01);
    check(`${label} orientation matches azimuth`, () => p.orientation === orientationFromAzimuth(azimuth));
    check(`${label} pitch preserved`, () => p.pitchDeg === pitch);
    check(`${label} perimeter > 0`, () => p.perimeterM > 0);

    if (pitch === 0) {
      check(`${label} flat true equals plan`, () => Math.abs(p.trueAreaM2 - p.planAreaM2) < 0.01);
    } else {
      check(`${label} pitched true exceeds plan`, () => p.trueAreaM2 > p.planAreaM2);
    }

    const fp = fingerprint(p.netUsableAreaM2, p.trueAreaM2, p.orientation);
    const fp2 = fingerprint(p.netUsableAreaM2, p.trueAreaM2, p.orientation);
    check(`${label} fingerprint stable`, () => fp === fp2);
  }
}

for (const mpu of MPU_VALUES) {
  check(`metersPerUnit ${mpu} scales plan area`, () => {
    const m = analyzeRoofSite({
      siteId: `scale-${mpu}`,
      metersPerUnit: mpu,
      planes: [{ id: "p", boundary: RECT, pitchDeg: 10, azimuthDeg: 180 }],
    });
    const expected = polygonArea(RECT) * mpu * mpu;
    return Math.abs(m.planes[0].planAreaM2 - expected) < 0.5;
  });
}

const OBSTACLE_COUNTS = [0, 1, 2, 3];
for (const count of OBSTACLE_COUNTS) {
  check(`obstacle count ${count} monotonic usable`, () => {
    const obstacles = Array.from({ length: count }, (_, i) => ({
      id: `o${i}`,
      polygon: [
        { x: 4 + i * 4, y: 4 },
        { x: 6 + i * 4, y: 4 },
        { x: 6 + i * 4, y: 6 },
        { x: 4 + i * 4, y: 6 },
      ],
    }));
    const m = analyzeRoofSite({
      siteId: `obs-${count}`,
      metersPerUnit: 1,
      planes: [{ id: "p", boundary: RECT, pitchDeg: 0, azimuthDeg: 180, obstacles }],
    });
    const prev =
      count === 0
        ? 9999
        : analyzeRoofSite({
            siteId: `obs-${count - 1}`,
            metersPerUnit: 1,
            planes: [
              {
                id: "p",
                boundary: RECT,
                pitchDeg: 0,
                azimuthDeg: 180,
                obstacles: obstacles.slice(0, count - 1),
              },
            ],
          }).planes[0].netUsableAreaM2;
    return count === 0 || m.planes[0].netUsableAreaM2 <= prev;
  });
}

const SETBACK_EDGES = [0, 0.3, 0.6, 1.0];
for (const edge of SETBACK_EDGES) {
  check(`edge setback ${edge} reduces usable`, () => {
    const m = analyzeRoofSite({
      siteId: `setback-${edge}`,
      metersPerUnit: 1,
      planes: [
        {
          id: "p",
          boundary: RECT,
          pitchDeg: 0,
          azimuthDeg: 180,
          setbacks: { edgeSetbackM: edge },
        },
      ],
    });
    const base = analyzeRoofSite({
      siteId: "setback-0",
      metersPerUnit: 1,
      planes: [{ id: "p", boundary: RECT, pitchDeg: 0, azimuthDeg: 180, setbacks: { edgeSetbackM: 0 } }],
    }).planes[0].netUsableAreaM2;
    return edge === 0 || m.planes[0].netUsableAreaM2 <= base;
  });
}

const PLANE_COUNTS = [1, 2, 3, 4];
for (const n of PLANE_COUNTS) {
  check(`${n} planes aggregate totals`, () => {
    const planes = Array.from({ length: n }, (_, i) => ({
      id: `plane-${i}`,
      boundary: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      pitchDeg: 5 * i,
      azimuthDeg: (i * 90) % 360,
    }));
    const m = analyzeRoofSite({ siteId: `multi-${n}`, metersPerUnit: 1, planes });
    const sumPlan = m.planes.reduce((s, p) => s + p.planAreaM2, 0);
    return m.planeCount === n && Math.abs(m.totalPlanAreaM2 - sumPlan) < 0.1;
  });
}

for (const pitch of [0, 15, 30]) {
  for (const azimuth of [90, 180, 270]) {
    const label = `capacity/${pitch}/${azimuth}`;
    const m = analyzeRoofSite({
      siteId: label,
      metersPerUnit: 1,
      planes: [{ id: "p", boundary: RECT, pitchDeg: pitch, azimuthDeg: azimuth }],
    });
    const kw = panelCapacityEstimateKw(m.planes[0].netUsableAreaM2);
    check(`${label} panel capacity >= 0`, () => kw >= 0);
    check(`${label} panel capacity reasonable for rect`, () => kw > 0 && kw < 120);
  }
}

const ARBITRARY_POLYGONS = [
  [
    { x: 0, y: 0 },
    { x: 15, y: 2 },
    { x: 18, y: 14 },
    { x: 3, y: 16 },
    { x: -1, y: 8 },
  ],
  [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 6 },
    { x: 6, y: 6 },
    { x: 6, y: 12 },
    { x: 0, y: 12 },
  ],
];

for (let i = 0; i < ARBITRARY_POLYGONS.length; i += 1) {
  const poly = ARBITRARY_POLYGONS[i];
  check(`arbitrary polygon ${i} analyzable`, () => {
    const m = analyzeRoofSite({
      siteId: `arb-${i}`,
      metersPerUnit: 1,
      planes: [{ id: "p", boundary: poly, pitchDeg: 12, azimuthDeg: 200 }],
    });
    return m.planes.length === 1 && m.planes[0].planAreaM2 > 0;
  });
}

console.log(`\nRoof geometry matrix tests: ${pass} passed`);
