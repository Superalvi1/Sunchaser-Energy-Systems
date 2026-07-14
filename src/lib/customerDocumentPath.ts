/**
 * Safe path helpers for customer document storage (local + Supabase object keys).
 * Fail closed: invalid paths never resolve to a readable file location.
 */

import path from "path";

/** Absolute root for local private customer documents. */
export function getCustomerDocsStorageRoot(cwd: string = process.cwd()): string {
  return path.resolve(cwd, "storage", "customer-docs");
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
  const cust = String(customerId || "").trim();
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
 * Returns absolute path or null.
 */
export function resolveSafeLocalCustomerDocumentPath(
  storagePath: string,
  customerId: string,
  cwd: string = process.cwd()
): string | null {
  const raw = String(storagePath || "").trim();
  const cust = String(customerId || "").trim();
  if (!raw || !cust) return null;
  if (raw.includes("\0")) return null;
  if (raw.includes("%")) return null;
  if (raw.includes("\\")) return null;
  if (/^[a-zA-Z]:/.test(raw)) return null;
  // Reject relative traversal segments before resolve (also catches "/etc/passwd" via customer root check)
  if (raw.split(/[/\\]/).some((p) => p === "..")) return null;
  if (raw.includes("..")) return null;

  const root = getCustomerDocsStorageRoot(cwd);
  const customerRoot = path.resolve(root, cust);

  let resolved: string;
  try {
    // Always resolve; absolute paths are only accepted if they land under customerRoot.
    resolved = path.resolve(cwd, raw);
  } catch {
    return null;
  }

  const relative = path.relative(customerRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  // Strict containment: resolved must be under customerRoot + sep
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
