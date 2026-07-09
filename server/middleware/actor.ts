import type { Request } from "express";
import type { Database } from "../../dbManager";
import { findUserByUsername, mapUserRow } from "../../userAuthDb.js";
import { verifyAccessToken } from "../auth/jwt.ts";

export type ActorAuthMethod = "jwt";

export type RequestActor = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  accountStatus: string;
  customerId?: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  onboardingCompletedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedReason?: string;
  createdAt?: string;
  authMethod: ActorAuthMethod;
};

export type ActorHydrationResult =
  | { ok: true; actor: RequestActor }
  | { ok: false; status: 401 | 403; error: string; reason: string };

/** Protected /api/* routes require Bearer JWT — middleware hydrates req.actor only. */

export function readBearerToken(req: Request): string | null {
  const header = String(req.headers.authorization || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function rowToActor(row: Record<string, unknown>, authMethod: ActorAuthMethod): RequestActor {
  const mapped = mapUserRow(row);
  return {
    id: mapped.id,
    username: mapped.username,
    name: mapped.name,
    email: mapped.email,
    role: mapped.role,
    accountStatus: mapped.accountStatus,
    customerId: mapped.customerId,
    emailVerified: mapped.emailVerified,
    onboardingCompleted: mapped.onboardingCompleted,
    onboardingCompletedAt: mapped.onboardingCompletedAt,
    approvedAt: mapped.approvedAt,
    approvedBy: mapped.approvedBy,
    rejectedReason: mapped.rejectedReason,
    createdAt: mapped.createdAt,
    authMethod,
  };
}

export function actorToApiUser(actor: RequestActor): Record<string, unknown> {
  const { authMethod: _authMethod, ...user } = actor;
  return user;
}

export async function hydrateActorFromUsername(
  username: string,
  localDb: Database | undefined,
  authMethod: ActorAuthMethod
): Promise<ActorHydrationResult> {
  const row = await findUserByUsername(username, localDb);
  if (!row) {
    return { ok: false, status: 401, error: "Unauthorized", reason: "user_not_found" };
  }

  const actor = rowToActor(row as Record<string, unknown>, authMethod);
  if (actor.accountStatus === "Suspended" || actor.accountStatus === "Rejected") {
    return { ok: false, status: 403, error: "Account is not active.", reason: "account_inactive" };
  }

  return { ok: true, actor };
}

export async function hydrateActorFromJwt(
  token: string,
  localDb: Database | undefined
): Promise<ActorHydrationResult> {
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    return { ok: false, status: 401, error: "Unauthorized", reason: "invalid_jwt" };
  }

  const hydrated = await hydrateActorFromUsername(claims.username, localDb, "jwt");
  if (!hydrated.ok) return hydrated;

  if (hydrated.actor.id !== claims.userId) {
    return { ok: false, status: 401, error: "Unauthorized", reason: "token_user_mismatch" };
  }

  return hydrated;
}

export function actorToLegacyUser(actor: RequestActor): {
  id: string;
  username: string;
  role: string;
} {
  return { id: actor.id, username: actor.username, role: actor.role };
}
