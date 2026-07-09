import type { Request, Response } from "express";
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
