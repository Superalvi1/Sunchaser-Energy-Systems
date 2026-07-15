export type IdempotencyRecord = {
  leadId: string;
  createdAtMs: number;
};

export type IdempotencyStore = {
  get(key: string): IdempotencyRecord | undefined;
  set(key: string, record: IdempotencyRecord): void;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, IdempotencyRecord>();
  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  get(key: string): IdempotencyRecord | undefined {
    const record = this.map.get(key);
    if (!record) return undefined;
    if (Date.now() - record.createdAtMs > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return record;
  }

  set(key: string, record: IdempotencyRecord): void {
    this.map.set(key, record);
  }

  clear(): void {
    this.map.clear();
  }
}

export const defaultPublicLeadIdempotencyStore = new MemoryIdempotencyStore();

export function normalizeIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (!key) return null;
  if (key.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) return null;
  return key;
}

export function readIdempotencyKeyFromHeaders(
  headers: Record<string, unknown>
): string | null {
  const raw = headers["idempotency-key"] ?? headers["Idempotency-Key"];
  if (Array.isArray(raw)) return normalizeIdempotencyKey(raw[0]);
  return normalizeIdempotencyKey(raw);
}
