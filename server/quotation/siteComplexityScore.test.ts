import assert from "node:assert/strict";
import { QuotationEngineError } from "./QuotationModels.ts";
import {
  computeSiteComplexity,
  isRoofAccessDifficulty,
  isShadingLevel,
  resolveComplexityTier,
} from "./SiteComplexityScore.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("isShadingLevel accepts none", isShadingLevel("none"));
check("isShadingLevel accepts heavy", isShadingLevel("heavy"));
check("isShadingLevel rejects unknown", !isShadingLevel("dim"));

check("isRoofAccessDifficulty accepts easy", isRoofAccessDifficulty("easy"));
check("isRoofAccessDifficulty accepts difficult", isRoofAccessDifficulty("difficult"));
check("isRoofAccessDifficulty rejects unknown", !isRoofAccessDifficulty("impossible"));

check("resolveComplexityTier: 0 is simple", resolveComplexityTier(0) === "simple");
check("resolveComplexityTier: 19 is simple", resolveComplexityTier(19) === "simple");
check("resolveComplexityTier: 20 is moderate", resolveComplexityTier(20) === "moderate");
check("resolveComplexityTier: 44 is moderate", resolveComplexityTier(44) === "moderate");
check("resolveComplexityTier: 45 is complex", resolveComplexityTier(45) === "complex");
check("resolveComplexityTier: 69 is complex", resolveComplexityTier(69) === "complex");
check("resolveComplexityTier: 70 is very_complex", resolveComplexityTier(70) === "very_complex");
check("resolveComplexityTier: 100 is very_complex", resolveComplexityTier(100) === "very_complex");

const bestCase = {
  roofType: "flat_concrete" as const,
  shadingLevel: "none" as const,
  roofAccessDifficulty: "easy" as const,
  meterToRoofDistanceMeters: 0,
  roofFaceCount: 1,
  heightMeters: 3,
};

const worstCase = {
  roofType: "sloped_tile" as const,
  shadingLevel: "heavy" as const,
  roofAccessDifficulty: "difficult" as const,
  meterToRoofDistanceMeters: 200,
  roofFaceCount: 10,
  heightMeters: 30,
};

check("computeSiteComplexity: best case scores near 0", computeSiteComplexity(bestCase).score === 0);
check("computeSiteComplexity: best case tier is simple", computeSiteComplexity(bestCase).tier === "simple");
check("computeSiteComplexity: best case installCostMultiplier is 1.0", computeSiteComplexity(bestCase).installCostMultiplier === 1.0);

check("computeSiteComplexity: worst case score is clamped to 100", computeSiteComplexity(worstCase).score === 100);
check("computeSiteComplexity: worst case tier is very_complex", computeSiteComplexity(worstCase).tier === "very_complex");
check("computeSiteComplexity: worst case installCostMultiplier is 1.5 at score 100", computeSiteComplexity(worstCase).installCostMultiplier === 1.5);

check("computeSiteComplexity: breakdown sums to the total score for an unclamped case", (() => {
  const input = { ...bestCase, shadingLevel: "partial" as const, roofAccessDifficulty: "moderate" as const };
  const result = computeSiteComplexity(input);
  const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
  return result.score === sum;
})());

check("computeSiteComplexity: more roof faces increases score", (() => {
  const one = computeSiteComplexity({ ...bestCase, roofFaceCount: 1 });
  const four = computeSiteComplexity({ ...bestCase, roofFaceCount: 4 });
  return four.score > one.score;
})());

check("computeSiteComplexity: heavier shading increases score", (() => {
  const none = computeSiteComplexity(bestCase);
  const heavy = computeSiteComplexity({ ...bestCase, shadingLevel: "heavy" });
  return heavy.score > none.score;
})());

check("computeSiteComplexity: greater height increases score above the 6m baseline", (() => {
  const low = computeSiteComplexity({ ...bestCase, heightMeters: 3 });
  const high = computeSiteComplexity({ ...bestCase, heightMeters: 12 });
  return high.score > low.score;
})());

check("computeSiteComplexity: height at or below 6m does not add points", computeSiteComplexity({ ...bestCase, heightMeters: 6 }).breakdown.height === 0);

check(
  "computeSiteComplexity throws for invalid roofType",
  (() => {
    try {
      computeSiteComplexity({ ...bestCase, roofType: "thatched" as never });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "site_complexity";
    }
  })()
);
check(
  "computeSiteComplexity throws for invalid shadingLevel",
  (() => {
    try {
      computeSiteComplexity({ ...bestCase, shadingLevel: "dim" as never });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeSiteComplexity throws for invalid roofAccessDifficulty",
  (() => {
    try {
      computeSiteComplexity({ ...bestCase, roofAccessDifficulty: "impossible" as never });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeSiteComplexity throws for negative meterToRoofDistanceMeters",
  (() => {
    try {
      computeSiteComplexity({ ...bestCase, meterToRoofDistanceMeters: -1 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeSiteComplexity throws for zero roofFaceCount",
  (() => {
    try {
      computeSiteComplexity({ ...bestCase, roofFaceCount: 0 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeSiteComplexity throws for negative heightMeters",
  (() => {
    try {
      computeSiteComplexity({ ...bestCase, heightMeters: -1 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

console.log(`\nSiteComplexityScore tests: ${pass} passed`);
