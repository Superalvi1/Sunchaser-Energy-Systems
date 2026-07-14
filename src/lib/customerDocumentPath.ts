/**
 * Safe path helpers for customer document storage (local + Supabase object keys).
 * Fail closed: invalid paths never resolve to a readable file location.
 */

import path from "path";

/** Maximum accepted length for a customer ID segment. */
export const CUSTOMER_ID_MAX_LENGTH = 128;

/** Strict customer ID allowlist: letters, numbers, hyphen, underscore only. */
const CUSTOMER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Validate a customer ID for use in storage paths (local + Supabase).
 * Rejects empty IDs, dots, "..", slashes, backslashes, percent encoding,
 * absolute paths, control characters, and Windows drive-style input.
 * Returns the validated ID or null.
 */
export function assertValidCustomerId(customerId: unknown): string | null {
  if (customerId == null) return null;
  if (typeof customerId !== "string" && typeof customerId !== "number") return null;
  const raw = String(customerId).trim();
  if (!raw) return null;
  if (raw.length > CUSTOMER_ID_MAX_LENGTH) return null;
  // Reject control chars / whitespace before allowlist (defense in depth).
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (raw.includes("/") || raw.includes("\\") || raw.includes("%") || raw.includes(".")) return null;
  if (raw.includes("..")) return null;
  if (/^[a-zA-Z]:/.test(raw)) return null;
  if (path.isAbsolute(raw)) return null;
  if (!CUSTOMER_ID_PATTERN.test(raw)) return null;
  return raw;
}

/** Absolute root for local private customer documents. */
export function getCustomerDocsStorageRoot(cwd: string = process.cwd()): string {
  return path.resolve(cwd, "storage", "customer-docs");
}

/**
 * Resolve `storage/customer-docs/{validatedCustomerId}/` with path.resolve and
 * require the result to remain strictly inside the storage root.
 */
export function resolveSafeCustomerDocsDirectory(
  customerId: string,
  cwd: string = process.cwd()
): string | null {
  const cust = assertValidCustomerId(customerId);
  if (!cust) return null;
  const root = getCustomerDocsStorageRoot(cwd);
  const resolved = path.resolve(root, cust);
  if (path.dirname(resolved) !== root) return null;
  if (path.basename(resolved) !== cust) return null;
  if (!resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function hasTraversalOrMalformedSegments(raw: string): boolean {
  if (!raw) return true;
  if (raw.includes("\0")) return true;
  if (raw.includes("\\")) return true; // reject Windows-style separators
  if (raw.includes("%")) return true; // reject URL-encoded / mixed traversal
  if (raw.includes("//")) return true;
  if (/^[a-zA-Z]:/.test(raw)) return true; // Windows drive
  if (raw.includes("..")) return true;
  return false;
}

/**
 * Validate a Supabase object key for customer-documents.
 * Expected shape: `{customerId}/{filename}` with safe segments only.
 * Returns the normalized key or null.
 */
export function assertSafeSupabaseCustomerObjectPath(
  storagePath: string,
  customerId: string
): string | null {
  const raw = String(storagePath || "").trim();
  const cust = assertValidCustomerId(customerId);
  if (!raw || !cust) return null;
  if (hasTraversalOrMalformedSegments(raw)) return null;
  if (raw.startsWith("/") || raw.startsWith("./")) return null;
  if (path.isAbsolute(raw)) return null;

  const parts = raw.split("/");
  if (parts.length < 2) return null;
  if (parts[0] !== cust) return null; // cross-customer
  for (const part of parts) {
    if (!part || part === "." || part === "..") return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(part)) return null;
  }
  return parts.join("/");
}

/**
 * Resolve a local customer-document path with path.resolve and require it
 * to remain strictly inside storage/customer-docs/{customerId}/.
 * Accepts absolute paths under the customer dir or relative object keys
 * `{customerId}/{filename}` (same shape as Supabase).
 * Returns absolute path or null.
 */
export function resolveSafeLocalCustomerDocumentPath(
  storagePath: string,
  customerId: string,
  cwd: string = process.cwd()
): string | null {
  const raw = String(storagePath || "").trim();
  const cust = assertValidCustomerId(customerId);
  if (!raw || !cust) return null;
  if (raw.includes("\0")) return null;
  if (raw.includes("%")) return null;
  if (raw.includes("\\")) return null;
  if (/^[a-zA-Z]:/.test(raw)) return null;
  if (raw.split(/[/\\]/).some((p) => p === "..")) return null;
  if (raw.includes("..")) return null;

  const customerRoot = resolveSafeCustomerDocsDirectory(cust, cwd);
  if (!customerRoot) return null;
  const root = getCustomerDocsStorageRoot(cwd);

  // Prefer canonical object-key form: {customerId}/{filename}
  const objectKey = assertSafeSupabaseCustomerObjectPath(raw, cust);
  if (objectKey) {
    const resolved = path.resolve(root, objectKey);
    if (!resolved.startsWith(customerRoot + path.sep)) return null;
    return resolved;
  }

  let resolved: string;
  try {
    resolved = path.resolve(cwd, raw);
  } catch {
    return null;
  }

  const relative = path.relative(customerRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  if (!resolved.startsWith(customerRoot + path.sep)) {
    return null;
  }
  return resolved;
}

/** True when a path is a safe server-generated storage key (supabase or local under root). */
export function isServerGeneratedCustomerStoragePath(
  storagePath: string,
  customerId: string,
  cwd: string = process.cwd()
): boolean {
  if (assertSafeSupabaseCustomerObjectPath(storagePath, customerId)) return true;
  return resolveSafeLocalCustomerDocumentPath(storagePath, customerId, cwd) !== null;
}
