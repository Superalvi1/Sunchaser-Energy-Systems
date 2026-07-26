/**
 * AI-05 — fail-closed Sunchaser launch knowledge pack (production).
 *
 * Contains ONLY currently approved launch facts. Explicitly excludes:
 * package/equipment prices, warranty durations, installation timelines,
 * savings promises, generation estimates, subsidy/policy claims, and
 * unverified technical limits.
 *
 * Never reuse fixture source IDs or fixture demo tenants.
 */

import { containsLikelyPii } from "./knowledgePrivacy.ts";
import type { KnowledgeRecord } from "./knowledgeTypes.ts";

/** Production knowledge tenant for companyId "sunchaser". */
export const PRODUCTION_TENANT_SUNCHASER = "tenant_sunchaser";

/** Stable publish stamp for launch facts (non-price; long max-age). */
export const KNOWLEDGE_PRODUCTION_AS_OF_ISO = "2026-07-26T00:00:00.000Z";

const LAUNCH_PUBLISHED_AT = "2026-07-01T00:00:00.000Z";
/** Non-price launch facts stay current for a year from publish. */
const LAUNCH_MAX_AGE_HOURS = 24 * 365;

function buildProductionRecords(): KnowledgeRecord[] {
  const tenantId = PRODUCTION_TENANT_SUNCHASER;
  const records: KnowledgeRecord[] = [
    {
      id: "sc-launch-company",
      tenantId,
      sourceType: "faq_cms",
      title: "Sunchaser Energy Systems",
      body: "Sunchaser Energy Systems provides residential and commercial solar solutions. We support on-grid and hybrid solar system enquiries. Primary service location: Lahore, Pakistan.",
      categories: ["solar_packages", "on_grid_hybrid", "unknown"],
      keywords: [
        "sunchaser",
        "company",
        "solar",
        "residential",
        "commercial",
        "on-grid",
        "ongrid",
        "hybrid",
        "lahore",
        "pakistan",
        "solutions",
        "about",
        "who",
        "offer",
        "services",
      ],
      publishedAt: LAUNCH_PUBLISHED_AT,
      maxAgeHours: LAUNCH_MAX_AGE_HOURS,
      containsPrice: false,
      price: null,
      priority: 95,
      active: true,
    },
    {
      id: "sc-launch-systems",
      tenantId,
      sourceType: "faq_cms",
      title: "On-Grid and Hybrid Enquiries",
      body: "Sunchaser Energy Systems supports on-grid and hybrid solar system enquiries for residential and commercial customers in Lahore, Pakistan. A human consultant confirms the right system type after reviewing your details.",
      categories: ["on_grid_hybrid", "solar_packages"],
      keywords: [
        "on-grid",
        "ongrid",
        "hybrid",
        "system",
        "systems",
        "grid",
        "battery backup",
        "package",
      ],
      publishedAt: LAUNCH_PUBLISHED_AT,
      maxAgeHours: LAUNCH_MAX_AGE_HOURS,
      containsPrice: false,
      price: null,
      priority: 90,
      active: true,
    },
    {
      id: "sc-launch-quote-reqs",
      tenantId,
      sourceType: "quotation_requirements",
      title: "Quotation Requirements",
      body: "For a quotation, please share: customer name; city/area; residential or commercial property; latest electricity bill; whether you need on-grid, hybrid, or are not sure; required battery backup; and phone number. A human consultant prepares a reviewed quotation from these details.",
      categories: ["quotation_requirements"],
      keywords: [
        "quotation",
        "quote",
        "requirements",
        "bill",
        "electricity bill",
        "need a quote",
        "quote requirements",
        "monthly bill",
        "how to quote",
        "get a quote",
      ],
      publishedAt: LAUNCH_PUBLISHED_AT,
      maxAgeHours: LAUNCH_MAX_AGE_HOURS,
      containsPrice: false,
      price: null,
      priority: 92,
      active: true,
    },
    {
      id: "sc-launch-engineering-handover",
      tenantId,
      sourceType: "human_handover",
      title: "Engineering and Site-Specific Review",
      body: "Complex electrical design, earthing, protection, string sizing, net-metering eligibility, and site-specific engineering require human review. Do not invent technical limits or DIY guidance.",
      categories: ["unsafe_engineering", "net_metering_general", "human_handover"],
      keywords: [
        "earthing",
        "protection",
        "string sizing",
        "electrical design",
        "net-metering",
        "net metering",
        "eligibility",
        "site-specific",
        "engineering",
        "cable size",
        "voltage drop",
      ],
      publishedAt: LAUNCH_PUBLISHED_AT,
      maxAgeHours: LAUNCH_MAX_AGE_HOURS,
      containsPrice: false,
      price: null,
      priority: 98,
      active: true,
    },
    {
      id: "sc-launch-complaints",
      tenantId,
      sourceType: "complaint_process",
      title: "Complaints Handover",
      body: "Complaints must be handed to the support team. A human coordinator will follow up — please share a general issue type and city if known.",
      categories: ["complaints", "human_handover"],
      keywords: ["complaint", "complain", "unhappy", "escalate complaint"],
      publishedAt: LAUNCH_PUBLISHED_AT,
      maxAgeHours: LAUNCH_MAX_AGE_HOURS,
      containsPrice: false,
      price: null,
      priority: 96,
      active: true,
    },
    {
      id: "sc-launch-aftersales",
      tenantId,
      sourceType: "after_sales_support",
      title: "After-Sales Handover",
      body: "After-sales enquiries must be handed to the support team. A human agent will continue from here.",
      categories: ["after_sales_support", "human_handover"],
      keywords: [
        "after sales",
        "after-sales",
        "service visit",
        "maintenance",
        "support ticket",
        "support",
      ],
      publishedAt: LAUNCH_PUBLISHED_AT,
      maxAgeHours: LAUNCH_MAX_AGE_HOURS,
      containsPrice: false,
      price: null,
      priority: 94,
      active: true,
    },
    {
      id: "sc-launch-human-handover",
      tenantId,
      sourceType: "human_handover",
      title: "Human Team Handover",
      body: "A human team member will continue this conversation for pricing, warranties, timelines, engineering decisions, complaints, after-sales, or anything not covered by approved launch knowledge.",
      categories: ["human_handover"],
      keywords: ["human", "agent", "handover", "talk to human", "real person"],
      publishedAt: LAUNCH_PUBLISHED_AT,
      maxAgeHours: LAUNCH_MAX_AGE_HOURS,
      containsPrice: false,
      price: null,
      priority: 99,
      active: true,
    },
  ];

  for (const record of records) {
    if (record.containsPrice || record.price != null) {
      throw new Error(`Production record ${record.id} must not contain prices`);
    }
    if (containsLikelyPii(record.body) || containsLikelyPii(record.title)) {
      throw new Error(`Production record ${record.id} must not contain PII`);
    }
  }

  return records;
}

/** Immutable production launch pack — no fixture prices or demo source IDs. */
export const KNOWLEDGE_PRODUCTION_RECORDS: readonly KnowledgeRecord[] =
  Object.freeze(buildProductionRecords());

/** Fixture source IDs that must never appear in production packs. */
export const FORBIDDEN_FIXTURE_SOURCE_IDS: readonly string[] = Object.freeze([
  "pkg-5kw-hybrid-a",
  "pkg-10kw-ongrid-a",
  "price-5kw-stale-a",
  "price-5kw-conflict-a",
  "pkg-5kw-hybrid-b",
  "cat-panel-mono-a",
  "cat-inverter-hybrid-a",
  "cat-battery-lithium-a",
  "faq-warranty-a",
  "faq-install-a",
  "faq-aftersales-a",
  "faq-complaint-a",
  "faq-quote-reqs-a",
  "faq-netmeter-a",
  "faq-handover-a",
  "terms-validity-a",
  "cms-injection-a",
]);

/** Fixture demo amounts that must never appear in production output. */
export const FORBIDDEN_FIXTURE_PRICE_AMOUNTS: readonly number[] = Object.freeze([
  875000, 1450000, 650000, 899000, 999999,
]);
