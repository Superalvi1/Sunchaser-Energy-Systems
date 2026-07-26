/**
 * WhatsApp AI Knowledge & Answer Engine (AI-02).
 *
 * Isolated, read-only retrieval layer that returns answer drafts with
 * approved facts, freshness, conflicts, and human-handover signals.
 *
 * Explicitly does NOT:
 * - send WhatsApp messages
 * - write CRM
 * - browse the web
 * - invent prices, warranties, savings, technical limits, or government rules
 */

import { KnowledgeRetriever } from "./knowledgeRetriever.ts";
import {
  KNOWLEDGE_FIXTURE_AS_OF_ISO,
  KNOWLEDGE_FIXTURE_RECORDS,
} from "./knowledgeFixtures.ts";
import { InMemoryKnowledgeStore } from "./knowledgeStore.ts";
import {
  KNOWLEDGE_UNAVAILABLE_MESSAGE,
  type KnowledgeAnswerDisposition,
  type KnowledgeAnswerDraft,
  type KnowledgeAnswerFact,
  type KnowledgeQueryCategory,
  type KnowledgeRetrievalRequest,
} from "./knowledgeTypes.ts";

const CATEGORY_EXPECTED_TOPICS: Partial<
  Record<KnowledgeQueryCategory, string[]>
> = {
  solar_packages: ["approved package overview", "current package price"],
  on_grid_hybrid: ["on-grid vs hybrid guidance"],
  batteries: ["battery backup guidance"],
  panels: ["panel catalogue guidance"],
  inverters: ["inverter catalogue guidance"],
  warranty: ["warranty policy"],
  installation_process: ["installation steps"],
  after_sales_support: ["after-sales process"],
  complaints: ["complaint handling"],
  quotation_requirements: ["quotation requirements"],
  net_metering_general: ["net-metering general information"],
  human_handover: ["human handover"],
  unsafe_engineering: ["human engineering review"],
  unknown: ["approved answer"],
};

function buildMissingTopics(
  category: KnowledgeQueryCategory,
  facts: readonly KnowledgeAnswerFact[],
): string[] {
  const expected = CATEGORY_EXPECTED_TOPICS[category] ?? ["approved answer"];
  if (facts.length === 0) return [...expected];

  const missing: string[] = [];
  if (
    (category === "solar_packages" || category === "on_grid_hybrid") &&
    !facts.some((f) => f.containsPrice)
  ) {
    missing.push("current package price");
  }
  return missing;
}

function chooseDisposition(input: {
  category: KnowledgeQueryCategory;
  facts: readonly KnowledgeAnswerFact[];
  missingTopics: string[];
  conflicts: { resolution: string }[];
  stalePriceRejected: boolean;
}): {
  disposition: KnowledgeAnswerDisposition;
  humanHandoverReason: string | null;
  unavailableMessage: string | null;
  safeReplyHints: string[];
} {
  if (input.category === "unsafe_engineering") {
    return {
      disposition: "escalate_human",
      humanHandoverReason:
        "Unsafe or engineering-specific question requires a qualified human — do not invent technical limits or DIY guidance.",
      unavailableMessage: null,
      safeReplyHints: [
        "I am connecting you with a human specialist for this technical request.",
      ],
    };
  }

  if (input.category === "human_handover") {
    return {
      disposition: "escalate_human",
      humanHandoverReason: "Customer requested a human team member.",
      unavailableMessage: null,
      safeReplyHints: [
        "A human team member will continue from here.",
      ],
    };
  }

  if (input.category === "complaints") {
    return {
      disposition: "escalate_human",
      humanHandoverReason: "Complaints require human coordination.",
      unavailableMessage: null,
      safeReplyHints: input.facts.slice(0, 1).map((f) => f.text),
    };
  }

  if (input.facts.length === 0) {
    return {
      disposition: "unavailable",
      humanHandoverReason:
        "No approved knowledge matched this query — ask a human.",
      unavailableMessage: KNOWLEDGE_UNAVAILABLE_MESSAGE,
      safeReplyHints: [KNOWLEDGE_UNAVAILABLE_MESSAGE],
    };
  }

  if (input.conflicts.some((c) => c.resolution === "escalate_human")) {
    return {
      disposition: "escalate_human",
      humanHandoverReason: "Conflicting approved sources need human resolution.",
      unavailableMessage: null,
      safeReplyHints: [
        "I found conflicting approved information and will involve a human teammate.",
      ],
    };
  }

  if (input.stalePriceRejected && input.missingTopics.includes("current package price")) {
    return {
      disposition: "partial",
      humanHandoverReason:
        "Price is stale or missing from approved current sources — human must confirm price.",
      unavailableMessage: null,
      safeReplyHints: [
        ...input.facts.slice(0, 2).map((f) => f.text),
        "I cannot quote a price until an approved current price is confirmed by a human.",
      ],
    };
  }

  if (input.missingTopics.length > 0) {
    return {
      disposition: "partial",
      humanHandoverReason:
        input.missingTopics.length > 0
          ? `Missing approved topics: ${input.missingTopics.join(", ")}`
          : null,
      unavailableMessage: null,
      safeReplyHints: [
        ...input.facts.slice(0, 3).map((f) => f.text),
        "Some details are not available in approved sources — a human can confirm.",
      ],
    };
  }

  return {
    disposition: "answer",
    humanHandoverReason: null,
    unavailableMessage: null,
    safeReplyHints: input.facts.slice(0, 3).map((f) => f.text),
  };
}

export class KnowledgeAnswerEngine {
  private readonly retriever: KnowledgeRetriever;

  constructor(private readonly store: InMemoryKnowledgeStore) {
    this.retriever = new KnowledgeRetriever(store);
  }

  /** Primary AI-02 entry point for later AI-01 plug-in. */
  retrieveAnswerDraft(
    request: KnowledgeRetrievalRequest,
  ): KnowledgeAnswerDraft {
    const result = this.retriever.retrieve(request);
    const missingTopics = buildMissingTopics(result.category, result.facts);
    const chosen = chooseDisposition({
      category: result.category,
      facts: result.facts,
      missingTopics,
      conflicts: result.conflicts,
      stalePriceRejected: result.stalePriceRejected,
    });

    // Mark uncertain/missing explicitly when disposition is not a full answer.
    const facts: KnowledgeAnswerFact[] = result.facts.map((fact) => {
      if (
        fact.containsPrice === false &&
        fact.text.includes("Price omitted")
      ) {
        return { ...fact, confidence: "uncertain" };
      }
      return fact;
    });

    if (chosen.disposition === "unavailable") {
      facts.push({
        id: "fact_missing",
        text: KNOWLEDGE_UNAVAILABLE_MESSAGE,
        confidence: "missing",
        sourceId: "none",
        sourceTitle: "No approved source",
        sourceType: "human_handover",
        freshness: "missing_timestamp",
        publishedAt: null,
        category: result.category,
        containsPrice: false,
        price: null,
        rankScore: 0,
      });
    }

    return {
      tenantId: request.tenantId,
      category: result.category,
      disposition: chosen.disposition,
      facts,
      missingTopics,
      conflicts: result.conflicts,
      humanHandoverReason: chosen.humanHandoverReason,
      safeReplyHints: chosen.safeReplyHints,
      unavailableMessage: chosen.unavailableMessage,
      retrieval: {
        tenantId: request.tenantId,
        category: result.category,
        matchedRecordCount: result.facts.length,
        consideredRecordCount: result.consideredRecordCount,
        usedDeterministicRetrieval: true,
        usedAiGeneration: false,
        usedExternalWeb: false,
        crmWrites: false,
        queryFingerprint: result.queryFingerprint,
      },
    };
  }

  /** Expose store snapshot for tests / health checks. */
  storeSnapshot(tenantId: string) {
    return this.store.snapshot(tenantId);
  }
}

/** Factory wired to mock fixtures — never production Supabase. */
export function createFixtureKnowledgeEngine(): KnowledgeAnswerEngine {
  const store = new InMemoryKnowledgeStore(KNOWLEDGE_FIXTURE_RECORDS);
  return new KnowledgeAnswerEngine(store);
}

export function fixtureAsOfIso(): string {
  return KNOWLEDGE_FIXTURE_AS_OF_ISO;
}
