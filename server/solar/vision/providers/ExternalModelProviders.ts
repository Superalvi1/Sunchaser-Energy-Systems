/**
 * External model provider stubs — SAM, YOLO, OpenCV, cloud.
 *
 * Architecture-only in Phase 3A: these declare the plug points for real model
 * runtimes without wiring any of them. Each is unavailable by default
 * (isAvailable() === false) and throws PROVIDER_UNAVAILABLE / NOT_IMPLEMENTED
 * if segment() is called — fail closed, no network, no AI call.
 */

import {
  assertValidImageRef,
  type RoofSegmentationProvider,
  type SegmentationHints,
} from "../VisionProvider.ts";
import {
  RoofVisionProviderNotConfiguredError,
  VisionPipelineError,
  type SatelliteImageRef,
  type SegmentationResult,
  type VisionProviderKind,
} from "../VisionModels.ts";

export interface ExternalProviderOptions {
  version?: string;
  /** Force availability on for tests that inject a real backend later. */
  available?: boolean;
}

abstract class NotWiredSegmentationProvider implements RoofSegmentationProvider {
  abstract readonly kind: VisionProviderKind;
  readonly version: string;
  private readonly available: boolean;

  constructor(defaultVersion: string, options: ExternalProviderOptions = {}) {
    this.version = options.version ?? defaultVersion;
    this.available = options.available ?? false;
  }

  isAvailable(): boolean {
    return this.available;
  }

  segment(image: SatelliteImageRef, _hints?: SegmentationHints): SegmentationResult {
    assertValidImageRef(image);
    if (!this.available) {
      throw new RoofVisionProviderNotConfiguredError(this.kind);
    }
    throw new VisionPipelineError(
      "NOT_IMPLEMENTED",
      `${this.kind} provider is an architecture stub in Phase 3A. Wire a real runtime before use.`
    );
  }
}

export class SamSegmentationProvider extends NotWiredSegmentationProvider {
  readonly kind = "sam" as const;
  constructor(options?: ExternalProviderOptions) {
    super("sam-stub-0.0.0", options);
  }
}

export class YoloSegmentationProvider extends NotWiredSegmentationProvider {
  readonly kind = "yolo" as const;
  constructor(options?: ExternalProviderOptions) {
    super("yolo-stub-0.0.0", options);
  }
}

export class OpenCvSegmentationProvider extends NotWiredSegmentationProvider {
  readonly kind = "opencv" as const;
  constructor(options?: ExternalProviderOptions) {
    super("opencv-stub-0.0.0", options);
  }
}

export class CloudSegmentationProvider extends NotWiredSegmentationProvider {
  readonly kind = "cloud" as const;
  constructor(options?: ExternalProviderOptions) {
    super("cloud-stub-0.0.0", options);
  }
}

export function createSamSegmentationProvider(options?: ExternalProviderOptions): SamSegmentationProvider {
  return new SamSegmentationProvider(options);
}
export function createYoloSegmentationProvider(options?: ExternalProviderOptions): YoloSegmentationProvider {
  return new YoloSegmentationProvider(options);
}
export function createOpenCvSegmentationProvider(options?: ExternalProviderOptions): OpenCvSegmentationProvider {
  return new OpenCvSegmentationProvider(options);
}
export function createCloudSegmentationProvider(options?: ExternalProviderOptions): CloudSegmentationProvider {
  return new CloudSegmentationProvider(options);
}
