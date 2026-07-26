/**
 * WS2 admin product DTOs — never include price, cost, stock, or supplier fields.
 */

export type AdminBrandRef = {
  id: string;
  slug: string;
  name: string;
};

export type AdminCategoryRef = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
};

export type AdminVariantDto = {
  id: string;
  productId: string;
  sku: string;
  title: string;
  isDefault: boolean;
  isPriceable: boolean;
  active: boolean;
};

export type AdminProductSummaryDto = {
  id: string;
  brandId: string;
  categoryId: string;
  title: string;
  slug: string;
  description: string;
  tags: string[];
  active: boolean;
  featured: boolean;
  brand: AdminBrandRef;
  category: AdminCategoryRef;
};

export type AdminProductDetailDto = AdminProductSummaryDto & {
  variants: AdminVariantDto[];
};

export type AdminProductListFilters = {
  search?: string;
  brandId?: string;
  categoryId?: string;
  active?: boolean;
  limit: number;
  offset: number;
};

export type AdminProductListResult = {
  items: AdminProductSummaryDto[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

export type AdminCreateProductInput = {
  brandId: string;
  categoryId: string;
  title: string;
  slug: string;
  description: string;
  tags: string[];
  active: boolean;
  featured: boolean;
  defaultVariant: {
    sku: string;
    title: string;
    isDefault: true;
    isPriceable: boolean;
    active: boolean;
  };
};

export type AdminPatchProductInput = {
  brandId?: string;
  categoryId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  active?: boolean;
  featured?: boolean;
};

export type AdminCreateVariantInput = {
  sku: string;
  title: string;
  isDefault: boolean;
  isPriceable: boolean;
  active: boolean;
};

export type AdminPatchVariantInput = {
  sku?: string;
  title?: string;
  isDefault?: boolean;
  isPriceable?: boolean;
  active?: boolean;
};

export type AdminActorRef = {
  id: string;
  username: string;
  role: string;
};

export class AdminProductError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
