/**
 * WS2 admin product/variant repository.
 * Writes only allowlisted non-price columns. Never sets mp.allow_price_write.
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

const FORBIDDEN_WRITE_COLUMNS = new Set([
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
]);

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

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function assertSafeWritePayload(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_WRITE_COLUMNS.has(key)) {
      throw new AdminProductError(
        "FORBIDDEN_FIELD",
        `Internal write blocked forbidden column: ${key}`,
        500,
      );
    }
  }
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

export function createSupabaseAdminProductRepository(
  clientFactory: () => SupabaseClient | null = getSupabase,
): AdminProductRepository {
  function requireClient(): SupabaseClient {
    if (!isSupabaseActive()) {
      throw new AdminProductError(
        "CATALOGUE_UNAVAILABLE",
        "Catalogue database is unavailable.",
        503,
      );
    }
    const client = clientFactory();
    if (!client) {
      throw new AdminProductError(
        "CATALOGUE_UNAVAILABLE",
        "Catalogue database is unavailable.",
        503,
      );
    }
    return client;
  }

  async function newId(prefix: string): Promise<string> {
    const supabase = requireClient();
    const { data, error } = await supabase.rpc("mp_new_id", {
      p_prefix: prefix,
    });
    if (error || typeof data !== "string" || !data) {
      // Fallback for environments where RPC is unavailable in tests — still server-side.
      return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
    }
    return data;
  }

  async function writeAudit(
    actor: AdminActorRef,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const supabase = requireClient();
    const { error } = await supabase.rpc("mp_write_audit", {
      p_actor_scope: `staff:${actor.id}`,
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_is_financial: false,
      p_payload: {
        actorId: actor.id,
        actorUsername: actor.username,
        actorRole: actor.role,
        ...payload,
      },
    });
    if (error) {
      // Direct insert fallback when RPC not wired in local fakes — still append-only shape.
      const id = await newId("mpaud");
      const insert = {
        id,
        actor_scope: `staff:${actor.id}`,
        action,
        entity_type: entityType,
        entity_id: entityId,
        is_financial: false,
        payload: {
          actorId: actor.id,
          actorUsername: actor.username,
          actorRole: actor.role,
          ...payload,
        },
      };
      assertSafeWritePayload(insert as Record<string, unknown>);
      const { error: insertError } = await supabase
        .from("mp_audit_events")
        .insert(insert);
      if (insertError) {
        throw new AdminProductError(
          "AUDIT_FAILED",
          "Unable to record marketplace audit event.",
          500,
        );
      }
    }
  }

  async function requireBrand(id: string): Promise<BrandRow> {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from("mp_brands")
      .select("id, slug, name, active")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new AdminProductError(
        "ADMIN_QUERY_FAILED",
        "Unable to validate brand.",
        500,
      );
    }
    if (!data || data.active === false) {
      throw new AdminProductError(
        "INVALID_RELATIONSHIP",
        "Brand not found or inactive.",
      );
    }
    return data as BrandRow;
  }

  async function requireCategory(id: string): Promise<CategoryRow> {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from("mp_categories")
      .select("id, slug, name, description, sort_order, active")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new AdminProductError(
        "ADMIN_QUERY_FAILED",
        "Unable to validate category.",
        500,
      );
    }
    if (!data || data.active === false) {
      throw new AdminProductError(
        "INVALID_RELATIONSHIP",
        "Category not found or inactive.",
      );
    }
    return data as CategoryRow;
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
        "ADMIN_QUERY_FAILED",
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
        "ADMIN_QUERY_FAILED",
        "Unable to load product variants.",
        500,
      );
    }
    return {
      ...summary,
      variants: ((variants || []) as VariantRow[]).map(mapVariant),
    };
  }

  async function clearOtherDefaults(
    productId: string,
    keepVariantId: string | null,
  ): Promise<string[]> {
    const supabase = requireClient();
    const { data: current, error } = await supabase
      .from("mp_product_variants")
      .select("id")
      .eq("product_id", productId)
      .eq("is_default", true)
      .eq("active", true);
    if (error) {
      throw new AdminProductError(
        "ADMIN_QUERY_FAILED",
        "Unable to load default variants.",
        500,
      );
    }
    const ids = ((current || []) as { id: string }[])
      .map((r) => r.id)
      .filter((id) => id !== keepVariantId);
    if (ids.length === 0) return [];
    const payload = { is_default: false };
    assertSafeWritePayload(payload);
    const { error: updErr } = await supabase
      .from("mp_product_variants")
      .update(payload)
      .in("id", ids)
      .eq("product_id", productId);
    if (updErr) {
      if (/mp_variants_one_default|unique/i.test(updErr.message || "")) {
        throw new AdminProductError(
          "CONFLICT",
          "Default variant conflict. Retry the request.",
          409,
        );
      }
      throw new AdminProductError(
        "ADMIN_QUERY_FAILED",
        "Unable to update default variants.",
        500,
      );
    }
    return ids;
  }

  async function countActiveDefaults(productId: string): Promise<number> {
    const supabase = requireClient();
    const { count, error } = await supabase
      .from("mp_product_variants")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId)
      .eq("is_default", true)
      .eq("active", true);
    if (error) {
      throw new AdminProductError(
        "ADMIN_QUERY_FAILED",
        "Unable to validate default variants.",
        500,
      );
    }
    return count ?? 0;
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
      if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
      if (filters.active !== undefined) query = query.eq("active", filters.active);
      if (filters.search) {
        const q = filters.search.replace(/[%_]/g, "");
        query = query.or(`title.ilike.%${q}%,slug.ilike.%${q}%`);
      }

      const { data, error, count } = await query;
      if (error) {
        throw new AdminProductError(
          "ADMIN_QUERY_FAILED",
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
      await requireBrand(input.brandId);
      await requireCategory(input.categoryId);
      const supabase = requireClient();

      const { data: slugHit } = await supabase
        .from("mp_products")
        .select("id")
        .eq("slug", input.slug)
        .maybeSingle();
      if (slugHit) {
        throw new AdminProductError("DUPLICATE_SLUG", "Product slug already exists.");
      }
      const { data: skuHit } = await supabase
        .from("mp_product_variants")
        .select("id")
        .eq("sku", input.defaultVariant.sku)
        .maybeSingle();
      if (skuHit) {
        throw new AdminProductError("DUPLICATE_SKU", "Variant SKU already exists.");
      }

      const productId = await newId("mpprod");
      const variantId = await newId("mpvar");

      const productInsert = {
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
      assertSafeWritePayload(productInsert);

      const { error: pErr } = await supabase
        .from("mp_products")
        .insert(productInsert);
      if (pErr) {
        if (/unique|duplicate/i.test(pErr.message || "")) {
          throw new AdminProductError(
            "DUPLICATE_SLUG",
            "Product slug already exists.",
          );
        }
        throw new AdminProductError(
          "ADMIN_QUERY_FAILED",
          "Unable to create product.",
          500,
        );
      }

      const variantInsert = {
        id: variantId,
        product_id: productId,
        sku: input.defaultVariant.sku,
        title: input.defaultVariant.title,
        is_default: true,
        is_priceable: input.defaultVariant.isPriceable,
        active: true,
      };
      assertSafeWritePayload(variantInsert);

      const { error: vErr } = await supabase
        .from("mp_product_variants")
        .insert(variantInsert);
      if (vErr) {
        await supabase.from("mp_products").delete().eq("id", productId);
        if (/unique|duplicate/i.test(vErr.message || "")) {
          throw new AdminProductError(
            "DUPLICATE_SKU",
            "Variant SKU already exists.",
          );
        }
        throw new AdminProductError(
          "ADMIN_QUERY_FAILED",
          "Unable to create default variant.",
          500,
        );
      }

      try {
        await writeAudit(actor, "product.created", "mp_products", productId, {
          changedFields: Object.keys(productInsert).filter((k) => k !== "id"),
          slug: input.slug,
        });
        await writeAudit(actor, "variant.created", "mp_product_variants", variantId, {
          changedFields: Object.keys(variantInsert).filter(
            (k) => k !== "id" && k !== "product_id",
          ),
          productId,
          sku: input.defaultVariant.sku,
        });
      } catch (auditErr) {
        await supabase.from("mp_product_variants").delete().eq("id", variantId);
        await supabase.from("mp_products").delete().eq("id", productId);
        throw auditErr;
      }

      const detail = await loadDetail(productId);
      if (!detail) {
        throw new AdminProductError(
          "ADMIN_QUERY_FAILED",
          "Product created but could not be reloaded.",
          500,
        );
      }
      return detail;
    },

    async updateProduct(id, patch, actor) {
      const existing = await loadDetail(id);
      if (!existing) {
        throw new AdminProductError(
          "PRODUCT_NOT_FOUND",
          "Product not found.",
          404,
        );
      }
      if (patch.brandId) await requireBrand(patch.brandId);
      if (patch.categoryId) await requireCategory(patch.categoryId);

      const update: Record<string, unknown> = {};
      if (patch.brandId !== undefined) update.brand_id = patch.brandId;
      if (patch.categoryId !== undefined) update.category_id = patch.categoryId;
      if (patch.title !== undefined) update.title = patch.title;
      if (patch.description !== undefined) update.description = patch.description;
      if (patch.tags !== undefined) update.tags = patch.tags;
      if (patch.active !== undefined) update.active = patch.active;
      if (patch.featured !== undefined) update.featured = patch.featured;
      update.updated_at = new Date().toISOString();
      assertSafeWritePayload(update);

      const supabase = requireClient();
      const { error } = await supabase
        .from("mp_products")
        .update(update)
        .eq("id", id);
      if (error) {
        throw new AdminProductError(
          "ADMIN_QUERY_FAILED",
          "Unable to update product.",
          500,
        );
      }

      await writeAudit(actor, "product.updated", "mp_products", id, {
        changedFields: Object.keys(update).filter((k) => k !== "updated_at"),
      });

      const detail = await loadDetail(id);
      if (!detail) {
        throw new AdminProductError(
          "PRODUCT_NOT_FOUND",
          "Product not found.",
          404,
        );
      }
      return detail;
    },

    async createVariant(productId, input, actor) {
      const product = await loadDetail(productId);
      if (!product) {
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

      const supabase = requireClient();
      const { data: skuHit } = await supabase
        .from("mp_product_variants")
        .select("id")
        .eq("sku", input.sku)
        .maybeSingle();
      if (skuHit) {
        throw new AdminProductError("DUPLICATE_SKU", "Variant SKU already exists.");
      }

      const previousDefaults = input.isDefault
        ? await clearOtherDefaults(productId, null)
        : [];

      const variantId = await newId("mpvar");
      const variantInsert = {
        id: variantId,
        product_id: productId,
        sku: input.sku,
        title: input.title,
        is_default: input.isDefault,
        is_priceable: input.isPriceable,
        active: input.active,
      };
      assertSafeWritePayload(variantInsert);

      const { error } = await supabase
        .from("mp_product_variants")
        .insert(variantInsert);
      if (error) {
        // Best-effort restore previous defaults if we cleared them.
        if (previousDefaults.length > 0) {
          await supabase
            .from("mp_product_variants")
            .update({ is_default: true })
            .in("id", previousDefaults)
            .eq("product_id", productId);
        }
        if (/unique|duplicate|mp_variants_one_default/i.test(error.message || "")) {
          throw new AdminProductError(
            "CONFLICT",
            "Unable to create variant due to a uniqueness or default conflict.",
            409,
          );
        }
        throw new AdminProductError(
          "ADMIN_QUERY_FAILED",
          "Unable to create variant.",
          500,
        );
      }

      if (input.isDefault) {
        await writeAudit(
          actor,
          "variant.default_changed",
          "mp_product_variants",
          variantId,
          { productId, previousDefaultIds: previousDefaults },
        );
      }
      await writeAudit(actor, "variant.created", "mp_product_variants", variantId, {
        changedFields: ["sku", "title", "is_default", "is_priceable", "active"],
        productId,
        sku: input.sku,
      });

      const defaults = await countActiveDefaults(productId);
      if (defaults !== 1) {
        throw new AdminProductError(
          "DEFAULT_VARIANT_REQUIRED",
          "Product must have exactly one active default variant.",
          409,
        );
      }

      return mapVariant(variantInsert as unknown as VariantRow);
    },

    async updateVariant(productId, variantId, patch, actor) {
      const product = await loadDetail(productId);
      if (!product) {
        throw new AdminProductError(
          "PRODUCT_NOT_FOUND",
          "Product not found.",
          404,
        );
      }
      const current = product.variants.find((v) => v.id === variantId);
      if (!current) {
        throw new AdminProductError(
          "VARIANT_NOT_FOUND",
          "Variant not found for this product.",
          404,
        );
      }

      const next = {
        sku: patch.sku ?? current.sku,
        title: patch.title ?? current.title,
        isDefault: patch.isDefault ?? current.isDefault,
        isPriceable: patch.isPriceable ?? current.isPriceable,
        active: patch.active ?? current.active,
      };

      if (next.isDefault && !next.active) {
        throw new AdminProductError(
          "DEFAULT_VARIANT_REQUIRED",
          "A default variant must be active.",
        );
      }

      const activeDefaults = product.variants.filter(
        (v) => v.active && v.isDefault && v.id !== variantId,
      );
      const selfWouldBeDefault = next.active && next.isDefault;
      const remainingDefaults =
        activeDefaults.length + (selfWouldBeDefault ? 1 : 0);
      if (remainingDefaults < 1) {
        throw new AdminProductError(
          "DEFAULT_VARIANT_REQUIRED",
          "Cannot leave the product without an active default variant.",
        );
      }

      const supabase = requireClient();
      if (patch.sku && patch.sku !== current.sku) {
        const { data: skuHit } = await supabase
          .from("mp_product_variants")
          .select("id")
          .eq("sku", patch.sku)
          .maybeSingle();
        if (skuHit) {
          throw new AdminProductError(
            "DUPLICATE_SKU",
            "Variant SKU already exists.",
          );
        }
      }

      let previousDefaults: string[] = [];
      if (next.isDefault && next.active) {
        previousDefaults = await clearOtherDefaults(productId, variantId);
      }

      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.sku !== undefined) update.sku = patch.sku;
      if (patch.title !== undefined) update.title = patch.title;
      if (patch.isDefault !== undefined) update.is_default = patch.isDefault;
      if (patch.isPriceable !== undefined) update.is_priceable = patch.isPriceable;
      if (patch.active !== undefined) update.active = patch.active;
      // When becoming default, force flags consistently
      if (next.isDefault && next.active) {
        update.is_default = true;
        update.active = true;
      }
      assertSafeWritePayload(update);

      const { error } = await supabase
        .from("mp_product_variants")
        .update(update)
        .eq("id", variantId)
        .eq("product_id", productId);
      if (error) {
        if (/unique|duplicate|mp_variants_one_default/i.test(error.message || "")) {
          throw new AdminProductError(
            "CONFLICT",
            "Variant update conflict. Retry the request.",
            409,
          );
        }
        throw new AdminProductError(
          "ADMIN_QUERY_FAILED",
          "Unable to update variant.",
          500,
        );
      }

      const defaults = await countActiveDefaults(productId);
      if (defaults !== 1) {
        throw new AdminProductError(
          "DEFAULT_VARIANT_REQUIRED",
          "Product must have exactly one active default variant.",
          409,
        );
      }

      if (
        next.isDefault &&
        next.active &&
        (!current.isDefault || previousDefaults.length > 0)
      ) {
        await writeAudit(
          actor,
          "variant.default_changed",
          "mp_product_variants",
          variantId,
          { productId, previousDefaultIds: previousDefaults },
        );
      }
      await writeAudit(actor, "variant.updated", "mp_product_variants", variantId, {
        changedFields: Object.keys(update).filter((k) => k !== "updated_at"),
        productId,
      });

      const detail = await loadDetail(productId);
      const updated = detail?.variants.find((v) => v.id === variantId);
      if (!updated) {
        throw new AdminProductError(
          "VARIANT_NOT_FOUND",
          "Variant not found for this product.",
          404,
        );
      }
      return updated;
    },
  };
}
