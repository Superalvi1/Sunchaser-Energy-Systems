/**
 * Tenant-isolated in-memory knowledge store (read-only API).
 *
 * Mocks/fixtures only — never production Supabase.
 * No CRM writes. Content is sanitized on ingest.
 */

import {
  redactPii,
  sanitizeKnowledgeContent,
} from "./knowledgePrivacy.ts";
import type { KnowledgeRecord } from "./knowledgeTypes.ts";

export type KnowledgeStoreSnapshot = {
  tenantId: string;
  recordCount: number;
};

export class InMemoryKnowledgeStore {
  private readonly byTenant = new Map<string, Map<string, KnowledgeRecord>>();

  constructor(seed: readonly KnowledgeRecord[] = []) {
    for (const record of seed) {
      this.ingest(record);
    }
  }

  /** Ingest a record after PII redaction + injection sanitization. */
  ingest(record: KnowledgeRecord): void {
    const tenantId = String(record.tenantId || "").trim();
    if (!tenantId) {
      throw new Error("Knowledge record requires tenantId");
    }
    const sanitized: KnowledgeRecord = {
      ...record,
      tenantId,
      title: redactPii(record.title).trim(),
      body: sanitizeKnowledgeContent(redactPii(record.body)),
      keywords: record.keywords.map((k) =>
        redactPii(k).toLowerCase().trim(),
      ),
      active: Boolean(record.active),
    };
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantId, bucket);
    }
    bucket.set(sanitized.id, Object.freeze(sanitized));
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
