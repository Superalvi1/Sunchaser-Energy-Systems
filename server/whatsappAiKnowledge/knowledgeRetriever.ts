/**
 * Deterministic knowledge retrieval + ranking (no AI generation, no web).
 *
 * Ranking:
 *  1. Tenant match (hard filter)
 *  2. Category overlap
 *  3. Keyword overlap with query tokens
 *  4. Source priority
 *  5. Fresher publishedAt as tie-breaker
 *
 * Prices are ranked only when freshness is current and source is price-eligible.
 */

import {
  fingerprintQuery,
  omitEmbeddedPriceAmounts,
  redactPii,
} from "./knowledgePrivacy.ts";
import {
  classifyQueryCategory,
  detectUnsafeEngineering,
  evaluateFreshness,
  evaluatePriceFreshness,
  isPriceAllowed,
} from "./knowledgeSourcePolicy.ts";
import type { InMemoryKnowledgeStore } from "./knowledgeStore.ts";
import type {
  KnowledgeAnswerFact,
  KnowledgeFreshnessStatus,
  KnowledgeQueryCategory,
  KnowledgeRecord,
  KnowledgeRetrievalRequest,
  KnowledgeSourceConflict,
} from "./knowledgeTypes.ts";

export type RankedKnowledgeHit = {
  record: KnowledgeRecord;
  rankScore: number;
  /** Record-level freshness (from record.publishedAt). */
  freshness: KnowledgeFreshnessStatus;
  /** Authoritative price freshness (from price.publishedAt when priced). */
  priceFreshness: KnowledgeFreshnessStatus;
  priceAllowed: boolean;
};

function tokenize(text: string): string[] {
  return redactPii(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function scoreRecord(
  record: KnowledgeRecord,
  queryTokens: Set<string>,
  category: KnowledgeQueryCategory,
): number {
  let score = 0;
  if (record.categories.includes(category)) score += 50;
  for (const kw of record.keywords) {
    const parts = kw.split(/\s+/);
    if (parts.every((p) => queryTokens.has(p)) || queryTokens.has(kw)) {
      score += 12;
    } else if (parts.some((p) => queryTokens.has(p))) {
      score += 4;
    }
  }
  for (const token of queryTokens) {
    if (record.title.toLowerCase().includes(token)) score += 3;
    if (record.body.toLowerCase().includes(token)) score += 1;
  }
  score += Math.min(record.priority, 100) / 10;
  return score;
}

export function rankRecordsForQuery(
  records: readonly KnowledgeRecord[],
  queryText: string,
  category: KnowledgeQueryCategory,
  asOfIso: string,
): RankedKnowledgeHit[] {
  const queryTokens = new Set(tokenize(queryText));
  const hits: RankedKnowledgeHit[] = [];

  for (const record of records) {
    const freshness = evaluateFreshness(
      record.publishedAt,
      record.maxAgeHours,
      asOfIso,
    );
    const priceFreshness = evaluatePriceFreshness(record, asOfIso);
    const priceAllowed = isPriceAllowed(record, priceFreshness);
    const categoryMatch = record.categories.includes(category);
    let keywordHits = 0;
    for (const kw of record.keywords) {
      const parts = kw.split(/\s+/);
      if (parts.every((p) => queryTokens.has(p)) || queryTokens.has(kw)) {
        keywordHits += 1;
      } else if (parts.some((p) => queryTokens.has(p))) {
        keywordHits += 0.25;
      }
    }

    // Require category or keyword relevance — never return the whole corpus.
    if (!categoryMatch && keywordHits < 1) {
      continue;
    }

    let rankScore = scoreRecord(record, queryTokens, category);

    if (record.containsPrice && !priceAllowed) {
      // Keep the non-price body potentially useful, but demote heavily.
      rankScore -= 25;
    }

    // Freshness tie-breaker: prefer current prices / records.
    const rankingFreshness = record.containsPrice ? priceFreshness : freshness;
    if (rankingFreshness === "current") rankScore += 5;
    if (rankingFreshness === "stale") rankScore -= 5;

    if (rankScore <= 0) continue;

    hits.push({ record, rankScore, freshness, priceFreshness, priceAllowed });
  }

  hits.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    if (b.record.priority !== a.record.priority) {
      return b.record.priority - a.record.priority;
    }
    const aPub = a.record.publishedAt ?? "";
    const bPub = b.record.publishedAt ?? "";
    return bPub.localeCompare(aPub);
  });

  return hits;
}

export function toAnswerFact(hit: RankedKnowledgeHit): KnowledgeAnswerFact {
  const { record, rankScore, freshness, priceFreshness, priceAllowed } = hit;
  const includePrice = Boolean(record.containsPrice && priceAllowed && record.price);
  const price = includePrice
    ? {
        ...record.price!,
        freshness: priceFreshness,
      }
    : null;

  let text = record.body;
  if (includePrice && price) {
    text = `${record.body} Approved current price: PKR ${price.amountPkr.toLocaleString("en-PK")} (${price.unitLabel}).`;
  } else if (record.containsPrice && !priceAllowed) {
    // Strip any embedded numeric price copy so stale amounts cannot leak via body.
    const safeBody = omitEmbeddedPriceAmounts(record.body);
    text = `${safeBody} Price omitted: approved current price unavailable (freshness=${priceFreshness}).`;
  }

  return {
    id: `fact_${record.id}`,
    text,
    confidence: "approved",
    sourceId: record.id,
    sourceTitle: record.title,
    sourceType: record.sourceType,
    freshness: record.containsPrice ? priceFreshness : freshness,
    publishedAt: record.containsPrice
      ? (record.price?.publishedAt ?? record.publishedAt)
      : record.publishedAt,
    category: record.categories[0] ?? "unknown",
    containsPrice: includePrice,
    price,
    rankScore,
  };
}

export function detectPriceConflicts(
  facts: readonly KnowledgeAnswerFact[],
): KnowledgeSourceConflict[] {
  const byTopic = new Map<string, KnowledgeAnswerFact[]>();
  for (const fact of facts) {
    if (!fact.containsPrice || !fact.price) continue;
    const topic = fact.category;
    const list = byTopic.get(topic) ?? [];
    list.push(fact);
    byTopic.set(topic, list);
  }

  const conflicts: KnowledgeSourceConflict[] = [];
  for (const [topic, priced] of byTopic) {
    if (priced.length < 2) continue;
    const amounts = new Set(priced.map((f) => f.price!.amountPkr));
    if (amounts.size < 2) continue;
    const sorted = [...priced].sort((a, b) => b.rankScore - a.rankScore);
    conflicts.push({
      topic,
      sourceIds: priced.map((f) => f.sourceId),
      sourceTitles: priced.map((f) => f.sourceTitle),
      resolution: "prefer_higher_priority",
      detail: `Conflicting current prices for ${topic}; preferring ${sorted[0].sourceTitle} (PKR ${sorted[0].price!.amountPkr}).`,
    });
  }
  return conflicts;
}

export class KnowledgeRetriever {
  constructor(private readonly store: InMemoryKnowledgeStore) {}

  retrieve(request: KnowledgeRetrievalRequest): {
    category: KnowledgeQueryCategory;
    hits: RankedKnowledgeHit[];
    facts: KnowledgeAnswerFact[];
    conflicts: KnowledgeSourceConflict[];
    stalePriceRejected: boolean;
    queryFingerprint: string;
    consideredRecordCount: number;
  } {
    const tenantId = String(request.tenantId || "").trim();
    if (!tenantId) {
      throw new Error("tenantId is required for knowledge retrieval");
    }

    const unsafe = detectUnsafeEngineering(request.queryText);
    const category = unsafe
      ? "unsafe_engineering"
      : classifyQueryCategory(request.queryText, request.categoryHint);

    const records = this.store.listActiveForTenant(tenantId);
    const hits = rankRecordsForQuery(
      records,
      request.queryText,
      category,
      request.asOfIso,
    );

    const limit = Math.max(1, Math.min(request.limit ?? 5, 20));
    const top = hits.slice(0, limit);
    const facts = top.map(toAnswerFact);

    // If conflicting prices, keep only the top-ranked priced fact.
    const conflicts = detectPriceConflicts(facts);
    let resolvedFacts = facts;
    if (conflicts.length > 0) {
      const drop = new Set<string>();
      for (const conflict of conflicts) {
        const priced = facts
          .filter((f) => conflict.sourceIds.includes(f.sourceId))
          .sort((a, b) => b.rankScore - a.rankScore);
        for (const extra of priced.slice(1)) {
          drop.add(extra.id);
        }
      }
      resolvedFacts = facts.filter((f) => !drop.has(f.id));
    }

    const stalePriceRejected = top.some(
      (h) =>
        h.record.containsPrice &&
        !h.priceAllowed &&
        h.priceFreshness === "stale",
    );

    return {
      category,
      hits: top,
      facts: resolvedFacts,
      conflicts,
      stalePriceRejected,
      queryFingerprint: fingerprintQuery(request.queryText),
      consideredRecordCount: records.length,
    };
  }
}
