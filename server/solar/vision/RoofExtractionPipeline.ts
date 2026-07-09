/**
 * Roof extraction pipeline — orchestrator for Phase 3A.
 *
 *   upload image ref
 *     → resolve pluggable provider (fixture / SAM / YOLO / OpenCV / cloud)
 *     → segment (deterministic)
 *     → extract editable CAD polygons  (delegates geometry to the engine)
 *     → build confidence heatmap
 *     → record the initial AI suggestion as version 1 (append-only store)
 *
 * The pipeline performs NO backend mutation, NO persistence, NO production
 * estimate, and NO panel placement. It is fully deterministic given the same
 * image ref, hints, and provider.
 */

import {
  createProviderRegistry,
  RoofSegmentationProviderRegistry,
  type RoofSegmentationProvider,
  type SegmentationHints,
} from "./VisionProvider.ts";
import { createFixtureSegmentationProvider } from "./providers/FixtureSegmentationProvider.ts";
import { extractPolygons, type PolygonExtractionOptions } from "./PolygonExtraction.ts";
import { buildConfidenceHeatmap, type HeatmapOptions } from "./ConfidenceHeatmap.ts";
import {
  createRoofExtractionVersionStore,
  RoofExtractionVersionStore,
  type RoofExtractionVersionStoreOptions,
} from "./RoofExtractionVersioning.ts";
import {
  VisionPipelineError,
  type ConfidenceHeatmap,
  type ExtractedPolygon,
  type RoofExtractionSuggestion,
  type SatelliteImageRef,
  type SegmentationResult,
  type VisionProviderKind,
} from "./VisionModels.ts";

export interface RoofExtractionPipelineOptions {
  registry?: RoofSegmentationProviderRegistry;
  extraction?: PolygonExtractionOptions;
  heatmap?: HeatmapOptions;
  versionStore?: RoofExtractionVersionStoreOptions;
}

export interface RoofExtractionRun {
  image: SatelliteImageRef;
  provider: { kind: VisionProviderKind; version: string };
  segmentation: SegmentationResult;
  polygons: ExtractedPolygon[];
  skippedRegions: { regionId: string; reason: string }[];
  heatmap: ConfidenceHeatmap;
  suggestion: RoofExtractionSuggestion;
  versionStore: RoofExtractionVersionStore;
}

export class RoofExtractionPipeline {
  private readonly registry: RoofSegmentationProviderRegistry;
  private readonly options: RoofExtractionPipelineOptions;

  constructor(options: RoofExtractionPipelineOptions = {}) {
    // Default registry always includes the cloud-free fixture provider so the
    // pipeline runs out of the box with no external model.
    this.registry =
      options.registry ?? createProviderRegistry([createFixtureSegmentationProvider()]);
    this.options = options;
  }

  registerProvider(provider: RoofSegmentationProvider): void {
    this.registry.register(provider);
  }

  extract(
    image: SatelliteImageRef,
    hints?: SegmentationHints,
    preferredProvider?: VisionProviderKind
  ): RoofExtractionRun {
    const provider = this.registry.resolve(preferredProvider);
    const segmentation = provider.segment(image, hints);

    const { polygons, skipped } = extractPolygons(segmentation.regions, this.options.extraction);
    if (polygons.length === 0) {
      throw new VisionPipelineError(
        "NO_POLYGONS_EXTRACTED",
        "Segmentation produced no valid roof polygons."
      );
    }

    const heatmap = buildConfidenceHeatmap(image.widthPx, image.heightPx, polygons, this.options.heatmap);

    const versionStore = createRoofExtractionVersionStore(image.imageId, this.options.versionStore);
    const suggestion = versionStore.append({
      source: "ai",
      polygons,
      note: `Initial extraction via ${provider.kind}@${provider.version}.`,
    });

    return {
      image,
      provider: { kind: provider.kind, version: provider.version },
      segmentation,
      polygons,
      skippedRegions: skipped,
      heatmap,
      suggestion,
      versionStore,
    };
  }
}

export function createRoofExtractionPipeline(
  options?: RoofExtractionPipelineOptions
): RoofExtractionPipeline {
  return new RoofExtractionPipeline(options);
}
