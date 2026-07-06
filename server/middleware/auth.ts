import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../auth/jwt.ts";

export type AuthenticatedUser = {
  id: string;
  username: string;
  role: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function readBearerToken(req: Request): string | null {
  const header = String(req.headers.authorization || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const claims = verifyAccessToken(token);
    req.user = {
      id: claims.userId,
      username: claims.username,
      role: claims.role,
    };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

const PROTECTED_EXACT = new Set(["/api/state", "/api/backup/export", "/api/db/update"]);

export function isProtectedApiPath(pathname: string): boolean {
  if (PROTECTED_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/api/diagnostics/")) return true;
  if (pathname.startsWith("/api/debug/")) return true;
  return false;
}

/** Apply JWT auth only to Phase 1A protected routes. */
export function protectSelectedApiRoutes(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isProtectedApiPath(req.path)) {
    next();
    return;
  }
  requireAuth(req, res, next);
}
