/**
 * In-memory Catalogue Manager repository for unit tests.
 */
import { createHash } from "node:crypto";
import { normalizeSupplierImageUrl } from "../suppliers/safeHttp.ts";
import { normalizeOwnImageUrl } from "./imagePolicy.ts";
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

export type MemProduct = {
  id: string;
  brandId: string;
  brandName: string;
  categoryId: string;
  categoryName: string;
  title: string;
  slug: string;
  description: string;
  shortDescription: string | null;
  model: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  datasheetUrl: string | null;
  warranty: string | null;
  specifications: Record<string, unknown>;
  tags: string[];
  active: boolean;
  publicVisible: boolean;
  featured: boolean;
  stockStatus: string;
  websitePrice: number | null;
  compareAtPrice: number | null;
  selectedSupplier: string | null;
  sourceUrls: string[];
  identityKey: string | null;
  lastSupplierSyncAt: string | null;
  lastManualEditAt: string | null;
  supplier: {
    title: string;
    description: string;
    shortDescription: string | null;
    model: string | null;
    warranty: string | null;
    datasheetUrl: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    specifications: Record<string, unknown>;
    publicVisible: boolean;
    featured: boolean;
  };
};

type MemReject = RejectLedgerEntry & { id: string; createdAt: string };

/**
 * Shared mutable state that multiple repository instances can reference.
 * Use createMemSharedState() to create and pass to createMemoryCatalogueManagerRepository()
 * in integration tests that need to verify persistence across repo recreation.
 */
export type MemSharedState = {
  products: Map<string, MemProduct>;
  overrides: Map<string, FieldOverrideRecord[]>;
  media: Map<string, CatalogueManagerMediaRow[]>;
  audits: CatalogueManagerAuditEvent[];
  rejects: MemReject[];
};

export function createMemSharedState(): MemSharedState {
  return {
    products: new Map(),
    overrides: new Map(),
    media: new Map(),
    audits: [],
    rejects: [],
  };
}

function mediaId(productId: string, url: string): string {
  const hash = createHash("md5").update(`${productId}|${url}`).digest("hex").slice(0, 24);
  return `mpmedia_${hash}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function auditId(): string {
  return `mpaud_${createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 20)}`;
}

export type CatalogueManagerRepository = {
  seedProduct?(product: MemProduct): void;
  listProducts(filters: CatalogueManagerListFilters): Promise<CatalogueManagerListResult>;
  getProduct(productId: string): Promise<CatalogueManagerProductDetail | null>;
  patchProduct(
    productId: string,
    patch: CatalogueManagerPatchInput,
    actor: CatalogueManagerActorRef,
  ): Promise<CatalogueManagerProductDetail>;
  setOverride(
    productId: string,
    input: SetOverrideInput,
    actor: CatalogueManagerActorRef,
  ): Promise<FieldOverrideRecord>;
  clearOverride(
    productId: string,
    fieldName: string,
    actor: CatalogueManagerActorRef,
  ): Promise<boolean>;
  bulkPublish(
    input: BulkPublishInput,
    actor: CatalogueManagerActorRef,
  ): Promise<number>;
  bulkCategory(
    input: BulkCategoryInput,
    actor: CatalogueManagerActorRef,
  ): Promise<number>;
  listMedia(productId: string): Promise<CatalogueManagerMediaRow[]>;
  replaceSupplierMedia(
    productId: string,
    images: SupplierMediaInput[],
    supplier: string,
  ): Promise<CatalogueManagerMediaRow[]>;
  setManualPrimaryImage(
    productId: string,
    url: string,
    actor: CatalogueManagerActorRef,
  ): Promise<CatalogueManagerMediaRow>;
  listAudit(productId: string): Promise<CatalogueManagerAuditEvent[]>;
  recordReject(entry: RejectLedgerEntry): Promise<void>;
  reconciliation(input?: ReconciliationInput): Promise<ReconciliationCounts>;
};

export function createMemoryCatalogueManagerRepository(
  state?: MemSharedState,
): CatalogueManagerRepository {
  const { products, overrides, media, audits, rejects } =
    state ?? createMemSharedState();

  function requireProduct(productId: string): MemProduct {
    const p = products.get(productId);
    if (!p) {
      throw new CatalogueManagerError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }
    return p;
  }

  function writeAudit(
    actor: CatalogueManagerActorRef | null,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): void {
    audits.push({
      id: auditId(),
      actorScope: actor ? `admin:super:${actor.id}` : "system",
      action,
      entityType,
      entityId,
      payload,
      createdAt: nowIso(),
    });
  }

  function productOverrides(productId: string): FieldOverrideRecord[] {
    return overrides.get(productId) ?? [];
  }

  function primaryImageFor(productId: string): string | null {
    const ovMap = activeOverridesByField(productOverrides(productId));
    const locked = ovMap.get("primary_image");
    if (locked && typeof locked.value === "string") return locked.value;
    const rows = (media.get(productId) ?? [])
      .filter((m) => m.published)
      .sort((a, b) => {
        if (a.role === "thumbnail" && b.role !== "thumbnail") return -1;
        if (b.role === "thumbnail" && a.role !== "thumbnail") return 1;
        return a.sortOrder - b.sortOrder;
      });
    return rows[0]?.sourceUrl ?? null;
  }

  function toSummary(p: MemProduct): CatalogueManagerProductSummary {
    const active = productOverrides(p.id).filter((o) => o.active).map((o) => o.fieldName);
    return {
      id: p.id,
      title: resolveTitle(p).effective,
      slug: p.slug,
      brandId: p.brandId,
      brandName: p.brandName,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      active: p.active,
      publicVisible: resolvePublicVisible(p),
      featured: resolveFeatured(p),
      stockStatus: p.stockStatus,
      websitePrice: p.websitePrice,
      compareAtPrice: p.compareAtPrice,
      selectedSupplier: p.selectedSupplier,
      primaryImage: primaryImageFor(p.id),
      lastSupplierSyncAt: p.lastSupplierSyncAt,
      lastManualEditAt: p.lastManualEditAt,
      overrideFields: active,
    };
  }

  function resolveTitle(p: MemProduct) {
    const ov = activeOverridesByField(productOverrides(p.id));
    const eff = resolveEffectiveValue({
      field: "title",
      supplierValue: p.supplier.title,
      fallback: p.title,
      overrides: ov,
    });
    const manual = ov.get("title");
    return {
      supplier: p.supplier.title,
      manual: manual ? (manual.value as string) : null,
      effective: eff.value,
      source: eff.source,
    };
  }

  function resolveDescription(p: MemProduct) {
    const ov = activeOverridesByField(productOverrides(p.id));
    const eff = resolveEffectiveValue({
      field: "description",
      supplierValue: p.supplier.description,
      fallback: p.description,
      overrides: ov,
    });
    const manual = ov.get("description");
    return {
      supplier: p.supplier.description,
      manual: manual ? (manual.value as string) : null,
      effective: eff.value,
      source: eff.source,
    };
  }

  function resolvePublicVisible(p: MemProduct): boolean {
    const ov = activeOverridesByField(productOverrides(p.id));
    return resolveEffectiveValue({
      field: "public_visible",
      supplierValue: p.supplier.publicVisible,
      fallback: p.publicVisible,
      overrides: ov,
    }).value;
  }

  function resolveFeatured(p: MemProduct): boolean {
    const ov = activeOverridesByField(productOverrides(p.id));
    return resolveEffectiveValue({
      field: "featured",
      supplierValue: p.supplier.featured,
      fallback: p.featured,
      overrides: ov,
    }).value;
  }

  function toDetail(p: MemProduct): CatalogueManagerProductDetail {
    const titleLayered = resolveTitle(p);
    const descriptionLayered = resolveDescription(p);
    const summary = toSummary(p);
    return {
      ...summary,
      title: titleLayered.effective,
      description: descriptionLayered.effective,
      shortDescription: p.shortDescription,
      model: p.model,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      datasheetUrl: p.datasheetUrl,
      warranty: p.warranty,
      specifications: { ...p.specifications },
      tags: [...p.tags],
      sourceUrls: [...p.sourceUrls],
      identityKey: p.identityKey,
      titleLayered,
      descriptionLayered,
      overrides: productOverrides(p.id).map((o) => ({ ...o })),
      media: [...(media.get(p.id) ?? [])],
    };
  }

  return {
    seedProduct(product: MemProduct): void {
      products.set(product.id, {
        ...product,
        specifications: { ...product.specifications },
        tags: [...product.tags],
        sourceUrls: [...product.sourceUrls],
        supplier: { ...product.supplier, specifications: { ...product.supplier.specifications } },
      });
      if (!overrides.has(product.id)) overrides.set(product.id, []);
      if (!media.has(product.id)) media.set(product.id, []);
    },

    async listProducts(filters) {
      let items = [...products.values()].map(toSummary);
      if (filters.q) {
        const q = filters.q.toLowerCase();
        items = items.filter(
          (i) =>
            i.title.toLowerCase().includes(q) ||
            i.slug.toLowerCase().includes(q) ||
            i.brandName.toLowerCase().includes(q),
        );
      }
      if (filters.brandId) items = items.filter((i) => i.brandId === filters.brandId);
      if (filters.categoryId) {
        items = items.filter((i) => i.categoryId === filters.categoryId);
      }
      if (filters.supplier) {
        items = items.filter((i) => i.selectedSupplier === filters.supplier);
      }
      if (filters.stockStatus) {
        items = items.filter((i) => i.stockStatus === filters.stockStatus);
      }
      if (filters.active !== undefined) {
        items = items.filter((i) => i.active === filters.active);
      }
      if (filters.publicVisible !== undefined) {
        items = items.filter((i) => i.publicVisible === filters.publicVisible);
      }
      if (filters.featured !== undefined) {
        items = items.filter((i) => i.featured === filters.featured);
      }
      const total = items.length;
      const page = items.slice(filters.offset, filters.offset + filters.limit);
      return { items: page, total, limit: filters.limit, offset: filters.offset };
    },

    async getProduct(productId) {
      const p = products.get(productId);
      return p ? toDetail(p) : null;
    },

    async patchProduct(productId, patch, actor) {
      const p = requireProduct(productId);
      if (patch.title !== undefined) {
        p.title = patch.title;
        p.supplier.title = patch.title;
      }
      if (patch.description !== undefined) {
        p.description = patch.description;
        p.supplier.description = patch.description;
      }
      if (patch.shortDescription !== undefined) p.shortDescription = patch.shortDescription;
      if (patch.model !== undefined) p.model = patch.model;
      if (patch.brandId !== undefined) p.brandId = patch.brandId;
      if (patch.categoryId !== undefined) p.categoryId = patch.categoryId;
      if (patch.seoTitle !== undefined) p.seoTitle = patch.seoTitle;
      if (patch.seoDescription !== undefined) p.seoDescription = patch.seoDescription;
      if (patch.datasheetUrl !== undefined) p.datasheetUrl = patch.datasheetUrl;
      if (patch.warranty !== undefined) p.warranty = patch.warranty;
      if (patch.specifications !== undefined) p.specifications = { ...patch.specifications };
      if (patch.tags !== undefined) p.tags = [...patch.tags];
      if (patch.active !== undefined) p.active = patch.active;
      if (patch.publicVisible !== undefined) {
        p.publicVisible = patch.publicVisible;
        p.supplier.publicVisible = patch.publicVisible;
      }
      if (patch.featured !== undefined) {
        p.featured = patch.featured;
        p.supplier.featured = patch.featured;
      }
      if (patch.compareAtPrice !== undefined) p.compareAtPrice = patch.compareAtPrice;
      p.lastManualEditAt = nowIso();
      writeAudit(actor, "product.patch", "mp_products", productId, {
        fields: Object.keys(patch),
      });
      return toDetail(p);
    },

    async setOverride(productId, input, actor) {
      requireProduct(productId);
      const list = productOverrides(productId).map((o) =>
        o.fieldName === input.fieldName && o.active
          ? { ...o, active: false, clearedAt: nowIso(), updatedAt: nowIso() }
          : o,
      );
      const record: FieldOverrideRecord = {
        fieldName: input.fieldName,
        value: input.value,
        active: true,
        actorId: actor.id,
        actorUsername: actor.username,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        clearedAt: null,
      };
      list.push(record);
      overrides.set(productId, list);
      const p = requireProduct(productId);
      p.lastManualEditAt = nowIso();
      writeAudit(actor, "field_override.set", "mp_field_overrides", productId, {
        fieldName: input.fieldName,
      });
      return { ...record };
    },

    async clearOverride(productId, fieldName, actor) {
      requireProduct(productId);
      const list = productOverrides(productId);
      let cleared = false;
      overrides.set(
        productId,
        list.map((o) => {
          if (o.fieldName === fieldName && o.active) {
            cleared = true;
            return { ...o, active: false, clearedAt: nowIso(), updatedAt: nowIso() };
          }
          return o;
        }),
      );
      if (cleared) {
        const p = requireProduct(productId);
        p.lastManualEditAt = nowIso();
        writeAudit(actor, "field_override.clear", "mp_field_overrides", productId, {
          fieldName,
        });
      }
      return cleared;
    },

    async bulkPublish(input, actor) {
      let n = 0;
      for (const id of input.productIds) {
        const p = products.get(id);
        if (!p) continue;
        p.publicVisible = input.publicVisible;
        p.supplier.publicVisible = input.publicVisible;
        p.lastManualEditAt = nowIso();
        // Set public_visible override so supplier resync cannot overwrite CEO bulk-hide.
        const list = (overrides.get(id) ?? []).map((o) =>
          o.fieldName === "public_visible" && o.active
            ? { ...o, active: false, clearedAt: nowIso(), updatedAt: nowIso() }
            : o,
        );
        list.push({
          fieldName: "public_visible",
          value: input.publicVisible,
          active: true,
          actorId: actor.id,
          actorUsername: actor.username,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          clearedAt: null,
        });
        overrides.set(id, list);
        n += 1;
      }
      writeAudit(actor, "products.bulk_publish", "mp_products", "bulk", {
        productIds: input.productIds,
        publicVisible: input.publicVisible,
        updated: n,
      });
      return n;
    },

    async bulkCategory(input, actor) {
      let n = 0;
      for (const id of input.productIds) {
        const p = products.get(id);
        if (!p) continue;
        p.categoryId = input.categoryId;
        p.lastManualEditAt = nowIso();
        // Set category_id override so supplier resync cannot overwrite this CEO edit.
        const list = (overrides.get(id) ?? []).map((o) =>
          o.fieldName === "category_id" && o.active
            ? { ...o, active: false, clearedAt: nowIso(), updatedAt: nowIso() }
            : o,
        );
        list.push({
          fieldName: "category_id",
          value: input.categoryId,
          active: true,
          actorId: actor.id,
          actorUsername: actor.username,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          clearedAt: null,
        });
        overrides.set(id, list);
        n += 1;
      }
      writeAudit(actor, "products.bulk_category", "mp_products", "bulk", {
        productIds: input.productIds,
        categoryId: input.categoryId,
        updated: n,
      });
      return n;
    },

    async listMedia(productId) {
      requireProduct(productId);
      return [...(media.get(productId) ?? [])];
    },

    async replaceSupplierMedia(productId, images, supplier) {
      requireProduct(productId);
      const ovMap = activeOverridesByField(productOverrides(productId));
      const existing = media.get(productId) ?? [];
      if (isMediaMutationLocked(ovMap)) {
        return [...existing];
      }

      const keptUrls = new Set<string>();
      const byId = new Map(existing.map((m) => [m.id, m]));

      for (const img of images) {
        const url = normalizeSupplierImageUrl(img.url);
        if (!url) continue;
        keptUrls.add(url);
        const id = mediaId(productId, url);
        const prev = byId.get(id);
        if (prev?.manualControl) continue;
        byId.set(id, {
          id,
          productId,
          sourceUrl: url,
          sortOrder: Math.max(0, Math.min(7, img.sortOrder || 0)),
          role: (img.sortOrder || 0) === 0 ? "thumbnail" : "gallery",
          published: true,
          sourceType: "supplier",
          rightsStatus: "supplier_approved",
          manualControl: false,
          sourceKey: img.sourceKey ?? null,
          supplierCode: supplier,
        });
      }

      const next: CatalogueManagerMediaRow[] = [];
      for (const row of byId.values()) {
        if (row.manualControl || row.sourceType !== "supplier") {
          next.push(row);
          continue;
        }
        if (!keptUrls.has(row.sourceUrl)) {
          next.push({ ...row, published: false });
        } else {
          next.push(row);
        }
      }
      media.set(productId, next);
      return [...next];
    },

    async setManualPrimaryImage(productId, url, actor) {
      requireProduct(productId);
      const safe = normalizeOwnImageUrl(url);
      if (!safe) {
        throw new CatalogueManagerError(
          400,
          "VALIDATION_ERROR",
          "url must be an allowlisted own/supabase-storage https image URL.",
        );
      }
      const id = mediaId(productId, safe);
      const rows = media.get(productId) ?? [];
      const next = rows.map((m) =>
        m.role === "thumbnail" && !m.manualControl ? { ...m, published: false } : m,
      );
      const row: CatalogueManagerMediaRow = {
        id,
        productId,
        sourceUrl: safe,
        sortOrder: 0,
        role: "thumbnail",
        published: true,
        sourceType: "own",
        rightsStatus: "own",
        manualControl: true,
        sourceKey: null,
        supplierCode: null,
      };
      const without = next.filter((m) => m.id !== id);
      without.push(row);
      media.set(productId, without);

      const list = productOverrides(productId).map((o) =>
        o.fieldName === "primary_image" && o.active
          ? { ...o, active: false, clearedAt: nowIso(), updatedAt: nowIso() }
          : o,
      );
      list.push({
        fieldName: "primary_image",
        value: safe,
        active: true,
        actorId: actor.id,
        actorUsername: actor.username,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        clearedAt: null,
      });
      overrides.set(productId, list);
      const p = requireProduct(productId);
      p.lastManualEditAt = nowIso();
      writeAudit(actor, "field_override.set", "mp_field_overrides", productId, {
        fieldName: "primary_image",
      });
      writeAudit(actor, "media.manual_primary", "mp_media", id, { productId, url: safe });
      return row;
    },

    async listAudit(productId) {
      return audits.filter(
        (a) =>
          a.entityId === productId ||
          (a.payload &&
            Array.isArray(a.payload.productIds) &&
            (a.payload.productIds as string[]).includes(productId)),
      );
    },

    async recordReject(entry) {
      rejects.push({
        ...entry,
        id: `mpirej_${rejects.length + 1}`,
        createdAt: nowIso(),
        detail: entry.detail ?? {},
      });
    },

    async reconciliation(input = {}) {
      const crmProducts = products.size;
      const withMedia = [...products.keys()].filter((id) =>
        (media.get(id) ?? []).some((m) => m.published),
      ).length;
      const legacy = [...products.values()].filter((p) => !p.lastSupplierSyncAt).length;
      return {
        discoveredProducts: input.discoveredProducts ?? null,
        normalizedAcceptedObservations: input.normalizedAcceptedObservations ?? null,
        excludedByReason: input.excludedByReason ?? {},
        acceptedListings: input.acceptedListings ?? null,
        rejectLedgerRows: rejects.length,
        crmProducts,
        productsWithMedia: withMedia,
        productsWithoutMedia: Math.max(0, crmProducts - withMedia),
        legacyUnreconciledProducts: legacy,
        metricNotes: {
          crmProducts: "Unique CRM product rows (not variant-level observations).",
          productsWithMedia: "Products with at least one published media row.",
          rejectLedgerRows: "Durable reject ledger row count.",
          legacyUnreconciledProducts: "Products with null lastSupplierSyncAt.",
        },
      };
    },
  };
}
