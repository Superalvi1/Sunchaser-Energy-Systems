/**
 * Solar Design Pipeline — structured result helpers.
 */

import type {
  SolarDesignPipelineFailure,
  SolarDesignPipelineOutcome,
  SolarDesignPipelineResult,
  SolarDesignPipelineSuccess,
  SolarPipelineStage,
} from "./SolarPipelineModels.ts";
import { PIPELINE_ENGINE_TIMESTAMP } from "./SolarPipelineModels.ts";

export function pipelineFailure(
  stage: SolarPipelineStage,
  code: string,
  message: string,
  stagesCompleted: SolarPipelineStage[],
  warnings: string[] = [],
  validationMessages: string[] = []
): SolarDesignPipelineFailure {
  return {
    success: false,
    stage,
    code,
    message,
    warnings,
    validationMessages,
    stagesCompleted,
  };
}

export function pipelineSuccess(result: SolarDesignPipelineResult): SolarDesignPipelineSuccess {
  return { success: true, result };
}

export function assertPipelineResultFinite(result: SolarDesignPipelineResult): void {
  const nums: number[] = [
    result.draft.panelCount,
    result.draft.systemSizeKw,
    result.draft.cableDistanceM,
    result.draft.cableRolls,
    result.draft.structureCost,
    result.draft.pricing.grandTotal,
    result.simulation.annualAcKwh,
    result.simulation.annualDcKwh,
    result.simulation.performanceRatio,
    result.panelLayout.requiredPanels,
    result.panelLayout.unplacedPanels,
    result.panelLayout.usableAreaM2,
  ];
  for (const n of nums) {
    if (!Number.isFinite(n)) {
      throw new Error(`Pipeline result contains non-finite value: ${n}`);
    }
  }
}

export function newPipelineDraftTimestamp(): string {
  return PIPELINE_ENGINE_TIMESTAMP;
}

export function collectNumericFields(obj: unknown, path = "", out: string[] = []): string[] {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) out.push(path || "(root)");
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => collectNumericFields(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      collectNumericFields(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

export function assertOutcomeFinite(outcome: SolarDesignPipelineOutcome): void {
  if (!outcome.success) return;
  const bad = collectNumericFields(outcome.result);
  if (bad.length > 0) {
    throw new Error(`Non-finite pipeline fields: ${bad.join(", ")}`);
  }
}
