/**
 * Roof Intelligence — Phase 3A public surface (AI-assisted roof extraction).
 *
 * Architecture only: upload → pluggable segmentation → polygon extraction →
 * confidence heatmap → versioned suggestions → manual correction → conversion
 * into the EXISTING Roof Geometry Engine objects. No cloud dependency, no
 * persistence, no backend mutation, no production estimate, no panel placement.
 */

export * from "./VisionErrors.ts";
export * from "./VisionModels.ts";
export * from "./VisionProvider.ts";
export * from "./providers/FixtureSegmentationProvider.ts";
export * from "./providers/ExternalModelProviders.ts";
export * from "./PolygonExtraction.ts";
export * from "./ConfidenceHeatmap.ts";
export {
  RoofExtractionVersionStore,
  createRoofExtractionVersionStore,
  assertFiniteVisionResult,
  validatePolygonsForVersionAppend,
  type AppendSuggestionInput,
  type RoofExtractionVersionStoreOptions,
} from "./RoofExtractionVersioning.ts";
export * from "./ManualCorrection.ts";
export * from "./RoofGeometryConversion.ts";
export * from "./RoofExtractionPipeline.ts";
