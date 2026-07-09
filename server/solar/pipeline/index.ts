/**
 * Solar Design Pipeline — public API boundary (draft-only).
 */

export {
  runSolarDesignPipeline,
  SolarProposalError,
} from "./SolarDesignPipeline.ts";

export {
  validateSolarDesignPipelineInput,
} from "./SolarPipelineValidation.ts";

export {
  validateCanvasGeometry,
  type CanvasCircleObstacle,
} from "./SolarPipelineCanvasGeometry.ts";

export {
  assertOutcomeFinite,
  assertPipelineResultFinite,
  pipelineFailure,
  pipelineSuccess,
} from "./SolarPipelineResult.ts";

export {
  PIPELINE_ENGINE_TIMESTAMP,
  PIPELINE_STAGES,
  SolarPipelineStageError,
  SolarPipelineValidationError,
  isPipelineSuccess,
  type ElectricalSizingResult,
  type PipelineSystemSizeSelection,
  type SolarDesignPipelineDraft,
  type SolarDesignPipelineFailure,
  type SolarDesignPipelineInput,
  type SolarDesignPipelineOutcome,
  type SolarDesignPipelineResult,
  type SolarDesignPipelineSuccess,
  type SolarPipelineStage,
} from "./SolarPipelineModels.ts";
