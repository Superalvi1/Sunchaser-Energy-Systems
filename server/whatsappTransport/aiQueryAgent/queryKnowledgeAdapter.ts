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
  type KnowledgeAnswerDraft,
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

export function knowledgeRequiresHumanEscalation(
  draft: KnowledgeAnswerDraft
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
