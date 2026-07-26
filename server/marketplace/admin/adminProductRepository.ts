/**
 * WS2 admin product/variant repository.
 *
 * Business writes go exclusively through transactional Postgres RPCs
 * (mp_admin_*). There is no multi-request write/compensation fallback.
 *
 * Read/list/detail may remain separate selects. If reload fails after a
 * successful RPC commit, the write has already committed — callers receive a
 * sanitized INTERNAL_ERROR and must not treat the mutation as rolled back.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import {
  AdminProductError,
  type AdminActorRef,
  type AdminCreateProductInput,
  type AdminCreateVariantInput,
  type AdminPatchProductInput,
  type AdminPatchVariantInput,
  type AdminProductDetailDto,
  type AdminProductListFilters,
  type AdminProductListResult,
  type AdminProductSummaryDto,
  type AdminVariantDto,
} from "./adminTypes.ts";

export type AdminProductRepository = {
  listProducts(filters: AdminProductListFilters): Promise<AdminProductListResult>;
  getProductById(id: string): Promise<AdminProductDetailDto | null>;
  createProduct(
    input: AdminCreateProductInput,
    actor: AdminActorRef,
  ): Promise<AdminProductDetailDto>;
  updateProduct(
    id: string,
    patch: AdminPatchProductInput,
    actor: AdminActorRef,
  ): Promise<AdminProductDetailDto>;
  createVariant(
    productId: string,
    input: AdminCreateVariantInput,
    actor: AdminActorRef,
  ): Promise<AdminVariantDto>;
  updateVariant(
    productId: string,
    variantId: string,
    patch: AdminPatchVariantInput,
    actor: AdminActorRef,
  ): Promise<AdminVariantDto>;
};

type BrandRow = { id: string; slug: string; name: string; active: boolean };
type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  active: boolean;
};
type ProductRow = {
  id: string;
  brand_id: string;
  category_id: string;
  title: string;
  slug: string;
  description: string;
  tags: string[] | null;
  active: boolean;
  featured: boolean;
  brand?: BrandRow | BrandRow[] | null;
  category?: CategoryRow | CategoryRow[] | null;
};
type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  title: string;
  is_default: boolean;
  is_priceable: boolean;
  active: boolean;
};

type RpcIds = { productId: string; variantId?: string };

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function mapBrand(row: BrandRow) {
  return { id: row.id, slug: row.slug, name: row.name };
}

function mapCategory(row: CategoryRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    sortOrder: Number(row.sort_order) || 0,
  };
}

function mapVariant(row: VariantRow): AdminVariantDto {
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    title: row.title,
    isDefault: Boolean(row.is_default),
    isPriceable: Boolean(row.is_priceable),
    active: Boolean(row.active),
  };
}

function mapSummary(row: ProductRow): AdminProductSummaryDto | null {
  const brand = one(row.brand);
  const category = one(row.category);
  if (!brand || !category) return null;
  return {
    id: row.id,
    brandId: row.brand_id,
    categoryId: row.category_id,
    title: row.title,
    slug: row.slug,
    description: row.description || "",
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    active: Boolean(row.active),
    featured: Boolean(row.featured),
    brand: mapBrand(brand),
    category: mapCategory(category),
  };
}

const PRODUCT_SELECT = `
  id, brand_id, category_id, title, slug, description, tags, active, featured,
  brand:mp_brands!brand_id ( id, slug, name, active ),
  category:mp_categories!category_id ( id, slug, name, description, sort_order, active )
`;

const ERROR_CODES = [
  "DUPLICATE_SLUG",
  "DUPLICATE_SKU",
  "PRODUCT_NOT_FOUND",
  "VARIANT_NOT_FOUND",
  "INVALID_RELATIONSHIP",
  "DEFAULT_VARIANT_REQUIRED",
  "CONFLICT",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
] as const;

function statusForCode(code: string): number {
  if (code === "PRODUCT_NOT_FOUND" || code === "VARIANT_NOT_FOUND") return 404;
  if (code === "CONFLICT") return 409;
  if (code === "INTERNAL_ERROR") return 500;
  return 400;
}

function mapRpcError(err: { message?: string; code?: string } | null): AdminProductError {
  const raw = String(err?.message || "");
  for (const code of ERROR_CODES) {
    if (raw.startsWith(`${code}:`) || raw.includes(`${code}:`)) {
      const message = raw.includes(":")
        ? raw.slice(raw.indexOf(":") + 1).trim() || code
        : code;
      return new AdminProductError(code, message, statusForCode(code));
    }
  }
  if (/unique|duplicate/i.test(raw) && /slug/i.test(raw)) {
    return new AdminProductError(
      "DUPLICATE_SLUG",
      "Product slug already exists.",
    );
  }
  if (/unique|duplicate/i.test(raw) && /sku/i.test(raw)) {
    return new AdminProductError(
      "DUPLICATE_SKU",
      "Variant SKU already exists.",
    );
  }
  if (/mp_variants_one_default/i.test(raw)) {
    return new AdminProductError(
      "CONFLICT",
      "Default variant conflict. Retry the request.",
      409,
    );
  }
  return new AdminProductError(
    "INTERNAL_ERROR",
    "Unable to process marketplace admin request.",
    500,
  );
}

function parseRpcIds(data: unknown): RpcIds {
  if (!data || typeof data !== "object") {
    throw new AdminProductError(
      "INTERNAL_ERROR",
      "Admin write RPC returned an invalid payload.",
      500,
    );
  }
  const row = data as Record<string, unknown>;
  const productId = String(row.productId || row.product_id || "");
  if (!productId) {
    throw new AdminProductError(
      "INTERNAL_ERROR",
      "Admin write RPC returned no product id.",
      500,
    );
  }
  const variantRaw = row.variantId ?? row.variant_id;
  return {
    productId,
    variantId: variantRaw ? String(variantRaw) : undefined,
  };
}

export function createSupabaseAdminProductRepository(
  clientFactory: () => SupabaseClient | null = getSupabase,
): AdminProductRepository {
  function requireClient(): SupabaseClient {
    if (!isSupabaseActive()) {
      throw new AdminProductError(
        "INTERNAL_ERROR",
        "Catalogue database is unavailable.",
        503,
      );
    }
    const client = clientFactory();
    if (!client) {
      throw new AdminProductError(
        "INTERNAL_ERROR",
        "Catalogue database is unavailable.",
        503,
      );
    }
    return client;
  }

  async function loadDetail(id: string): Promise<AdminProductDetailDto | null> {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from("mp_products")
      .select(PRODUCT_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new AdminProductError(
        "INTERNAL_ERROR",
        "Unable to load product.",
        500,
      );
    }
    if (!data) return null;
    const summary = mapSummary(data as ProductRow);
    if (!summary) return null;
    const { data: variants, error: vErr } = await supabase
      .from("mp_product_variants")
      .select("id, product_id, sku, title, is_default, is_priceable, active")
      .eq("product_id", id)
      .order("sku", { ascending: true });
    if (vErr) {
      throw new AdminProductError(
        "INTERNAL_ERROR",
        "Unable to load product variants.",
        500,
      );
    }
    return {
      ...summary,
      variants: ((variants || []) as VariantRow[]).map(mapVariant),
    };
  }

  /**
   * Reload after a committed RPC. Failure here does not mean the write rolled back.
   */
  async function reloadAfterCommit(
    productId: string,
  ): Promise<AdminProductDetailDto> {
    const detail = await loadDetail(productId);
    if (!detail) {
      throw new AdminProductError(
        "INTERNAL_ERROR",
        "Write committed but product could not be reloaded.",
        500,
      );
    }
    return detail;
  }

  async function callAdminRpc(
    fn: string,
    params: Record<string, unknown>,
  ): Promise<RpcIds> {
    const supabase = requireClient();
    const { data, error } = await supabase.rpc(fn, params);
    if (error) throw mapRpcError(error);
    return parseRpcIds(data);
  }

  return {
    async listProducts(filters) {
      const supabase = requireClient();
      let query = supabase
        .from("mp_products")
        .select(PRODUCT_SELECT, { count: "exact" })
        .order("title", { ascending: true })
        .range(filters.offset, filters.offset + filters.limit - 1);

      if (filters.brandId) query = query.eq("brand_id", filters.brandId);
      if (filters.categoryId) {
        query = query.eq("category_id", filters.categoryId);
      }
      if (filters.active !== undefined) {
        query = query.eq("active", filters.active);
      }
      if (filters.search) {
        const q = filters.search.replace(/[%_]/g, "");
        query = query.or(`title.ilike.%${q}%,slug.ilike.%${q}%`);
      }

      const { data, error, count } = await query;
      if (error) {
        throw new AdminProductError(
          "INTERNAL_ERROR",
          "Unable to list products.",
          500,
        );
      }
      const items = ((data || []) as ProductRow[])
        .map(mapSummary)
        .filter((p): p is AdminProductSummaryDto => p !== null);
      return {
        items,
        pagination: {
          limit: filters.limit,
          offset: filters.offset,
          total: count ?? items.length,
        },
      };
    },

    async getProductById(id) {
      return loadDetail(id);
    },

    async createProduct(input, actor) {
      const ids = await callAdminRpc("mp_admin_create_product", {
        p_actor_id: actor.id,
        p_actor_username: actor.username,
        p_actor_role: actor.role,
        p_brand_id: input.brandId,
        p_category_id: input.categoryId,
        p_title: input.title,
        p_slug: input.slug,
        p_description: input.description,
        p_tags: input.tags,
        p_active: input.active,
        p_featured: input.featured,
        p_variant_sku: input.defaultVariant.sku,
        p_variant_title: input.defaultVariant.title,
        p_variant_is_priceable: input.defaultVariant.isPriceable,
      });
      return reloadAfterCommit(ids.productId);
    },

    async updateProduct(id, patch, actor) {
      const ids = await callAdminRpc("mp_admin_update_product", {
        p_actor_id: actor.id,
        p_actor_username: actor.username,
        p_actor_role: actor.role,
        p_product_id: id,
        p_brand_id: patch.brandId ?? null,
        p_category_id: patch.categoryId ?? null,
        p_title: patch.title ?? null,
        p_description: patch.description ?? null,
        p_tags: patch.tags ?? null,
        p_active: patch.active ?? null,
        p_featured: patch.featured ?? null,
      });
      return reloadAfterCommit(ids.productId);
    },

    async createVariant(productId, input, actor) {
      const ids = await callAdminRpc("mp_admin_create_variant", {
        p_actor_id: actor.id,
        p_actor_username: actor.username,
        p_actor_role: actor.role,
        p_product_id: productId,
        p_sku: input.sku,
        p_title: input.title,
        p_is_default: input.isDefault,
        p_is_priceable: input.isPriceable,
        p_active: input.active,
      });
      const detail = await reloadAfterCommit(ids.productId);
      const variant = detail.variants.find((v) => v.id === ids.variantId);
      if (!variant) {
        throw new AdminProductError(
          "INTERNAL_ERROR",
          "Write committed but variant could not be reloaded.",
          500,
        );
      }
      return variant;
    },

    async updateVariant(productId, variantId, patch, actor) {
      const ids = await callAdminRpc("mp_admin_update_variant", {
        p_actor_id: actor.id,
        p_actor_username: actor.username,
        p_actor_role: actor.role,
        p_product_id: productId,
        p_variant_id: variantId,
        p_sku: patch.sku ?? null,
        p_title: patch.title ?? null,
        p_is_default: patch.isDefault ?? null,
        p_is_priceable: patch.isPriceable ?? null,
        p_active: patch.active ?? null,
      });
      const detail = await reloadAfterCommit(ids.productId);
      const variant = detail.variants.find(
        (v) => v.id === (ids.variantId || variantId),
      );
      if (!variant) {
        throw new AdminProductError(
          "INTERNAL_ERROR",
          "Write committed but variant could not be reloaded.",
          500,
        );
      }
      return variant;
    },
  };
}
