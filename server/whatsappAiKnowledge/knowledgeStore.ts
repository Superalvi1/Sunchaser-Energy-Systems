/**
 * Tenant-isolated in-memory knowledge store (read-only API).
 *
 * Mocks/fixtures only — never production Supabase.
 * No CRM writes. Content is validated, sanitized, deep-copied, and deeply frozen on ingest.
 */

import {
  hasEmbeddedPriceAmount,
  redactPii,
  sanitizeKnowledgeContent,
} from "./knowledgePrivacy.ts";
import {
  isApprovedKnowledgeSourceType,
  isKnowledgeQueryCategory,
  type KnowledgeFreshnessStatus,
  type KnowledgePricePayload,
  type KnowledgeQueryCategory,
  type KnowledgeRecord,
} from "./knowledgeTypes.ts";

export type KnowledgeStoreSnapshot = {
  tenantId: string;
  recordCount: number;
};

const FRESHNESS_STATUSES: ReadonlySet<KnowledgeFreshnessStatus> = new Set([
  "current",
  "stale",
  "unknown",
  "missing_timestamp",
]);

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    const child = (value as Record<string, unknown>)[key];
    if (child && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Knowledge record ${field} must be a non-empty string`);
  }
  return value.trim();
}

function assertValidId(value: unknown, field: string): string {
  const id = assertNonEmptyString(value, field);
  if (!ID_RE.test(id)) {
    throw new Error(
      `Knowledge record ${field} has invalid format (use alphanumeric/._- up to 128 chars)`,
    );
  }
  return id;
}

function assertValidIsoTimestamp(
  value: unknown,
  field: string,
  { allowNull }: { allowNull: boolean },
): string | null {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw new Error(`Knowledge record ${field} is required`);
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Knowledge record ${field} must be an ISO timestamp string`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`Knowledge record ${field} is not a valid ISO timestamp`);
  }
  // Normalize to the provided string form after parseability check.
  return value.trim();
}

function assertFiniteNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; allowNull?: boolean },
): number | null {
  if (value === null || value === undefined) {
    if (opts.allowNull) return null;
    throw new Error(`Knowledge record ${field} is required`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Knowledge record ${field} must be a finite number (rejected NaN/Infinity)`,
    );
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new Error(`Knowledge record ${field} must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new Error(`Knowledge record ${field} must be <= ${opts.max}`);
  }
  return value;
}

function assertCategories(
  value: unknown,
): KnowledgeQueryCategory[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      "Knowledge record categories must be a non-empty array of approved categories",
    );
  }
  const out: KnowledgeQueryCategory[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isKnowledgeQueryCategory(entry)) {
      throw new Error(
        `Knowledge record categories contains unapproved value: ${String(entry)}`,
      );
    }
    out.push(entry);
  }
  return out;
}

function assertKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Knowledge record keywords must be an array of strings");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`Knowledge record keywords[${index}] must be a string`);
    }
    return entry;
  });
}

function assertPricePayload(
  price: unknown,
  record: {
    id: string;
    title: string;
    publishedAt: string | null;
  },
): KnowledgePricePayload {
  if (!price || typeof price !== "object") {
    throw new Error("Knowledge record price payload is required when containsPrice is true");
  }
  const p = price as Record<string, unknown>;

  if (typeof p.amountPkr !== "number" || !Number.isFinite(p.amountPkr)) {
    throw new Error(
      "Knowledge record price.amountPkr must be a finite number (rejected NaN/Infinity)",
    );
  }
  if (p.amountPkr <= 0) {
    throw new Error(
      "Knowledge record price.amountPkr must be a positive finite number",
    );
  }
  const amountPkr = p.amountPkr;

  if (p.currency !== "PKR") {
    throw new Error('Knowledge record price.currency must be "PKR"');
  }

  const unitLabel = assertNonEmptyString(p.unitLabel, "price.unitLabel");
  const publishedAt = assertValidIsoTimestamp(p.publishedAt, "price.publishedAt", {
    allowNull: false,
  });
  if (!publishedAt) {
    throw new Error("Knowledge record price.publishedAt is required");
  }

  // Authoritative price timestamp must match the record timestamp.
  if (record.publishedAt !== publishedAt) {
    throw new Error(
      "Knowledge record publishedAt must match price.publishedAt (authoritative price timestamp)",
    );
  }

  if (typeof p.freshness !== "string" || !FRESHNESS_STATUSES.has(p.freshness as KnowledgeFreshnessStatus)) {
    throw new Error(
      `Knowledge record price.freshness has unapproved value: ${String(p.freshness)}`,
    );
  }

  const sourceId = assertValidId(p.sourceId, "price.sourceId");
  if (sourceId !== record.id) {
    throw new Error(
      "Knowledge record price.sourceId must match record.id",
    );
  }

  const sourceTitle = assertNonEmptyString(p.sourceTitle, "price.sourceTitle");
  if (sourceTitle !== record.title) {
    throw new Error(
      "Knowledge record price.sourceTitle must match record.title",
    );
  }

  return {
    amountPkr,
    currency: "PKR",
    unitLabel,
    publishedAt,
    freshness: p.freshness as KnowledgeFreshnessStatus,
    sourceId,
    sourceTitle,
  };
}

/**
 * Runtime validation for ingest. Rejects unknown/unapproved values that
 * TypeScript types alone cannot enforce.
 */
export function validateKnowledgeRecord(record: KnowledgeRecord): void {
  assertValidId(record.id, "id");
  assertNonEmptyString(record.tenantId, "tenantId");

  if (
    typeof record.sourceType !== "string" ||
    !isApprovedKnowledgeSourceType(record.sourceType)
  ) {
    throw new Error(
      `Knowledge record sourceType is unapproved: ${String(record.sourceType)}`,
    );
  }

  assertNonEmptyString(record.title, "title");
  if (typeof record.body !== "string") {
    throw new Error("Knowledge record body must be a string");
  }

  assertCategories(record.categories);
  assertKeywords(record.keywords);

  const publishedAt = assertValidIsoTimestamp(record.publishedAt, "publishedAt", {
    allowNull: true,
  });

  if (record.maxAgeHours !== null && record.maxAgeHours !== undefined) {
    if (typeof record.maxAgeHours !== "number" || !Number.isFinite(record.maxAgeHours)) {
      throw new Error(
        "Knowledge record maxAgeHours must be a finite number or null (rejected NaN/Infinity)",
      );
    }
    if (record.maxAgeHours <= 0) {
      throw new Error(
        "Knowledge record maxAgeHours must be a positive finite number or null",
      );
    }
  }

  assertFiniteNumber(record.priority, "priority", { min: 0, max: 1000 });

  if (typeof record.active !== "boolean") {
    throw new Error("Knowledge record active must be a boolean");
  }
  if (typeof record.containsPrice !== "boolean") {
    throw new Error("Knowledge record containsPrice must be a boolean");
  }

  if (record.containsPrice) {
    if (publishedAt === null) {
      throw new Error(
        "Knowledge record publishedAt is required when containsPrice is true",
      );
    }
    assertPricePayload(record.price, {
      id: String(record.id).trim(),
      title: String(record.title).trim(),
      publishedAt,
    });
    if (hasEmbeddedPriceAmount(record.body)) {
      throw new Error(
        "Knowledge record body must not embed numeric price amounts for priced records; use the price payload",
      );
    }
  } else if (record.price !== null && record.price !== undefined) {
    throw new Error(
      "Knowledge record price must be null when containsPrice is false",
    );
  }
}

function sanitizeValidatedRecord(record: KnowledgeRecord): KnowledgeRecord {
  const tenantId = String(record.tenantId).trim();
  const id = String(record.id).trim();
  const title = redactPii(record.title).trim();
  const body = sanitizeKnowledgeContent(redactPii(record.body));
  const keywords = record.keywords.map((k) =>
    redactPii(k).toLowerCase().trim(),
  );
  const categories = [...record.categories];

  let price: KnowledgePricePayload | null = null;
  if (record.containsPrice && record.price) {
    // Keep authoritative price timestamp + attribution aligned after title redact.
    price = {
      amountPkr: record.price.amountPkr,
      currency: "PKR",
      unitLabel: String(record.price.unitLabel).trim(),
      publishedAt: record.price.publishedAt,
      freshness: record.price.freshness,
      sourceId: id,
      sourceTitle: title,
    };
  }

  return {
    id,
    tenantId,
    sourceType: record.sourceType,
    title,
    body,
    categories,
    keywords,
    publishedAt: record.publishedAt,
    maxAgeHours: record.maxAgeHours,
    containsPrice: Boolean(record.containsPrice),
    price,
    priority: record.priority,
    active: Boolean(record.active),
  };
}

export class InMemoryKnowledgeStore {
  private readonly byTenant = new Map<string, Map<string, KnowledgeRecord>>();

  constructor(seed: readonly KnowledgeRecord[] = []) {
    for (const record of seed) {
      this.ingest(record);
    }
  }

  /** Ingest a record after validation, PII redaction, deep-copy, and deep-freeze. */
  ingest(record: KnowledgeRecord): void {
    validateKnowledgeRecord(record);
    const sanitized = deepFreeze(deepClone(sanitizeValidatedRecord(record)));
    const tenantId = sanitized.tenantId;
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantId, bucket);
    }
    bucket.set(sanitized.id, sanitized);
  }

  /** Read-only list for a single tenant. Never crosses tenants. */
  listActiveForTenant(tenantId: string): KnowledgeRecord[] {
    const bucket = this.byTenant.get(String(tenantId || "").trim());
    if (!bucket) return [];
    return [...bucket.values()].filter((r) => r.active);
  }

  getById(tenantId: string, id: string): KnowledgeRecord | null {
    const bucket = this.byTenant.get(String(tenantId || "").trim());
    if (!bucket) return null;
    return bucket.get(id) ?? null;
  }

  snapshot(tenantId: string): KnowledgeStoreSnapshot {
    return {
      tenantId,
      recordCount: this.listActiveForTenant(tenantId).length,
    };
  }

  /** Explicitly no-op — knowledge layer never writes CRM. */
  writeCrm(): never {
    throw new Error("CRM writes are forbidden in whatsappAiKnowledge");
  }
}
