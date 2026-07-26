/**
 * Public exports for WhatsApp AI Knowledge & Answer Engine (AI-02).
 *
 * Plug-in surface for AI-01: call `retrieveAnswerDraft` and inject
 * `safeReplyHints` / facts into prompts. Do not wire outbound WhatsApp here.
 */

export {
  APPROVED_KNOWLEDGE_SOURCE_TYPES,
  DEFAULT_PRICE_MAX_AGE_HOURS,
  KNOWLEDGE_QUERY_CATEGORIES,
  KNOWLEDGE_UNAVAILABLE_MESSAGE,
  isApprovedKnowledgeSourceType,
  isKnowledgeQueryCategory,
  type ApprovedKnowledgeSourceType,
  type KnowledgeAnswerDisposition,
  type KnowledgeAnswerDraft,
  type KnowledgeAnswerFact,
  type KnowledgeFactConfidence,
  type KnowledgeFreshnessStatus,
  type KnowledgePricePayload,
  type KnowledgeQueryCategory,
  type KnowledgeRecord,
  type KnowledgeRetrievalMeta,
  type KnowledgeRetrievalRequest,
  type KnowledgeSourceConflict,
} from "./knowledgeTypes.ts";

export {
  CATEGORY_KEYWORD_MAP,
  PRICE_ELIGIBLE_SOURCE_TYPES,
  UNSAFE_ENGINEERING_SIGNALS,
  classifyQueryCategory,
  detectUnsafeEngineering,
  evaluateFreshness,
  evaluatePriceFreshness,
  isPriceAllowed,
} from "./knowledgeSourcePolicy.ts";

export {
  FINGERPRINT_UNCONFIGURED,
  KNOWLEDGE_QUERY_FINGERPRINT_SECRET_ENV,
  assertSafeKnowledgeBody,
  containsLikelyPii,
  fingerprintQuery,
  hasEmbeddedPriceAmount,
  omitEmbeddedPriceAmounts,
  redactPii,
  resolveFingerprintSecret,
  sanitizeKnowledgeContent,
} from "./knowledgePrivacy.ts";

export {
  FIXTURE_TENANT_A,
  FIXTURE_TENANT_B,
  KNOWLEDGE_FIXTURE_AS_OF_ISO,
  KNOWLEDGE_FIXTURE_RECORDS,
} from "./knowledgeFixtures.ts";

export {
  FORBIDDEN_FIXTURE_PRICE_AMOUNTS,
  FORBIDDEN_FIXTURE_SOURCE_IDS,
  KNOWLEDGE_PRODUCTION_AS_OF_ISO,
  KNOWLEDGE_PRODUCTION_RECORDS,
  PRODUCTION_TENANT_SUNCHASER,
} from "./knowledgeProduction.ts";

export {
  InMemoryKnowledgeStore,
  PRICE_SENSITIVE_CATEGORIES,
  validateKnowledgeRecord,
} from "./knowledgeStore.ts";

export {
  KnowledgeRetriever,
  detectPriceConflicts,
  rankRecordsForQuery,
  toAnswerFact,
} from "./knowledgeRetriever.ts";

export {
  KnowledgeAnswerEngine,
  createFixtureKnowledgeEngine,
  createKnowledgeEngineFromRecords,
  createProductionKnowledgeEngine,
  fixtureAsOfIso,
  productionAsOfIso,
} from "./knowledgeEngine.ts";
