/**
 * Stage 6 — Storage provider.
 *
 * Interface + a real, functional in-memory default. Swap InMemoryStorageProvider
 * for a real backend (S3, GCS, local disk) via dependency injection in
 * production — nothing else in the pipeline needs to change.
 */

import { DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP, DocumentPipelineError } from "./DocumentModels.ts";

export interface StorageRef {
  key: string;
  provider: string;
  sizeBytes: number;
  storedAt: string;
}

export interface StorageProvider {
  readonly providerId: string;
  store(key: string, content: Buffer, now?: string): StorageRef;
  retrieve(key: string): Buffer | null;
  delete(key: string): boolean;
  exists(key: string): boolean;
}

/** Deterministic key: one path per company / family / version. */
export function buildStorageKey(companyId: string, familyId: string, versionNumber: number): string {
  return `${companyId}/${familyId}/v${versionNumber}`;
}

/** Real, functional in-memory store — suitable for dev/tests, not production durability. */
export class InMemoryStorageProvider implements StorageProvider {
  readonly providerId = "in-memory";
  private objects = new Map<string, Buffer>();

  store(key: string, content: Buffer, now?: string): StorageRef {
    this.objects.set(key, Buffer.from(content));
    return {
      key,
      provider: this.providerId,
      sizeBytes: content.byteLength,
      storedAt: now ?? DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP,
    };
  }

  retrieve(key: string): Buffer | null {
    const buf = this.objects.get(key);
    return buf ? Buffer.from(buf) : null;
  }

  delete(key: string): boolean {
    return this.objects.delete(key);
  }

  exists(key: string): boolean {
    return this.objects.has(key);
  }

  /** Test helper. */
  size(): number {
    return this.objects.size;
  }
}

export function createInMemoryStorageProvider(): InMemoryStorageProvider {
  return new InMemoryStorageProvider();
}

export function assertStored(provider: StorageProvider, key: string): void {
  if (!provider.exists(key)) {
    throw new DocumentPipelineError("storage", `object not found for key: ${key}`, { key });
  }
}
