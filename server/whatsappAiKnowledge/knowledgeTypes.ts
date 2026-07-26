/**
 * WhatsApp AI Knowledge & Answer Engine (AI-02) — domain models.
 *
 * Isolated, read-only retrieval types for customer-query answer drafts.
 * No outbound WhatsApp, no CRM writes, no external web browsing.
 */

/** Approved knowledge-source types that may ground customer answers. */
export const APPROVED_KNOWLEDGE_SOURCE_TYPES = [
  "solar_package",
  "product_catalogue",
  "pricing_approved",
  "faq_cms",
  "company_terms",
  "warranty_policy",
  "installation_process",
  "after_sales_support",
  "complaint_process",
  "quotation_requirements",
  "net_metering_general",
  "human_handover",
] as const;

export type ApprovedKnowledgeSourceType =
  (typeof APPROVED_KNOWLEDGE_SOURCE_TYPES)[number];

/** Safe answer-pack categories supported by the engine. */
export const KNOWLEDGE_QUERY_CATEGORIES = [
  "solar_packages",
  "on_grid_hybrid",
  "batteries",
  "panels",
  "inverters",
  "warranty",
  "installation_process",
  "after_sales_support",
  "complaints",
  "quotation_requirements",
  "net_metering_general",
  "human_handover",
  "unsafe_engineering",
  "unknown",
] as const;

export type KnowledgeQueryCategory =
  (typeof KNOWLEDGE_QUERY_CATEGORIES)[number];

/** Freshness of an approved fact relative to as-of time. */
export type KnowledgeFreshnessStatus =
  | "current"
  | "stale"
  | "unknown"
  | "missing_timestamp";

/** Confidence label distinguishing approved facts from gaps. */
export type KnowledgeFactConfidence =
  | "approved"
  | "uncertain"
  | "missing";

/** Disposition of a composed answer draft. */
export type KnowledgeAnswerDisposition =
  | "answer"
  | "partial"
  | "escalate_human"
  | "unavailable";

export type KnowledgePricePayload = {
  amountPkr: number;
  currency: "PKR";
  unitLabel: string;
  publishedAt: string;
  freshness: KnowledgeFreshnessStatus;
  sourceId: string;
  sourceTitle: string;
};

export type KnowledgeRecord = {
  id: string;
  tenantId: string;
  sourceType: ApprovedKnowledgeSourceType;
  title: string;
  /** Customer-safe body. Must not contain PII. */
  body: string;
  categories: KnowledgeQueryCategory[];
  keywords: string[];
  /** ISO timestamp when the source was last approved/published. */
  publishedAt: string | null;
  /** Max age in hours before the record is considered stale (esp. prices). */
  maxAgeHours: number | null;
  containsPrice: boolean;
  price: KnowledgePricePayload | null;
  /** Higher wins when ranking equal relevance. */
  priority: number;
  active: boolean;
};

export type KnowledgeAnswerFact = {
  id: string;
  text: string;
  confidence: KnowledgeFactConfidence;
  sourceId: string;
  sourceTitle: string;
  sourceType: ApprovedKnowledgeSourceType;
  freshness: KnowledgeFreshnessStatus;
  publishedAt: string | null;
  category: KnowledgeQueryCategory;
  containsPrice: boolean;
  price: KnowledgePricePayload | null;
  rankScore: number;
};

export type KnowledgeSourceConflict = {
  topic: string;
  sourceIds: string[];
  sourceTitles: string[];
  resolution: "prefer_higher_priority" | "omit_price" | "escalate_human";
  detail: string;
};

export type KnowledgeRetrievalRequest = {
  tenantId: string;
  /** Sanitized customer question text (may still contain injection attempts). */
  queryText: string;
  /** Optional hint from AI-01 intent classifier. */
  categoryHint?: KnowledgeQueryCategory | null;
  /** ISO as-of clock for freshness checks (deterministic in tests). */
  asOfIso: string;
  /** Max facts to return. */
  limit?: number;
};

export type KnowledgeRetrievalMeta = {
  tenantId: string;
  category: KnowledgeQueryCategory;
  matchedRecordCount: number;
  consideredRecordCount: number;
  usedDeterministicRetrieval: true;
  usedAiGeneration: false;
  usedExternalWeb: false;
  crmWrites: false;
  queryFingerprint: string;
};

export type KnowledgeAnswerDraft = {
  tenantId: string;
  category: KnowledgeQueryCategory;
  disposition: KnowledgeAnswerDisposition;
  facts: KnowledgeAnswerFact[];
  missingTopics: string[];
  conflicts: KnowledgeSourceConflict[];
  humanHandoverReason: string | null;
  /**
   * Safe reply hints for AI-01 prompt injection only.
   * Not an outbound WhatsApp message.
   */
  safeReplyHints: string[];
  unavailableMessage: string | null;
  retrieval: KnowledgeRetrievalMeta;
};

export const KNOWLEDGE_UNAVAILABLE_MESSAGE =
  "This information is not available in approved sources right now. Please ask a human team member.";

export const DEFAULT_PRICE_MAX_AGE_HOURS = 36;

export function isApprovedKnowledgeSourceType(
  value: string,
): value is ApprovedKnowledgeSourceType {
  return (APPROVED_KNOWLEDGE_SOURCE_TYPES as readonly string[]).includes(value);
}

export function isKnowledgeQueryCategory(
  value: string,
): value is KnowledgeQueryCategory {
  return (KNOWLEDGE_QUERY_CATEGORIES as readonly string[]).includes(value);
}
