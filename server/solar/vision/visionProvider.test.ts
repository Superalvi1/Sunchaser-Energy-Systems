import assert from "node:assert/strict";
import {
  assertValidImageRef,
  createProviderRegistry,
  RoofSegmentationProviderRegistry,
} from "./VisionProvider.ts";
import { createFixtureSegmentationProvider } from "./providers/FixtureSegmentationProvider.ts";
import {
  createSamSegmentationProvider,
  createYoloSegmentationProvider,
  createOpenCvSegmentationProvider,
  createCloudSegmentationProvider,
} from "./providers/ExternalModelProviders.ts";
import { VisionPipelineError, type SatelliteImageRef } from "./VisionModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function image(overrides: Partial<SatelliteImageRef> = {}): SatelliteImageRef {
  return { imageId: "img-1", widthPx: 800, heightPx: 600, metersPerPixel: 0.1, checksum: "abc", ...overrides };
}

check("assertValidImageRef accepts a valid image", (() => {
  assertValidImageRef(image());
  return true;
})());
check("assertValidImageRef rejects missing imageId", (() => {
  try {
    assertValidImageRef(image({ imageId: "" }));
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "INVALID_IMAGE_ID";
  }
})());
check("assertValidImageRef rejects missing checksum", (() => {
  try {
    assertValidImageRef(image({ checksum: "" }));
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError;
  }
})());
check("assertValidImageRef rejects non-positive width", (() => {
  try {
    assertValidImageRef(image({ widthPx: 0 }));
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError;
  }
})());
check("assertValidImageRef rejects non-positive metersPerPixel", (() => {
  try {
    assertValidImageRef(image({ metersPerPixel: -1 }));
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError;
  }
})());

check("registry registers and gets by kind", (() => {
  const reg = createProviderRegistry([createFixtureSegmentationProvider()]);
  return reg.get("fixture")?.kind === "fixture";
})());
check("registry get returns null for unregistered kind", createProviderRegistry([]).get("sam") === null);
check("registry list preserves registration order", (() => {
  const reg = new RoofSegmentationProviderRegistry();
  reg.register(createSamSegmentationProvider());
  reg.register(createFixtureSegmentationProvider());
  return reg.list().map((p) => p.kind).join(",") === "sam,fixture";
})());

check("resolve returns the preferred provider when available", (() => {
  const reg = createProviderRegistry([createFixtureSegmentationProvider()]);
  return reg.resolve("fixture").kind === "fixture";
})());
check("resolve fails closed when preferred (SAM) is unavailable", (() => {
  const reg = createProviderRegistry([createFixtureSegmentationProvider(), createSamSegmentationProvider()]);
  try {
    reg.resolve("sam");
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "PROVIDER_UNAVAILABLE";
  }
})());
check("resolve fails closed when preferred provider is not registered", (() => {
  const reg = createProviderRegistry([createFixtureSegmentationProvider()]);
  try {
    reg.resolve("yolo");
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "PROVIDER_UNAVAILABLE";
  }
})());
check("resolve without preferred falls back to first available", (() => {
  const reg = createProviderRegistry([createSamSegmentationProvider(), createFixtureSegmentationProvider()]);
  return reg.resolve().kind === "fixture";
})());
check("resolve throws when nothing is available", (() => {
  const reg = createProviderRegistry([createSamSegmentationProvider(), createYoloSegmentationProvider()]);
  try {
    reg.resolve();
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "NO_PROVIDER_AVAILABLE";
  }
})());
check("resolve uses an available SAM provider when it is marked available", (() => {
  const reg = createProviderRegistry([
    createFixtureSegmentationProvider(),
    createSamSegmentationProvider({ available: true }),
  ]);
  return reg.resolve("sam").kind === "sam";
})());

check("SAM stub is unavailable by default", !createSamSegmentationProvider().isAvailable());
check("YOLO stub is unavailable by default", !createYoloSegmentationProvider().isAvailable());
check("OpenCV stub is unavailable by default", !createOpenCvSegmentationProvider().isAvailable());
check("cloud stub is unavailable by default", !createCloudSegmentationProvider().isAvailable());
check("fixture provider is always available", createFixtureSegmentationProvider().isAvailable());

check("SAM stub throws PROVIDER_UNAVAILABLE when segment() is called while unavailable", (() => {
  try {
    createSamSegmentationProvider().segment(image());
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "PROVIDER_UNAVAILABLE";
  }
})());
check("YOLO stub throws PROVIDER_UNAVAILABLE", (() => {
  try {
    createYoloSegmentationProvider().segment(image());
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "PROVIDER_UNAVAILABLE";
  }
})());
check("OpenCV stub throws PROVIDER_UNAVAILABLE", (() => {
  try {
    createOpenCvSegmentationProvider().segment(image());
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "PROVIDER_UNAVAILABLE";
  }
})());
check("cloud stub throws PROVIDER_UNAVAILABLE", (() => {
  try {
    createCloudSegmentationProvider().segment(image());
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "PROVIDER_UNAVAILABLE";
  }
})());
check("available external stub still throws NOT_IMPLEMENTED (no real model)", (() => {
  try {
    createSamSegmentationProvider({ available: true }).segment(image());
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "NOT_IMPLEMENTED";
  }
})());
check("external stub still validates the image before throwing", (() => {
  try {
    createSamSegmentationProvider().segment(image({ imageId: "" }));
    return false;
  } catch (e) {
    return e instanceof VisionPipelineError && e.code === "INVALID_IMAGE_ID";
  }
})());

console.log(`\nVisionProvider tests: ${pass} passed`);
