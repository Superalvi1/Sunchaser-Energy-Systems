import type { AuditEntry } from "./types.ts";
import type { Clock } from "./Clock.ts";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Produce a fresh, deeply frozen audit entry safe to expose to callers. */
function sealAuditEntry(entry: AuditEntry): Readonly<AuditEntry> {
  const sealed: AuditEntry = {
    seq: entry.seq,
    timestamp: entry.timestamp,
    instanceId: entry.instanceId,
    type: entry.type,
  };
  if (entry.stepId !== undefined) {
    sealed.stepId = entry.stepId;
  }
  if (entry.data !== undefined) {
    sealed.data = deepFreeze(structuredClone(entry.data));
  }
  return Object.freeze(sealed);
}

/**
 * Append-only workflow audit log.
 *
 * Entries are never removed, replaced, or reordered. Sequence numbers increase
 * monotonically for the lifetime of each `AuditLog` instance and are never reset.
 * Read APIs return defensive copies with frozen entries so callers cannot mutate
 * stored history.
 */
export class AuditLog {
  private readonly entries: Readonly<AuditEntry>[] = [];
  private sequence = 0;

  constructor(private readonly clock: Clock) {}

  record(
    instanceId: string,
    type: string,
    stepId?: string,
    data?: Record<string, unknown>
  ): Readonly<AuditEntry> {
    this.sequence += 1;
    const entry = sealAuditEntry({
      seq: this.sequence,
      timestamp: this.clock.now(),
      instanceId,
      type,
      ...(stepId !== undefined ? { stepId } : {}),
      ...(data !== undefined ? { data } : {}),
    });
    this.entries.push(entry);
    return entry;
  }

  entriesFor(instanceId: string): readonly AuditEntry[] {
    return this.entries
      .filter((entry) => entry.instanceId === instanceId)
      .map((entry) => sealAuditEntry(entry));
  }

  all(): readonly AuditEntry[] {
    return this.entries.map((entry) => sealAuditEntry(entry));
  }
}
