import assert from "node:assert/strict";
import { createRoofExtractionPipeline } from "./RoofExtractionPipeline.ts";
import { createProviderRegistry } from "./VisionProvider.ts";
import { createFixtureSegmentationProvider } from "./providers/FixtureSegmentationProvider.ts";
import { createSamSegmentationProvider } from "./providers/ExternalModelProviders.ts";
import { toRoofSiteInput } from "./RoofGeometryConversion.ts";
import { analyzeRoofSite } from "../roof/RoofGeometryEngine.ts";
import { VisionPipelineError, type SatelliteImageRef, type SegmentationRegion } from "./VisionModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function image(overrides: Partial<SatelliteImageRef> = {}): SatelliteImageRef {
  return { imageId: "img-1", widthPx: 1000, heightPx: 800, metersPerPixel: 0.1, checksum: "abc", ...overrides };
}

const fixtureRegions: SegmentationRegion[] = [
  { regionId: "a", contourPx: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }], confidence: 0.9, label: "roof" },
  { regionId: "b", contourPx: [{ x: 300, y: 300 }, { x: 500, y: 300 }, { x: 500, y: 500 }, { x: 300, y: 500 }], confidence: 0.7, label: "roof" },
];

function pipelineWithFixtures() {
  const provider = createFixtureSegmentationProvider({ fixtures: { "img-1": fixtureRegions } });
  return createRoofExtractionPipeline({ registry: createProviderRegistry([provider]) });
}

check("extract returns a run with polygons", pipelineWithFixtures().extract(image()).polygons.length === 2);
check("extract records the provider used", pipelineWithFixtures().extract(image()).provider.kind === "fixture");
check("extract produces a confidence heatmap", pipelineWithFixtures().extract(image()).heatmap.cells.length > 0);
check("extract records the initial suggestion as AI version 1", (() => {
  const run = pipelineWithFixtures().extract(image());
  return run.suggestion.version === 1 && run.suggestion.source === "ai" && run.suggestion.status === "proposed";
})());
check("extract's version store starts with 1 entry", pipelineWithFixtures().extract(image()).versionStore.size() === 1);
check("suggestion note names the provider", pipelineWithFixtures().extract(image()).suggestion.note.includes("fixture"));

check("default pipeline works with zero configured providers (cloud-free fixture default)", (() => {
  const run = createRoofExtractionPipeline().extract(image());
  return run.provider.kind === "fixture" && run.polygons.length >= 1;
})());

check("extract is deterministic across runs", (() => {
  const a = pipelineWithFixtures().extract(image());
  const b = pipelineWithFixtures().extract(image());
  return JSON.stringify(a.polygons) === JSON.stringify(b.polygons) && JSON.stringify(a.heatmap) === JSON.stringify(b.heatmap);
})());

check("extract skips invalid regions but still succeeds", (() => {
  const provider = createFixtureSegmentationProvider({
    fixtures: {
      "img-1": [
        ...fixtureRegions,
        { regionId: "bad", contourPx: [{ x: 0, y: 0 }, { x: 1, y: 1 }], confidence: 0.5, label: "roof" },
      ],
    },
  });
  const run = createRoofExtractionPipeline({ registry: createProviderRegistry([provider]) }).extract(image());
  return run.polygons.length === 2 && run.skippedRegions.some((s) => s.regionId === "bad");
})());

check("extract throws when no valid polygon can be produced", (() => {
  const provider = createFixtureSegmentationProvider({
    fixtures: { "img-1": [{ regionId: "bad", contourPx: [{ x: 0, y: 0 }], confidence: 0.5, label: "roof" }] },
  });
  try {
    createRoofExtractionPipeline({ registry: createProviderRegistry([provider]) }).extract(image());
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "NO_POLYGONS_EXTRACTED";
  }
})());

check("pipeline fails closed when SAM is preferred but unavailable", (() => {
  const registry = createProviderRegistry([
    createFixtureSegmentationProvider({ fixtures: { "img-1": fixtureRegions } }),
    createSamSegmentationProvider(),
  ]);
  try {
    createRoofExtractionPipeline({ registry }).extract(image(), undefined, "sam");
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "PROVIDER_UNAVAILABLE";
  }
})());

check("end-to-end: pipeline output converts into an analyzable roof site", (() => {
  const run = pipelineWithFixtures().extract(image());
  const site = toRoofSiteInput(run.image, run.suggestion.polygons);
  const metrics = analyzeRoofSite(site);
  return metrics.planeCount === 2 && metrics.totalPlanAreaM2 > 0;
})());

check("registerProvider adds a provider to the default registry", (() => {
  const pipeline = createRoofExtractionPipeline();
  pipeline.registerProvider(createSamSegmentationProvider({ available: false }));
  // SAM unavailable → still resolves to the built-in fixture default when no preferred.
  return pipeline.extract(image()).provider.kind === "fixture";
})());

check("initial suggestion status is proposed", pipelineWithFixtures().extract(image()).suggestion.status === "proposed");

console.log(`\nRoofExtractionPipeline tests: ${pass} passed`);
