/**
 * Deterministic, cloud-free V1 segmentation provider.
 *
 * Two deterministic modes, in priority order:
 *   1. Fixture mode — regions registered per imageId are returned verbatim.
 *      This is how recorded model outputs (or hand-authored test roofs) drive
 *      the pipeline without any model runtime.
 *   2. Synthesis mode — when no fixture exists for the image, a deterministic
 *      roof rectangle is synthesized from the image bounds, refined by any box
 *      hints. Confidence is derived deterministically from geometry so results
 *      are stable and reproducible.
 *
 * This provider is ALWAYS available (isAvailable() === true), so it is the safe
 * fallback the registry resolves to when SAM/YOLO/OpenCV are absent.
 */

import {
  assertValidImageRef,
  type RoofSegmentationProvider,
  type SegmentationHints,
} from "../VisionProvider.ts";
import {
  clampUnit,
  round4,
  type SatelliteImageRef,
  type SegmentationRegion,
  type SegmentationResult,
} from "../VisionModels.ts";
import type { Point2D } from "../../roof/RoofModels.ts";

export interface FixtureSegmentationProviderOptions {
  version?: string;
  /** Pre-registered regions keyed by imageId. */
  fixtures?: Record<string, SegmentationRegion[]>;
  /** Inset (fraction of the smaller image dimension) for synthesized roofs. Default 0.15. */
  synthesisInsetFraction?: number;
}

export class FixtureSegmentationProvider implements RoofSegmentationProvider {
  readonly kind = "fixture" as const;
  readonly version: string;
  private readonly fixtures: Map<string, SegmentationRegion[]>;
  private readonly insetFraction: number;

  constructor(options: FixtureSegmentationProviderOptions = {}) {
    this.version = options.version ?? "fixture-1.0.0";
    this.fixtures = new Map(Object.entries(options.fixtures ?? {}));
    this.insetFraction = options.synthesisInsetFraction ?? 0.15;
  }

  /** Register (or replace) the fixture regions for an image. */
  setFixture(imageId: string, regions: SegmentationRegion[]): void {
    this.fixtures.set(imageId, regions);
  }

  isAvailable(): boolean {
    return true;
  }

  segment(image: SatelliteImageRef, hints?: SegmentationHints): SegmentationResult {
    assertValidImageRef(image);

    const fixed = this.fixtures.get(image.imageId);
    const minConfidence = hints?.minConfidence ?? 0;

    const regions = fixed
      ? fixed.filter((r) => r.confidence >= minConfidence)
      : this.synthesize(image, hints).filter((r) => r.confidence >= minConfidence);

    return {
      imageId: image.imageId,
      providerKind: this.kind,
      providerVersion: this.version,
      regions,
    };
  }

  /** Deterministic roof synthesis from image bounds + optional box hints. */
  private synthesize(image: SatelliteImageRef, hints?: SegmentationHints): SegmentationRegion[] {
    const boxes = hints?.boxesPx?.length
      ? hints.boxesPx
      : [this.defaultBox(image.widthPx, image.heightPx)];

    return boxes.map((box, index) => {
      const [minX, minY, maxX, maxY] = box;
      const contourPx: Point2D[] = [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ];
      const areaFraction = ((maxX - minX) * (maxY - minY)) / (image.widthPx * image.heightPx);
      // Larger, more-central regions get higher deterministic confidence.
      const confidence = clampUnit(round4(0.6 + 0.35 * Math.min(1, areaFraction * 2)));
      return {
        regionId: `${image.imageId}-syn-${index + 1}`,
        contourPx,
        confidence,
        label: "roof",
      };
    });
  }

  private defaultBox(widthPx: number, heightPx: number): [number, number, number, number] {
    const inset = Math.round(Math.min(widthPx, heightPx) * this.insetFraction);
    return [inset, inset, widthPx - inset, heightPx - inset];
  }
}

export function createFixtureSegmentationProvider(
  options?: FixtureSegmentationProviderOptions
): FixtureSegmentationProvider {
  return new FixtureSegmentationProvider(options);
}
