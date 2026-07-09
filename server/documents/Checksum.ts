/**
 * Stage 3 — Checksum.
 *
 * Real, pure, deterministic content hashing. No external dependency: this is
 * plain SHA-256 over the uploaded bytes, so it is fully implemented (unlike
 * the interface-only stages elsewhere in the pipeline).
 */

import { createHash } from "node:crypto";

import { DocumentPipelineError } from "./DocumentModels.ts";

export const CHECKSUM_ALGORITHM = "sha256" as const;

export interface ChecksumResult {
  algorithm: typeof CHECKSUM_ALGORITHM;
  value: string;
  sizeBytes: number;
}

/** Deterministic SHA-256 hex digest of the given bytes. */
export function computeChecksum(content: Buffer): string {
  return createHash(CHECKSUM_ALGORITHM).update(content).digest("hex");
}

export function computeChecksumResult(content: Buffer): ChecksumResult {
  return {
    algorithm: CHECKSUM_ALGORITHM,
    value: computeChecksum(content),
    sizeBytes: content.byteLength,
  };
}

/** Constant-time-ish comparison (length check first) for two checksum strings. */
export function checksumsMatch(a: string, b: string): boolean {
  return a.length === b.length && a === b;
}

export function verifyChecksum(content: Buffer, expectedChecksum: string): boolean {
  return checksumsMatch(computeChecksum(content), expectedChecksum);
}

/** Throws DocumentPipelineError("checksum", ...) if the content does not match. */
export function assertChecksumMatches(content: Buffer, expectedChecksum: string): void {
  if (!verifyChecksum(content, expectedChecksum)) {
    throw new DocumentPipelineError("checksum", "content does not match expected checksum", {
      expectedChecksum,
      actualChecksum: computeChecksum(content),
    });
  }
}
