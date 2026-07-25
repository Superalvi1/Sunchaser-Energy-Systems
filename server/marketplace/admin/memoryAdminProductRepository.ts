/**
 * In-memory admin product repository for WS2C tests.
 * Tracks write payloads so tests can assert no forbidden columns were written.
 */
import type { AdminProductRepository } from "./adminProductRepository.ts";
import {
  AdminProductError,
  type AdminActorRef,
  type AdminBrandRef,
  type AdminCategoryRef,
  type AdminCreateProductInput,
  type AdminCreateVariantInput,
  type AdminPatchProductInput,
  type AdminPatchVariantInput,
  type AdminProductDetailDto,
  type AdminProductListFilters,
  type AdminProductListResult,
  type AdminProductSummaryDto,
} from "./adminTypes.ts";

const FORBIDDEN_WRITE_COLUMNS = [
  "display_from_price",
  "display_price_state",
  "website_price",
  "website_price_state",
  "website_price_source",
  "price_published_at",
  "stock_status",
  "supplier_public_price",
  "actual_purchase_cost",
  "margin",
  "delivery_charge",
];

type MemProduct = {
  id: string;
  brandId: string;
  categoryId: string;
  title: string;
  slug: string;
  description: string;
  tags: string[];
  active: boolean;
  featured: boolean;
};

type MemVariant = {
  id: string;
  productId: string;
  sku: string;
  title: string;
  isDefault: boolean;
  isPriceable: boolean;
  active: boolean;
};

type MemAudit = {
  actorScope: string;
  action: string;
  entityType: string;
  entityId: string;
  isFinancial: boolean;
  payload: Record<string, unknown>;
};

export type MemoryAdminStore = {
  brands: AdminBrandRef[];
  categories: (AdminCategoryRef & { active: boolean })[];
  products: MemProduct[];
  variants: MemVariant[];
  audits: MemAudit[];
  writePayloads: Record<string, unknown>[];
};

export function createMemoryAdminStore(): MemoryAdminStore {
  return {
    brands: [
      { id: "mpbrand_knox", slug: "knox", name: "Knox" },
      { id: "mpbrand_growatt", slug: "growatt", name: "Growatt" },
    ],
    categories: [
      {
        id: "mpcat_inverters",
        slug: "solar-inverters",
        name: "Solar Inverters",
        description: "Inverters",
        sortOrder: 1,
        active: true,
      },
      {
        id: "mpcat_panels",
        slug: "solar-panels",
        name: "Solar Panels",
        description: "Panels",
        sortOrder: 2,
        active: true,
      },
    ],
    products: [],
    variants: [],
    audits: [],
    writePayloads: [],
  };
}

function trackWrite(store: MemoryAdminStore, payload: Record<string, unknown>) {
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_WRITE_COLUMNS.includes(key)) {
      throw new AdminProductError(
        "FORBIDDEN_FIELD",
        `Internal write blocked forbidden column: ${key}`,
        500,
      );
    }
  }
  store.writePayloads.push({ ...payload });
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function toSummary(
  store: MemoryAdminStore,
  p: MemProduct,
): AdminProductSummaryDto {
  const brand = store.brands.find((b) => b.id === p.brandId)!;
  const category = store.categories.find((c) => c.id === p.categoryId)!;
  return {
    id: p.id,
    brandId: p.brandId,
    categoryId: p.categoryId,
    title: p.title,
    slug: p.slug,
    description: p.description,
    tags: [...p.tags],
    active: p.active,
    featured: p.featured,
    brand,
    category: {
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
    },
  };
}

function toDetail(
  store: MemoryAdminStore,
  p: MemProduct,
): AdminProductDetailDto {
  return {
    ...toSummary(store, p),
    variants: store.variants
      .filter((v) => v.productId === p.id)
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((v) => ({
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        title: v.title,
        isDefault: v.isDefault,
        isPriceable: v.isPriceable,
        active: v.active,
      })),
  };
}

function activeDefaultCount(store: MemoryAdminStore, productId: string): number {
  return store.variants.filter(
    (v) => v.productId === productId && v.isDefault && v.active,
  ).length;
}

export function createMemoryAdminProductRepository(
  store: MemoryAdminStore,
): AdminProductRepository {
  return {
    async listProducts(
      filters: AdminProductListFilters,
    ): Promise<AdminProductListResult> {
      let items = store.products.map((p) => toSummary(store, p));
      if (filters.brandId) {
        items = items.filter((p) => p.brandId === filters.brandId);
      }
      if (filters.categoryId) {
        items = items.filter((p) => p.categoryId === filters.categoryId);
      }
      if (filters.active !== undefined) {
        items = items.filter((p) => p.active === filters.active);
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        items = items.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.slug.toLowerCase().includes(q),
        );
      }
      items.sort((a, b) => a.title.localeCompare(b.title));
      const total = items.length;
      const page = items.slice(filters.offset, filters.offset + filters.limit);
      return {
        items: page,
        pagination: { limit: filters.limit, offset: filters.offset, total },
      };
    },

    async getProductById(id) {
      const p = store.products.find((x) => x.id === id);
      return p ? toDetail(store, p) : null;
    },

    async createProduct(input: AdminCreateProductInput, actor: AdminActorRef) {
      if (!store.brands.some((b) => b.id === input.brandId)) {
        throw new AdminProductError(
          "INVALID_RELATIONSHIP",
          "Brand not found or inactive.",
        );
      }
      if (!store.categories.some((c) => c.id === input.categoryId && c.active)) {
        throw new AdminProductError(
          "INVALID_RELATIONSHIP",
          "Category not found or inactive.",
        );
      }
      if (store.products.some((p) => p.slug === input.slug)) {
        throw new AdminProductError(
          "DUPLICATE_SLUG",
          "Product slug already exists.",
        );
      }
      if (store.variants.some((v) => v.sku === input.defaultVariant.sku)) {
        throw new AdminProductError(
          "DUPLICATE_SKU",
          "Variant SKU already exists.",
        );
      }

      const productId = newId("mpprod");
      const variantId = newId("mpvar");
      const productRow = {
        id: productId,
        brand_id: input.brandId,
        category_id: input.categoryId,
        title: input.title,
        slug: input.slug,
        description: input.description,
        tags: input.tags,
        active: input.active,
        featured: input.featured,
      };
      trackWrite(store, productRow);

      store.products.push({
        id: productId,
        brandId: input.brandId,
        categoryId: input.categoryId,
        title: input.title,
        slug: input.slug,
        description: input.description,
        tags: [...input.tags],
        active: input.active,
        featured: input.featured,
      });

      const variantRow = {
        id: variantId,
        product_id: productId,
        sku: input.defaultVariant.sku,
        title: input.defaultVariant.title,
        is_default: true,
        is_priceable: input.defaultVariant.isPriceable,
        active: true,
      };
      trackWrite(store, variantRow);

      if ((input as { __failVariant?: boolean }).__failVariant) {
        store.products = store.products.filter((p) => p.id !== productId);
        throw new AdminProductError(
          "ADMIN_QUERY_FAILED",
          "Unable to create default variant.",
          500,
        );
      }

      store.variants.push({
        id: variantId,
        productId,
        sku: input.defaultVariant.sku,
        title: input.defaultVariant.title,
        isDefault: true,
        isPriceable: input.defaultVariant.isPriceable,
        active: true,
      });

      if ((input as { __failAudit?: boolean }).__failAudit) {
        store.variants = store.variants.filter((v) => v.id !== variantId);
        store.products = store.products.filter((p) => p.id !== productId);
        throw new AdminProductError(
          "AUDIT_FAILED",
          "Unable to record marketplace audit event.",
          500,
        );
      }

      store.audits.push({
        actorScope: `staff:${actor.id}`,
        action: "product.created",
        entityType: "mp_products",
        entityId: productId,
        isFinancial: false,
        payload: {
          actorId: actor.id,
          actorUsername: actor.username,
          actorRole: actor.role,
          changedFields: [
            "brand_id",
            "category_id",
            "title",
            "slug",
            "description",
            "tags",
            "active",
            "featured",
          ],
          slug: input.slug,
        },
      });
      store.audits.push({
        actorScope: `staff:${actor.id}`,
        action: "variant.created",
        entityType: "mp_product_variants",
        entityId: variantId,
        isFinancial: false,
        payload: {
          actorId: actor.id,
          actorUsername: actor.username,
          actorRole: actor.role,
          productId,
          sku: input.defaultVariant.sku,
          changedFields: [
            "sku",
            "title",
            "is_default",
            "is_priceable",
            "active",
          ],
        },
      });

      return toDetail(store, store.products.find((p) => p.id === productId)!);
    },

    async updateProduct(
      id: string,
      patch: AdminPatchProductInput,
      actor: AdminActorRef,
    ) {
      const p = store.products.find((x) => x.id === id);
      if (!p) {
        throw new AdminProductError(
          "PRODUCT_NOT_FOUND",
          "Product not found.",
          404,
        );
      }
      if (patch.brandId && !store.brands.some((b) => b.id === patch.brandId)) {
        throw new AdminProductError(
          "INVALID_RELATIONSHIP",
          "Brand not found or inactive.",
        );
      }
      if (
        patch.categoryId &&
        !store.categories.some((c) => c.id === patch.categoryId && c.active)
      ) {
        throw new AdminProductError(
          "INVALID_RELATIONSHIP",
          "Category not found or inactive.",
        );
      }
      const update: Record<string, unknown> = {};
      if (patch.brandId !== undefined) {
        update.brand_id = patch.brandId;
        p.brandId = patch.brandId;
      }
      if (patch.categoryId !== undefined) {
        update.category_id = patch.categoryId;
        p.categoryId = patch.categoryId;
      }
      if (patch.title !== undefined) {
        update.title = patch.title;
        p.title = patch.title;
      }
      if (patch.description !== undefined) {
        update.description = patch.description;
        p.description = patch.description;
      }
      if (patch.tags !== undefined) {
        update.tags = patch.tags;
        p.tags = [...patch.tags];
      }
      if (patch.active !== undefined) {
        update.active = patch.active;
        p.active = patch.active;
      }
      if (patch.featured !== undefined) {
        update.featured = patch.featured;
        p.featured = patch.featured;
      }
      trackWrite(store, update);
      store.audits.push({
        actorScope: `staff:${actor.id}`,
        action: "product.updated",
        entityType: "mp_products",
        entityId: id,
        isFinancial: false,
        payload: {
          actorId: actor.id,
          actorUsername: actor.username,
          actorRole: actor.role,
          changedFields: Object.keys(update),
        },
      });
      return toDetail(store, p);
    },

    async createVariant(
      productId: string,
      input: AdminCreateVariantInput,
      actor: AdminActorRef,
    ) {
      const p = store.products.find((x) => x.id === productId);
      if (!p) {
        throw new AdminProductError(
          "PRODUCT_NOT_FOUND",
          "Product not found.",
          404,
        );
      }
      if (input.isDefault && !input.active) {
        throw new AdminProductError(
          "DEFAULT_VARIANT_REQUIRED",
          "A default variant must be active.",
        );
      }
      if (store.variants.some((v) => v.sku === input.sku)) {
        throw new AdminProductError(
          "DUPLICATE_SKU",
          "Variant SKU already exists.",
        );
      }
      const previousDefaultIds: string[] = [];
      if (input.isDefault) {
        for (const v of store.variants) {
          if (v.productId === productId && v.isDefault && v.active) {
            previousDefaultIds.push(v.id);
            v.isDefault = false;
            trackWrite(store, { id: v.id, is_default: false });
          }
        }
      }
      const id = newId("mpvar");
      const row = {
        id,
        product_id: productId,
        sku: input.sku,
        title: input.title,
        is_default: input.isDefault,
        is_priceable: input.isPriceable,
        active: input.active,
      };
      trackWrite(store, row);
      store.variants.push({
        id,
        productId,
        sku: input.sku,
        title: input.title,
        isDefault: input.isDefault,
        isPriceable: input.isPriceable,
        active: input.active,
      });
      if (activeDefaultCount(store, productId) !== 1) {
        throw new AdminProductError(
          "DEFAULT_VARIANT_REQUIRED",
          "Product must have exactly one active default variant.",
          409,
        );
      }
      if (input.isDefault) {
        store.audits.push({
          actorScope: `staff:${actor.id}`,
          action: "variant.default_changed",
          entityType: "mp_product_variants",
          entityId: id,
          isFinancial: false,
          payload: {
            actorId: actor.id,
            actorUsername: actor.username,
            actorRole: actor.role,
            productId,
            previousDefaultIds,
          },
        });
      }
      store.audits.push({
        actorScope: `staff:${actor.id}`,
        action: "variant.created",
        entityType: "mp_product_variants",
        entityId: id,
        isFinancial: false,
        payload: {
          actorId: actor.id,
          actorUsername: actor.username,
          actorRole: actor.role,
          productId,
          sku: input.sku,
          changedFields: [
            "sku",
            "title",
            "is_default",
            "is_priceable",
            "active",
          ],
        },
      });
      return {
        id,
        productId,
        sku: input.sku,
        title: input.title,
        isDefault: input.isDefault,
        isPriceable: input.isPriceable,
        active: input.active,
      };
    },

    async updateVariant(
      productId: string,
      variantId: string,
      patch: AdminPatchVariantInput,
      actor: AdminActorRef,
    ) {
      const p = store.products.find((x) => x.id === productId);
      if (!p) {
        throw new AdminProductError(
          "PRODUCT_NOT_FOUND",
          "Product not found.",
          404,
        );
      }
      const v = store.variants.find(
        (x) => x.id === variantId && x.productId === productId,
      );
      if (!v) {
        throw new AdminProductError(
          "VARIANT_NOT_FOUND",
          "Variant not found for this product.",
          404,
        );
      }
      const next = {
        sku: patch.sku ?? v.sku,
        title: patch.title ?? v.title,
        isDefault: patch.isDefault ?? v.isDefault,
        isPriceable: patch.isPriceable ?? v.isPriceable,
        active: patch.active ?? v.active,
      };
      if (next.isDefault && !next.active) {
        throw new AdminProductError(
          "DEFAULT_VARIANT_REQUIRED",
          "A default variant must be active.",
        );
      }
      const others = store.variants.filter(
        (x) =>
          x.productId === productId &&
          x.id !== variantId &&
          x.isDefault &&
          x.active,
      );
      const remaining = others.length + (next.isDefault && next.active ? 1 : 0);
      if (remaining < 1) {
        throw new AdminProductError(
          "DEFAULT_VARIANT_REQUIRED",
          "Cannot leave the product without an active default variant.",
        );
      }
      if (
        patch.sku &&
        store.variants.some((x) => x.sku === patch.sku && x.id !== variantId)
      ) {
        throw new AdminProductError(
          "DUPLICATE_SKU",
          "Variant SKU already exists.",
        );
      }

      const previousDefaultIds: string[] = [];
      if (next.isDefault && next.active) {
        for (const o of store.variants) {
          if (
            o.productId === productId &&
            o.id !== variantId &&
            o.isDefault &&
            o.active
          ) {
            previousDefaultIds.push(o.id);
            o.isDefault = false;
            trackWrite(store, { id: o.id, is_default: false });
          }
        }
      }

      const update: Record<string, unknown> = {};
      if (patch.sku !== undefined) {
        update.sku = patch.sku;
        v.sku = patch.sku;
      }
      if (patch.title !== undefined) {
        update.title = patch.title;
        v.title = patch.title;
      }
      if (patch.isDefault !== undefined || (next.isDefault && next.active)) {
        update.is_default = next.isDefault;
        v.isDefault = next.isDefault;
      }
      if (patch.isPriceable !== undefined) {
        update.is_priceable = patch.isPriceable;
        v.isPriceable = patch.isPriceable;
      }
      if (patch.active !== undefined || (next.isDefault && next.active)) {
        update.active = next.active;
        v.active = next.active;
      }
      trackWrite(store, update);

      if (activeDefaultCount(store, productId) !== 1) {
        throw new AdminProductError(
          "DEFAULT_VARIANT_REQUIRED",
          "Product must have exactly one active default variant.",
          409,
        );
      }

      if (next.isDefault && next.active && previousDefaultIds.length > 0) {
        store.audits.push({
          actorScope: `staff:${actor.id}`,
          action: "variant.default_changed",
          entityType: "mp_product_variants",
          entityId: variantId,
          isFinancial: false,
          payload: {
            actorId: actor.id,
            actorUsername: actor.username,
            actorRole: actor.role,
            productId,
            previousDefaultIds,
          },
        });
      }
      store.audits.push({
        actorScope: `staff:${actor.id}`,
        action: "variant.updated",
        entityType: "mp_product_variants",
        entityId: variantId,
        isFinancial: false,
        payload: {
          actorId: actor.id,
          actorUsername: actor.username,
          actorRole: actor.role,
          productId,
          changedFields: Object.keys(update),
        },
      });

      return {
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        title: v.title,
        isDefault: v.isDefault,
        isPriceable: v.isPriceable,
        active: v.active,
      };
    },
  };
}
