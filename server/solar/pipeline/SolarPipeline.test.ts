import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runSolarDesignPipeline } from "./SolarDesignPipeline.ts";
import { defaultRoofBoundary } from "../proposal/RoofGeometry.ts";
import { panelCountForSystem } from "../proposal/SolarDesignRules.ts";
import {
  EQUIPMENT_TIERS,
  STRUCTURE_TYPES,
  SUPPORTED_SYSTEM_SIZES_KW,
  SYSTEM_TYPES,
} from "../proposal/SolarProposalModels.ts";
import {
  assertOutcomeFinite,
} from "./SolarPipelineResult.ts";
import {
  isPipelineSuccess,
  SolarPipelineValidationError,
  type SolarDesignPipelineInput,
} from "./SolarPipelineModels.ts";
import { validateSolarDesignPipelineInput } from "./SolarPipelineValidation.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const LARGE_ROOF = defaultRoofBoundary(800, 500);

const VALID_ROOF_SITE = {
  siteId: "pipeline-test",
  metersPerUnit: 1,
  planes: [
    {
      id: "p1",
      boundary: [
        { x: 0, y: 0 },
        { x: 24, y: 0 },
        { x: 24, y: 14 },
        { x: 0, y: 14 },
      ],
      pitchDeg: 15,
      azimuthDeg: 180,
    },
  ],
};

const BASE: SolarDesignPipelineInput = {
  systemSizeKw: 5,
  tier: "budget",
  systemType: "on-grid",
  structureType: "standard",
  roofBoundary: LARGE_ROOF,
  roofWidthMeters: 12,
  canvasWidth: 800,
  canvasHeight: 500,
};

function fp(outcome: ReturnType<typeof runSolarDesignPipeline>): string {
  if (!outcome.success) return `fail:${outcome.stage}:${outcome.code}`;
  const r = outcome.result;
  return createHash("sha256")
    .update(
      [
        r.draft.pricing.grandTotal,
        r.draft.panelCount,
        r.simulation.annualAcKwh,
        r.panelLayout.placedPanels.length,
      ].join("|")
    )
    .digest("hex")
    .slice(0, 12);
}

check("pipeline succeeds with default canvas roof", () => {
  const o = runSolarDesignPipeline(BASE);
  return o.success && o.result.draftOnly === true;
});

check("pipeline completes all stages in order", () => {
  const o = runSolarDesignPipeline(BASE);
  if (!o.success) return false;
  const expected = ["validation", "roof", "layout", "simulation", "electrical", "boq", "pricing", "proposal"];
  return JSON.stringify(o.result.stagesCompleted) === JSON.stringify(expected);
});

check("pipeline output has BOQ sections", () => {
  const o = runSolarDesignPipeline(BASE);
  return o.success && o.result.draft.sections.length === 7;
});

check("pipeline output has simulation production", () => {
  const o = runSolarDesignPipeline(BASE);
  return o.success && o.result.simulation.annualAcKwh > 0 && o.result.simulation.monthly.length === 12;
});

check("pipeline output has string sizing from simulation", () => {
  const o = runSolarDesignPipeline(BASE);
  return o.success && o.result.electrical.stringSizing.moduleCount > 0;
});

check("pipeline output has breaker and SPD selection", () => {
  const o = runSolarDesignPipeline(BASE);
  return (
    o.success &&
    o.result.electrical.breakerSelection.toLowerCase().includes("mcb") &&
    o.result.electrical.spdSelection.toLowerCase().includes("surge")
  );
});

check("pipeline output has proposal template pages metadata", () => {
  const o = runSolarDesignPipeline(BASE);
  return o.success && o.result.template.sectionSummaries.length === 7;
});

check("panel count matches system size rule", () => {
  const o = runSolarDesignPipeline(BASE);
  return o.success && o.result.draft.panelCount === panelCountForSystem(5);
});

check("layout placed panels equals required when fits", () => {
  const o = runSolarDesignPipeline(BASE);
  return o.success && o.result.panelLayout.fitsOnRoof && o.result.panelLayout.unplacedPanels === 0;
});

check("roof geometry engine used when roofSite provided", () => {
  const o = runSolarDesignPipeline({ ...BASE, roofSite: VALID_ROOF_SITE, roofBoundary: undefined });
  return o.success && o.result.roof !== null && o.result.roof.planeCount === 1;
});

check("deterministic fingerprint stable", () => {
  const a = runSolarDesignPipeline(BASE);
  const b = runSolarDesignPipeline(BASE);
  return fp(a) === fp(b);
});

check("no NaN in successful output", () => {
  const o = runSolarDesignPipeline(BASE);
  if (!o.success) return false;
  assertOutcomeFinite(o);
  return true;
});

check("invalid roof fails at roof stage", () => {
  const o = runSolarDesignPipeline({
    ...BASE,
    roofSite: {
      siteId: "bad",
      planes: [
        {
          id: "bowtie",
          boundary: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 10, y: 0 },
            { x: 0, y: 10 },
          ],
          pitchDeg: 15,
          azimuthDeg: 180,
        },
      ],
    },
  });
  return !o.success && o.stage === "roof";
});

check("impossible layout fails at layout stage", () => {
  const o = runSolarDesignPipeline({
    ...BASE,
    systemSizeKw: 15,
    roofBoundary: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 0, y: 30 },
    ],
    roofWidthMeters: 3,
    canvasWidth: 100,
    canvasHeight: 100,
  });
  return !o.success && o.stage === "layout" && o.code === "LAYOUT_IMPOSSIBLE";
});

check("simulation invalid input fails at simulation stage", () => {
  const o = runSolarDesignPipeline({
    ...BASE,
    simulation: { module: { wattageW: 0 } },
  });
  return !o.success && o.stage === "simulation";
});

check("pipeline input validation rejects bad tier", () => {
  try {
    validateSolarDesignPipelineInput({ ...BASE, tier: "luxury" as "budget" });
    return false;
  } catch (e) {
    return e instanceof SolarPipelineValidationError && e.code === "INVALID_TIER";
  }
});

check("pipeline input validation rejects NaN size", () => {
  try {
    validateSolarDesignPipelineInput({ ...BASE, systemSizeKw: NaN as 5 });
    return false;
  } catch (e) {
    return e instanceof SolarPipelineValidationError && e.code === "INVALID_SIZE";
  }
});

check("off-grid yield lower than on-grid via simulation stage", () => {
  const on = runSolarDesignPipeline({ ...BASE, systemType: "on-grid" });
  const off = runSolarDesignPipeline({ ...BASE, systemType: "off-grid" });
  return (
    isPipelineSuccess(on) &&
    isPipelineSuccess(off) &&
    off.result.simulation.annualAcKwh < on.result.simulation.annualAcKwh
  );
});

check("premium tier grand total >= budget for same size", () => {
  const budget = runSolarDesignPipeline({ ...BASE, tier: "budget" });
  const premium = runSolarDesignPipeline({ ...BASE, tier: "premium" });
  return (
    isPipelineSuccess(budget) &&
    isPipelineSuccess(premium) &&
    premium.result.draft.pricing.grandTotal >= budget.result.draft.pricing.grandTotal
  );
});

check("elevated structure cost >= standard", () => {
  const std = runSolarDesignPipeline({ ...BASE, structureType: "standard" });
  const elev = runSolarDesignPipeline({ ...BASE, structureType: "elevated_hbeam" });
  return (
    isPipelineSuccess(std) &&
    isPipelineSuccess(elev) &&
    elev.result.structureEstimate.lineTotalPrice >= std.result.structureEstimate.lineTotalPrice
  );
});

check("engineering assumptions from simulation included", () => {
  const o = runSolarDesignPipeline(BASE);
  return o.success && o.result.engineeringAssumptions.length > 0;
});

check("loss breakdown present in simulation", () => {
  const o = runSolarDesignPipeline(BASE);
  return o.success && o.result.simulation.losses.totalLossKwh >= 0;
});

check("cable estimate present in electrical and draft", () => {
  const o = runSolarDesignPipeline(BASE);
  return o.success && o.result.draft.cableRolls >= 1 && o.result.electrical.cables.cableRolls >= 1;
});

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  check(`size ${sizeKw}kW pipeline succeeds`, () => {
    const o = runSolarDesignPipeline({ ...BASE, systemSizeKw: sizeKw });
    return o.success && o.result.draft.systemSizeKw === sizeKw;
  });
}

function expectCanvasGeometryFailure(input: SolarDesignPipelineInput): boolean {
  const o = runSolarDesignPipeline(input);
  return (
    !o.success &&
    o.stage === "validation" &&
    o.code === "INVALID_CANVAS_GEOMETRY" &&
    o.stagesCompleted.length === 0
  );
}

check("NaN obstacle coordinate fails validation", () =>
  expectCanvasGeometryFailure({
    ...BASE,
    obstacles: [{ id: "bad", x: NaN, y: 10, w: 20, h: 20 }],
  })
);

check("Infinity obstacle dimension fails validation", () => {
  const o = runSolarDesignPipeline({
    ...BASE,
    obstacles: [{ id: "bad", x: 10, y: 10, w: Infinity, h: 20 }],
  });
  return !o.success && o.stage === "validation" && o.code === "INVALID_CANVAS_GEOMETRY";
});

check("invalid roof vertex fails validation", () =>
  expectCanvasGeometryFailure({
    ...BASE,
    roofBoundary: [
      { x: 0, y: 0 },
      { x: NaN, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  })
);

check("invalid metersPerUnit fails validation", () =>
  expectCanvasGeometryFailure({
    ...BASE,
    roofSite: {
      siteId: "scale-bad",
      metersPerUnit: 0,
      planes: VALID_ROOF_SITE.planes,
    },
  })
);

check("invalid pitch fails validation", () =>
  expectCanvasGeometryFailure({
    ...BASE,
    roofSite: {
      siteId: "pitch-bad",
      planes: [{ ...VALID_ROOF_SITE.planes[0], pitchDeg: Infinity }],
    },
  })
);

check("invalid azimuth fails validation", () =>
  expectCanvasGeometryFailure({
    ...BASE,
    roofSite: {
      siteId: "az-bad",
      planes: [{ ...VALID_ROOF_SITE.planes[0], azimuthDeg: NaN }],
    },
  })
);

check("invalid walkway fails validation", () =>
  expectCanvasGeometryFailure({
    ...BASE,
    roofSite: {
      siteId: "walk-bad",
      planes: [
        {
          ...VALID_ROOF_SITE.planes[0],
          walkways: [
            {
              id: "w1",
              polygon: [
                { x: 0, y: 0 },
                { x: 5, y: 0 },
                { x: Infinity, y: 5 },
              ],
              widthM: 1,
            },
          ],
        },
      ],
    },
  })
);

check("invalid parapet fails validation", () =>
  expectCanvasGeometryFailure({
    ...BASE,
    roofSite: {
      siteId: "parapet-bad",
      planes: [
        {
          ...VALID_ROOF_SITE.planes[0],
          parapets: [{ id: "p1", heightM: -1, thicknessM: 0.2 }],
        },
      ],
    },
  })
);

check("invalid ridge fails validation", () =>
  expectCanvasGeometryFailure({
    ...BASE,
    roofSite: {
      siteId: "ridge-bad",
      planes: [
        {
          ...VALID_ROOF_SITE.planes[0],
          ridges: [{ id: "r1", start: { x: 0, y: 0 }, end: { x: NaN, y: 10 } }],
        },
      ],
    },
  })
);

check("invalid valley fails validation", () =>
  expectCanvasGeometryFailure({
    ...BASE,
    roofSite: {
      siteId: "valley-bad",
      planes: [
        {
          ...VALID_ROOF_SITE.planes[0],
          valleys: [{ id: "v1", start: { x: 0, y: 0 }, end: { x: 5, y: Infinity } }],
        },
      ],
    },
  })
);

check("invalid circle obstacle fails validation", () =>
  expectCanvasGeometryFailure({
    ...BASE,
    circleObstacles: [{ id: "c1", cx: 10, cy: 10, radius: NaN }],
  })
);

check("canvas geometry validation failure stops later stages", () => {
  const o = runSolarDesignPipeline({
    ...BASE,
    obstacles: [{ id: "bad", x: 10, y: 10, w: NaN, h: 20 }],
  });
  return !o.success && o.stagesCompleted.length === 0 && o.stage === "validation";
});

check("success output recursively finite after canvas validation", () => {
  const o = runSolarDesignPipeline({
    ...BASE,
    obstacles: [{ id: "ok", x: 100, y: 100, w: 50, h: 40 }],
    circleObstacles: [{ id: "c", cx: 200, cy: 150, radius: 15 }],
  });
  if (!o.success) return false;
  assertOutcomeFinite(o);
  return true;
});

function planeWith(overrides: Record<string, unknown>) {
  return { ...VALID_ROOF_SITE.planes[0], ...overrides };
}

function roofSiteWith(planes: unknown[]) {
  return { siteId: "shape-test", metersPerUnit: 1, planes };
}

function expectValidationFailure(input: SolarDesignPipelineInput): boolean {
  const o = runSolarDesignPipeline(input);
  return !o.success && o.stage === "validation" && o.stagesCompleted.length === 0;
}

check("roofSite null returns validation failure not throw", () =>
  expectValidationFailure({ ...BASE, roofSite: null as unknown as typeof VALID_ROOF_SITE })
);

check("roofSite missing planes returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: { siteId: "no-planes" } as unknown as typeof VALID_ROOF_SITE,
  })
);

check("roofSite invalid planes non-array returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: { siteId: "bad-planes", planes: {} } as unknown as typeof VALID_ROOF_SITE,
  })
);

check("plane null returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([null]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("boundary null returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ boundary: null })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("boundary non-array returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ boundary: {} })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("obstacles as object returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ obstacles: {} })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("obstacles null returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ obstacles: null })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("walkways as object returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ walkways: {} })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("walkways null returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ walkways: null })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("parapets as object returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ parapets: {} })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("parapets null returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ parapets: null })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("ridges as object returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ ridges: {} })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("ridges null returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ ridges: null })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("valleys as object returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ valleys: {} })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("valleys null returns validation failure", () =>
  expectValidationFailure({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ valleys: null })]) as unknown as typeof VALID_ROOF_SITE,
  })
);

check("shape validation failure returns INVALID_CANVAS_GEOMETRY", () => {
  const o = runSolarDesignPipeline({
    ...BASE,
    roofSite: roofSiteWith([planeWith({ obstacles: null })]) as unknown as typeof VALID_ROOF_SITE,
  });
  return !o.success && o.code === "INVALID_CANVAS_GEOMETRY";
});

check("shape validation failure stops all later stages", () => {
  const o = runSolarDesignPipeline({
    ...BASE,
    roofSite: null as unknown as typeof VALID_ROOF_SITE,
  });
  return !o.success && o.stagesCompleted.length === 0;
});

console.log(`\nSolar pipeline unit tests: ${pass} passed`);
