const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LEN = 120;

export function isValidCatalogueSlug(value: string): boolean {
  const slug = String(value || "").trim();
  if (!slug || slug.length > MAX_SLUG_LEN) return false;
  return SLUG_RE.test(slug);
}

export function parseFeaturedFilter(raw: unknown): boolean | undefined | "invalid" {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = String(raw).trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return "invalid";
}

export function parseOptionalSlugFilter(
  raw: unknown,
  field: "category" | "brand",
): string | undefined | "invalid" {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = String(raw).trim().toLowerCase();
  if (!isValidCatalogueSlug(value)) return "invalid";
  return value;
}
