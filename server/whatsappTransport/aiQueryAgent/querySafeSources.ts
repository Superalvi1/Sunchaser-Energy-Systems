/**
 * Safe, non-PII source references for draft answers.
 * Only public/marketing catalogue entries — never CRM rows or message bodies.
 */

import type { QueryIntent, SafeSourceReference } from "./queryAgentTypes.ts";

const CATALOGUE: Record<string, SafeSourceReference> = {
  "faq-solar-basics": {
    sourceId: "faq-solar-basics",
    title: "Solar basics FAQ (public)",
    publicUrl: "https://sunchaserenergy.co/faq/solar-basics",
  },
  "faq-system-types": {
    sourceId: "faq-system-types",
    title: "On-grid vs hybrid overview (public)",
    publicUrl: "https://sunchaserenergy.co/faq/system-types",
  },
  "faq-products": {
    sourceId: "faq-products",
    title: "Product overview (public)",
    publicUrl: "https://sunchaserenergy.co/products",
  },
  "faq-net-metering": {
    sourceId: "faq-net-metering",
    title: "Net metering process overview (public)",
    publicUrl: "https://sunchaserenergy.co/faq/net-metering",
  },
  "faq-after-sales": {
    sourceId: "faq-after-sales",
    title: "After-sales support overview (public)",
    publicUrl: "https://sunchaserenergy.co/support",
  },
  "faq-billing": {
    sourceId: "faq-billing",
    title: "Billing & payment overview (public)",
    publicUrl: "https://sunchaserenergy.co/faq/billing",
  },
};

export function safeSourcesForIntent(intent: QueryIntent): SafeSourceReference[] {
  switch (intent) {
    case "greeting":
    case "sales":
      return [CATALOGUE["faq-solar-basics"]];
    case "system_selection":
      return [CATALOGUE["faq-system-types"], CATALOGUE["faq-solar-basics"]];
    case "product_question":
      return [CATALOGUE["faq-products"]];
    case "technical_question":
      return [CATALOGUE["faq-solar-basics"], CATALOGUE["faq-products"]];
    case "quotation_request":
      return [CATALOGUE["faq-system-types"]];
    case "net_metering":
      return [CATALOGUE["faq-net-metering"]];
    case "after_sales":
    case "complaint":
      return [CATALOGUE["faq-after-sales"]];
    case "billing_payment":
      return [CATALOGUE["faq-billing"]];
    case "human_request":
    case "unsupported_high_risk":
    default:
      return [];
  }
}
