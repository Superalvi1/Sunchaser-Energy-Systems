/**
 * Design Session client + store tests (RC-1.1).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoBrowserStorageInDesignSessionSources,
  buildDesignSessionPayload,
  buildResultsSnapshot,
  designSessionPayloadFingerprint,
  emptyDesignSessionPayload,
  parseDesignSessionPayload,
  sanitizeBackgroundImage,
} from "./designSessionClient.ts";
import { createInitialRoofStudioState } from "./roofStudioClient.ts";
import { DEFAULT_DESIGN_CONTROLS } from "./sunchaserDesignStudioClient.ts";
import {
  findLocalDesignSession,
  upsertLocalDesignSession,
  type DesignSessionRecord,
} from "../../server/designSessions/designSessionStore.ts";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0;

function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("sanitizeBackgroundImage drops blob URLs", () => {
  const bg = sanitizeBackgroundImage("blob:http://localhost/abc", "roof.png");
  assert.equal(bg.remoteUrl, null);
  assert.equal(bg.fileName, "roof.png");
  const remote = sanitizeBackgroundImage("https://maps.example/sat.png", "sat");
  assert.equal(remote.remoteUrl, "https://maps.example/sat.png");
});

check("build/parse round-trip preserves geometry and controls", () => {
  const state = createInitialRoofStudioState("lead-test");
  state.metersPerUnit = 0.05;
  state.scaleCalibration = {
    calibrated: true,
    lineStart: { x: 0, y: 0 },
    lineEnd: { x: 100, y: 0 },
    realLengthM: 5,
    inputLabel: "5 m",
  };
  state.planes = [
    {
      id: "p1",
      name: "Roof A",
      boundary: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
        { x: 0, y: 80 },
      ],
      pitchDeg: 15,
      azimuthDeg: 180,
      obstacles: [
        {
          id: "o1",
          name: "HVAC",
          shape: "rect",
          vertices: [
            { x: 40, y: 30 },
            { x: 55, y: 30 },
            { x: 55, y: 45 },
            { x: 40, y: 45 },
          ],
          clearanceM: 0.3,
        },
      ],
      walkways: [],
      parapets: [],
      ridges: [],
      valleys: [],
    },
  ];
  state.selectedPlaneId = "p1";

  const payload = buildDesignSessionPayload({
    roofStudioState: state,
    controls: { ...DEFAULT_DESIGN_CONTROLS, moduleId: "mod-580", tiltDeg: 18 },
    alignment: "left",
    address: "Lahore",
    latText: "31.5",
    lngText: "74.3",
    imageUrl: "https://example.com/sat.png",
    imageFileName: "sat",
    layoutResult: null,
    live: null,
  });

  const parsed = parseDesignSessionPayload(payload);
  assert.ok(parsed);
  assert.equal(parsed!.address, "Lahore");
  assert.equal(parsed!.alignment, "left");
  assert.equal(parsed!.controls.tiltDeg, 18);
  assert.equal(parsed!.roofStudioState.planes.length, 1);
  assert.equal(parsed!.roofStudioState.planes[0].obstacles.length, 1);
  assert.equal(parsed!.backgroundImage.remoteUrl, "https://example.com/sat.png");
  assert.equal(parsed!.schemaVersion, 1);
});

check("fingerprint changes when roof edits", () => {
  const a = emptyDesignSessionPayload("lead-a");
  const b = emptyDesignSessionPayload("lead-a");
  b.roofStudioState.planes = [
    {
      id: "p1",
      name: "R",
      boundary: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      pitchDeg: 10,
      azimuthDeg: 180,
      obstacles: [],
      walkways: [],
      parapets: [],
      ridges: [],
      valleys: [],
    },
  ];
  assert.notEqual(designSessionPayloadFingerprint(a), designSessionPayloadFingerprint(b));
});

check("local upsert creates versioned session", () => {
  const sessions: DesignSessionRecord[] = [];
  const payload = emptyDesignSessionPayload("lead-1") as unknown as Record<string, unknown>;
  const created = upsertLocalDesignSession(sessions, {
    leadId: "lead-1",
    payload,
    expectedVersion: null,
    actorUsername: "admin",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.created, true);
  assert.equal(created.session.version, 1);
  assert.equal(created.session.status, "draft");

  const updated = upsertLocalDesignSession(sessions, {
    leadId: "lead-1",
    payload: { ...payload, address: "changed" },
    expectedVersion: 1,
    actorUsername: "admin",
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.session.version, 2);
});

check("local upsert detects concurrent edit via expectedVersion", () => {
  const sessions: DesignSessionRecord[] = [];
  const payload = emptyDesignSessionPayload("lead-2") as unknown as Record<string, unknown>;
  upsertLocalDesignSession(sessions, {
    leadId: "lead-2",
    payload,
    expectedVersion: null,
    actorUsername: "a",
  });
  upsertLocalDesignSession(sessions, {
    leadId: "lead-2",
    payload,
    expectedVersion: 1,
    actorUsername: "a",
  });
  const conflict = upsertLocalDesignSession(sessions, {
    leadId: "lead-2",
    payload,
    expectedVersion: 1,
    actorUsername: "b",
  });
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.equal(conflict.concurrentEditDetected, true);
  assert.equal(findLocalDesignSession(sessions, "lead-2")?.concurrentEditDetected, true);
});

check("designSessionClient sources forbid browser storage", () => {
  const clientSrc = readFileSync(resolve(here, "designSessionClient.ts"), "utf8");
  const workspaceSrc = readFileSync(
    resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"),
    "utf8"
  );
  const storeSrc = readFileSync(
    resolve(here, "../../server/designSessions/designSessionStore.ts"),
    "utf8"
  );
  assert.ok(assertNoBrowserStorageInDesignSessionSources(clientSrc));
  assert.ok(assertNoBrowserStorageInDesignSessionSources(workspaceSrc));
  assert.ok(assertNoBrowserStorageInDesignSessionSources(storeSrc));
});

check("buildResultsSnapshot null-safe", () => {
  assert.equal(buildResultsSnapshot(null), null);
});

check("parseDesignSessionPayload rejects garbage", () => {
  assert.equal(parseDesignSessionPayload(null), null);
  assert.equal(parseDesignSessionPayload({ foo: 1 }), null);
});

console.log(`\ndesignSessionClient tests: ${pass} passed`);
