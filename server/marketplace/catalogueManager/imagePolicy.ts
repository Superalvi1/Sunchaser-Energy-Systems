/**
 * Image URL allowlist policy for different source types in the marketplace.
 *
 * Supplier: SUPPLIER_IMAGE_HOSTS (cdn.shopify.com, kamalsolar.pk, alladin.pk, etc.)
 *   — same allowlist used by supplier scraper / safeHttp.ts
 *
 * Own: hosts from env MARKETPLACE_OWN_IMAGE_HOSTS (comma-separated)
 *   PLUS Supabase Storage public paths — but ONLY when:
 *     - hostname ends with ".supabase.co"
 *     - pathname contains "/storage/v1/object/public/"
 *   This rule does NOT allow arbitrary supabase.co URLs; only the public storage
 *   CDN path is trusted. Never allow arbitrary https from *.supabase.co.
 *
 * Licensed / Manufacturer: hosts from env MARKETPLACE_LICENSED_IMAGE_HOSTS
 *   (comma-separated), empty by default.
 */
import {
  SUPPLIER_IMAGE_HOSTS,
  isAllowedSupplierImageUrl,
  normalizeSupplierImageUrl,
} from "../suppliers/safeHttp.ts";

export { SUPPLIER_IMAGE_HOSTS };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseHostList(raw: string | undefined): Set<string> {
  const hosts = new Set<string>();
  if (!raw) return hosts;
  for (const h of raw.split(",")) {
    const trimmed = h.trim().toLowerCase();
    if (trimmed) hosts.add(trimmed);
  }
  return hosts;
}

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const absolute = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    return new URL(absolute);
  } catch {
    return null;
  }
}

/**
 * Returns true when the URL is a Supabase Storage public path.
 * Only the public object CDN path is trusted — not arbitrary supabase.co pages.
 */
function isSupabaseStoragePath(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    host.endsWith(".supabase.co") &&
    url.pathname.includes("/storage/v1/object/public/")
  );
}

// ---------------------------------------------------------------------------
// Own image policy
// ---------------------------------------------------------------------------

export function normalizeOwnImageUrl(
  raw: string | null | undefined,
  env?: NodeJS.ProcessEnv,
): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const absolute = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  const url = parseUrl(absolute);
  if (!url || url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  const e = env ?? process.env;
  const ownHosts = parseHostList(e.MARKETPLACE_OWN_IMAGE_HOSTS);

  if (ownHosts.has(host)) return absolute;
  if (isSupabaseStoragePath(url)) return absolute;

  return null;
}

// ---------------------------------------------------------------------------
// Licensed / manufacturer image policy
// ---------------------------------------------------------------------------

export function normalizeLicensedImageUrl(
  raw: string | null | undefined,
  env?: NodeJS.ProcessEnv,
): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const absolute = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  const url = parseUrl(absolute);
  if (!url || url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  const e = env ?? process.env;
  const licHosts = parseHostList(e.MARKETPLACE_LICENSED_IMAGE_HOSTS);

  if (licHosts.has(host)) return absolute;
  return null;
}

// ---------------------------------------------------------------------------
// Per-source-type normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a URL by source type.
 *
 * - "supplier"      → SUPPLIER_IMAGE_HOSTS allowlist
 * - "own"           → MARKETPLACE_OWN_IMAGE_HOSTS + supabase.co /storage/v1/object/public/
 * - "licensed"      → MARKETPLACE_LICENSED_IMAGE_HOSTS
 * - "manufacturer"  → same as licensed
 * - anything else   → supplier fallback (conservative)
 */
export function normalizeImageUrlForSourceType(
  raw: string | null | undefined,
  sourceType: string,
  env?: NodeJS.ProcessEnv,
): string | null {
  switch (sourceType) {
    case "supplier":
      return normalizeSupplierImageUrl(raw);
    case "own":
      return normalizeOwnImageUrl(raw, env);
    case "licensed":
    case "manufacturer":
      return normalizeLicensedImageUrl(raw, env);
    default:
      return normalizeSupplierImageUrl(raw);
  }
}

/**
 * Normalize a URL for any catalogue-allowed source type (used when we don't
 * know the original source type at read time, e.g., reading override values
 * for public DTOs).
 *
 * Tries supplier → own → licensed in order.
 */
export function normalizeCatalogueImageUrl(
  raw: string | null | undefined,
  sourceType: string,
  env?: NodeJS.ProcessEnv,
): string | null {
  return normalizeImageUrlForSourceType(raw, sourceType, env);
}

/**
 * Accept a URL from any allowlisted source type (supplier, own, or licensed).
 * Used when validating override image URLs where the source type is not yet
 * known (e.g., parseSetOverrideBody accepting primary_image / gallery_images).
 */
export function normalizeAnyAllowedImageUrl(
  raw: string | null | undefined,
  env?: NodeJS.ProcessEnv,
): string | null {
  if (!raw) return null;
  return (
    normalizeSupplierImageUrl(raw) ??
    normalizeOwnImageUrl(raw, env) ??
    normalizeLicensedImageUrl(raw, env)
  );
}

/**
 * Boolean check: is this URL allowed for any catalogue source type?
 */
export function isAllowedCatalogueImageUrl(
  raw: string | null | undefined,
  env?: NodeJS.ProcessEnv,
): boolean {
  return normalizeAnyAllowedImageUrl(raw, env) !== null;
}

/**
 * Boolean check: is this URL allowed as a supplier image?
 */
export { isAllowedSupplierImageUrl };
