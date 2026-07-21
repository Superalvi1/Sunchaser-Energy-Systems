/**
 * Segmentation abstraction — the pluggable seam for roof-segmentation models.
 *
 * Any model family (SAM, YOLO, OpenCV, a future cloud service) implements
 * RoofSegmentationProvider. The pipeline depends only on this interface, never
 * on a concrete model. V1 ships a deterministic fixture provider so the whole
 * pipeline runs with no cloud dependency.
 *
 * Preferred-provider resolution is FAIL CLOSED: if the caller asks for SAM and
 * SAM is unavailable, resolve throws PROVIDER_UNAVAILABLE (no silent fallback).
 * Callers that want automatic fallback omit `preferred`.
 */

import {
  isNonEmptyString,
  VisionPipelineError,
  type SatelliteImageRef,
  type SegmentationResult,
  type VisionProviderKind,
} from "./VisionModels.ts";

/** Optional hints a caller can pass to steer segmentation (e.g. SAM point/box prompts). */
export interface SegmentationHints {
  /** Prompt points in pixel space (foreground seeds). */
  pointsPx?: { x: number; y: number }[];
  /** Prompt boxes in pixel space [minX, minY, maxX, maxY]. */
  boxesPx?: [number, number, number, number][];
  /** Minimum confidence a region must meet to be returned. */
  minConfidence?: number;
}

export interface RoofSegmentationProvider {
  readonly kind: VisionProviderKind;
  readonly version: string;
  /** True when the provider can actually run in this environment. */
  isAvailable(): boolean;
  /** Deterministic for a given (image, hints) pair. Throws VisionPipelineError on failure. */
  segment(image: SatelliteImageRef, hints?: SegmentationHints): SegmentationResult;
}

/** Validates the common image contract every provider must uphold before running. */
export function assertValidImageRef(image: SatelliteImageRef): void {
  if (!image || typeof image !== "object") {
    throw new VisionPipelineError("INVALID_IMAGE", "Image reference is required.");
  }
  if (!isNonEmptyString(image.imageId)) {
    throw new VisionPipelineError("INVALID_IMAGE_ID", "imageId is required.");
  }
  if (!isNonEmptyString(image.checksum)) {
    throw new VisionPipelineError("INVALID_IMAGE_CHECKSUM", "checksum is required.");
  }
  if (!Number.isFinite(image.widthPx) || image.widthPx <= 0) {
    throw new VisionPipelineError("INVALID_IMAGE_WIDTH", "widthPx must be a positive number.");
  }
  if (!Number.isFinite(image.heightPx) || image.heightPx <= 0) {
    throw new VisionPipelineError("INVALID_IMAGE_HEIGHT", "heightPx must be a positive number.");
  }
  if (!Number.isFinite(image.metersPerPixel) || image.metersPerPixel <= 0) {
    throw new VisionPipelineError("INVALID_IMAGE_GSD", "metersPerPixel must be a positive number.");
  }
}

/**
 * A registry of available providers. The pipeline resolves a provider by kind
 * and fails closed when a preferred provider is unavailable.
 */
export class RoofSegmentationProviderRegistry {
  private readonly providers = new Map<VisionProviderKind, RoofSegmentationProvider>();
  private readonly order: VisionProviderKind[] = [];

  register(provider: RoofSegmentationProvider): void {
    if (!this.providers.has(provider.kind)) this.order.push(provider.kind);
    this.providers.set(provider.kind, provider);
  }

  get(kind: VisionProviderKind): RoofSegmentationProvider | null {
    return this.providers.get(kind) ?? null;
  }

  list(): RoofSegmentationProvider[] {
    return this.order.map((k) => this.providers.get(k)!).filter(Boolean);
  }

  /**
   * Resolve a provider.
   * - With `preferred`: that provider must be registered AND available, else throw.
   * - Without `preferred`: first available provider in registration order.
   */
  resolve(preferred?: VisionProviderKind): RoofSegmentationProvider {
    if (preferred) {
      const exact = this.providers.get(preferred);
      if (!exact) {
        throw new VisionPipelineError(
          "PROVIDER_UNAVAILABLE",
          `Provider "${preferred}" is not registered.`
        );
      }
      if (!exact.isAvailable()) {
        throw new VisionPipelineError(
          "PROVIDER_UNAVAILABLE",
          `Provider "${preferred}" is registered but not available in this environment.`
        );
      }
      return exact;
    }
    for (const kind of this.order) {
      const provider = this.providers.get(kind)!;
      if (provider.isAvailable()) return provider;
    }
    throw new VisionPipelineError("NO_PROVIDER_AVAILABLE", "No segmentation provider is available.");
  }
}

export function createProviderRegistry(
  providers: RoofSegmentationProvider[] = []
): RoofSegmentationProviderRegistry {
  const registry = new RoofSegmentationProviderRegistry();
  for (const provider of providers) registry.register(provider);
  return registry;
}
