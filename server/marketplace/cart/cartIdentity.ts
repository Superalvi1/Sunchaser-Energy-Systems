/**
 * Resolve marketplace cart ownership from verified JWT or header-only possession token.
 * Never trust body/query identity fields.
 */
import type { Request } from "express";
import type { Database } from "../../../dbManager.ts";
import {
  hydrateActorFromJwt,
  readBearerToken,
  type RequestActor,
} from "../../middleware/actor.ts";
import type { MarketplaceIdentity } from "./cartTypes.ts";
import {
  generatePossessionToken,
  hashPossessionToken,
  readPossessionTokenFromHeaders,
} from "./possessionToken.ts";

export type IdentityResolveResult =
  | { ok: true; identity: MarketplaceIdentity; actor?: RequestActor }
  | { ok: false; code: string; message: string; status: number };

export type CartIdentityDeps = {
  resolveLocalDb?: () => Database | undefined;
};

function customerIdFromActor(actor: RequestActor): string | null {
  if (actor.role !== "Customer") return null;
  const id = String(actor.customerId || actor.id || "").trim();
  return id || null;
}

/**
 * Optional JWT hydration for public marketplace routes.
 * Marketplace possession scheme must not be treated as Bearer CRM JWT.
 */
export async function resolveOptionalCustomer(
  req: Request,
  deps: CartIdentityDeps = {},
): Promise<IdentityResolveResult | { ok: true; identity: null }> {
  const bearer = readBearerToken(req);
  if (!bearer) return { ok: true, identity: null };

  const localDb = deps.resolveLocalDb?.();
  const hydrated = await hydrateActorFromJwt(bearer, localDb);
  if (!hydrated.ok) {
    return {
      ok: false,
      status: hydrated.status,
      code: "INVALID_TOKEN",
      message: "Invalid authentication token.",
    };
  }

  const customerId = customerIdFromActor(hydrated.actor);
  if (!customerId) {
    return {
      ok: false,
      status: 403,
      code: "CART_NOT_AUTHORIZED",
      message: "Customer authentication required.",
    };
  }

  return {
    ok: true,
    identity: {
      kind: "customer",
      customerId,
      actorScope: `customer:${customerId}`,
    },
    actor: hydrated.actor,
  };
}

/** Create-cart identity: customer JWT or new guest token. */
export async function resolveCreateIdentity(
  req: Request,
  deps: CartIdentityDeps = {},
): Promise<IdentityResolveResult> {
  const customer = await resolveOptionalCustomer(req, deps);
  if (!customer.ok) return customer;
  if (customer.identity) {
    return { ok: true, identity: customer.identity, actor: customer.actor };
  }

  const rawToken = generatePossessionToken();
  const tokenHash = hashPossessionToken(rawToken);
  return {
    ok: true,
    identity: {
      kind: "guest",
      tokenHash,
      actorScope: "guest:pending",
      rawToken,
    },
  };
}

/**
 * Mutating / read identity for an existing cart or order.
 * Requires customer JWT or header possession token.
 */
export async function resolveOwnedIdentity(
  req: Request,
  publicRef: string,
  deps: CartIdentityDeps = {},
): Promise<IdentityResolveResult> {
  const customer = await resolveOptionalCustomer(req, deps);
  if (!customer.ok) return customer;
  if (customer.identity) {
    return { ok: true, identity: customer.identity, actor: customer.actor };
  }

  const rawToken = readPossessionTokenFromHeaders(
    req.headers as Record<string, unknown>,
  );
  if (!rawToken) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_TOKEN",
      message: "Possession token required.",
    };
  }

  return {
    ok: true,
    identity: {
      kind: "guest",
      tokenHash: hashPossessionToken(rawToken),
      actorScope: `guest:${publicRef}`,
    },
  };
}

/** After guest cart create, actor_scope becomes guest:{publicRef}. */
export function guestActorScope(publicRef: string): string {
  return `guest:${publicRef}`;
}
