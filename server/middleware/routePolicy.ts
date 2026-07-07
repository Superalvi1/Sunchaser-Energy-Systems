/**
 * API route access policy (Phase 1B.1).
 *
 * Model:
 * - PUBLIC allowlist only → no authorization required
 * - Every other /api/* route is PROTECTED by default (fail closed without actor)
 * - JWT-only routes (Phase 1A migrated list) accept Bearer JWT only — never legacy headers
 * - Other protected routes accept JWT, or legacy X-Sunchaser-* headers when LEGACY_HEADER_AUTH=true
 *
 * LEGACY_HEADER_AUTH=false:
 * - Middleware never hydrates req.actor from headers
 * - Legacy route handlers still read headers directly until migrated (not middleware-secured)
 * - Clients must send Bearer JWT to pass centralized authorization
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

/** Phase 1A migrated routes — JWT Bearer required; legacy headers rejected. */
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
