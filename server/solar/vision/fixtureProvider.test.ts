import assert from "node:assert/strict";
import { createFixtureSegmentationProvider } from "./providers/FixtureSegmentationProvider.ts";
import { VisionPipelineError, type SatelliteImageRef, type SegmentationRegion } from "./VisionModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function image(overrides: Partial<SatelliteImageRef> = {}): SatelliteImageRef {
  return { imageId: "img-1", widthPx: 1000, heightPx: 800, metersPerPixel: 0.05, checksum: "abc", ...overrides };
}

check("synthesis mode returns at least one region", createFixtureSegmentationProvider().segment(image()).regions.length >= 1);
check("synthesis region is labeled roof", createFixtureSegmentationProvider().segment(image()).regions[0].label === "roof");
check("synthesis region has 4 contour points", createFixtureSegmentationProvider().segment(image()).regions[0].contourPx.length === 4);
check("synthesis region confidence is within [0,1]", (() => {
  const c = createFixtureSegmentationProvider().segment(image()).regions[0].confidence;
  return c >= 0 && c <= 1;
})());
check("providerKind is fixture", createFixtureSegmentationProvider().segment(image()).providerKind === "fixture");
check("providerVersion is echoed", createFixtureSegmentationProvider({ version: "test-9" }).segment(image()).providerVersion === "test-9");

check("segment is deterministic for the same image", (() => {
  const provider = createFixtureSegmentationProvider();
  const a = JSON.stringify(provider.segment(image()));
  const b = JSON.stringify(provider.segment(image()));
  return a === b;
})());

check("box hints drive the synthesized contour", (() => {
  const region = createFixtureSegmentationProvider().segment(image(), { boxesPx: [[10, 20, 110, 220]] }).regions[0];
  return (
    region.contourPx[0].x === 10 &&
    region.contourPx[0].y === 20 &&
    region.contourPx[2].x === 110 &&
    region.contourPx[2].y === 220
  );
})());
check("multiple box hints produce multiple regions", (() => {
  const regions = createFixtureSegmentationProvider().segment(image(), {
    boxesPx: [
      [0, 0, 100, 100],
      [200, 200, 400, 400],
    ],
  }).regions;
  return regions.length === 2;
})());

const fixtureRegions: SegmentationRegion[] = [
  { regionId: "r1", contourPx: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }], confidence: 0.9, label: "roof" },
  { regionId: "r2", contourPx: [{ x: 60, y: 60 }, { x: 90, y: 60 }, { x: 90, y: 90 }, { x: 60, y: 90 }], confidence: 0.3, label: "roof" },
];

check("fixture mode returns registered regions verbatim", (() => {
  const provider = createFixtureSegmentationProvider({ fixtures: { "img-1": fixtureRegions } });
  return provider.segment(image()).regions.length === 2;
})());
check("fixture mode is preferred over synthesis", (() => {
  const provider = createFixtureSegmentationProvider({ fixtures: { "img-1": fixtureRegions } });
  return provider.segment(image()).regions[0].regionId === "r1";
})());
check("setFixture registers regions at runtime", (() => {
  const provider = createFixtureSegmentationProvider();
  provider.setFixture("img-1", fixtureRegions);
  return provider.segment(image()).regions.length === 2;
})());
check("minConfidence hint filters low-confidence regions", (() => {
  const provider = createFixtureSegmentationProvider({ fixtures: { "img-1": fixtureRegions } });
  return provider.segment(image(), { minConfidence: 0.5 }).regions.length === 1;
})());
check("an image with no fixture falls back to synthesis", (() => {
  const provider = createFixtureSegmentationProvider({ fixtures: { "other-image": fixtureRegions } });
  return provider.segment(image()).regions[0].regionId.includes("syn");
})());

check("segment validates the image ref", (() => {
  try {
    createFixtureSegmentationProvider().segment(image({ widthPx: 0 }));
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError;
  }
})());

console.log(`\nFixtureProvider tests: ${pass} passed`);
