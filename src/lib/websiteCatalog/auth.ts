import { canManageAutoSizerPresets } from "../roles";

export type WebsiteCatalogAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Website catalog sync is quotation/product administration.
 * Reuses the AutoSizer admin role set: Super Admin, Admin, Director, Technical CEO.
 */
export function canSyncWebsiteCatalog(username: string, role: string): boolean {
  return canManageAutoSizerPresets(username, role);
}

export function authorizeWebsiteCatalogSyncAccess(
  actor: { username?: string; role?: string } | null | undefined
): WebsiteCatalogAuthResult {
  if (!actor || !String(actor.role || "").trim()) {
    return { ok: false, status: 401, error: "Authentication required." };
  }
  if (!canSyncWebsiteCatalog(String(actor.username || ""), String(actor.role))) {
    return { ok: false, status: 403, error: "Not authorized to sync the website catalog." };
  }
  return { ok: true };
}

export function authorizeWebsiteCatalogReadAccess(
  actor: { username?: string; role?: string } | null | undefined
): WebsiteCatalogAuthResult {
  if (!actor || !String(actor.role || "").trim()) {
    return { ok: false, status: 401, error: "Authentication required." };
  }
  return { ok: true };
}
