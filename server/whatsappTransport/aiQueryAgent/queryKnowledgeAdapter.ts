/**
 * AI-04/AI-05 — adapter from AI-01 query agent → AI-02 knowledge engine.
 *
 * Tenant isolation: companyId maps to knowledge tenantId; retrieval is always
 * scoped by tenant. No WhatsApp send, no CRM writes, no live provider calls.
 *
 * AI-05: production never loads fixture knowledge. Source is selected via
 * WHATSAPP_AI_KNOWLEDGE_SOURCE (fail-closed; no silent fixture fallback).
 */

import {
  FIXTURE_TENANT_A,
  KNOWLEDGE_UNAVAILABLE_MESSAGE,
  KnowledgeAnswerEngine,
  PRODUCTION_TENANT_SUNCHASER,
  createFixtureKnowledgeEngine,
  createProductionKnowledgeEngine,
  fixtureAsOfIso,
  omitEmbeddedPriceAmounts,
  productionAsOfIso,
  type KnowledgeAnswerDraft,
  type KnowledgeAnswerFact,
  type KnowledgeQueryCategory,
} from "../../whatsappAiKnowledge/index.ts";
import {
  isActualProductionRuntime,
  readKnowledgeSource,
  type KnowledgeSourceMode,
} from "./queryAgentConfig.ts";
import type { QueryIntent } from "./queryAgentTypes.ts";

/**
 * Immutable knowledge-port provenance (AI-05-R2).
 * Production-safe outline selection trusts this field only — never portId.
 */
export type KnowledgePortProvenance =
  | "production"
  | "fixtures"
  | "unavailable"
  | "test";

export type QueryKnowledgeRetrieveRequest = {
  /** AI-01 company / tenant scope. */
  companyId: string;
  /** Sanitized customer text (post injection guard). */
  queryText: string;
  intent: QueryIntent;
  /** ISO as-of for freshness; defaults inside adapter when omitted. */
  asOfIso?: string;
};

/**
 * Port consumed by QueryAgentService. Implementations must enforce tenant scope.
 * `provenance` is factory-assigned and immutable; callers cannot forge it.
 */
export type QueryKnowledgePort = {
  readonly portId: string;
  /** Factory-sealed trust mark — never derived from caller portId overrides. */
  readonly provenance: KnowledgePortProvenance;
  retrieve(request: QueryKnowledgeRetrieveRequest): KnowledgeAnswerDraft;
};

/** Map AI-01 intents onto AI-02 category hints. */
export function mapIntentToKnowledgeCategory(
  intent: QueryIntent
): KnowledgeQueryCategory | null {
  switch (intent) {
    case "sales":
    case "system_selection":
      return "solar_packages";
    case "product_question":
      return "panels";
    case "technical_question":
      return "unsafe_engineering";
    case "quotation_request":
      return "quotation_requirements";
    case "complaint":
      return "complaints";
    case "after_sales":
      return "after_sales_support";
    case "billing_payment":
      return "quotation_requirements";
    case "net_metering":
      return "net_metering_general";
    case "human_request":
      return "human_handover";
    case "unsupported_high_risk":
      return "unsafe_engineering";
    case "greeting":
      return null;
    default:
      return null;
  }
}

/**
 * Resolve knowledge tenant id from company id.
 * Fixture aliases apply only in fixtures mode; production maps sunchaser to
 * the launch tenant. Unknown companies keep their id (empty bucket → escalate).
 */
export function resolveKnowledgeTenantId(
  companyId: string,
  mode: KnowledgeSourceMode = "fixtures"
): string {
  const id = String(companyId || "").trim();
  if (!id) return "";
  if (mode === "fixtures") {
    if (id === "sunchaser" || id === FIXTURE_TENANT_A) return FIXTURE_TENANT_A;
    return id;
  }
  if (mode === "production") {
    if (id === "sunchaser" || id === PRODUCTION_TENANT_SUNCHASER) {
      return PRODUCTION_TENANT_SUNCHASER;
    }
    return id;
  }
  return id;
}

function buildUnavailableDraft(
  tenantId: string,
  category: KnowledgeQueryCategory,
  queryText: string,
  reason: string
): KnowledgeAnswerDraft {
  return {
    tenantId,
    category,
    disposition: "unavailable",
    facts: [
      {
        id: "fact_missing",
        text: KNOWLEDGE_UNAVAILABLE_MESSAGE,
        confidence: "missing",
        sourceId: "none",
        sourceTitle: "No approved source",
        sourceType: "human_handover",
        freshness: "missing_timestamp",
        publishedAt: null,
        category,
        containsPrice: false,
        price: null,
        rankScore: 0,
      },
    ],
    missingTopics: ["approved answer"],
    conflicts: [],
    humanHandoverReason: reason,
    safeReplyHints: [KNOWLEDGE_UNAVAILABLE_MESSAGE],
    unavailableMessage: KNOWLEDGE_UNAVAILABLE_MESSAGE,
    retrieval: {
      tenantId,
      category,
      matchedRecordCount: 0,
      consideredRecordCount: 0,
      usedDeterministicRetrieval: true,
      usedAiGeneration: false,
      usedExternalWeb: false,
      crmWrites: false,
      queryFingerprint: `unavailable:${String(queryText || "").length}`,
    },
  };
}

/** Fail-closed port when knowledge source is missing/invalid or blocked. */
export function createUnavailableKnowledgePort(
  reason =
    "Knowledge source unavailable or misconfigured — human review required."
): QueryKnowledgePort {
  return {
    portId: "knowledge-unavailable",
    provenance: "unavailable",
    retrieve(request) {
      const category =
        mapIntentToKnowledgeCategory(request.intent) ?? "unknown";
      const tenantId = resolveKnowledgeTenantId(
        request.companyId,
        "unavailable"
      );
      return buildUnavailableDraft(
        tenantId,
        category,
        request.queryText,
        reason
      );
    },
  };
}

/**
 * Normalize customer text for price-intent detection:
 * - Unicode NFKC
 * - collapse whitespace
 * - treat harmless punctuation as separators
 * - fold common Roman-Urdu spelling variants
 */
export function normalizePriceIntentText(queryText: string): string {
  let t = String(queryText || "")
    .normalize("NFKC")
    .toLowerCase();

  // Harmless punctuation → space (keep digits/letters including Urdu).
  t = t.replace(/[?!.,;:'"“”‘’`´()[\]{}<>*_~^+=|\\/]+/g, " ");
  t = t.replace(/[-–—]+/g, " ");
  t = t.replace(/\s+/g, " ").trim();

  // Common Roman-Urdu spelling folds (word-bounded).
  t = t
    .replace(/\bkitnay\b/g, "kitne")
    .replace(/\bkitny\b/g, "kitne")
    .replace(/\bkitni\b/g, "kitne")
    .replace(/\bkya\b/g, "kia")
    .replace(/\bbatao\b/g, "bata")
    .replace(/\bbata\s+dein\b/g, "bata")
    .replace(/\bbata\s+den\b/g, "bata")
    .replace(/\bbata\s+do\b/g, "bata")
    .replace(/\bbata\s+dena\b/g, "bata")
    .replace(/\bmein\b/g, "men")
    .replace(/\bmai\b/g, "men");

  return t.replace(/\s+/g, " ").trim();
}

/**
 * Intervening words allowed between battery ↔ charge/charging in a technical
 * span. Must NOT cross package/system/product/commercial-rate wording or
 * conjunctions (and/aur/اور), or price-first clauses get swallowed.
 *
 * Note: JS `\b` is ASCII-word based and does not bound Urdu tokens reliably, so
 * forbidden/safe tokens use an explicit end look-ahead instead.
 */
const TECH_SPAN_TOKEN_END = String.raw`(?=$|[\s؟!?.،,;:\/\-])`;

const TECH_SPAN_FORBIDDEN_GAP_TOKEN = String.raw`(?:package|packages|pakej|pakege|پیکیج|system|systems|سسٹم|product|products|price|pricing|cost|costs|charges|rate|rates|ریٹ|قیمت|kitne|kitnay|kitni|kia|kya|bata|aur|and|اور|or|یا)`;

/**
 * Allowlisted descriptive connectors only (no arbitrary multiword / Urdu catch-all).
 * This keeps “بیٹری بینک کا چارجنگ ریٹ” technical while refusing to leap across
 * “بیٹری پیکیج کا ریٹ اور …”.
 */
const TECH_SPAN_SAFE_GAP_TOKEN = String.raw`(?:(?!${TECH_SPAN_FORBIDDEN_GAP_TOKEN}${TECH_SPAN_TOKEN_END})(?:the|a|an|this|our|ka|ki|ke|کا|کی|کے|bank|banks|pack|packs|cell|cells|lithium|storage|بینک|پیک|سیل|لیتھیم|والا|والی|والے))`;

function techSpanSafeGap(maxWords: number): string {
  return String.raw`(?:\s+${TECH_SPAN_SAFE_GAP_TOKEN}){0,${maxWords}}`;
}

/**
 * Technical-rate span patterns (English / Roman-Urdu), applied after
 * normalizePriceIntentText. Spans are removed before price-intent checks so a
 * technical phrase cannot suppress a separate product/package rate request.
 *
 * Each pattern is rebuilt per call (global + stateful lastIndex).
 */
function technicalRateSpanPatternsEn(): RegExp[] {
  const gap = techSpanSafeGap(4);
  // Optional slash form: charge/discharge (raw) or charge discharge (normalized).
  const chargeWord = String.raw`(?:charge|charging|discharge)`;
  const chargePair = String.raw`${chargeWord}(?:\s*[\/]\s*${chargeWord}|\s+${chargeWord})?`;
  return [
    // battery charge/charging/discharge rate (incl. charge/discharge)
    new RegExp(String.raw`\bbatter(?:y|ies)\s+${chargePair}\s+rate\b`, "g"),
    // charge rate for this battery / charging rate of the battery bank
    new RegExp(
      String.raw`\b${chargeWord}\s+rate(?:\s+(?:for|of|on|in)\s+(?:the\s+|this\s+|a\s+|an\s+)?(?:\w+\s+){0,3}batter(?:y|ies))?\b`,
      "g"
    ),
    // battery … charging rate (safe descriptive intervening words only)
    new RegExp(
      String.raw`\bbatter(?:y|ies)${gap}\s+${chargeWord}\s+rate\b`,
      "g"
    ),
    // rate of discharge / rate of panel degradation
    /\brate\s+of\s+(?:the\s+)?(?:panel\s+)?(?:discharge|degradation|charging|charge)\b/g,
    // other technical * rate forms
    /\b(?:data|refresh|failure|generation|degradation)\s+rate\b/g,
    /\brate\s+of\s+(?:the\s+)?(?:data|refresh|failure|generation)\b/g,
  ];
}

/** Urdu / mixed technical-rate spans (ریٹ as technical rate). */
function technicalRateSpanPatternsUrdu(): RegExp[] {
  const gap = techSpanSafeGap(4);
  const chargeUr = String.raw`(?:charging|charge|discharge|چارجنگ|چارج)`;
  return [
    // Tight: بیٹری کا چارجنگ ریٹ / بیٹری بینک کا چارجنگ ریٹ (no commercial gap)
    new RegExp(String.raw`بیٹری${gap}\s*${chargeUr}\s*ریٹ`, "g"),
    // Tight mixed: battery charging ریٹ / battery bank charging ریٹ
    new RegExp(
      String.raw`\bbatter(?:y|ies)${gap}\s*${chargeUr}\s*ریٹ`,
      "gi"
    ),
    // Tip-only technical ریٹ (does not reach backward into package ریٹ)
    new RegExp(String.raw`${chargeUr}\s*ریٹ`, "gi"),
  ];
}

function applySpanRemovals(text: string, patterns: RegExp[]): string {
  let out = text;
  for (const re of patterns) {
    out = out.replace(re, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Remove technical-rate spans from customer text. Price-intent detection runs
 * on the remainder so mixed technical + commercial messages stay price-positive.
 */
export function stripTechnicalRateSpans(queryText: string): {
  normalizedRemainder: string;
  rawRemainder: string;
  removedTechnicalSpan: boolean;
} {
  const raw = String(queryText || "").normalize("NFKC");
  const normalized = normalizePriceIntentText(raw);

  const rawAfterUrdu = applySpanRemovals(raw, technicalRateSpanPatternsUrdu());
  const enPatternsCi = technicalRateSpanPatternsEn().map(
    (re) => new RegExp(re.source, "gi")
  );
  const rawRemainder = applySpanRemovals(rawAfterUrdu, enPatternsCi).replace(
    /\s+/g,
    " "
  ).trim();

  const normalizedRemainder = applySpanRemovals(
    normalizePriceIntentText(rawAfterUrdu),
    technicalRateSpanPatternsEn()
  );

  const removedTechnicalSpan =
    normalizedRemainder !== normalized || rawAfterUrdu !== raw;

  return {
    normalizedRemainder,
    rawRemainder,
    removedTechnicalSpan,
  };
}

/** True when the message contains at least one technical-rate span. */
export function isTechnicalRateContext(queryText: string): boolean {
  return stripTechnicalRateSpans(queryText).removedTechnicalSpan;
}

function hasUrduPriceIntent(text: string): boolean {
  const raw = String(text || "").normalize("NFKC");
  // Urdu-script price / commercial rate / “how much” equivalents.
  return (
    /قیمت/.test(raw) ||
    /ریٹ/.test(raw) ||
    /کتنے\s*کا/.test(raw) ||
    /کتنی\s*کی/.test(raw)
  );
}

function hasLatinPriceIntent(t: string): boolean {
  if (!t) return false;

  // Formal English price wording.
  if (
    /\b(price|pricing|cost|costs|pkr|rupees?)\b/.test(t) ||
    /\b(rs|rs\/-)\b/.test(t) ||
    /\bhow much\b/.test(t) ||
    /\b(quote|quot(?:e|ation))\b.*\b(price|cost|pkr|rs)\b/.test(t) ||
    /\b(exact|current)\s+(price|cost)\b/.test(t) ||
    /\bprice\s+of\b/.test(t)
  ) {
    return true;
  }

  // Informal Roman-Urdu / mixed WhatsApp price intents.
  if (
    /\bkitne\s+ka\b/.test(t) ||
    /\bkitne\s+ki\b/.test(t) ||
    /\bkitne\s+men\b/.test(t) ||
    /\bkia\s+rate\b/.test(t) ||
    /\brate\s+kia\b/.test(t) ||
    /\b(price|rate)\s+bata\b/.test(t) ||
    /\bbata\b.{0,40}\b(price|rate)\b/.test(t) ||
    /\bcharges\b/.test(t)
  ) {
    return true;
  }

  // Remaining commercial rate/rates after technical spans were removed.
  if (/\brates?\b/.test(t)) {
    return true;
  }

  return false;
}

/**
 * True when the customer text is asking for a price / cost / monetary quote.
 * Technical-rate spans are removed first; any independent price intent in the
 * remainder still returns true.
 */
export function queryRequestsPrice(queryText: string): boolean {
  const { normalizedRemainder, rawRemainder } =
    stripTechnicalRateSpans(queryText);

  if (hasUrduPriceIntent(rawRemainder)) return true;
  if (hasLatinPriceIntent(normalizedRemainder)) return true;
  return false;
}

/** Extract package-size tokens (e.g. 5kw, 10kw) to scope price ambiguity. */
export function extractPackageSizeTokens(queryText: string): string[] {
  const matches = String(queryText || "")
    .toLowerCase()
    .match(/\b\d+(?:\.\d+)?\s*kw\b/g);
  if (!matches) return [];
  return [
    ...new Set(matches.map((m) => m.replace(/\s+/g, ""))),
  ];
}

function blobMatchesSizeTokens(blob: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const normalized = blob.toLowerCase().replace(/\s+/g, "");
  return tokens.some((t) => normalized.includes(t));
}

function currentApprovedPricedFacts(
  draft: KnowledgeAnswerDraft
): KnowledgeAnswerFact[] {
  return draft.facts.filter(
    (f) =>
      f.containsPrice === true &&
      f.price != null &&
      f.freshness !== "stale" &&
      f.freshness !== "missing_timestamp" &&
      (f.price.freshness === "current" || f.freshness === "current")
  );
}

const PRICE_QUERY_STOPWORDS = new Set([
  "what",
  "is",
  "the",
  "a",
  "an",
  "of",
  "for",
  "current",
  "exact",
  "please",
  "quote",
  "me",
  "your",
  "price",
  "pricing",
  "cost",
  "costs",
  "pkr",
  "rs",
  "rupees",
  "how",
  "much",
  "now",
  "tell",
  "about",
]);

function extractRelevanceKeywords(queryText: string): string[] {
  const sizes = extractPackageSizeTokens(queryText);
  const words = String(queryText || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !PRICE_QUERY_STOPWORDS.has(w));
  return [...new Set([...sizes, ...words])];
}

/** Current approved priced facts relevant to the queried product. */
export function relevantCurrentPricedFacts(
  draft: KnowledgeAnswerDraft,
  queryText: string
): KnowledgeAnswerFact[] {
  const priced = currentApprovedPricedFacts(draft);
  const sizeTokens = extractPackageSizeTokens(queryText);
  if (sizeTokens.length > 0) {
    return priced.filter((f) =>
      blobMatchesSizeTokens(`${f.sourceId} ${f.sourceTitle} ${f.text}`, sizeTokens)
    );
  }
  const keywords = extractRelevanceKeywords(queryText);
  if (keywords.length === 0) return priced;
  return priced.filter((f) => {
    const blob = `${f.sourceId} ${f.sourceTitle} ${f.text}`.toLowerCase();
    return keywords.some((k) => blob.includes(k));
  });
}

function uniqueAmounts(facts: readonly KnowledgeAnswerFact[]): number[] {
  return [
    ...new Set(
      facts
        .filter((f) => f.price != null)
        .map((f) => f.price!.amountPkr)
    ),
  ];
}

/**
 * True when conflicting sources disagree on the queried product’s price.
 * Cross-package fixture noise (5kW vs 10kW) is ignored when the query names a size.
 */
export function priceConflictAffectsQuery(
  draft: KnowledgeAnswerDraft,
  queryText: string
): boolean {
  if (draft.conflicts.length === 0) return false;
  const tokens = extractPackageSizeTokens(queryText);

  for (const conflict of draft.conflicts) {
    if (conflict.resolution === "escalate_human") return true;

    const relevantIndexes: number[] = [];
    for (let i = 0; i < conflict.sourceIds.length; i += 1) {
      const blob = `${conflict.sourceIds[i]} ${conflict.sourceTitles[i] ?? ""}`;
      if (blobMatchesSizeTokens(blob, tokens)) {
        relevantIndexes.push(i);
      }
    }

    if (tokens.length === 0) {
      // No size disambiguation — any multi-source price conflict is uncertain.
      if (conflict.sourceIds.length >= 2) return true;
      continue;
    }

    // Two+ approved sources for the same requested size ⇒ conflicting price.
    if (relevantIndexes.length >= 2) return true;
  }

  // Also: multiple distinct current amounts among query-relevant facts.
  return uniqueAmounts(relevantCurrentPricedFacts(draft, queryText)).length > 1;
}

function hasStaleOrMissingPriceSignal(
  draft: KnowledgeAnswerDraft,
  queryText: string
): boolean {
  const tokens = extractPackageSizeTokens(queryText);
  const priceTopicMissing = draft.missingTopics.some((t) => /price/i.test(t));
  if (priceTopicMissing && relevantCurrentPricedFacts(draft, queryText).length === 0) {
    return true;
  }
  if (/stale|missing.*price|price.*stale|confirm price/i.test(draft.humanHandoverReason || "")) {
    return true;
  }
  for (const fact of draft.facts) {
    const relevant =
      tokens.length === 0 ||
      blobMatchesSizeTokens(`${fact.sourceId} ${fact.sourceTitle} ${fact.text}`, tokens);
    if (!relevant) continue;
    if (fact.freshness === "stale" || fact.freshness === "missing_timestamp") {
      return true;
    }
    if (/Price omitted|freshness=stale|approved current price unavailable/i.test(fact.text)) {
      return true;
    }
  }
  return false;
}

/** Categories that always require human handover (AI-05-R1). */
const HUMAN_HANDOVER_CATEGORIES: ReadonlySet<KnowledgeQueryCategory> = new Set([
  "unsafe_engineering",
  "human_handover",
  "complaints",
  "after_sales_support",
  "net_metering_general",
  "warranty",
  "installation_process",
]);

/** Off-grid is outside approved AI-05 launch scope (on-grid + hybrid only). */
export function queryRequestsUnsupportedOffGrid(queryText: string): boolean {
  const t = String(queryText || "")
    .normalize("NFKC")
    .toLowerCase();
  return (
    /\boff[\s-]?grid\b/.test(t) ||
    /\boffgrid\b/.test(t) ||
    /آف\s*گرڈ/.test(String(queryText || "").normalize("NFKC"))
  );
}

/** Site-specific net-metering eligibility always needs human engineering review. */
export function queryRequestsNetMeteringEligibility(queryText: string): boolean {
  const t = String(queryText || "")
    .normalize("NFKC")
    .toLowerCase();
  if (!/(net[\s-]?meter|netmeter|green\s*meter|export)/i.test(t)) {
    return false;
  }
  return (
    /\beligib/.test(t) ||
    /\bqualify\b/.test(t) ||
    /\bam i\b/.test(t) ||
    /\bcan i\b/.test(t) ||
    /\bdo i\b/.test(t) ||
    /\bmy (site|house|home|property)\b/.test(t) ||
    /اہل|eligible/i.test(String(queryText || ""))
  );
}

/** Unsupported warranty-duration or install-timeline questions. */
export function queryRequestsUnsupportedWarrantyOrTimeline(
  queryText: string
): boolean {
  const t = String(queryText || "")
    .normalize("NFKC")
    .toLowerCase();
  if (
    /\b(warranty|guarantee)\b/.test(t) &&
    /\b(year|years|month|months|how long|duration|period)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(install|installation|timeline|how long|delivery|complete)\b/.test(t) &&
    /\b(day|days|week|weeks|month|months|how long|timeline|when)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * True when knowledge requires a human-escalation draft (no provider phrasing
 * of uncertain facts). Price uncertainty escalates only when a price was
 * requested — non-price package questions are not broadly escalated merely
 * because a price was not asked.
 *
 * AI-05-R1: off-grid, net-metering eligibility, after-sales, complaints,
 * warranty/timeline, and other human-handover categories always escalate.
 */
export function knowledgeRequiresHumanEscalation(
  draft: KnowledgeAnswerDraft,
  options: { queryText?: string } = {}
): boolean {
  if (
    draft.disposition === "escalate_human" ||
    draft.disposition === "unavailable"
  ) {
    return true;
  }
  if (HUMAN_HANDOVER_CATEGORIES.has(draft.category)) return true;
  if (draft.conflicts.some((c) => c.resolution === "escalate_human")) {
    return true;
  }

  const queryText = options.queryText ?? "";
  if (queryRequestsUnsupportedOffGrid(queryText)) return true;
  if (queryRequestsNetMeteringEligibility(queryText)) return true;
  if (queryRequestsUnsupportedWarrantyOrTimeline(queryText)) return true;

  // Fact rows that explicitly require human handover / support team.
  if (
    draft.facts.some((f) =>
      /human review|support team|handed to the support|human specialist|human coordinator/i.test(
        f.text
      )
    )
  ) {
    return true;
  }

  const priceRequested = queryRequestsPrice(queryText);
  if (!priceRequested) {
    // Non-price path: still escalate stale priced facts that somehow remain
    // quotable (defense in depth). Do not escalate merely for missing price.
    if (
      draft.facts.some(
        (f) =>
          f.containsPrice &&
          (f.freshness === "stale" || f.freshness === "missing_timestamp")
      )
    ) {
      return true;
    }
    return false;
  }

  // Price was explicitly requested — require one unambiguous current approved price.
  if (priceConflictAffectsQuery(draft, queryText)) return true;
  if (hasStaleOrMissingPriceSignal(draft, queryText)) return true;

  const relevant = relevantCurrentPricedFacts(draft, queryText);
  if (uniqueAmounts(relevant).length !== 1) return true;

  return false;
}

/** Privacy-safe escalation warning — never embeds monetary amounts. */
export function safeKnowledgeEscalationWarning(
  draft: KnowledgeAnswerDraft
): string {
  const raw =
    draft.humanHandoverReason ||
    draft.unavailableMessage ||
    "Approved knowledge unavailable or requires human review.";
  const stripped = omitEmbeddedPriceAmounts(String(raw));
  // Extra belt: drop any remaining long digit runs that look like PKR amounts.
  return stripped
    .replace(/\b\d{4,}\b/g, "[amount-omitted]")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prepare knowledge for provider phrasing: only quote a price when the query
 * requested one and exactly one current approved amount is available for the
 * requested product with no product-level conflict. Otherwise strip monetary
 * copy so uncertain amounts never reach the provider.
 */
export function prepareKnowledgeDraftForPhrasing(
  draft: KnowledgeAnswerDraft,
  queryText: string
): KnowledgeAnswerDraft {
  const relevant = relevantCurrentPricedFacts(draft, queryText);
  const mayQuotePrice =
    queryRequestsPrice(queryText) &&
    !priceConflictAffectsQuery(draft, queryText) &&
    uniqueAmounts(relevant).length === 1;

  if (mayQuotePrice) {
    const allowedAmount = uniqueAmounts(relevant)[0];
    const allowedIds = new Set(
      relevant
        .filter((f) => f.price?.amountPkr === allowedAmount)
        .map((f) => f.id)
    );
    return {
      ...draft,
      facts: draft.facts.map((fact) => {
        if (allowedIds.has(fact.id)) return fact;
        if (!fact.containsPrice && !/\b(?:PKR|Rs\.?)\b|\d{5,}/i.test(fact.text)) {
          return fact;
        }
        return {
          ...fact,
          containsPrice: false,
          price: null,
          text: omitEmbeddedPriceAmounts(fact.text).replace(
            /Approved current price:[^.]*\.?/gi,
            "Price omitted pending human confirmation."
          ),
        };
      }),
    };
  }

  const stripAmounts = (text: string): string =>
    omitEmbeddedPriceAmounts(String(text || ""))
      .replace(/Approved current price:[^.]*\.?/gi, "Price omitted pending human confirmation.")
      .replace(/\b\d{4,}\b/g, "[amount-omitted]");

  const facts = draft.facts.map((fact) => {
    if (!fact.containsPrice && !/\b(?:PKR|Rs\.?|price)\b|\d{5,}/i.test(fact.text)) {
      return fact;
    }
    return {
      ...fact,
      containsPrice: false,
      price: null,
      text: stripAmounts(fact.text),
    };
  });

  return {
    ...draft,
    facts,
    conflicts: draft.conflicts.map((c) => ({
      ...c,
      detail: stripAmounts(c.detail),
      resolution:
        c.resolution === "prefer_higher_priority" ? "omit_price" : c.resolution,
    })),
    humanHandoverReason: draft.humanHandoverReason
      ? stripAmounts(draft.humanHandoverReason)
      : draft.humanHandoverReason,
    safeReplyHints: draft.safeReplyHints.map((h) => stripAmounts(h)),
  };
}

/**
 * AI-05-R1 production-safe conversational shell.
 * Contains no unsupported product claims (no off-grid availability, no
 * eligibility promises, no prices/warranties/timelines).
 */
export function productionSafePolicyOutline(intent: QueryIntent): string {
  switch (intent) {
    case "greeting":
      return (
        "Greet the customer politely as Sunchaser Energy Systems. " +
        "Invite them to share their city or system interest. " +
        "Use only approved knowledge facts below. Do not invent offerings."
      );
    case "sales":
    case "system_selection":
    case "product_question":
      return (
        "Acknowledge interest politely. State only approved knowledge facts below. " +
        "Approved launch scope is on-grid and hybrid enquiries only — never claim off-grid availability. " +
        "Do not invent prices, warranties, timelines, savings, or eligibility."
      );
    case "quotation_request":
    case "billing_payment":
      return (
        "Acknowledge the request. Ask only for quotation details listed in approved knowledge. " +
        "Do not invent prices, balances, or payment outcomes."
      );
    case "complaint":
    case "after_sales":
    case "human_request":
      return (
        "Hand the conversation to the human support team. Keep the draft short. " +
        "Do not invent repair timelines, warranty outcomes, or liability admissions."
      );
    case "net_metering":
    case "technical_question":
    case "unsupported_high_risk":
      return (
        "Do not answer the substance. State that a human specialist must review this request. " +
        "Do not invent eligibility, engineering limits, approvals, or DIY guidance."
      );
    default:
      return (
        "Respond briefly using only approved knowledge facts below. " +
        "Escalate anything unsupported. Do not invent facts."
      );
  }
}

/** Merge approved knowledge hints into the policy outline for phrasing. */
export function enrichOutlineWithKnowledge(
  policyOutline: string,
  draft: KnowledgeAnswerDraft,
  options: { productionSafe?: boolean; intent?: QueryIntent } = {}
): string {
  const baseOutline = options.productionSafe
    ? productionSafePolicyOutline(options.intent ?? "sales")
    : policyOutline.trim();

  const hints = draft.safeReplyHints.filter((h) => String(h || "").trim());
  const factLines = draft.facts
    .filter((f) => f.confidence === "approved")
    .slice(0, 5)
    .map((f) => `- [${f.sourceTitle}] ${f.text}`);

  const parts = [baseOutline.trim()];
  if (hints.length) {
    parts.push(
      `Approved knowledge hints:\n${hints.map((h) => `- ${h}`).join("\n")}`
    );
  }
  if (factLines.length) {
    parts.push(
      `Approved facts (do not invent beyond these):\n${factLines.join("\n")}`
    );
  }
  if (draft.missingTopics.length) {
    parts.push(
      `Missing topics (do not invent; escalate if asked):\n${draft.missingTopics
        .map((t) => `- ${t}`)
        .join("\n")}`
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

export function knowledgeFactsToSafeSources(
  draft: KnowledgeAnswerDraft
): Array<{ sourceId: string; title: string }> {
  const seen = new Set<string>();
  const out: Array<{ sourceId: string; title: string }> = [];
  for (const fact of draft.facts) {
    if (seen.has(fact.sourceId)) continue;
    seen.add(fact.sourceId);
    out.push({ sourceId: fact.sourceId, title: fact.sourceTitle });
  }
  return out;
}

/** Public production factory options — no engine/portId injection surface. */
export type CreateQueryKnowledgeAdapterOptions = {
  /**
   * Optional env for WHATSAPP_AI_KNOWLEDGE_SOURCE in non-production runtimes.
   * Ignored for production trust decisions: actual process.env.NODE_ENV wins.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Explicit source mode. In actual production runtime, only "production"
   * is accepted; fixtures/unavailable fail closed.
   */
  knowledgeSource?: KnowledgeSourceMode;
};

/** Test-only DI options — never trusted in actual production runtime. */
export type CreateTestQueryKnowledgeAdapterOptions = {
  engine?: KnowledgeAnswerEngine;
  asOfIso?: string;
  env?: NodeJS.ProcessEnv;
  knowledgeSource?: KnowledgeSourceMode;
  /** Decorative only in tests — cannot mint production provenance. */
  portId?: string;
};

function portIdForSource(mode: KnowledgeSourceMode): string {
  switch (mode) {
    case "production":
      return "knowledge-production";
    case "fixtures":
      return "knowledge-fixtures";
    default:
      return "knowledge-unavailable";
  }
}

function provenanceForMode(mode: KnowledgeSourceMode): KnowledgePortProvenance {
  switch (mode) {
    case "production":
      return "production";
    case "fixtures":
      return "fixtures";
    default:
      return "unavailable";
  }
}

function engineForSource(mode: KnowledgeSourceMode): KnowledgeAnswerEngine | null {
  if (mode === "production") return createProductionKnowledgeEngine();
  if (mode === "fixtures") return createFixtureKnowledgeEngine();
  return null;
}

function defaultAsOfForSource(mode: KnowledgeSourceMode): string {
  if (mode === "production") return productionAsOfIso();
  if (mode === "fixtures") return fixtureAsOfIso();
  return new Date().toISOString();
}

/**
 * @deprecated Trust boundary no longer inspects engines. Kept for test diagnostics.
 * Prefer createTestQueryKnowledgeAdapter for fixture DI.
 */
export function isFixtureBackedEngine(engine: KnowledgeAnswerEngine): boolean {
  try {
    return engine.storeSnapshot(FIXTURE_TENANT_A).recordCount > 0;
  } catch {
    return false;
  }
}

function buildEnginePort(input: {
  engine: KnowledgeAnswerEngine;
  mode: KnowledgeSourceMode;
  provenance: KnowledgePortProvenance;
  portId: string;
  asOfIso?: string;
}): QueryKnowledgePort {
  const { engine, mode, provenance, portId, asOfIso: fixedAsOf } = input;
  return {
    portId,
    provenance,
    retrieve(request) {
      const tenantId = resolveKnowledgeTenantId(request.companyId, mode);
      return engine.retrieveAnswerDraft({
        tenantId,
        queryText: request.queryText,
        categoryHint: mapIntentToKnowledgeCategory(request.intent),
        asOfIso:
          request.asOfIso ||
          fixedAsOf ||
          (mode === "production"
            ? new Date().toISOString()
            : defaultAsOfForSource(mode)),
      });
    },
  };
}

const PRODUCTION_OVERRIDE_BLOCK_REASON =
  "Production knowledge trust boundary rejected caller override — human review required.";

/**
 * Locked production path: ignore caller env/engine/portId, construct the
 * approved production engine internally, seal provenance=production.
 */
function createLockedProductionKnowledgePort(
  knowledgeSource?: KnowledgeSourceMode
): QueryKnowledgePort {
  if (knowledgeSource === "fixtures" || knowledgeSource === "unavailable") {
    return createUnavailableKnowledgePort(PRODUCTION_OVERRIDE_BLOCK_REASON);
  }
  // Source must come from the real process env — caller env cannot downgrade.
  const mode = knowledgeSource ?? readKnowledgeSource(process.env);
  if (mode !== "production") {
    return createUnavailableKnowledgePort(
      mode === "fixtures"
        ? PRODUCTION_OVERRIDE_BLOCK_REASON
        : "WHATSAPP_AI_KNOWLEDGE_SOURCE missing, invalid, or blocked for this runtime — human review required."
    );
  }
  const engine = createProductionKnowledgeEngine();
  return buildEnginePort({
    engine,
    mode: "production",
    provenance: "production",
    portId: "knowledge-production",
  });
}

/**
 * Public AI-01←AI-02 knowledge port factory.
 *
 * AI-05-R2 trust rules:
 * - Actual process.env.NODE_ENV=production cannot be downgraded by options.env
 * - Production rejects every caller-injected engine
 * - Production ignores portId overrides
 * - Production constructs the approved engine internally and seals provenance
 * - Engine/portId DI lives only on createTestQueryKnowledgeAdapter
 */
export function createQueryKnowledgeAdapter(
  options: CreateQueryKnowledgeAdapterOptions = {}
): QueryKnowledgePort {
  // Strip any illicit DI fields if a JS caller smuggles them in.
  const smuggled = options as CreateTestQueryKnowledgeAdapterOptions;

  // Immutable trust boundary: real process runtime, not caller-supplied env.
  if (isActualProductionRuntime()) {
    // Reject every caller-injected engine. Ignore decorative portId/asOfIso.
    if (smuggled.engine) {
      return createUnavailableKnowledgePort(PRODUCTION_OVERRIDE_BLOCK_REASON);
    }
    return createLockedProductionKnowledgePort(options.knowledgeSource);
  }

  // Public factory never accepts engine/portId/asOfIso — construct internally.
  const env = options.env ?? process.env;
  const mode = options.knowledgeSource ?? readKnowledgeSource(env);
  if (mode === "unavailable") {
    return createUnavailableKnowledgePort(
      "WHATSAPP_AI_KNOWLEDGE_SOURCE missing, invalid, or blocked for this runtime — human review required."
    );
  }

  const engine = engineForSource(mode);
  if (!engine) {
    return createUnavailableKnowledgePort(
      "Knowledge engine unavailable — human review required."
    );
  }

  return buildEnginePort({
    engine,
    mode,
    provenance: provenanceForMode(mode),
    portId: portIdForSource(mode),
  });
}

/**
 * Test-only knowledge port factory with engine/asOf/portId DI.
 *
 * - Fail-closed when the actual process runtime is production.
 * - Injected engines never receive provenance "production".
 * - Only an internally constructed production engine can seal production provenance.
 */
export function createTestQueryKnowledgeAdapter(
  options: CreateTestQueryKnowledgeAdapterOptions = {}
): QueryKnowledgePort {
  if (isActualProductionRuntime()) {
    // No test DI downgrade path in a real production process.
    if (options.engine || options.knowledgeSource === "fixtures") {
      return createUnavailableKnowledgePort(PRODUCTION_OVERRIDE_BLOCK_REASON);
    }
    return createLockedProductionKnowledgePort(options.knowledgeSource);
  }

  // Injected engines: never mint production provenance (portId cannot impersonate).
  if (options.engine) {
    const requested = options.knowledgeSource ?? "fixtures";
    if (requested === "unavailable") {
      return createUnavailableKnowledgePort(
        "WHATSAPP_AI_KNOWLEDGE_SOURCE missing, invalid, or blocked for this runtime — human review required."
      );
    }
    const claimingProduction = requested === "production";
    const mode: KnowledgeSourceMode = claimingProduction
      ? "production"
      : "fixtures";
    const provenance: KnowledgePortProvenance = claimingProduction
      ? "test"
      : "fixtures";
    const portId =
      options.portId && options.portId !== "knowledge-production"
        ? options.portId
        : provenance === "fixtures"
          ? "knowledge-fixtures"
          : "knowledge-test";
    return buildEnginePort({
      engine: options.engine,
      mode,
      provenance,
      portId,
      asOfIso: options.asOfIso,
    });
  }

  const env = options.env ?? process.env;
  const mode = options.knowledgeSource ?? readKnowledgeSource(env);
  if (mode === "unavailable") {
    return createUnavailableKnowledgePort(
      "WHATSAPP_AI_KNOWLEDGE_SOURCE missing, invalid, or blocked for this runtime — human review required."
    );
  }

  // Internal construction only — production provenance when mode is production.
  const engine = engineForSource(mode);
  if (!engine) {
    return createUnavailableKnowledgePort(
      "Knowledge engine unavailable — human review required."
    );
  }

  return buildEnginePort({
    engine,
    mode,
    provenance: provenanceForMode(mode),
    // Ignore caller portId when sealing production provenance.
    portId:
      mode === "production"
        ? "knowledge-production"
        : options.portId && options.portId !== "knowledge-production"
          ? options.portId
          : portIdForSource(mode),
    asOfIso: options.asOfIso,
  });
}
