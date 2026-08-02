/**
 * Strict allowlists for Catalogue Manager Super-Admin payloads.
 */
import { normalizeSupplierImageUrl } from "../suppliers/safeHttp.ts";
import { isCatalogueOverrideField } from "./fieldOverrides.ts";
import {
  CatalogueManagerError,
  type BulkCategoryInput,
  type BulkPublishInput,
  type CatalogueManagerListFilters,
  type CatalogueManagerPatchInput,
  type SetOverrideInput,
  type SupplierMediaInput,
} from "./catalogueManagerTypes.ts";

const POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const PATCH_KEYS = new Set([
  "title",
  "description",
  "shortDescription",
  "model",
  "brandId",
  "categoryId",
  "seoTitle",
  "seoDescription",
  "datasheetUrl",
  "warranty",
  "specifications",
  "tags",
  "active",
  "publicVisible",
  "featured",
  "compareAtPrice",
]);

function assertPlainObject(body: unknown, label: string): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", `${label} must be an object.`);
  }
  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (POLLUTION_KEYS.has(key)) {
      throw new CatalogueManagerError(400, "VALIDATION_ERROR", "Invalid payload key.");
    }
  }
  return obj;
}

function assertKnownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new CatalogueManagerError(
        400,
        "VALIDATION_ERROR",
        `Unknown or forbidden field: ${key}`,
      );
    }
  }
}

function asOptionalString(
  value: unknown,
  field: string,
  { allowNull = false, max = 2000 } = {},
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) {
    if (!allowNull) {
      throw new CatalogueManagerError(400, "VALIDATION_ERROR", `${field} cannot be null.`);
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed && !allowNull) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", `${field} is required.`);
  }
  if (trimmed.length > max) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", `${field} is too long.`);
  }
  return trimmed || null;
}

function asOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", `${field} must be a boolean.`);
  }
  return value;
}

function parseBoolQuery(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = String(raw).toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  throw new CatalogueManagerError(400, "VALIDATION_ERROR", "Invalid boolean query param.");
}

function parseIntQuery(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", "Invalid pagination param.");
  }
  return Math.min(n, max);
}

export function parseProductListQuery(
  query: Record<string, unknown>,
): CatalogueManagerListFilters {
  return {
    limit: Math.max(1, parseIntQuery(query.limit, 50, 200)),
    offset: parseIntQuery(query.offset, 0, 100_000),
    q: asOptionalString(query.q, "q", { allowNull: false, max: 200 }) ?? undefined,
    brandId: asOptionalString(query.brandId, "brandId", { max: 80 }) ?? undefined,
    categoryId:
      asOptionalString(query.categoryId, "categoryId", { max: 80 }) ?? undefined,
    supplier: asOptionalString(query.supplier, "supplier", { max: 40 }) ?? undefined,
    stockStatus:
      asOptionalString(query.stockStatus, "stockStatus", { max: 40 }) ?? undefined,
    active: parseBoolQuery(query.active),
    publicVisible: parseBoolQuery(query.publicVisible),
    featured: parseBoolQuery(query.featured),
  };
}

export function parsePatchProductBody(body: unknown): CatalogueManagerPatchInput {
  const obj = assertPlainObject(body, "body");
  assertKnownKeys(obj, PATCH_KEYS);
  const out: CatalogueManagerPatchInput = {};
  const title = asOptionalString(obj.title, "title", { max: 300 });
  if (title !== undefined) out.title = title!;
  const description = asOptionalString(obj.description, "description", { max: 20_000 });
  if (description !== undefined) out.description = description!;
  if (obj.shortDescription !== undefined) {
    out.shortDescription = asOptionalString(obj.shortDescription, "shortDescription", {
      allowNull: true,
      max: 2000,
    })!;
  }
  if (obj.model !== undefined) {
    out.model = asOptionalString(obj.model, "model", { allowNull: true, max: 200 })!;
  }
  const brandId = asOptionalString(obj.brandId, "brandId", { max: 80 });
  if (brandId !== undefined) out.brandId = brandId!;
  const categoryId = asOptionalString(obj.categoryId, "categoryId", { max: 80 });
  if (categoryId !== undefined) out.categoryId = categoryId!;
  if (obj.seoTitle !== undefined) {
    out.seoTitle = asOptionalString(obj.seoTitle, "seoTitle", {
      allowNull: true,
      max: 300,
    })!;
  }
  if (obj.seoDescription !== undefined) {
    out.seoDescription = asOptionalString(obj.seoDescription, "seoDescription", {
      allowNull: true,
      max: 2000,
    })!;
  }
  if (obj.datasheetUrl !== undefined) {
    const url = asOptionalString(obj.datasheetUrl, "datasheetUrl", {
      allowNull: true,
      max: 2000,
    });
    if (url && !/^https:\/\//i.test(url)) {
      throw new CatalogueManagerError(
        400,
        "VALIDATION_ERROR",
        "datasheetUrl must be https.",
      );
    }
    out.datasheetUrl = url!;
  }
  if (obj.warranty !== undefined) {
    out.warranty = asOptionalString(obj.warranty, "warranty", {
      allowNull: true,
      max: 500,
    })!;
  }
  if (obj.specifications !== undefined) {
    if (
      !obj.specifications ||
      typeof obj.specifications !== "object" ||
      Array.isArray(obj.specifications)
    ) {
      throw new CatalogueManagerError(
        400,
        "VALIDATION_ERROR",
        "specifications must be an object.",
      );
    }
    out.specifications = obj.specifications as Record<string, unknown>;
  }
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === "string")) {
      throw new CatalogueManagerError(400, "VALIDATION_ERROR", "tags must be string[].");
    }
    out.tags = obj.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 40);
  }
  const active = asOptionalBoolean(obj.active, "active");
  if (active !== undefined) out.active = active;
  const publicVisible = asOptionalBoolean(obj.publicVisible, "publicVisible");
  if (publicVisible !== undefined) out.publicVisible = publicVisible;
  const featured = asOptionalBoolean(obj.featured, "featured");
  if (featured !== undefined) out.featured = featured;
  if (obj.compareAtPrice !== undefined) {
    if (obj.compareAtPrice === null) {
      out.compareAtPrice = null;
    } else {
      const n = Number(obj.compareAtPrice);
      if (!Number.isFinite(n) || n <= 0) {
        throw new CatalogueManagerError(
          400,
          "VALIDATION_ERROR",
          "compareAtPrice must be a positive number.",
        );
      }
      out.compareAtPrice = n;
    }
  }
  if (Object.keys(out).length === 0) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", "No patch fields provided.");
  }
  return out;
}

export function parseSetOverrideBody(body: unknown): SetOverrideInput {
  const obj = assertPlainObject(body, "body");
  assertKnownKeys(obj, new Set(["fieldName", "value"]));
  const fieldName = asOptionalString(obj.fieldName, "fieldName", { max: 80 });
  if (!fieldName || !isCatalogueOverrideField(fieldName)) {
    throw new CatalogueManagerError(
      400,
      "VALIDATION_ERROR",
      "Unsupported override fieldName.",
    );
  }
  if (!("value" in obj)) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", "value is required.");
  }
  if (fieldName === "primary_image" || fieldName === "gallery_images") {
    if (fieldName === "primary_image") {
      if (typeof obj.value !== "string" || !normalizeSupplierImageUrl(obj.value)) {
        throw new CatalogueManagerError(
          400,
          "VALIDATION_ERROR",
          "primary_image override must be an allowlisted https image URL.",
        );
      }
    } else if (!Array.isArray(obj.value)) {
      throw new CatalogueManagerError(
        400,
        "VALIDATION_ERROR",
        "gallery_images override must be an array of URLs.",
      );
    } else {
      for (const u of obj.value) {
        if (typeof u !== "string" || !normalizeSupplierImageUrl(u)) {
          throw new CatalogueManagerError(
            400,
            "VALIDATION_ERROR",
            "gallery_images contains an unsafe URL.",
          );
        }
      }
    }
  }
  return { fieldName, value: obj.value };
}

export function parseBulkPublishBody(body: unknown): BulkPublishInput {
  const obj = assertPlainObject(body, "body");
  assertKnownKeys(obj, new Set(["productIds", "publicVisible"]));
  if (!Array.isArray(obj.productIds) || obj.productIds.length === 0) {
    throw new CatalogueManagerError(
      400,
      "VALIDATION_ERROR",
      "productIds must be a non-empty array.",
    );
  }
  if (obj.productIds.length > 200) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", "productIds limit is 200.");
  }
  if (!obj.productIds.every((id) => typeof id === "string" && id.trim())) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", "productIds must be strings.");
  }
  if (typeof obj.publicVisible !== "boolean") {
    throw new CatalogueManagerError(
      400,
      "VALIDATION_ERROR",
      "publicVisible must be a boolean.",
    );
  }
  return {
    productIds: obj.productIds.map((id) => String(id).trim()),
    publicVisible: obj.publicVisible,
  };
}

export function parseBulkCategoryBody(body: unknown): BulkCategoryInput {
  const obj = assertPlainObject(body, "body");
  assertKnownKeys(obj, new Set(["productIds", "categoryId"]));
  if (!Array.isArray(obj.productIds) || obj.productIds.length === 0) {
    throw new CatalogueManagerError(
      400,
      "VALIDATION_ERROR",
      "productIds must be a non-empty array.",
    );
  }
  const categoryId = asOptionalString(obj.categoryId, "categoryId", { max: 80 });
  if (!categoryId) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", "categoryId is required.");
  }
  return {
    productIds: obj.productIds.map((id) => String(id).trim()),
    categoryId,
  };
}

export function parseSupplierMediaBody(body: unknown): {
  images: SupplierMediaInput[];
  supplier: string;
} {
  const obj = assertPlainObject(body, "body");
  assertKnownKeys(obj, new Set(["images", "supplier"]));
  const supplier = asOptionalString(obj.supplier, "supplier", { max: 40 });
  if (!supplier || (supplier !== "kamal" && supplier !== "alladin")) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", "supplier must be kamal|alladin.");
  }
  if (!Array.isArray(obj.images)) {
    throw new CatalogueManagerError(400, "VALIDATION_ERROR", "images must be an array.");
  }
  const images: SupplierMediaInput[] = [];
  for (const raw of obj.images.slice(0, 8)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : "";
    const sortOrder = Number(row.sortOrder) || 0;
    const sourceKey =
      typeof row.sourceKey === "string" ? row.sourceKey.trim() || undefined : undefined;
    images.push({ url, sortOrder, sourceKey });
  }
  return { images, supplier };
}

export function parseManualPrimaryImageBody(body: unknown): string {
  const obj = assertPlainObject(body, "body");
  assertKnownKeys(obj, new Set(["url"]));
  const url = asOptionalString(obj.url, "url", { max: 2000 });
  if (!url || !normalizeSupplierImageUrl(url)) {
    throw new CatalogueManagerError(
      400,
      "VALIDATION_ERROR",
      "url must be an allowlisted https image URL.",
    );
  }
  return url;
}
