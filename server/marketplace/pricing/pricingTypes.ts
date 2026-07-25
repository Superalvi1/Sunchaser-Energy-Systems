export type PricingActorRef = {
  id: string;
  username: string;
  role: string;
};

export type CostDto = {
  id: string;
  productId: string;
  variantId: string;
  actualPurchaseCost: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  setBy: string;
  reason: string | null;
};

export type MarginDto = {
  variantId: string;
  productId: string;
  websitePrice: number | null;
  websitePriceState: string;
  actualPurchaseCost: number | null;
  profit: number | null;
  marginPct: number | null;
  purchasable: boolean;
};

export type PricingConfigDto = {
  companyId: string;
  maxIncreasePct: number;
  maxDecreasePct: number;
  stalenessHours: number;
  allowSoldoutReference: boolean;
  safetyAbsoluteFloor: number | null;
  safetyAbsoluteCeiling: number | null;
  minTokenPct: number;
  maxTokenPct: number;
  minAdvancePct: number;
  maxAdvancePct: number;
  codMaxOrderValue: number;
  updatedBy: string | null;
  updatedAt: string;
};

export type PublishResultDto = {
  variantId: string;
  productId: string;
  websitePrice: number | null;
  websitePriceState: string;
  websitePriceSource: string | null;
};

export type OverrideResultDto = {
  overrideId: string;
  supersededOverrideId: string | null;
};

export type MappingResultDto = {
  mappingId: string;
  action: string;
};

export class PricingError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
