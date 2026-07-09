/**
 * Stage 2 — Virus scan interface.
 *
 * Architecture only: no real anti-malware engine is wired. NullVirusScanner
 * always reports "clean" and exists purely so the pipeline has a working
 * default to run against in development and tests. Replace it via
 * dependency injection with a real engine (ClamAV, a cloud AV API, etc.)
 * before accepting untrusted uploads in production.
 */

import { DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP, DocumentPipelineError } from "./DocumentModels.ts";
import type { UploadedFile } from "./DocumentUpload.ts";

export type VirusScanStatus = "clean" | "infected" | "error";

export interface VirusScanResult {
  status: VirusScanStatus;
  engine: string;
  scannedAt: string;
  threatName?: string;
  message: string;
}

export interface VirusScanner {
  scan(file: UploadedFile): VirusScanResult;
}

export const VIRUS_SCANNER_NOT_IMPLEMENTED_MESSAGE =
  "No real virus scanning engine is wired in this architecture. Replace NullVirusScanner via DI before accepting untrusted uploads.";

/** Deterministic stub — always reports clean. Architecture placeholder only. */
export class NullVirusScanner implements VirusScanner {
  scan(file: UploadedFile): VirusScanResult {
    return {
      status: "clean",
      engine: "null-scanner",
      scannedAt: DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP,
      message: VIRUS_SCANNER_NOT_IMPLEMENTED_MESSAGE,
    };
  }
}

export function createNullVirusScanner(): NullVirusScanner {
  return new NullVirusScanner();
}

export const NULL_VIRUS_SCANNER: VirusScanner = createNullVirusScanner();

/**
 * Deterministic fixed-result scanner for tests and DI seams — lets callers
 * exercise the infected/error branches of the pipeline without a real engine.
 */
export class StaticVirusScanner implements VirusScanner {
  constructor(private readonly result: VirusScanResult) {}

  scan(): VirusScanResult {
    return this.result;
  }
}

export function createStaticVirusScanner(result: VirusScanResult): StaticVirusScanner {
  return new StaticVirusScanner(result);
}

export function assertScanClean(result: VirusScanResult): void {
  if (result.status !== "clean") {
    throw new DocumentPipelineError("virus_scan", result.message || `scan status: ${result.status}`, {
      status: result.status,
      threatName: result.threatName,
    });
  }
}
