/**
 * Field-level manual override resolution for Catalogue Manager.
 * Website price authority remains mp_price_overrides (not this module).
 */

export const CATALOGUE_OVERRIDE_FIELDS = [
  "title",
  "description",
  "short_description",
  "brand_id",
  "category_id",
  "model",
  "specifications",
  "warranty",
  "datasheet_url",
  "seo_title",
  "seo_description",
  "stock_status",
  "primary_image",
  "gallery_images",
  "public_visible",
  "featured",
] as const;

export type CatalogueOverrideField = (typeof CATALOGUE_OVERRIDE_FIELDS)[number];

export type FieldOverrideRecord = {
  fieldName: string;
  value: unknown;
  active: boolean;
  actorId?: string;
  actorUsername?: string | null;
  createdAt?: string;
  updatedAt?: string;
  clearedAt?: string | null;
};

export type EffectiveSource = "manual" | "supplier" | "fallback";

export type EffectiveValue<T> = {
  value: T;
  source: EffectiveSource;
};

const OVERRIDE_FIELD_SET = new Set<string>(CATALOGUE_OVERRIDE_FIELDS);

export function isCatalogueOverrideField(
  field: string,
): field is CatalogueOverrideField {
  return OVERRIDE_FIELD_SET.has(field);
}

/** Map active overrides by field name (first active wins). */
export function activeOverridesByField(
  overrides: FieldOverrideRecord[],
): Map<string, FieldOverrideRecord> {
  const map = new Map<string, FieldOverrideRecord>();
  for (const o of overrides) {
    if (!o.active) continue;
    if (!map.has(o.fieldName)) map.set(o.fieldName, o);
  }
  return map;
}

/**
 * Effective value: active manual override → supplier value → safe fallback.
 */
export function resolveEffectiveValue<T>(input: {
  field: string;
  supplierValue: T;
  fallback: T;
  overrides: Map<string, FieldOverrideRecord>;
}): EffectiveValue<T> {
  const ov = input.overrides.get(input.field);
  if (ov && ov.active) {
    return { value: ov.value as T, source: "manual" };
  }
  if (input.supplierValue !== undefined && input.supplierValue !== null) {
    return { value: input.supplierValue, source: "supplier" };
  }
  return { value: input.fallback, source: "fallback" };
}

/** True when primary_image or gallery_images has an active override. */
export function isMediaMutationLocked(
  overrides: Map<string, FieldOverrideRecord>,
): boolean {
  return (
    overrides.has("primary_image") || overrides.has("gallery_images")
  );
}
