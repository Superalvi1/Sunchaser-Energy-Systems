import type { Request } from "express";
import type { Database } from "../../dbManager";
import { findUserByUsername, mapUserRow } from "../../userAuthDb.js";
import {
  passwordVersion,
  passwordVersionMatches,
  sessionLimitViolation,
  sessionMaxAgeSeconds,
  verifySessionToken,
} from "../auth/jwt.ts";

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

/** What a verified token says about its session; `passwordVersion` is the CURRENT value derived from the database. */
export type AuthSessionInfo = {
  startedAt: number | null;
  passwordVersion: string | null;
};

export type ActorHydrationResult =
  | { ok: true; actor: RequestActor; session?: AuthSessionInfo }
  | { ok: false; status: 401 | 403; error: string; reason: string };

/** Account states that may not use an existing session (login refuses the same states). */
const INACTIVE_ACCOUNT_STATUSES = new Set(["Suspended", "Rejected", "Pending"]);

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

async function loadActiveUser(
  username: string,
  localDb: Database | undefined,
  authMethod: ActorAuthMethod
): Promise<
  | { ok: true; actor: RequestActor; passwordVersion: string | null }
  | { ok: false; status: 401 | 403; error: string; reason: string }
> {
  const row = await findUserByUsername(username, localDb);
  if (!row) {
    return { ok: false, status: 401, error: "Unauthorized", reason: "user_not_found" };
  }

  const actor = rowToActor(row as Record<string, unknown>, authMethod);
  if (INACTIVE_ACCOUNT_STATUSES.has(actor.accountStatus)) {
    return { ok: false, status: 403, error: "Account is not active.", reason: "account_inactive" };
  }

  return {
    ok: true,
    actor,
    passwordVersion: passwordVersion((row as Record<string, unknown>).password),
  };
}

export async function hydrateActorFromUsername(
  username: string,
  localDb: Database | undefined,
  authMethod: ActorAuthMethod
): Promise<ActorHydrationResult> {
  const loaded = await loadActiveUser(username, localDb, authMethod);
  return loaded.ok ? { ok: true, actor: loaded.actor } : loaded;
}

export async function hydrateActorFromJwt(
  token: string,
  localDb: Database | undefined
): Promise<ActorHydrationResult> {
  let verified;
  try {
    verified = verifySessionToken(token);
  } catch {
    return { ok: false, status: 401, error: "Unauthorized", reason: "invalid_jwt" };
  }

  // The absolute session limit holds on every request, not only when a client asks for a renewal.
  const violation = sessionLimitViolation(verified, Math.floor(Date.now() / 1000), sessionMaxAgeSeconds());
  if (violation) {
    return { ok: false, status: 401, error: "Unauthorized", reason: violation };
  }

  const claims = verified.claims;
  const loaded = await loadActiveUser(claims.username, localDb, "jwt");
  if (!loaded.ok) return loaded;

  if (loaded.actor.id !== claims.userId) {
    return { ok: false, status: 401, error: "Unauthorized", reason: "token_user_mismatch" };
  }

  // A password change or reset retires every token minted before it. Tokens issued before this claim existed
  // carry none and stay valid until they expire (they are re-bound to the current password on renewal).
  if (verified.passwordVersion && !passwordVersionMatches(verified.passwordVersion, loaded.passwordVersion)) {
    return { ok: false, status: 401, error: "Unauthorized", reason: "password_changed" };
  }

  return {
    ok: true,
    actor: loaded.actor,
    session: { startedAt: verified.startedAt, passwordVersion: loaded.passwordVersion },
  };
}

export function actorToLegacyUser(actor: RequestActor): {
  id: string;
  username: string;
  role: string;
} {
  return { id: actor.id, username: actor.username, role: actor.role };
}
