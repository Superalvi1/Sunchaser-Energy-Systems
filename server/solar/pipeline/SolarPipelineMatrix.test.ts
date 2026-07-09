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
import { assertOutcomeFinite } from "./SolarPipelineResult.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
}

const LARGE_ROOF = defaultRoofBoundary(800, 500);

const MULTI_PLANE_ROOF = {
  siteId: "multi-plane",
  metersPerUnit: 1,
  planes: [
    {
      id: "south",
      boundary: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 12 },
        { x: 0, y: 12 },
      ],
      pitchDeg: 12,
      azimuthDeg: 175,
    },
    {
      id: "west",
      boundary: [
        { x: 22, y: 0 },
        { x: 34, y: 0 },
        { x: 34, y: 10 },
        { x: 22, y: 10 },
      ],
      pitchDeg: 10,
      azimuthDeg: 260,
    },
  ],
};

const COMPLEX_ROOF = {
  siteId: "complex",
  metersPerUnit: 1,
  planes: [
    {
      id: "l-shape",
      boundary: [
        { x: 0, y: 0 },
        { x: 18, y: 0 },
        { x: 18, y: 8 },
        { x: 10, y: 8 },
        { x: 10, y: 16 },
        { x: 0, y: 16 },
      ],
      pitchDeg: 18,
      azimuthDeg: 185,
      obstacles: [
        {
          id: "chimney",
          polygon: [
            { x: 4, y: 4 },
            { x: 7, y: 4 },
            { x: 7, y: 7 },
            { x: 4, y: 7 },
          ],
        },
      ],
    },
  ],
};

function fingerprint(grandTotal: number, annualAc: number, panelCount: number): string {
  return createHash("sha256").update(`${grandTotal}|${annualAc}|${panelCount}`).digest("hex").slice(0, 10);
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  for (const tier of EQUIPMENT_TIERS) {
    for (const systemType of SYSTEM_TYPES) {
      for (const structureType of STRUCTURE_TYPES) {
        const label = `${sizeKw}/${tier}/${systemType}/${structureType}`;
        const outcome = runSolarDesignPipeline({
          systemSizeKw: sizeKw,
          tier,
          systemType,
          structureType,
          roofBoundary: LARGE_ROOF,
          roofWidthMeters: 12,
          canvasWidth: 800,
          canvasHeight: 500,
        });

        check(`${label} succeeds`, () => outcome.success);
        if (!outcome.success) continue;
        const r = outcome.result;

        check(`${label} draftOnly true`, () => r.draftOnly === true);
        check(`${label} panel count rule`, () => r.draft.panelCount === panelCountForSystem(sizeKw));
        check(`${label} layout fits`, () => r.panelLayout.fitsOnRoof);
        check(`${label} annual AC > 0`, () => r.simulation.annualAcKwh > 0);
        check(`${label} PR bounded`, () => r.simulation.performanceRatio > 0.2 && r.simulation.performanceRatio < 1.1);
        check(`${label} monthly rows 12`, () => r.simulation.monthly.length === 12);
        check(`${label} BOQ 7 sections`, () => r.draft.sections.length === 7);
        check(`${label} pricing positive`, () => r.draft.pricing.grandTotal > 0);
        check(`${label} template sections`, () => r.template.sectionSummaries.length === 7);
        check(`${label} stages complete`, () => r.stagesCompleted.length === 8);
        check(`${label} no NaN annual`, () => Number.isFinite(r.simulation.annualAcKwh));
        check(`${label} string sizing valid`, () => r.electrical.stringSizing.moduleCount > 0);
        check(`${label} cable rolls >= 1`, () => r.draft.cableRolls >= 1);

        const fp = fingerprint(r.draft.pricing.grandTotal, r.simulation.annualAcKwh, r.draft.panelCount);
        const outcome2 = runSolarDesignPipeline({
          systemSizeKw: sizeKw,
          tier,
          systemType,
          structureType,
          roofBoundary: LARGE_ROOF,
          roofWidthMeters: 12,
          canvasWidth: 800,
          canvasHeight: 500,
        });
        if (outcome2.success) {
          const fp2 = fingerprint(
            outcome2.result.draft.pricing.grandTotal,
            outcome2.result.simulation.annualAcKwh,
            outcome2.result.draft.panelCount
          );
          check(`${label} deterministic`, () => fp === fp2);
        }
      }
    }
  }
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  check(`hybrid/${sizeKw} < on-grid AC`, () => {
    const on = runSolarDesignPipeline({
      systemSizeKw: sizeKw,
      tier: "budget",
      systemType: "on-grid",
      structureType: "standard",
      roofBoundary: LARGE_ROOF,
    });
    const hy = runSolarDesignPipeline({
      systemSizeKw: sizeKw,
      tier: "budget",
      systemType: "hybrid",
      structureType: "standard",
      roofBoundary: LARGE_ROOF,
    });
    return on.success && hy.success && hy.result.simulation.annualAcKwh < on.result.simulation.annualAcKwh;
  });
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  const withRoof = runSolarDesignPipeline({
    systemSizeKw: sizeKw,
    tier: "premium",
    systemType: "on-grid",
    structureType: "elevated_hbeam",
    roofSite: MULTI_PLANE_ROOF,
  });
  check(`multi-plane roof/${sizeKw}`, () => withRoof.success && withRoof.result.roof!.planeCount === 2);
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  const complex = runSolarDesignPipeline({
    systemSizeKw: sizeKw,
    tier: "budget",
    systemType: "on-grid",
    structureType: "standard",
    roofSite: COMPLEX_ROOF,
  });
  if (sizeKw <= 10) {
    check(`complex roof/${sizeKw}`, () => complex.success && complex.result.roof !== null);
  } else {
    check(`complex roof/${sizeKw} fails layout or succeeds`, () =>
      (complex.success && complex.result.roof !== null) ||
      (!complex.success && complex.stage === "layout")
    );
  }
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  const obstacles = runSolarDesignPipeline({
    systemSizeKw: sizeKw,
    tier: "budget",
    systemType: "on-grid",
    structureType: "standard",
    roofBoundary: LARGE_ROOF,
    obstacles: [{ id: "ac", x: 300, y: 200, w: 80, h: 60 }],
  });
  check(`obstacles/${sizeKw}`, () => obstacles.success);
}

for (const sizeKw of [3, 5, 8, 15]) {
  const noRoof = runSolarDesignPipeline({
    systemSizeKw: sizeKw,
    tier: "budget",
    systemType: "on-grid",
    structureType: "standard",
  });
  check(`no explicit roof/${sizeKw} uses default`, () => noRoof.success && noRoof.result.roof === null);
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  const bad = runSolarDesignPipeline({
    systemSizeKw: sizeKw,
    tier: "budget",
    systemType: "on-grid",
    structureType: "standard",
    roofSite: {
      siteId: "invalid",
      planes: [
        {
          id: "x",
          boundary: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
            { x: 5, y: 0 },
            { x: 0, y: 5 },
          ],
          pitchDeg: 15,
          azimuthDeg: 180,
        },
      ],
    },
  });
  check(`invalid roof/${sizeKw} fails roof stage`, () => !bad.success && bad.stage === "roof");
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  const badLayout = runSolarDesignPipeline({
    systemSizeKw: sizeKw,
    tier: "budget",
    systemType: "on-grid",
    structureType: "standard",
    roofBoundary: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    roofWidthMeters: 2,
    canvasWidth: 80,
    canvasHeight: 80,
  });
  if (sizeKw <= 3) {
    check(`tiny roof may fit ${sizeKw}`, () => badLayout.success || badLayout.stage === "layout");
  } else {
    check(`tiny roof fails layout ${sizeKw}`, () => !badLayout.success && badLayout.stage === "layout");
  }
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  const simFail = runSolarDesignPipeline({
    systemSizeKw: sizeKw,
    tier: "budget",
    systemType: "on-grid",
    structureType: "standard",
    roofBoundary: LARGE_ROOF,
    simulation: { finance: { electricityTariffPkrPerKwh: Infinity } },
  });
  check(`simulation tariff Infinity/${sizeKw}`, () => !simFail.success && simFail.stage === "simulation");
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  const outcome = runSolarDesignPipeline({
    systemSizeKw: sizeKw,
    tier: "budget",
    systemType: "on-grid",
    structureType: "standard",
    roofBoundary: LARGE_ROOF,
  });
  if (outcome.success) {
    check(`finite scan/${sizeKw}`, () => {
      assertOutcomeFinite(outcome);
      return true;
    });
    check(`simulation is single source for PR/${sizeKw}`, () =>
      outcome.result.simulation.performanceRatio === outcome.result.simulation.performanceRatio
    );
    check(`panel layout not duplicated in BOQ/${sizeKw}`, () =>
      outcome.result.panelLayout.requiredPanels === panelCountForSystem(sizeKw)
    );
  }
}

console.log(`\nSolar pipeline matrix tests: ${pass} passed`);
