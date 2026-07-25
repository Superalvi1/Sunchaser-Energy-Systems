/**
 * Approved-source policy and freshness rules for AI-02.
 *
 * Prices may only come from pricing_approved / solar_package sources that are
 * still within their max-age window at the as-of clock.
 */

import {
  DEFAULT_PRICE_MAX_AGE_HOURS,
  type ApprovedKnowledgeSourceType,
  type KnowledgeFreshnessStatus,
  type KnowledgeQueryCategory,
  type KnowledgeRecord,
} from "./knowledgeTypes.ts";

/** Source types allowed to contribute numeric prices. */
export const PRICE_ELIGIBLE_SOURCE_TYPES: ReadonlySet<ApprovedKnowledgeSourceType> =
  new Set(["pricing_approved", "solar_package"]);

/** Categories that must escalate to a human (never invent engineering advice). */
export const UNSAFE_ENGINEERING_SIGNALS: readonly string[] = [
  "rewire",
  "rewiring",
  "bypass breaker",
  "bypass the breaker",
  "diy wiring",
  "wire it myself",
  "change inverter settings myself",
  "open the inverter",
  "earth fault fix myself",
  "short circuit",
  "live wire",
  "modify electrical panel",
  "technical limit calculation",
  "calculate cable size",
  "voltage drop formula",
  "government subsidy amount",
  "nedo tariff exact",
  "pepco tariff exact",
];

/** Deterministic keyword → category map (prefer deterministic before AI). */
export const CATEGORY_KEYWORD_MAP: ReadonlyArray<{
  category: KnowledgeQueryCategory;
  keywords: readonly string[];
}> = [
  {
    category: "unsafe_engineering",
    keywords: UNSAFE_ENGINEERING_SIGNALS,
  },
  {
    category: "human_handover",
    keywords: [
      "talk to human",
      "speak to agent",
      "real person",
      "customer care call",
      "transfer me",
      "human please",
    ],
  },
  {
    category: "complaints",
    keywords: [
      "complaint",
      "complain",
      "not working",
      "issue with install",
      "unhappy",
      "escalate complaint",
    ],
  },
  {
    category: "after_sales_support",
    keywords: [
      "after sales",
      "after-sales",
      "service visit",
      "maintenance",
      "support ticket",
      "free service",
    ],
  },
  {
    category: "warranty",
    keywords: ["warranty", "guarantee", "warrenty"],
  },
  {
    category: "installation_process",
    keywords: [
      "installation process",
      "install process",
      "how long to install",
      "survey",
      "site survey",
      "installation steps",
    ],
  },
  {
    category: "quotation_requirements",
    keywords: [
      "quotation",
      "quote requirements",
      "need a quote",
      "what do you need for quote",
      "bill photo",
      "monthly bill",
    ],
  },
  {
    category: "net_metering_general",
    keywords: [
      "net metering",
      "net-metering",
      "netmetering",
      "export units",
      "bi-directional",
      "bidirectional meter",
    ],
  },
  {
    category: "batteries",
    keywords: ["battery", "batteries", "lithium", "tubular", "backup"],
  },
  {
    category: "panels",
    keywords: ["panel", "panels", "solar panel", "pv module", "mono"],
  },
  {
    category: "inverters",
    keywords: ["inverter", "inverters", "hybrid inverter", "ongrid inverter"],
  },
  {
    category: "on_grid_hybrid",
    keywords: [
      "on-grid",
      "ongrid",
      "on grid",
      "hybrid system",
      "hybrid package",
      "grid tied",
      "grid-tied",
    ],
  },
  {
    category: "solar_packages",
    keywords: [
      "solar package",
      "package price",
      "system package",
      "5kw",
      "10kw",
      "solar system price",
      "package",
    ],
  },
];

export function evaluateFreshness(
  publishedAt: string | null,
  maxAgeHours: number | null,
  asOfIso: string,
): KnowledgeFreshnessStatus {
  if (!publishedAt) return "missing_timestamp";
  const publishedMs = Date.parse(publishedAt);
  const asOfMs = Date.parse(asOfIso);
  if (!Number.isFinite(publishedMs) || !Number.isFinite(asOfMs)) {
    return "unknown";
  }
  const maxHours =
    typeof maxAgeHours === "number" && Number.isFinite(maxAgeHours)
      ? maxAgeHours
      : DEFAULT_PRICE_MAX_AGE_HOURS;
  const ageHours = (asOfMs - publishedMs) / (1000 * 60 * 60);
  if (ageHours < 0) return "unknown";
  return ageHours <= maxHours ? "current" : "stale";
}

export function isPriceAllowed(
  record: KnowledgeRecord,
  freshness: KnowledgeFreshnessStatus,
): boolean {
  if (!record.containsPrice || !record.price) return false;
  if (!PRICE_ELIGIBLE_SOURCE_TYPES.has(record.sourceType)) return false;
  return freshness === "current";
}

export function classifyQueryCategory(
  queryText: string,
  categoryHint?: KnowledgeQueryCategory | null,
): KnowledgeQueryCategory {
  const normalized = String(queryText || "").toLowerCase();
  for (const entry of CATEGORY_KEYWORD_MAP) {
    if (entry.keywords.some((kw) => normalized.includes(kw))) {
      return entry.category;
    }
  }
  if (categoryHint && categoryHint !== "unknown") return categoryHint;
  return "unknown";
}

export function detectUnsafeEngineering(queryText: string): boolean {
  const normalized = String(queryText || "").toLowerCase();
  return UNSAFE_ENGINEERING_SIGNALS.some((signal) =>
    normalized.includes(signal),
  );
}
