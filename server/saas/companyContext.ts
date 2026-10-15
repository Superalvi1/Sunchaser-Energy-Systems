import { AsyncLocalStorage } from "node:async_hooks";
import { FOUNDING_COMPANY_ID, isValidCompanyId } from "./multiCompany.ts";

/**
 * Who the current unit of work acts for.
 * - company: a request or job acting for one company. Database access goes through the tenant role, so the
 *   database itself restricts every query to that company.
 * - system: explicit platform work (login, billing, schedulers) that may use the service role. Must name a reason.
 * Anything else, in multi-company mode, is a bug and fails closed.
 */
export type CompanyContext =
  | { kind: "company"; companyId: string; userId?: string; role?: string; membershipId?: string }
  | { kind: "system"; reason: string };

const storage = new AsyncLocalStorage<CompanyContext>();

export class CompanyContextMissingError extends Error {
  readonly code = "COMPANY_CONTEXT_MISSING";
  constructor(message = "No company context for this database access. Wrap it in runWithCompany() or runAsSystem().") {
    super(message);
    this.name = "CompanyContextMissingError";
  }
}

export function getCompanyContext(): CompanyContext | undefined {
  return storage.getStore();
}

export function runWithCompany<T>(
  ctx: { companyId: string; userId?: string; role?: string; membershipId?: string },
  fn: () => T
): T {
  if (!isValidCompanyId(ctx.companyId)) throw new Error("Invalid company id");
  return storage.run({ kind: "company", ...ctx }, fn);
}

export function runAsSystem<T>(reason: string, fn: () => T): T {
  if (!reason || reason.trim().length < 3) throw new Error("runAsSystem needs a reason");
  return storage.run({ kind: "system", reason }, fn);
}

/** Work that belongs to the founding company only (legacy schedulers, features not yet scoped per company). */
export function runAsFoundingCompany<T>(fn: () => T): T {
  return runWithCompany({ companyId: FOUNDING_COMPANY_ID }, fn);
}

export function requireCompanyId(): string {
  const ctx = storage.getStore();
  if (ctx?.kind !== "company") throw new CompanyContextMissingError("This operation needs a company context.");
  return ctx.companyId;
}
