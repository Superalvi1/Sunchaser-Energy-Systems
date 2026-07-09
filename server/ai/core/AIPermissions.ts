/**
 * Permission-aware execution primitives.
 *
 * The engine never encodes business rules ("Sales Advisors may not see
 * profit"). Instead:
 *   - every tool DECLARES what it requires (roles, permissions, ownership),
 *   - the actor CARRIES its identity, role, permission grants, and ABAC
 *     attributes,
 *   - an evaluator DECIDES, purely from those two inputs.
 *
 * Business modules plug in their rules by (a) declaring specs on tools/agents
 * and (b) optionally registering ownership policies for record-level checks.
 */

/** The authenticated principal on whose behalf the engine acts. */
export interface AIActor {
  userId: string;
  username?: string;
  displayName?: string;
  /** Opaque role string — the engine compares it, never interprets it. */
  role: string;
  /** Granted permission strings, e.g. "finance:write". "*" grants all. */
  permissions: string[];
  /** Set when the actor is (or acts within the scope of) a customer. */
  customerId?: string | null;
  /** Free-form ABAC attributes (region, team, tenant, clearance, ...). */
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Row/record-level requirement a tool declares. Evaluated against the tool
 * call's arguments at execution time.
 */
export type OwnershipRequirement =
  | { type: "none" }
  /** args[argumentKey] must equal actor.customerId (customer data scoping). */
  | { type: "customer-scope"; argumentKey: string }
  /** args[argumentKey] must equal actor.userId (assignee/self scoping). */
  | { type: "assigned-user"; argumentKey: string }
  /** Delegated to a named policy — the ABAC extension point. */
  | { type: "policy"; policy: string };

/** What a tool (or agent) requires before the engine may run it. */
export interface AIPermissionSpec {
  /** Empty array = any role. Otherwise actor.role must be in the list. */
  requiredRoles: string[];
  /** Every listed permission must be granted (or actor holds "*"). */
  requiredPermissions: string[];
  requiredOwnership: OwnershipRequirement;
}

export interface PermissionDecision {
  allowed: boolean;
  /** Human-readable denial reason. Always set when allowed === false. */
  reason?: string;
}

/**
 * Async record-level policy hook. Future ABAC engines (or the Ownership
 * module of the CRM) implement this to answer "may this actor touch this
 * record" without the AI engine knowing what the record is.
 */
export interface OwnershipPolicyResolver {
  resolve(
    policy: string,
    actor: AIActor,
    args: Record<string, unknown>
  ): Promise<PermissionDecision>;
}

export interface AIPermissionEvaluator {
  /** Static check (roles + permissions) — used to filter visible tools/agents. */
  canAccess(actor: AIActor, spec: AIPermissionSpec): PermissionDecision;
  /** Full check including ownership against concrete call arguments. */
  authorize(
    actor: AIActor,
    spec: AIPermissionSpec,
    args: Record<string, unknown>
  ): Promise<PermissionDecision>;
}

const ALLOW: PermissionDecision = { allowed: true };

function deny(reason: string): PermissionDecision {
  return { allowed: false, reason };
}

/**
 * Pure, rule-free evaluator. Contains zero knowledge of the CRM — it only
 * compares declared specs to actor claims and delegates "policy" ownership
 * to an injected resolver.
 */
export class DefaultPermissionEvaluator implements AIPermissionEvaluator {
  constructor(private readonly ownershipResolver?: OwnershipPolicyResolver) {}

  canAccess(actor: AIActor, spec: AIPermissionSpec): PermissionDecision {
    if (spec.requiredRoles.length > 0 && !spec.requiredRoles.includes(actor.role)) {
      return deny(`Role "${actor.role}" is not permitted. Requires one of: ${spec.requiredRoles.join(", ")}.`);
    }
    if (spec.requiredPermissions.length > 0 && !actor.permissions.includes("*")) {
      const granted = new Set(actor.permissions);
      const missing = spec.requiredPermissions.filter((p) => !granted.has(p));
      if (missing.length > 0) {
        return deny(`Missing permission(s): ${missing.join(", ")}.`);
      }
    }
    return ALLOW;
  }

  async authorize(
    actor: AIActor,
    spec: AIPermissionSpec,
    args: Record<string, unknown>
  ): Promise<PermissionDecision> {
    const staticDecision = this.canAccess(actor, spec);
    if (!staticDecision.allowed) return staticDecision;

    const ownership = spec.requiredOwnership;
    switch (ownership.type) {
      case "none":
        return ALLOW;

      case "customer-scope": {
        if (!actor.customerId) {
          return deny("Actor is not linked to a customer; customer-scoped tool refused.");
        }
        const requested = args[ownership.argumentKey];
        if (requested !== undefined && requested !== null && String(requested) !== String(actor.customerId)) {
          return deny("Cross-customer access refused: requested record belongs to another customer.");
        }
        return ALLOW;
      }

      case "assigned-user": {
        const requested = args[ownership.argumentKey];
        if (requested !== undefined && requested !== null && String(requested) !== String(actor.userId)) {
          return deny("Access refused: record is scoped to a different user.");
        }
        return ALLOW;
      }

      case "policy": {
        if (!this.ownershipResolver) {
          return deny(`Ownership policy "${ownership.policy}" has no registered resolver; refusing by default.`);
        }
        return this.ownershipResolver.resolve(ownership.policy, actor, args);
      }
    }
  }
}
