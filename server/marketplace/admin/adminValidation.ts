/**
 * Strict positive allowlists for WS2 admin product/variant payloads.
 * Unknown and forbidden fields are rejected (never silently stripped).
 */
import { isValidCatalogueSlug } from "../catalogue/catalogueValidation.ts";
import {
  AdminProductError,
  type AdminCreateProductInput,
  type AdminCreateVariantInput,
  type AdminPatchProductInput,
  type AdminPatchVariantInput,
  type AdminProductListFilters,
} from "./adminTypes.ts";

const POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const FORBIDDEN_FIELD_KEYS = new Set([
  "display_from_price",
  "displayFromPrice",
  "display_price_state",
  "displayPriceState",
  "website_price",
  "websitePrice",
  "website_price_state",
  "websitePriceState",
  "website_price_source",
  "websitePriceSource",
  "price_published_at",
  "pricePublishedAt",
  "stock_status",
  "stockStatus",
  "supplier_public_price",
  "supplierPublicPrice",
  "actual_purchase_cost",
  "actualPurchaseCost",
  "profit",
  "margin",
  "delivery_charge",
  "deliveryCharge",
  "delivery_fee",
  "deliveryFee",
  "priceOverride",
  "price_override",
  "price_overrides",
  "priceOverrides",
  "supplierObservation",
  "supplier_observation",
  "supplierMapping",
  "supplier_mapping",
  "id",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "approved_by",
  "approvedBy",
  "approved_at",
  "approvedAt",
  "actor",
  "role",
  "permissions",
  "media",
  "storagePath",
  "storage_path",
  "product_id",
  "productId",
  "variant_id",
  "variantId",
  "brand_id",
  "category_id",
]);

const PRODUCT_CREATE_KEYS = new Set([
  "brandId",
  "categoryId",
  "title",
  "slug",
  "description",
  "tags",
  "active",
  "featured",
  "defaultVariant",
]);

const PRODUCT_PATCH_KEYS = new Set([
  "brandId",
  "categoryId",
  "title",
  "description",
  "tags",
  "active",
  "featured",
]);

const VARIANT_CREATE_KEYS = new Set([
  "sku",
  "title",
  "isDefault",
  "isPriceable",
  "active",
]);

const VARIANT_PATCH_KEYS = new Set([
  "sku",
  "title",
  "isDefault",
  "isPriceable",
  "active",
]);

const DEFAULT_VARIANT_CREATE_KEYS = new Set([
  "sku",
  "title",
  "isDefault",
  "isPriceable",
  "active",
]);

const SKU_RE = /^[A-Z0-9]+(?:[_-][A-Z0-9]+)*$/;
const MAX_SKU_LEN = 80;
const MAX_TITLE_LEN = 200;
const MAX_DESCRIPTION_LEN = 5000;
const MAX_TAGS = 40;
const MAX_TAG_LEN = 64;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively ensure every object key is in the allowlist (or nested allow handlers). */
export function assertAllowlistedObject(
  value: unknown,
  allowed: Set<string>,
  path = "",
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      path ? `Invalid object at ${path}.` : "Request body must be an object.",
    );
  }
  for (const key of Object.keys(value)) {
    if (POLLUTION_KEYS.has(key)) {
      throw new AdminProductError(
        "UNKNOWN_FIELD",
        `Unexpected field: ${path ? `${path}.` : ""}${key}`,
      );
    }
    if (FORBIDDEN_FIELD_KEYS.has(key)) {
      throw new AdminProductError(
        "FORBIDDEN_FIELD",
        `Field not allowed: ${path ? `${path}.` : ""}${key}`,
      );
    }
    if (!allowed.has(key)) {
      throw new AdminProductError(
        "UNKNOWN_FIELD",
        `Unexpected field: ${path ? `${path}.` : ""}${key}`,
      );
    }
  }
}

export function normalizeSlug(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeSku(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      `${field} must be a string.`,
    );
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      `${field} is required.`,
    );
  }
  return trimmed;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      `${field} must be a boolean.`,
    );
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  const v = optionalBoolean(value, field);
  if (v === undefined) {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      `${field} is required.`,
    );
  }
  return v;
}

function parseTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      "tags must be an array of strings.",
    );
  }
  if (value.length > MAX_TAGS) {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      `tags cannot exceed ${MAX_TAGS} entries.`,
    );
  }
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new AdminProductError(
        "VALIDATION_ERROR",
        "tags must be an array of strings.",
      );
    }
    const tag = item.trim();
    if (!tag || tag.length > MAX_TAG_LEN) {
      throw new AdminProductError(
        "VALIDATION_ERROR",
        "Each tag must be a non-empty string within length limits.",
      );
    }
    tags.push(tag);
  }
  return tags;
}

function parseDefaultVariant(raw: unknown): AdminCreateProductInput["defaultVariant"] {
  assertAllowlistedObject(raw, DEFAULT_VARIANT_CREATE_KEYS, "defaultVariant");
  const sku = normalizeSku(requireString(raw.sku, "defaultVariant.sku"));
  if (!SKU_RE.test(sku) || sku.length > MAX_SKU_LEN) {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      "defaultVariant.sku format is invalid.",
    );
  }
  const title = requireString(raw.title, "defaultVariant.title");
  if (title.length > MAX_TITLE_LEN) {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      "defaultVariant.title is too long.",
    );
  }
  if (raw.isDefault !== true) {
    throw new AdminProductError(
      "DEFAULT_VARIANT_REQUIRED",
      "defaultVariant.isDefault must be true on create.",
    );
  }
  const isPriceable = requireBoolean(
    raw.isPriceable,
    "defaultVariant.isPriceable",
  );
  const active = requireBoolean(raw.active, "defaultVariant.active");
  if (!active) {
    throw new AdminProductError(
      "DEFAULT_VARIANT_REQUIRED",
      "Initial default variant must be active.",
    );
  }
  return {
    sku,
    title,
    isDefault: true,
    isPriceable,
    active: true,
  };
}

export function parseCreateProductBody(body: unknown): AdminCreateProductInput {
  assertAllowlistedObject(body, PRODUCT_CREATE_KEYS);
  const brandId = requireString(body.brandId, "brandId");
  const categoryId = requireString(body.categoryId, "categoryId");
  const title = requireString(body.title, "title");
  if (title.length > MAX_TITLE_LEN) {
    throw new AdminProductError("VALIDATION_ERROR", "title is too long.");
  }
  const slug = normalizeSlug(requireString(body.slug, "slug"));
  if (!isValidCatalogueSlug(slug)) {
    throw new AdminProductError("VALIDATION_ERROR", "slug format is invalid.");
  }
  const description =
    body.description === undefined
      ? ""
      : typeof body.description === "string"
        ? body.description.trim()
        : (() => {
            throw new AdminProductError(
              "VALIDATION_ERROR",
              "description must be a string.",
            );
          })();
  if (description.length > MAX_DESCRIPTION_LEN) {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      "description is too long.",
    );
  }
  const tags = parseTags(body.tags);
  const active = body.active === undefined ? true : requireBoolean(body.active, "active");
  const featured =
    body.featured === undefined
      ? false
      : requireBoolean(body.featured, "featured");
  if (body.defaultVariant === undefined) {
    throw new AdminProductError(
      "DEFAULT_VARIANT_REQUIRED",
      "defaultVariant is required.",
    );
  }
  const defaultVariant = parseDefaultVariant(body.defaultVariant);
  return {
    brandId,
    categoryId,
    title,
    slug,
    description,
    tags,
    active,
    featured,
    defaultVariant,
  };
}

export function parsePatchProductBody(body: unknown): AdminPatchProductInput {
  // Slug is immutable in WS2 — reject explicitly even when value matches current.
  if (isPlainObject(body) && Object.prototype.hasOwnProperty.call(body, "slug")) {
    throw new AdminProductError(
      "FORBIDDEN_FIELD",
      "Field not allowed: slug",
    );
  }
  assertAllowlistedObject(body, PRODUCT_PATCH_KEYS);
  const patch: AdminPatchProductInput = {};
  if (body.brandId !== undefined) {
    patch.brandId = requireString(body.brandId, "brandId");
  }
  if (body.categoryId !== undefined) {
    patch.categoryId = requireString(body.categoryId, "categoryId");
  }
  if (body.title !== undefined) {
    const title = requireString(body.title, "title");
    if (title.length > MAX_TITLE_LEN) {
      throw new AdminProductError("VALIDATION_ERROR", "title is too long.");
    }
    patch.title = title;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      throw new AdminProductError(
        "VALIDATION_ERROR",
        "description must be a string.",
      );
    }
    const description = body.description.trim();
    if (description.length > MAX_DESCRIPTION_LEN) {
      throw new AdminProductError(
        "VALIDATION_ERROR",
        "description is too long.",
      );
    }
    patch.description = description;
  }
  if (body.tags !== undefined) {
    patch.tags = parseTags(body.tags);
  }
  if (body.active !== undefined) {
    patch.active = requireBoolean(body.active, "active");
  }
  if (body.featured !== undefined) {
    patch.featured = requireBoolean(body.featured, "featured");
  }
  if (Object.keys(patch).length === 0) {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      "Patch body must include at least one allowed field.",
    );
  }
  return patch;
}

export function parseCreateVariantBody(body: unknown): AdminCreateVariantInput {
  assertAllowlistedObject(body, VARIANT_CREATE_KEYS);
  const sku = normalizeSku(requireString(body.sku, "sku"));
  if (!SKU_RE.test(sku) || sku.length > MAX_SKU_LEN) {
    throw new AdminProductError("VALIDATION_ERROR", "sku format is invalid.");
  }
  const title = requireString(body.title, "title");
  if (title.length > MAX_TITLE_LEN) {
    throw new AdminProductError("VALIDATION_ERROR", "title is too long.");
  }
  return {
    sku,
    title,
    isDefault: requireBoolean(body.isDefault, "isDefault"),
    isPriceable: requireBoolean(body.isPriceable, "isPriceable"),
    active: requireBoolean(body.active, "active"),
  };
}

export function parsePatchVariantBody(body: unknown): AdminPatchVariantInput {
  assertAllowlistedObject(body, VARIANT_PATCH_KEYS);
  const patch: AdminPatchVariantInput = {};
  if (body.sku !== undefined) {
    const sku = normalizeSku(requireString(body.sku, "sku"));
    if (!SKU_RE.test(sku) || sku.length > MAX_SKU_LEN) {
      throw new AdminProductError("VALIDATION_ERROR", "sku format is invalid.");
    }
    patch.sku = sku;
  }
  if (body.title !== undefined) {
    const title = requireString(body.title, "title");
    if (title.length > MAX_TITLE_LEN) {
      throw new AdminProductError("VALIDATION_ERROR", "title is too long.");
    }
    patch.title = title;
  }
  if (body.isDefault !== undefined) {
    patch.isDefault = requireBoolean(body.isDefault, "isDefault");
  }
  if (body.isPriceable !== undefined) {
    patch.isPriceable = requireBoolean(body.isPriceable, "isPriceable");
  }
  if (body.active !== undefined) {
    patch.active = requireBoolean(body.active, "active");
  }
  if (Object.keys(patch).length === 0) {
    throw new AdminProductError(
      "VALIDATION_ERROR",
      "Patch body must include at least one allowed field.",
    );
  }
  return patch;
}

export function parseProductListQuery(
  query: Record<string, unknown>,
): AdminProductListFilters {
  const filters: AdminProductListFilters = { limit: 50, offset: 0 };
  if (query.search !== undefined && query.search !== "") {
    if (typeof query.search !== "string") {
      throw new AdminProductError(
        "VALIDATION_ERROR",
        "search must be a string.",
      );
    }
    const search = query.search.trim();
    if (search.length > 120) {
      throw new AdminProductError("VALIDATION_ERROR", "search is too long.");
    }
    if (search) filters.search = search;
  }
  if (query.brandId !== undefined && query.brandId !== "") {
    filters.brandId = requireString(query.brandId, "brandId");
  }
  if (query.categoryId !== undefined && query.categoryId !== "") {
    filters.categoryId = requireString(query.categoryId, "categoryId");
  }
  if (query.active !== undefined && query.active !== "") {
    const raw = String(query.active).trim().toLowerCase();
    if (raw === "true" || raw === "1") filters.active = true;
    else if (raw === "false" || raw === "0") filters.active = false;
    else {
      throw new AdminProductError(
        "VALIDATION_ERROR",
        "active filter must be true or false.",
      );
    }
  }
  if (query.limit !== undefined && query.limit !== "") {
    const n = Number.parseInt(String(query.limit), 10);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      throw new AdminProductError(
        "VALIDATION_ERROR",
        "limit must be an integer between 1 and 100.",
      );
    }
    filters.limit = n;
  }
  if (query.offset !== undefined && query.offset !== "") {
    const n = Number.parseInt(String(query.offset), 10);
    if (!Number.isFinite(n) || n < 0 || n > 100_000) {
      throw new AdminProductError(
        "VALIDATION_ERROR",
        "offset must be a non-negative integer.",
      );
    }
    filters.offset = n;
  }
  // Reject unexpected query keys
  const allowedQuery = new Set([
    "search",
    "brandId",
    "categoryId",
    "active",
    "limit",
    "offset",
  ]);
  for (const key of Object.keys(query)) {
    if (!allowedQuery.has(key)) {
      if (FORBIDDEN_FIELD_KEYS.has(key) || POLLUTION_KEYS.has(key)) {
        throw new AdminProductError(
          FORBIDDEN_FIELD_KEYS.has(key) ? "FORBIDDEN_FIELD" : "UNKNOWN_FIELD",
          `Field not allowed: ${key}`,
        );
      }
      throw new AdminProductError("UNKNOWN_FIELD", `Unexpected field: ${key}`);
    }
  }
  return filters;
}

/** Exported for tests — proves recursive forbidden detection. */
export function assertNoForbiddenKeysDeep(value: unknown, path = ""): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) =>
      assertNoForbiddenKeysDeep(item, `${path}[${i}]`),
    );
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const full = path ? `${path}.${key}` : key;
    if (POLLUTION_KEYS.has(key)) {
      throw new AdminProductError("UNKNOWN_FIELD", `Unexpected field: ${full}`);
    }
    if (FORBIDDEN_FIELD_KEYS.has(key)) {
      throw new AdminProductError(
        "FORBIDDEN_FIELD",
        `Field not allowed: ${full}`,
      );
    }
    assertNoForbiddenKeysDeep(child, full);
  }
}
