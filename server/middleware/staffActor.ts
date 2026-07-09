import type { Request, Response } from "express";
import { StaffPortalAuthError } from "../../dbManager.js";
import type { RequestActor } from "./actor.ts";

/**
 * Staff/admin handlers must use req.actor — never trust legacy headers when JWT is present.
 * Customer actors are rejected with 403.
 */
export function resolveStaffActor(req: Request, res: Response): RequestActor | null {
  if (req.actor?.role === "Customer") {
    res.status(403).json({ error: "Not authorized for staff routes." });
    return null;
  }
  if (!req.actor) {
    res.status(401).json({ error: "Auth required." });
    return null;
  }
  return req.actor;
}

export function staffIdentityFromActor(actor: RequestActor): {
  userId: string;
  username: string;
  role: string;
} {
  return {
    userId: actor.id,
    username: actor.username,
    role: actor.role,
  };
}

/** @deprecated Route handlers should use resolveStaffActor — req.actor only. */
export function readStaffAuth(req: Request): { userId: string; username: string; role: string } {
  if (req.actor) {
    return staffIdentityFromActor(req.actor);
  }
  return { userId: "", username: "", role: "" };
}

/** @deprecated Route handlers should use resolveCustomerPortalActor — req.actor only. */
export function readPortalAuth(req: Request): { userId: string; username: string } {
  if (req.actor) {
    return { userId: req.actor.id, username: req.actor.username };
  }
  return { userId: "", username: "" };
}

export function assertSuperAdminCleanup(req: Request): void {
  if (!req.actor || req.actor.role !== "Super Admin") {
    throw new StaffPortalAuthError("Super Admin access required.", 403);
  }
}
