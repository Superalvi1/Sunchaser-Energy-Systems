/**
 * Supabase/Postgres implementation of CatalogueManagerRepository.
 *
 * Uses existing RPCs where available:
 *   mp_set_field_override, mp_clear_field_override,
 *   mp_record_import_reject, mp_catalogue_reconciliation_counts,
 *   mp_ceo_auto_import_sync_product_media (if present)
 *
 * patchProduct: CEO-protected content fields are written via setOverride so
 *   supplier sync cannot wipe them. Non-protected fields (active, tags,
 *   compareAtPrice) update columns directly.
 *
 * bulkPublish: sets public_visible override per product so sync cannot reset it.
 * bulkCategory: sets category_id override per product AND updates column.
 *
 * Fail-closed: any DB error → CatalogueManagerError(503/500).
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  activeOverridesByField,
  isMediaMutationLocked,
  resolveEffectiveValue,
  type FieldOverrideRecord,
} from "./fieldOverrides.ts";
import type {
  BulkCategoryInput,
  BulkPublishInput,
  CatalogueManagerActorRef,
  CatalogueManagerAuditEvent,
  CatalogueManagerListFilters,
  CatalogueManagerListResult,
  CatalogueManagerMediaRow,
  CatalogueManagerPatchInput,
  CatalogueManagerProductDetail,
  CatalogueManagerProductSummary,
  ReconciliationCounts,
  ReconciliationInput,
  RejectLedgerEntry,
  SetOverrideInput,
  SupplierMediaInput,
} from "./catalogueManagerTypes.ts";
import { CatalogueManagerError } from "./catalogueManagerTypes.ts";
import { normalizeSupplierImageUrl } from "../suppliers/safeHttp.ts";
import type { CatalogueManagerRepository } from "./memoryCatalogueManagerRepository.ts";

// ---------------------------------------------------------------------------
// DB row types (snake_case from Supabase)
// ---------------------------------------------------------------------------

type DbOverrideRow = {
  id: string;
  field_name: string;
  override_value: unknown;
  active: boolean;
  actor_id: string;
  actor_username: string | null;
  created_at: string;
  updated_at: string;
  cleared_at: string | null;
};

type DbBrandRow = { id: string; name: string; slug: string };
type DbCategoryRow = { id: string; name: string; slug: string };

type DbVariantRow = {
  sku: string;
  title: string;
  is_default: boolean;
  website_price: string | number | null;
  compare_at_price: string | number | null;
  stock_status: string;
  active: boolean;
};

type DbMediaRow = {
  id: string;
  source_url: string | null;
  sort_order: number | null;
  role: string | null;
  published: boolean | null;
  source_type: string | null;
  rights_status: string | null;
  manual_control: boolean | null;
  source_key: string | null;
  supplier_code: string | null;
};

type DbProductSummaryRow = {
  id: string;
  slug: string;
  title: string;
  active: boolean;
  public_visible: boolean | null;
  featured: boolean | null;
  stock_status?: string | null;
  last_supplier_sync_at: string | null;
  last_manual_edit_at: string | null;
  selected_supplier: string | null;
  identity_key: string | null;
  source_urls: string[] | null;
  brand: DbBrandRow | DbBrandRow[] | null;
  category: DbCategoryRow | DbCategoryRow[] | null;
  variants: DbVariantRow[] | null;
  overrides: DbOverrideRow[] | null;
  media: DbMediaRow[] | null;
};

type DbProductDetailRow = DbProductSummaryRow & {
  description: string | null;
  short_description: string | null;
  model: string | null;
  seo_title: string | null;
  seo_description: string | null;
  datasheet_url: string | null;
  warranty: string | null;
  specifications: Record<string, unknown> | null;
  tags: string[] | null;
  compare_at_price?: string | number | null;
};

type DbAuditRow = {
  id: string;
  actor_scope: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Supabase select strings
// ---------------------------------------------------------------------------

const OVERRIDE_SELECT = `
  id,
  field_name,
  override_value,
  active,
  actor_id,
  actor_username,
  created_at,
  updated_at,
  cleared_at
`.trim();

const SUMMARY_SELECT = `
  id,
  slug,
  title,
  active,
  public_visible,
  featured,
  last_supplier_sync_at,
  last_manual_edit_at,
  selected_supplier,
  identity_key,
  source_urls,
  brand:mp_brands!brand_id (id, name, slug),
  category:mp_categories!category_id (id, name, slug),
  variants:mp_product_variants!product_id (
    sku, title, is_default, website_price, compare_at_price, stock_status, active
  ),
  overrides:mp_field_overrides!product_id (${OVERRIDE_SELECT}),
  media:mp_media!product_id (
    id, source_url, sort_order, role, published, source_type,
    rights_status, manual_control, source_key, supplier_code
  )
`.trim();

const DETAIL_SELECT = `
  ${SUMMARY_SELECT},
  description,
  short_description,
  model,
  seo_title,
  seo_description,
  datasheet_url,
  warranty,
  specifications,
  tags
`.trim();

// ---------------------------------------------------------------------------
// DB → TS mappers
// ---------------------------------------------------------------------------

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function toFieldOverrideRecord(row: DbOverrideRow): FieldOverrideRecord {
  return {
    fieldName: row.field_name,
    value: row.override_value,
    active: row.active,
    actorId: row.actor_id,
    actorUsername: row.actor_username ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clearedAt: row.cleared_at ?? null,
  };
}

function toMediaRow(row: DbMediaRow, productId: string): CatalogueManagerMediaRow {
  return {
    id: row.id,
    productId,
    sourceUrl: row.source_url ?? "",
    sortOrder: Number(row.sort_order) || 0,
    role: (row.role === "thumbnail" || row.role === "gallery" || row.role === "og"
      ? row.role
      : "gallery") as CatalogueManagerMediaRow["role"],
    published: row.published ?? false,
    sourceType: row.source_type ?? "supplier",
    rightsStatus: row.rights_status ?? "supplier_approved",
    manualControl: row.manual_control ?? false,
    sourceKey: row.source_key ?? null,
    supplierCode: row.supplier_code ?? null,
  };
}

function resolveStockStatus(overrides: Map<string, FieldOverrideRecord>, variants: DbVariantRow[] | null): string {
  const ov = overrides.get("stock_status");
  if (ov && ov.active && typeof ov.value === "string") return ov.value;
  const def = (variants ?? []).find((v) => v.is_default && v.active !== false);
  return def?.stock_status ?? "unknown";
}

function resolveWebsitePrice(variants: DbVariantRow[] | null): number | null {
  const def = (variants ?? []).find((v) => v.is_default && v.active !== false);
  if (!def) return null;
  const n = typeof def.website_price === "number" ? def.website_price : Number(def.website_price);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveCompareAtPrice(variants: DbVariantRow[] | null): number | null {
  const def = (variants ?? []).find((v) => v.is_default && v.active !== false);
  if (!def) return null;
  const n = typeof def.compare_at_price === "number" ? def.compare_at_price : Number(def.compare_at_price);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function primaryImageFor(productId: string, overrides: Map<string, FieldOverrideRecord>, media: DbMediaRow[]): string | null {
  const piOv = overrides.get("primary_image");
  if (piOv && piOv.active && typeof piOv.value === "string") return piOv.value;
  const published = media
    .filter((m) => m.published === true)
    .sort((a, b) => {
      if (a.role === "thumbnail" && b.role !== "thumbnail") return -1;
      if (b.role === "thumbnail" && a.role !== "thumbnail") return 1;
      return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    });
  return published[0]?.source_url ?? null;
}

/**
 * Resolve effective brand/category ID + name.
 * When an override is active, the override brand/category record (looked up
 * by the caller and passed via resolvedOverrideBrand/Category) provides BOTH
 * the ID and the name. If the override is active but the record is missing,
 * fail closed — never show an override ID with the supplier name.
 */
function toSummary(
  row: DbProductSummaryRow,
  resolvedOverrideBrand?: { id: string; name: string; slug: string } | null,
  resolvedOverrideCategory?: { id: string; name: string; slug: string } | null,
): CatalogueManagerProductSummary {
  const brand = one(row.brand);
  const category = one(row.category);
  const overrideRows = (row.overrides ?? []).map(toFieldOverrideRecord);
  const ovMap = activeOverridesByField(overrideRows);
  const media = row.media ?? [];

  const effectiveTitle = resolveEffectiveValue({
    field: "title",
    supplierValue: row.title,
    fallback: row.title,
    overrides: ovMap,
  }).value;

  const effectivePV = resolveEffectiveValue({
    field: "public_visible",
    supplierValue: row.public_visible ?? true,
    fallback: true,
    overrides: ovMap,
  }).value;

  const effectiveFeatured = resolveEffectiveValue({
    field: "featured",
    supplierValue: row.featured ?? false,
    fallback: false,
    overrides: ovMap,
  }).value;

  // Brand: override record if active and resolved, else supplier FK join.
  // Fail-closed: if override is active but record is missing, throw — never
  // combine an override ID with the supplier name.
  const brandOvActive = ovMap.has("brand_id");
  const categoryOvActive = ovMap.has("category_id");

  if (brandOvActive && !resolvedOverrideBrand) {
    throw new CatalogueManagerError(
      500,
      "OVERRIDE_BRAND_UNRESOLVED",
      "Active brand_id override could not be resolved.",
    );
  }
  if (categoryOvActive && !resolvedOverrideCategory) {
    throw new CatalogueManagerError(
      500,
      "OVERRIDE_CATEGORY_UNRESOLVED",
      "Active category_id override could not be resolved.",
    );
  }

  const effectiveBrandId = brandOvActive
    ? (resolvedOverrideBrand!.id)
    : (brand?.id ?? "");
  const effectiveBrandName = brandOvActive
    ? (resolvedOverrideBrand!.name)
    : (brand?.name ?? "");
  const effectiveCategoryId = categoryOvActive
    ? (resolvedOverrideCategory!.id)
    : (category?.id ?? "");
  const effectiveCategoryName = categoryOvActive
    ? (resolvedOverrideCategory!.name)
    : (category?.name ?? "");

  return {
    id: row.id,
    title: effectiveTitle,
    slug: row.slug,
    brandId: effectiveBrandId,
    brandName: effectiveBrandName,
    categoryId: effectiveCategoryId,
    categoryName: effectiveCategoryName,
    active: row.active,
    publicVisible: Boolean(effectivePV),
    featured: Boolean(effectiveFeatured),
    stockStatus: resolveStockStatus(ovMap, row.variants),
    websitePrice: resolveWebsitePrice(row.variants),
    compareAtPrice: resolveCompareAtPrice(row.variants),
    selectedSupplier: row.selected_supplier ?? null,
    primaryImage: primaryImageFor(row.id, ovMap, media),
    lastSupplierSyncAt: row.last_supplier_sync_at ?? null,
    lastManualEditAt: row.last_manual_edit_at ?? null,
    overrideFields: overrideRows.filter((o) => o.active).map((o) => o.fieldName),
  };
}

function layered<T>(
  field: string,
  supplierValue: T,
  fallback: T,
  ovMap: Map<string, FieldOverrideRecord>,
): { supplier: T; manual: T | null; effective: T; source: ReturnType<typeof resolveEffectiveValue>["source"] } {
  const ov = ovMap.get(field);
  const result = resolveEffectiveValue({ field, supplierValue, fallback, overrides: ovMap });
  return {
    supplier: supplierValue,
    manual: ov && ov.active ? (ov.value as T) : null,
    effective: result.value,
    source: result.source,
  };
}

function toDetail(
  row: DbProductDetailRow,
  resolvedOverrideBrand?: { id: string; name: string; slug: string } | null,
  resolvedOverrideCategory?: { id: string; name: string; slug: string } | null,
): CatalogueManagerProductDetail {
  const summary = toSummary(row, resolvedOverrideBrand, resolvedOverrideCategory);
  const overrideRows = (row.overrides ?? []).map(toFieldOverrideRecord);
  const ovMap = activeOverridesByField(overrideRows);

  const supplierTitle = row.title;
  const titleLayered = layered("title", supplierTitle, supplierTitle, ovMap);

  const supplierDesc = row.description ?? "";
  const descriptionLayered = layered("description", supplierDesc, supplierDesc, ovMap);

  // All other content fields resolved with override > column > null fallback
  const effectiveShortDesc = resolveEffectiveValue({
    field: "short_description",
    supplierValue: row.short_description ?? null,
    fallback: null,
    overrides: ovMap,
  }).value;
  const effectiveModel = resolveEffectiveValue({
    field: "model",
    supplierValue: row.model ?? null,
    fallback: null,
    overrides: ovMap,
  }).value;
  const effectiveWarranty = resolveEffectiveValue({
    field: "warranty",
    supplierValue: row.warranty ?? null,
    fallback: null,
    overrides: ovMap,
  }).value;
  const effectiveDatasheet = resolveEffectiveValue({
    field: "datasheet_url",
    supplierValue: row.datasheet_url ?? null,
    fallback: null,
    overrides: ovMap,
  }).value;
  const effectiveSeoTitle = resolveEffectiveValue({
    field: "seo_title",
    supplierValue: row.seo_title ?? null,
    fallback: null,
    overrides: ovMap,
  }).value;
  const effectiveSeoDesc = resolveEffectiveValue({
    field: "seo_description",
    supplierValue: row.seo_description ?? null,
    fallback: null,
    overrides: ovMap,
  }).value;
  const effectiveSpecs = resolveEffectiveValue({
    field: "specifications",
    supplierValue: (row.specifications ?? {}) as Record<string, unknown>,
    fallback: {} as Record<string, unknown>,
    overrides: ovMap,
  }).value;

  return {
    ...summary,
    title: titleLayered.effective,
    description: descriptionLayered.effective,
    shortDescription: effectiveShortDesc as string | null,
    model: effectiveModel as string | null,
    seoTitle: effectiveSeoTitle as string | null,
    seoDescription: effectiveSeoDesc as string | null,
    datasheetUrl: effectiveDatasheet as string | null,
    warranty: effectiveWarranty as string | null,
    specifications: effectiveSpecs as Record<string, unknown>,
    tags: row.tags ?? [],
    sourceUrls: row.source_urls ?? [],
    identityKey: row.identity_key ?? null,
    titleLayered,
    descriptionLayered,
    overrides: overrideRows,
    media: (row.media ?? []).map((m) => toMediaRow(m, row.id)),
  };
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic media row ID: mirrors the SQL function's approach so the
 * TypeScript fallback upsert targets the primary key (id) instead of the
 * partial unique index — avoiding "no unique constraint matching ON CONFLICT".
 *   SQL: 'mpmedia_' || left(md5(p_product_id || '|' || v_url), 24)
 */
function mediaRowId(productId: string, url: string): string {
  return "mpmedia_" + createHash("md5").update(`${productId}|${url}`).digest("hex").slice(0, 24);
}

function dbErr(label: string, err: { message?: string } | null | unknown): CatalogueManagerError {
  const msg = (err as { message?: string })?.message ?? "Unknown DB error";
  console.error(`[CatalogueManager] ${label}:`, msg);
  return new CatalogueManagerError(500, "DB_ERROR", `Catalogue manager database error: ${label}.`);
}

/**
 * Batch-resolve override brand/category records for a set of product rows.
 * Fail-closed: if the DB query errors, throw — never silently fall back to
 * the supplier brand/category when an override is active.
 */
async function resolveOverrideTaxonomy(
  rows: DbProductSummaryRow[],
  supabase: SupabaseClient,
): Promise<{
  brandCache: Map<string, { id: string; name: string; slug: string }>;
  categoryCache: Map<string, { id: string; name: string; slug: string }>;
}> {
  const brandIds = new Set<string>();
  const categoryIds = new Set<string>();

  for (const row of rows) {
    const ovRows = (row.overrides ?? []).map(toFieldOverrideRecord);
    const ovMap = activeOverridesByField(ovRows);
    const bid = ovMap.get("brand_id")?.value as string | undefined;
    const cid = ovMap.get("category_id")?.value as string | undefined;
    if (bid && typeof bid === "string") brandIds.add(bid);
    if (cid && typeof cid === "string") categoryIds.add(cid);
  }

  const brandCache = new Map<string, { id: string; name: string; slug: string }>();
  const categoryCache = new Map<string, { id: string; name: string; slug: string }>();

  if (brandIds.size > 0) {
    const { data, error } = await supabase
      .from("mp_brands")
      .select("id, name, slug")
      .in("id", [...brandIds]);
    if (error) throw dbErr("resolveOverrideTaxonomy.brands", error);
    for (const b of (data ?? []) as Array<{ id: string; name: string; slug: string }>) {
      brandCache.set(b.id, b);
    }
  }

  if (categoryIds.size > 0) {
    const { data, error } = await supabase
      .from("mp_categories")
      .select("id, name, slug")
      .in("id", [...categoryIds]);
    if (error) throw dbErr("resolveOverrideTaxonomy.categories", error);
    for (const c of (data ?? []) as Array<{ id: string; name: string; slug: string }>) {
      categoryCache.set(c.id, c);
    }
  }

  return { brandCache, categoryCache };
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

export function createSupabaseCatalogueManagerRepository(
  supabase: SupabaseClient,
): CatalogueManagerRepository {

  // ── helpers ──────────────────────────────────────────────────────────────

  async function requireProduct(productId: string): Promise<void> {
    const { data, error } = await supabase
      .from("mp_products")
      .select("id")
      .eq("id", productId)
      .maybeSingle();
    if (error) throw dbErr("requireProduct", error);
    if (!data) throw new CatalogueManagerError(404, "PRODUCT_NOT_FOUND", "Product not found.");
  }

  async function callSetOverride(
    productId: string,
    fieldName: string,
    value: unknown,
    actor: CatalogueManagerActorRef,
  ): Promise<FieldOverrideRecord> {
    const { data, error } = await supabase.rpc("mp_set_field_override", {
      p_product_id: productId,
      p_field_name: fieldName,
      p_override_value: value,
      p_actor_id: actor.id,
      p_actor_username: actor.username ?? null,
    });
    if (error) {
      if (error.message?.includes("PRODUCT_NOT_FOUND")) {
        throw new CatalogueManagerError(404, "PRODUCT_NOT_FOUND", "Product not found.");
      }
      throw dbErr("setOverride", error);
    }
    const newId = data as string;
    // Fetch freshly inserted record for return shape consistency
    const { data: ov, error: ovErr } = await supabase
      .from("mp_field_overrides")
      .select(OVERRIDE_SELECT)
      .eq("id", newId)
      .maybeSingle();
    if (ovErr || !ov) {
      // Return a synthetic record (non-fatal)
      return {
        fieldName,
        value,
        active: true,
        actorId: actor.id,
        actorUsername: actor.username,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        clearedAt: null,
      };
    }
    return toFieldOverrideRecord(ov as DbOverrideRow);
  }

  // ── Repository ───────────────────────────────────────────────────────────

  return {
    // Products have no seedProduct in production
    seedProduct: undefined,

    async listProducts(filters: CatalogueManagerListFilters): Promise<CatalogueManagerListResult> {
      // Use the effective-value RPC for server-side pagination + filtering.
      // This bypasses Supabase's implicit 1000-row response cap and filters
      // on EFFECTIVE values (override-aware), not base columns.
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "mp_catalogue_manager_list",
        {
          p_limit: filters.limit,
          p_offset: filters.offset,
          p_q: filters.q ?? null,
          p_brand_id: filters.brandId ?? null,
          p_category_id: filters.categoryId ?? null,
          p_supplier: filters.supplier ?? null,
          p_active: filters.active ?? null,
          p_public_visible: filters.publicVisible ?? null,
          p_featured: filters.featured ?? null,
          p_stock_status: filters.stockStatus ?? null,
        },
      );
      if (rpcErr) throw dbErr("listProducts.rpc", rpcErr);

      // Sentinel row with id=null carries accurate total when page is empty.
      const rpcRows = (rpcData ?? []) as Array<{ id: string | null; total: number }>;
      const total = rpcRows.length > 0 ? Number(rpcRows[0].total) : 0;
      const ids = rpcRows.map((r) => r.id).filter((id): id is string => id !== null);

      if (ids.length === 0) {
        return { items: [], total, limit: filters.limit, offset: filters.offset };
      }

      // Fetch full summary data for the paginated IDs.
      const { data: prodData, error: prodErr } = await supabase
        .from("mp_products")
        .select(SUMMARY_SELECT)
        .in("id", ids);
      if (prodErr) throw dbErr("listProducts.fetch", prodErr);

      const prodRows = (prodData ?? []) as DbProductSummaryRow[];
      const rowById = new Map(prodRows.map((r) => [r.id, r]));

      // Batch-resolve override brand/category records.
      const { brandCache, categoryCache } = await resolveOverrideTaxonomy(prodRows, supabase);

      // Map to summaries in the RPC's deterministic order.
      const items: CatalogueManagerProductSummary[] = [];
      for (const id of ids) {
        const row = rowById.get(id);
        if (!row) continue;
        const ovMap = activeOverridesByField((row.overrides ?? []).map(toFieldOverrideRecord));
        const bid = ovMap.get("brand_id")?.value as string | undefined;
        const cid = ovMap.get("category_id")?.value as string | undefined;
        items.push(toSummary(
          row,
          bid ? (brandCache.get(bid) ?? null) : undefined,
          cid ? (categoryCache.get(cid) ?? null) : undefined,
        ));
      }

      return { items, total, limit: filters.limit, offset: filters.offset };
    },

    async getProduct(productId: string): Promise<CatalogueManagerProductDetail | null> {
      const { data, error } = await supabase
        .from("mp_products")
        .select(DETAIL_SELECT)
        .eq("id", productId)
        .maybeSingle();
      if (error) throw dbErr("getProduct", error);
      if (!data) return null;
      const row = data as DbProductDetailRow;
      // Resolve override brand/category for this single product.
      const { brandCache, categoryCache } = await resolveOverrideTaxonomy([row], supabase);
      const ovMap = activeOverridesByField((row.overrides ?? []).map(toFieldOverrideRecord));
      const bid = ovMap.get("brand_id")?.value as string | undefined;
      const cid = ovMap.get("category_id")?.value as string | undefined;
      return toDetail(
        row,
        bid ? (brandCache.get(bid) ?? null) : undefined,
        cid ? (categoryCache.get(cid) ?? null) : undefined,
      );
    },

    async patchProduct(
      productId: string,
      patch: CatalogueManagerPatchInput,
      actor: CatalogueManagerActorRef,
    ): Promise<CatalogueManagerProductDetail> {
      await requireProduct(productId);

      // CEO-protected content fields → always use override so sync cannot wipe them
      const ceoFields: Array<[string, unknown]> = [];
      if (patch.title !== undefined) ceoFields.push(["title", patch.title]);
      if (patch.description !== undefined) ceoFields.push(["description", patch.description]);
      if (patch.shortDescription !== undefined) ceoFields.push(["short_description", patch.shortDescription]);
      if (patch.model !== undefined) ceoFields.push(["model", patch.model]);
      if (patch.brandId !== undefined) ceoFields.push(["brand_id", patch.brandId]);
      if (patch.categoryId !== undefined) ceoFields.push(["category_id", patch.categoryId]);
      if (patch.seoTitle !== undefined) ceoFields.push(["seo_title", patch.seoTitle]);
      if (patch.seoDescription !== undefined) ceoFields.push(["seo_description", patch.seoDescription]);
      if (patch.datasheetUrl !== undefined) ceoFields.push(["datasheet_url", patch.datasheetUrl]);
      if (patch.warranty !== undefined) ceoFields.push(["warranty", patch.warranty]);
      if (patch.specifications !== undefined) ceoFields.push(["specifications", patch.specifications]);
      if (patch.publicVisible !== undefined) ceoFields.push(["public_visible", patch.publicVisible]);
      if (patch.featured !== undefined) ceoFields.push(["featured", patch.featured]);

      // Validate brand/category IDs exist AND are active before setting override.
      // Reject inactive taxonomy assignments with 422. Fail-closed on DB errors with 503.
      if (patch.brandId !== undefined) {
        const { data: bData, error: bErr } = await supabase
          .from("mp_brands")
          .select("id, active")
          .eq("id", patch.brandId)
          .maybeSingle();
        if (bErr) throw dbErr("patchProduct.validateBrand", bErr);
        if (!bData) {
          throw new CatalogueManagerError(422, "INVALID_BRAND", `Brand not found: ${patch.brandId}`);
        }
        if (bData.active === false) {
          throw new CatalogueManagerError(422, "INACTIVE_BRAND", `Brand is inactive: ${patch.brandId}`);
        }
      }
      if (patch.categoryId !== undefined) {
        const { data: cData, error: cErr } = await supabase
          .from("mp_categories")
          .select("id, active")
          .eq("id", patch.categoryId)
          .maybeSingle();
        if (cErr) throw dbErr("patchProduct.validateCategory", cErr);
        if (!cData) {
          throw new CatalogueManagerError(422, "INVALID_CATEGORY", `Category not found: ${patch.categoryId}`);
        }
        if (cData.active === false) {
          throw new CatalogueManagerError(422, "INACTIVE_CATEGORY", `Category is inactive: ${patch.categoryId}`);
        }
      }

      // Write overrides for CEO-protected fields
      for (const [field, value] of ceoFields) {
        await callSetOverride(productId, field, value, actor);
      }

      // brand_id / category_id columns are intentionally NOT updated here.
      // The column preserves the supplier's original value so that clearing
      // the override immediately restores the supplier brand/category.
      // Effective brand/category IDs are resolved from the override map at
      // read time in toSummary/toDetail.

      // Non-protected fields: update columns directly
      const columnPatch: Record<string, unknown> = {};
      if (patch.active !== undefined) columnPatch.active = patch.active;
      if (patch.tags !== undefined) columnPatch.tags = patch.tags;
      if (patch.compareAtPrice !== undefined) {
        // compare_at_price is on the default variant
        const { data: vData } = await supabase
          .from("mp_product_variants")
          .select("id")
          .eq("product_id", productId)
          .eq("is_default", true)
          .maybeSingle();
        if (vData) {
          const { error: vErr } = await supabase
            .from("mp_product_variants")
            .update({ compare_at_price: patch.compareAtPrice })
            .eq("id", vData.id);
          if (vErr) throw dbErr("patchProduct.compareAtPrice", vErr);
        }
      }

      if (Object.keys(columnPatch).length > 0) {
        const { error: pErr } = await supabase
          .from("mp_products")
          .update({ ...columnPatch, updated_at: new Date().toISOString() })
          .eq("id", productId);
        if (pErr) throw dbErr("patchProduct.columns", pErr);
      }

      const detail = await this.getProduct(productId);
      if (!detail) throw new CatalogueManagerError(404, "PRODUCT_NOT_FOUND", "Product not found after patch.");
      return detail;
    },

    async setOverride(
      productId: string,
      input: SetOverrideInput,
      actor: CatalogueManagerActorRef,
    ): Promise<FieldOverrideRecord> {
      // Validate referenced brand/category IDs: must exist AND be active.
      if (input.fieldName === "brand_id") {
        const { data: bData, error: bErr } = await supabase
          .from("mp_brands")
          .select("id, active")
          .eq("id", input.value as string)
          .maybeSingle();
        if (bErr) throw dbErr("setOverride.validateBrand", bErr);
        if (!bData) {
          throw new CatalogueManagerError(
            422, "INVALID_BRAND",
            `Brand not found: ${String(input.value)}`,
          );
        }
        if (bData.active === false) {
          throw new CatalogueManagerError(
            422, "INACTIVE_BRAND",
            `Brand is inactive: ${String(input.value)}`,
          );
        }
      }
      if (input.fieldName === "category_id") {
        const { data: cData, error: cErr } = await supabase
          .from("mp_categories")
          .select("id, active")
          .eq("id", input.value as string)
          .maybeSingle();
        if (cErr) throw dbErr("setOverride.validateCategory", cErr);
        if (!cData) {
          throw new CatalogueManagerError(
            422, "INVALID_CATEGORY",
            `Category not found: ${String(input.value)}`,
          );
        }
        if (cData.active === false) {
          throw new CatalogueManagerError(
            422, "INACTIVE_CATEGORY",
            `Category is inactive: ${String(input.value)}`,
          );
        }
      }
      return callSetOverride(productId, input.fieldName, input.value, actor);
    },

    async clearOverride(
      productId: string,
      fieldName: string,
      actor: CatalogueManagerActorRef,
    ): Promise<boolean> {
      const { data, error } = await supabase.rpc("mp_clear_field_override", {
        p_product_id: productId,
        p_field_name: fieldName,
        p_actor_id: actor.id,
        p_actor_username: actor.username ?? null,
      });
      if (error) throw dbErr("clearOverride", error);
      return data === true;
    },

    async bulkPublish(
      input: BulkPublishInput,
      actor: CatalogueManagerActorRef,
    ): Promise<number> {
      let n = 0;
      for (const productId of input.productIds) {
        try {
          await callSetOverride(productId, "public_visible", input.publicVisible, actor);
          n += 1;
        } catch (err) {
          if (err instanceof CatalogueManagerError && err.status === 404) continue;
          throw err;
        }
      }
      return n;
    },

    async bulkCategory(
      input: BulkCategoryInput,
      actor: CatalogueManagerActorRef,
    ): Promise<number> {
      // Validate category exists AND is active
      const { data: catData, error: catErr } = await supabase
        .from("mp_categories")
        .select("id, active")
        .eq("id", input.categoryId)
        .maybeSingle();
      if (catErr) throw dbErr("bulkCategory.validateCategory", catErr);
      if (!catData) {
        throw new CatalogueManagerError(422, "INVALID_CATEGORY", `Category not found: ${input.categoryId}`);
      }
      if (catData.active === false) {
        throw new CatalogueManagerError(422, "INACTIVE_CATEGORY", `Category is inactive: ${input.categoryId}`);
      }

      let n = 0;
      for (const productId of input.productIds) {
        try {
          // Store ONLY as an override so the supplier/base column is preserved.
          // Clearing the override immediately restores the supplier category.
          await callSetOverride(productId, "category_id", input.categoryId, actor);
          n += 1;
        } catch (err) {
          if (err instanceof CatalogueManagerError && err.status === 404) continue;
          throw err;
        }
      }
      return n;
    },

    async listMedia(productId: string): Promise<CatalogueManagerMediaRow[]> {
      await requireProduct(productId);
      const { data, error } = await supabase
        .from("mp_media")
        .select("id, source_url, sort_order, role, published, source_type, rights_status, manual_control, source_key, supplier_code")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true });
      if (error) throw dbErr("listMedia", error);
      return (data ?? []).map((m) => toMediaRow(m as DbMediaRow, productId));
    },

    async replaceSupplierMedia(
      productId: string,
      images: SupplierMediaInput[],
      supplier: string,
    ): Promise<CatalogueManagerMediaRow[]> {
      await requireProduct(productId);

      // Check media lock via active overrides
      const { data: ovData, error: ovErr } = await supabase
        .from("mp_field_overrides")
        .select("field_name")
        .eq("product_id", productId)
        .eq("active", true)
        .in("field_name", ["primary_image", "gallery_images"]);
      if (ovErr) throw dbErr("replaceSupplierMedia.checkLock", ovErr);

      const locked = (ovData ?? []).length > 0;
      if (locked) {
        return this.listMedia(productId);
      }

      // Try to call mp_ceo_auto_import_sync_product_media RPC if available
      // Get default variant id
      const { data: vData } = await supabase
        .from("mp_product_variants")
        .select("id")
        .eq("product_id", productId)
        .eq("is_default", true)
        .maybeSingle();

      const variantId = vData?.id ?? null;

      if (variantId) {
        const imagePayload = images
          .map((img) => {
            const safe = normalizeSupplierImageUrl(img.url);
            if (!safe) return null;
            return { url: safe, sortOrder: img.sortOrder, sourceKey: img.sourceKey };
          })
          .filter(Boolean);

        const { error: syncErr } = await supabase.rpc(
          "mp_ceo_auto_import_sync_product_media",
          {
            p_product_id: productId,
            p_variant_id: variantId,
            p_supplier: supplier,   // SQL function uses p_supplier, not p_supplier_code
            p_images: JSON.parse(JSON.stringify(imagePayload)),
          },
        );

        if (!syncErr) {
          return this.listMedia(productId);
        }
        // RPC not available — fall through to manual upsert
      }

      // Manual upsert fallback: respect media locks (already checked above)
      const filteredImages = images
        .slice(0, 8)
        .map((img) => ({ ...img, url: normalizeSupplierImageUrl(img.url) }))
        .filter((img): img is typeof img & { url: string } => Boolean(img.url));

      // Get existing media for this product
      const { data: existingData, error: exErr } = await supabase
        .from("mp_media")
        .select("id, source_url, source_type, manual_control, supplier_code")
        .eq("product_id", productId)
        .eq("source_type", "supplier")
        .eq("supplier_code", supplier);
      if (exErr) throw dbErr("replaceSupplierMedia.existing", exErr);

      const keptUrls = new Set(filteredImages.map((i) => i.url));
      const existingRows = (existingData ?? []) as Array<{
        id: string;
        source_url: string | null;
        source_type: string | null;
        manual_control: boolean | null;
        supplier_code: string | null;
      }>;

      // Unpublish supplier rows no longer in the new set
      const toUnpublish = existingRows
        .filter((r) => r.source_url && !keptUrls.has(r.source_url) && !r.manual_control)
        .map((r) => r.id);

      if (toUnpublish.length > 0) {
        const { error: upErr } = await supabase
          .from("mp_media")
          .update({ published: false, updated_at: new Date().toISOString() })
          .in("id", toUnpublish);
        if (upErr) throw dbErr("replaceSupplierMedia.unpublish", upErr);
      }

      // Upsert new images
      for (const img of filteredImages) {
        // Use deterministic id (mirrors SQL function) so ON CONFLICT targets
        // the primary key — partial unique indexes cannot be used for upsert.
        const { error: upsErr } = await supabase
          .from("mp_media")
          .upsert(
            {
              id: mediaRowId(productId, img.url),
              product_id: productId,
              source_url: img.url,
              sort_order: Math.max(0, Math.min(7, img.sortOrder || 0)),
              role: (img.sortOrder || 0) === 0 ? "thumbnail" : "gallery",
              published: true,
              source_type: "supplier",
              rights_status: "supplier_approved",
              manual_control: false,
              source_key: img.sourceKey ?? null,
              supplier_code: supplier,
            },
            { onConflict: "id" },
          );
        if (upsErr) throw dbErr("replaceSupplierMedia.upsert", upsErr);
      }

      return this.listMedia(productId);
    },

    async setManualPrimaryImage(
      productId: string,
      url: string,
      actor: CatalogueManagerActorRef,
    ): Promise<CatalogueManagerMediaRow> {
      await requireProduct(productId);

      // Validate URL via own image policy
      const { normalizeOwnImageUrl } = await import("./imagePolicy.ts");
      const safe = normalizeOwnImageUrl(url);
      if (!safe) {
        throw new CatalogueManagerError(
          400,
          "VALIDATION_ERROR",
          "url must be an allowlisted own/supabase-storage https image URL.",
        );
      }

      // Use deterministic id so ON CONFLICT targets the primary key.
      // (The partial unique index on (product_id, source_url) cannot be used
      // for upsert without a WHERE predicate matching the index's condition.)
      const mediaInsert = {
        id: mediaRowId(productId, safe),
        product_id: productId,
        source_url: safe,
        sort_order: 0,
        role: "thumbnail",
        published: true,
        source_type: "own",
        rights_status: "own",
        manual_control: true,
        source_key: null,
        supplier_code: null,
      };

      const { data: insertedData, error: insertErr } = await supabase
        .from("mp_media")
        .upsert(mediaInsert, { onConflict: "id" })
        .select("id, source_url, sort_order, role, published, source_type, rights_status, manual_control, source_key, supplier_code")
        .maybeSingle();

      if (insertErr) throw dbErr("setManualPrimaryImage.upsert", insertErr);

      // Set primary_image override
      await callSetOverride(productId, "primary_image", safe, actor);

      if (!insertedData) {
        // Fetch the row we just upserted
        const { data: fetchedData, error: fetchErr } = await supabase
          .from("mp_media")
          .select("id, source_url, sort_order, role, published, source_type, rights_status, manual_control, source_key, supplier_code")
          .eq("product_id", productId)
          .eq("source_url", safe)
          .maybeSingle();
        if (fetchErr || !fetchedData) throw dbErr("setManualPrimaryImage.fetch", fetchErr);
        return toMediaRow(fetchedData as DbMediaRow, productId);
      }

      return toMediaRow(insertedData as DbMediaRow, productId);
    },

    async listAudit(productId: string): Promise<CatalogueManagerAuditEvent[]> {
      const { data, error } = await supabase
        .from("mp_audit_events")
        .select("id, actor_scope, action, entity_type, entity_id, payload, created_at")
        .or(`entity_id.eq.${productId}`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw dbErr("listAudit", error);
      return (data ?? []).map(
        (r): CatalogueManagerAuditEvent => ({
          id: (r as DbAuditRow).id,
          actorScope: (r as DbAuditRow).actor_scope,
          action: (r as DbAuditRow).action,
          entityType: (r as DbAuditRow).entity_type,
          entityId: (r as DbAuditRow).entity_id ?? null,
          payload: ((r as DbAuditRow).payload ?? {}) as Record<string, unknown>,
          createdAt: (r as DbAuditRow).created_at,
        }),
      );
    },

    async recordReject(entry: RejectLedgerEntry): Promise<void> {
      const { error } = await supabase.rpc("mp_record_import_reject", {
        p_run_id: entry.runId,
        p_supplier: entry.supplier,
        p_reason: entry.reason,
        p_source_key: entry.sourceKey ?? null,
        p_supplier_product_id: entry.supplierProductId ?? null,
        p_canonical_url: entry.canonicalUrl ?? null,
        p_title: entry.title ?? null,
        p_identity_key: entry.identityKey ?? null,
        p_stage: entry.stage,
        p_detail: entry.detail ?? {},
      });
      if (error) throw dbErr("recordReject", error);
    },

    async reconciliation(input: ReconciliationInput = {}): Promise<ReconciliationCounts> {
      const { data, error } = await supabase.rpc("mp_catalogue_reconciliation_counts");
      if (error) throw dbErr("reconciliation", error);
      const counts = (data ?? {}) as Record<string, unknown>;
      return {
        discoveredProducts: input.discoveredProducts ?? null,
        normalizedAcceptedObservations: input.normalizedAcceptedObservations ?? null,
        excludedByReason: (input.excludedByReason ?? {}) as Record<string, number>,
        acceptedListings: input.acceptedListings ?? null,
        rejectLedgerRows: Number(counts.rejectLedgerRows) || 0,
        crmProducts: Number(counts.crmProducts) || 0,
        productsWithMedia: Number(counts.productsWithMedia) || 0,
        productsWithoutMedia: Number(counts.productsWithoutMedia) || 0,
        legacyUnreconciledProducts: Number(counts.legacyUnreconciledProducts) || 0,
        metricNotes: (counts.metricNotes as Record<string, string>) ?? {
          crmProducts: "Unique rows in mp_products.",
          productsWithMedia: "Products with published non-receipt media.",
          rejectLedgerRows: "mp_import_reject_ledger rows.",
          legacyUnreconciledProducts: "Products with null last_supplier_sync_at.",
        },
      };
    },
  };
}
