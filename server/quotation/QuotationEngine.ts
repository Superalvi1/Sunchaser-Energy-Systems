/**
 * Solar Quotation Engine — orchestrator.
 *
 * Ties together: product catalog → BOQ generation (price/margin/cable/
 * structure rules + optional site-complexity multiplier) → discount approval
 * → margin-safe view → proposal outline. Pure composition; no persistence,
 * no HTTP routes, no rendering.
 */

import { QuotationEngineError } from "./QuotationModels.ts";
import type { ProductCatalog } from "./ProductCatalog.ts";
import { generateBoq, applyDiscountToBoq, type BoqResult, type SystemDesignInput } from "./BoqGenerator.ts";
import {
  computeSiteComplexity,
  type SiteComplexityInput,
  type SiteComplexityResult,
} from "./SiteComplexityScore.ts";
import { evaluateDiscountApproval, type DiscountApprovalDecision } from "./DiscountApprovalRules.ts";
import {
  defaultCanViewMargin,
  toMarginSafeView,
  type MarginSafeView,
  type MarginVisibilityPredicate,
} from "./MarginRules.ts";
import { buildProposalOutline, type ProposalOutline } from "./ProposalTemplate.ts";

export interface QuotationRequest {
  customerName: string;
  role: string;
  username: string;
  design: SystemDesignInput;
  siteComplexity?: SiteComplexityInput;
  requestedDiscountPercent?: number;
  includedProposalSectionIds?: string[];
}

export interface QuotationResult {
  boq: BoqResult;
  siteComplexity: SiteComplexityResult | null;
  discount: DiscountApprovalDecision;
  marginView: MarginSafeView;
  proposal: ProposalOutline;
}

export interface QuotationEngineOptions {
  canViewMargin?: MarginVisibilityPredicate;
}

export class QuotationEngine {
  private readonly canViewMargin: MarginVisibilityPredicate;

  constructor(
    private readonly catalog: ProductCatalog,
    options: QuotationEngineOptions = {}
  ) {
    this.canViewMargin = options.canViewMargin ?? defaultCanViewMargin;
  }

  generate(request: QuotationRequest): QuotationResult {
    if (!request.customerName || !request.customerName.trim()) {
      throw new QuotationEngineError("boq_generation", "customerName is required.");
    }

    const siteComplexity = request.siteComplexity ? computeSiteComplexity(request.siteComplexity) : null;

    const design: SystemDesignInput = siteComplexity
      ? { ...request.design, installCostMultiplier: siteComplexity.installCostMultiplier }
      : request.design;

    let boq = generateBoq(this.catalog, design);

    const requestedDiscountPercent = request.requestedDiscountPercent ?? 0;
    const discount = evaluateDiscountApproval(requestedDiscountPercent, request.role);

    if (discount.autoApproved && requestedDiscountPercent > 0) {
      boq = applyDiscountToBoq(boq, requestedDiscountPercent);
    }

    const marginView = toMarginSafeView(boq.margin, request.role, request.username, this.canViewMargin);

    const proposal = buildProposalOutline({
      customerName: request.customerName,
      includedSectionIds: request.includedProposalSectionIds,
      boq,
    });

    return { boq, siteComplexity, discount, marginView, proposal };
  }
}

export function createQuotationEngine(catalog: ProductCatalog, options?: QuotationEngineOptions): QuotationEngine {
  return new QuotationEngine(catalog, options);
}
