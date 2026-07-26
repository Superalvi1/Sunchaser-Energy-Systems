/**
 * AI-04 — single clean adapter from AI-01 query agent → AI-02 knowledge engine.
 *
 * Tenant isolation: companyId maps to knowledge tenantId; retrieval is always
 * scoped by tenant. No WhatsApp send, no CRM writes, no live provider calls.
 */

import {
  FIXTURE_TENANT_A,
  KnowledgeAnswerEngine,
  createFixtureKnowledgeEngine,
  fixtureAsOfIso,
  omitEmbeddedPriceAmounts,
  type KnowledgeAnswerDraft,
  type KnowledgeAnswerFact,
  type KnowledgeQueryCategory,
} from "../../whatsappAiKnowledge/index.ts";
import type { QueryIntent } from "./queryAgentTypes.ts";

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
 */
export type QueryKnowledgePort = {
  readonly portId: string;
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
 * Fixture aliases keep demo packs isolated; unknown companies keep their id
 * (empty bucket → unavailable → human escalation).
 */
export function resolveKnowledgeTenantId(companyId: string): string {
  const id = String(companyId || "").trim();
  if (!id) return "";
  if (id === "sunchaser" || id === FIXTURE_TENANT_A) return FIXTURE_TENANT_A;
  return id;
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

/** Technical “rate” phrases that must not be treated as price requests. */
const TECHNICAL_RATE_PATTERNS: RegExp[] = [
  /\bbattery\s+charge\s+rate\b/,
  /\bcharging\s+rate\b/,
  /\bdischarge\s+rate\b/,
  /\bdata\s+rate\b/,
  /\brefresh\s+rate\b/,
  /\bfailure\s+rate\b/,
  /\bgeneration\s+rate\b/,
  /\bdegradation\s+rate\b/,
];

export function isTechnicalRateContext(queryText: string): boolean {
  const t = normalizePriceIntentText(queryText);
  return TECHNICAL_RATE_PATTERNS.some((re) => re.test(t));
}

function hasUrduPriceIntent(queryText: string): boolean {
  const raw = String(queryText || "").normalize("NFKC");
  // Urdu-script price / rate / “how much” equivalents.
  return (
    /قیمت/.test(raw) ||
    /ریٹ/.test(raw) ||
    /کتنے\s*کا/.test(raw) ||
    /کتنی\s*کی/.test(raw)
  );
}

/**
 * True when the customer text is asking for a price / cost / monetary quote.
 * Includes common Pakistani WhatsApp Roman-Urdu / Urdu phrasing, while
 * excluding technical “rate” uses (charge rate, data rate, etc.).
 */
export function queryRequestsPrice(queryText: string): boolean {
  if (hasUrduPriceIntent(queryText)) return true;

  const t = normalizePriceIntentText(queryText);
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

  // Bare rate/rates — only when not a known technical-rate phrase.
  if (/\brates?\b/.test(t) && !isTechnicalRateContext(t)) {
    return true;
  }

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

/**
 * True when knowledge requires a human-escalation draft (no provider phrasing
 * of uncertain facts). Price uncertainty escalates only when a price was
 * requested — non-price package questions are not broadly escalated merely
 * because a price was not asked.
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
  if (draft.category === "unsafe_engineering") return true;
  if (draft.conflicts.some((c) => c.resolution === "escalate_human")) {
    return true;
  }

  const queryText = options.queryText ?? "";
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

/** Merge approved knowledge hints into the policy outline for phrasing. */
export function enrichOutlineWithKnowledge(
  policyOutline: string,
  draft: KnowledgeAnswerDraft
): string {
  const hints = draft.safeReplyHints.filter((h) => String(h || "").trim());
  const factLines = draft.facts
    .filter((f) => f.confidence === "approved")
    .slice(0, 5)
    .map((f) => `- [${f.sourceTitle}] ${f.text}`);

  const parts = [policyOutline.trim()];
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

export type CreateQueryKnowledgeAdapterOptions = {
  engine?: KnowledgeAnswerEngine;
  /** Override as-of clock (tests). */
  asOfIso?: string;
};

/**
 * Build the AI-01←AI-02 knowledge port.
 * Uses fixture knowledge packs only in this phase (no Supabase / live AI).
 */
export function createQueryKnowledgeAdapter(
  options: CreateQueryKnowledgeAdapterOptions = {}
): QueryKnowledgePort {
  const engine = options.engine ?? createFixtureKnowledgeEngine();
  const fixedAsOf = options.asOfIso;

  return {
    portId: "knowledge-fixtures",
    retrieve(request) {
      const tenantId = resolveKnowledgeTenantId(request.companyId);
      return engine.retrieveAnswerDraft({
        tenantId,
        queryText: request.queryText,
        categoryHint: mapIntentToKnowledgeCategory(request.intent),
        asOfIso: request.asOfIso || fixedAsOf || fixtureAsOfIso(),
      });
    },
  };
}
