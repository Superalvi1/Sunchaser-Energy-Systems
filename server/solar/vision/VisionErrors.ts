/**
 * Roof Intelligence Phase 3A — typed vision errors.
 * Fail closed. No silent fallbacks.
 */

export type VisionErrorCode =
  | "INVALID_IMAGE"
  | "INVALID_IMAGE_ID"
  | "INVALID_IMAGE_CHECKSUM"
  | "INVALID_IMAGE_WIDTH"
  | "INVALID_IMAGE_HEIGHT"
  | "INVALID_IMAGE_GSD"
  | "NO_PROVIDER_AVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "NOT_IMPLEMENTED"
  | "REGION_NOT_EXTRACTABLE"
  | "REGION_TOO_SMALL"
  | "NO_POLYGONS"
  | "NO_POLYGONS_EXTRACTED"
  | "INVALID_PARENT_VERSION"
  | "SUGGESTION_NOT_FOUND"
  | "SUGGESTION_NOT_ACTIVE"
  | "POLYGON_NOT_FOUND"
  | "INVALID_VERTEX_INDEX"
  | "INVALID_EDIT"
  | "MIN_VERTICES"
  | "DUPLICATE_POLYGON_ID"
  | "INVALID_HEATMAP_WIDTH"
  | "INVALID_HEATMAP_HEIGHT"
  | "INVALID_HEATMAP_CELL"
  | "SELF_INTERSECTING_SUGGESTION"
  | "INSUFFICIENT_VERTICES"
  | "ACCEPT_REJECTED"
  | "OUT_OF_BOUNDS"
  | "INVALID_POLYGON_VERTEX"
  | "NON_FINITE_VISION_RESULT";

export class VisionPipelineError extends Error {
  readonly code: VisionErrorCode;

  constructor(code: VisionErrorCode, message: string) {
    super(message);
    this.name = "VisionPipelineError";
    this.code = code;
  }
}

/** @deprecated Prefer VisionPipelineError — alias kept for clarity in provider stubs. */
export class RoofVisionProviderNotConfiguredError extends VisionPipelineError {
  constructor(providerKind: string) {
    super(
      "PROVIDER_UNAVAILABLE",
      `${providerKind} provider is not configured in Phase 3A. Use the fixture provider or wire a real runtime.`
    );
    this.name = "RoofVisionProviderNotConfiguredError";
  }
}
