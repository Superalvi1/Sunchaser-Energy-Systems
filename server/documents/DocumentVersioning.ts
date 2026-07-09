/**
 * Stage 5 — Versioning.
 *
 * Real, pure, deterministic version-chain resolution for a document family.
 * A "family" is the stable identity of a document across re-uploads; each
 * upload becomes a new immutable version in that family's chain.
 */

import { DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP } from "./DocumentModels.ts";

export interface VersionChainEntry {
  versionId: string;
  familyId: string;
  versionNumber: number;
  previousVersionId?: string;
  checksum: string;
  createdAt: string;
}

export interface VersionRegistry {
  getLatest(familyId: string): VersionChainEntry | null;
  record(entry: VersionChainEntry): void;
  listVersions(familyId: string): VersionChainEntry[];
}

/** Pure in-memory version registry — deterministic ordering by versionNumber. */
export class InMemoryVersionRegistry implements VersionRegistry {
  private chains = new Map<string, VersionChainEntry[]>();

  getLatest(familyId: string): VersionChainEntry | null {
    const chain = this.chains.get(familyId);
    if (!chain || chain.length === 0) return null;
    return chain[chain.length - 1];
  }

  record(entry: VersionChainEntry): void {
    const chain = this.chains.get(entry.familyId) ?? [];
    chain.push(entry);
    this.chains.set(entry.familyId, chain);
  }

  listVersions(familyId: string): VersionChainEntry[] {
    return [...(this.chains.get(familyId) ?? [])].sort((a, b) => a.versionNumber - b.versionNumber);
  }

  /** Test helper. */
  familyCount(): number {
    return this.chains.size;
  }
}

export function createInMemoryVersionRegistry(): InMemoryVersionRegistry {
  return new InMemoryVersionRegistry();
}

export interface ResolveVersionOptions {
  registry: VersionRegistry;
  familyId: string;
  versionId: string;
  checksum: string;
  now?: string;
}

/**
 * Pure resolution — does not write to the registry. Callers commit the
 * returned entry via registry.record(...) once downstream stages succeed.
 */
export function resolveNextVersion(options: ResolveVersionOptions): VersionChainEntry {
  const latest = options.registry.getLatest(options.familyId);
  const versionNumber = latest ? latest.versionNumber + 1 : 1;

  return {
    versionId: options.versionId,
    familyId: options.familyId,
    versionNumber,
    previousVersionId: latest?.versionId,
    checksum: options.checksum,
    createdAt: options.now ?? DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP,
  };
}

/** True when the resolved version has identical content to the immediate prior version. */
export function isUnchangedFromPreviousVersion(entry: VersionChainEntry, registry: VersionRegistry): boolean {
  if (!entry.previousVersionId) return false;
  const previous = registry
    .listVersions(entry.familyId)
    .find((v) => v.versionId === entry.previousVersionId);
  return Boolean(previous && previous.checksum === entry.checksum);
}

export function isFirstVersion(entry: VersionChainEntry): boolean {
  return entry.versionNumber === 1 && !entry.previousVersionId;
}
