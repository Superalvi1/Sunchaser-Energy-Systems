/**
 * Catalogue Manager DTO / repository contracts (Super Admin surface).
 */
import type { EffectiveSource, FieldOverrideRecord } from "./fieldOverrides.ts";

export type CatalogueManagerActorRef = {
  id: string;
  username: string;
  role: string;
};

export type LayeredField<T> = {
  supplier: T;
  manual: T | null;
  effective: T;
  source: EffectiveSource;
};

export type CatalogueManagerMediaRow = {
  id: string;
  productId: string;
  sourceUrl: string;
  sortOrder: number;
  role: "thumbnail" | "gallery" | "og";
  published: boolean;
  sourceType: string;
  rightsStatus: string;
  manualControl: boolean;
  sourceKey: string | null;
  supplierCode: string | null;
};

export type CatalogueManagerProductSummary = {
  id: string;
  title: string;
  slug: string;
  brandId: string;
  brandName: string;
  categoryId: string;
  categoryName: string;
  active: boolean;
  publicVisible: boolean;
  featured: boolean;
  stockStatus: string;
  websitePrice: number | null;
  compareAtPrice: number | null;
  selectedSupplier: string | null;
  primaryImage: string | null;
  lastSupplierSyncAt: string | null;
  lastManualEditAt: string | null;
  overrideFields: string[];
};

export type CatalogueManagerProductDetail = CatalogueManagerProductSummary & {
  description: string;
  shortDescription: string | null;
  model: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  datasheetUrl: string | null;
  warranty: string | null;
  specifications: Record<string, unknown>;
  tags: string[];
  sourceUrls: string[];
  identityKey: string | null;
  titleLayered: LayeredField<string>;
  descriptionLayered: LayeredField<string>;
  overrides: FieldOverrideRecord[];
  media: CatalogueManagerMediaRow[];
};

export type CatalogueManagerListFilters = {
  limit: number;
  offset: number;
  q?: string;
  brandId?: string;
  categoryId?: string;
  supplier?: string;
  stockStatus?: string;
  active?: boolean;
  publicVisible?: boolean;
  featured?: boolean;
};

export type CatalogueManagerListResult = {
  items: CatalogueManagerProductSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type CatalogueManagerPatchInput = {
  title?: string;
  description?: string;
  shortDescription?: string | null;
  model?: string | null;
  brandId?: string;
  categoryId?: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  datasheetUrl?: string | null;
  warranty?: string | null;
  specifications?: Record<string, unknown>;
  tags?: string[];
  active?: boolean;
  publicVisible?: boolean;
  featured?: boolean;
  compareAtPrice?: number | null;
};

export type SetOverrideInput = {
  fieldName: string;
  value: unknown;
};

export type BulkPublishInput = {
  productIds: string[];
  publicVisible: boolean;
};

export type BulkCategoryInput = {
  productIds: string[];
  categoryId: string;
};

export type SupplierMediaInput = {
  url: string;
  sortOrder: number;
  sourceKey?: string;
};

export type RejectLedgerEntry = {
  runId: string;
  supplier: string;
  sourceKey: string | null;
  supplierProductId: string | null;
  canonicalUrl: string | null;
  title: string | null;
  identityKey: string | null;
  reason: string;
  stage: "normalize" | "import" | "commit";
  detail?: Record<string, unknown>;
};

export type ReconciliationInput = {
  discoveredProducts?: number;
  normalizedAcceptedObservations?: number;
  excludedByReason?: Record<string, number>;
  acceptedListings?: number;
};

export type ReconciliationCounts = {
  discoveredProducts: number | null;
  normalizedAcceptedObservations: number | null;
  excludedByReason: Record<string, number>;
  acceptedListings: number | null;
  rejectLedgerRows: number;
  crmProducts: number;
  productsWithMedia: number;
  productsWithoutMedia: number;
  legacyUnreconciledProducts: number;
  metricNotes: Record<string, string>;
};

export type CatalogueManagerAuditEvent = {
  id: string;
  actorScope: string;
  action: string;
  entityType: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export class CatalogueManagerError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
