/**
 * Solar Quotation Engine — public surface.
 *
 * Pure architecture: product catalog, price rules, margin rules, cable
 * pricing rules, structure pricing rules, site complexity score, BOQ
 * generator, discount approval rules, and proposal template sections.
 *
 * No UI, no HTTP routes. Every dependency is injectable; the in-memory
 * product catalog is the only stateful default, and it is a real, working
 * implementation (not a stub) — swap it for a real inventory-backed catalog
 * via dependency injection when one exists.
 */

export * from "./QuotationModels.ts";
export * from "./ProductCatalog.ts";
export * from "./PriceRules.ts";
export * from "./MarginRules.ts";
export * from "./CablePricingRules.ts";
export * from "./StructurePricingRules.ts";
export * from "./SiteComplexityScore.ts";
export * from "./BoqGenerator.ts";
export * from "./DiscountApprovalRules.ts";
export * from "./ProposalTemplate.ts";
export * from "./QuotationEngine.ts";
