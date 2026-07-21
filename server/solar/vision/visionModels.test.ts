import assert from "node:assert/strict";
import {
  clampUnit,
  isNonEmptyString,
  isUnitInterval,
  isVisionProviderKind,
  round4,
  VISION_PROVIDER_KINDS,
  VisionPipelineError,
} from "./VisionModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("provider kinds include fixture/sam/yolo/opencv/cloud", VISION_PROVIDER_KINDS.length === 5);
check("isVisionProviderKind accepts sam", isVisionProviderKind("sam"));
check("isVisionProviderKind accepts fixture", isVisionProviderKind("fixture"));
check("isVisionProviderKind rejects unknown", !isVisionProviderKind("magic"));

check("VisionPipelineError carries code", new VisionPipelineError("X", "m").code === "X");
check("VisionPipelineError is an Error", new VisionPipelineError("X", "m") instanceof Error);
check("VisionPipelineError name set", new VisionPipelineError("X", "m").name === "VisionPipelineError");

check("isNonEmptyString true for text", isNonEmptyString("a"));
check("isNonEmptyString false for whitespace", !isNonEmptyString("  "));
check("isNonEmptyString false for number", !isNonEmptyString(1));

check("isUnitInterval true for 0", isUnitInterval(0));
check("isUnitInterval true for 1", isUnitInterval(1));
check("isUnitInterval true for 0.5", isUnitInterval(0.5));
check("isUnitInterval false for 1.5", !isUnitInterval(1.5));
check("isUnitInterval false for -0.1", !isUnitInterval(-0.1));
check("isUnitInterval false for NaN", !isUnitInterval(NaN));

check("clampUnit clamps above 1", clampUnit(2) === 1);
check("clampUnit clamps below 0", clampUnit(-1) === 0);
check("clampUnit passes through mid value", clampUnit(0.4) === 0.4);

check("round4 rounds to 4 decimals", round4(0.123456) === 0.1235);
check("round4 keeps integers", round4(5) === 5);

console.log(`\nVisionModels tests: ${pass} passed`);
