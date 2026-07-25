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
  isPriceAllowed,
} from "./knowledgeSourcePolicy.ts";

export {
  assertSafeKnowledgeBody,
  containsLikelyPii,
  fingerprintQuery,
  redactPii,
  sanitizeKnowledgeContent,
} from "./knowledgePrivacy.ts";

export {
  FIXTURE_TENANT_A,
  FIXTURE_TENANT_B,
  KNOWLEDGE_FIXTURE_AS_OF_ISO,
  KNOWLEDGE_FIXTURE_RECORDS,
} from "./knowledgeFixtures.ts";

export { InMemoryKnowledgeStore } from "./knowledgeStore.ts";

export {
  KnowledgeRetriever,
  detectPriceConflicts,
  rankRecordsForQuery,
  toAnswerFact,
} from "./knowledgeRetriever.ts";

export {
  KnowledgeAnswerEngine,
  createFixtureKnowledgeEngine,
  fixtureAsOfIso,
} from "./knowledgeEngine.ts";
