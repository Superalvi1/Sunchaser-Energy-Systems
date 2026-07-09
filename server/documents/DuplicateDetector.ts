/**
 * Stage 4 — Duplicate detection.
 *
 * Real, pure, deterministic content-addressable dedup keyed by (companyId,
 * checksum). No external dependency — this is a plain lookup index.
 */

export interface DuplicateRecord {
  documentId: string;
  familyId: string;
  checksum: string;
  companyId: string;
}

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  checksum: string;
  /** Set when an identical checksum already exists for this exact family. */
  sameFamilyMatch?: DuplicateRecord;
  /** Other documents (different families) sharing this checksum, informational only. */
  crossFamilyMatches: DuplicateRecord[];
}

export interface DuplicateIndex {
  register(record: DuplicateRecord): void;
  lookup(companyId: string, checksum: string): DuplicateRecord[];
  remove(documentId: string): void;
}

/** Pure in-memory index — deterministic ordering by insertion. */
export class InMemoryDuplicateIndex implements DuplicateIndex {
  private records: DuplicateRecord[] = [];

  register(record: DuplicateRecord): void {
    this.remove(record.documentId);
    this.records.push(record);
  }

  lookup(companyId: string, checksum: string): DuplicateRecord[] {
    return this.records.filter((r) => r.companyId === companyId && r.checksum === checksum);
  }

  remove(documentId: string): void {
    this.records = this.records.filter((r) => r.documentId !== documentId);
  }

  /** Test helper. */
  size(): number {
    return this.records.length;
  }
}

export function createInMemoryDuplicateIndex(): InMemoryDuplicateIndex {
  return new InMemoryDuplicateIndex();
}

/** Pure detection function — does not mutate the index. */
export function detectDuplicate(
  index: DuplicateIndex,
  companyId: string,
  checksum: string,
  familyId: string
): DuplicateDetectionResult {
  const matches = index.lookup(companyId, checksum);
  const sameFamilyMatch = matches.find((m) => m.familyId === familyId);
  const crossFamilyMatches = matches.filter((m) => m.familyId !== familyId);

  return {
    isDuplicate: Boolean(sameFamilyMatch),
    checksum,
    sameFamilyMatch,
    crossFamilyMatches,
  };
}
