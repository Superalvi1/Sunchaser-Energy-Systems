/**
 * API route access policy (Phase 1B.1 / 1B.3B Wave 7C).
 *
 * Model:
 * - PUBLIC allowlist only → no authorization required
 * - Every other /api/* route is PROTECTED — valid Bearer JWT required (req.actor)
 * - jwt_only routes are a documented subset with identical auth behavior
 */

import { isPublicApiRoute } from "./publicRoutes.ts";

export type RouteAccessKind = "public" | "jwt_only" | "protected";

export type RouteAccessPolicy = {
  kind: RouteAccessKind;
};

const JWT_ONLY_EXACT = new Set(["/api/state", "/api/backup/export", "/api/db/update"]);

const JWT_ONLY_PREFIXES = ["/api/diagnostics/", "/api/debug/"];

export function normalizeApiPath(pathname: string): string {
  return pathname.split("?")[0] || pathname;
}

export function isJwtOnlyRoute(pathname: string): boolean {
  const path = normalizeApiPath(pathname);
  if (JWT_ONLY_EXACT.has(path)) return true;
  return JWT_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Phase 1A migrated routes — documented JWT-only list. */
export function isMigratedProtectedRoute(pathname: string): boolean {
  return isJwtOnlyRoute(pathname);
}

/** @deprecated Alias for isJwtOnlyRoute — Phase 1A compatibility. */
export function isProtectedApiPath(pathname: string): boolean {
  return isJwtOnlyRoute(pathname);
}

/** True when path is under /api/ and not on the public allowlist. */
export function isProtectedApiRoute(method: string, pathname: string): boolean {
  const path = normalizeApiPath(pathname);
  if (!path.startsWith("/api/")) return false;
  return !isPublicApiRoute(method, path);
}

export function resolveRouteAccessPolicy(method: string, pathname: string): RouteAccessPolicy {
  const path = normalizeApiPath(pathname);

  if (!path.startsWith("/api/")) {
    return { kind: "public" };
  }

  if (isPublicApiRoute(method, path)) {
    return { kind: "public" };
  }

  if (isJwtOnlyRoute(path)) {
    return { kind: "jwt_only" };
  }

  return { kind: "protected" };
}
