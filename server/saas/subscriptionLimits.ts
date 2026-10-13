import type { NextFunction, Request, Response } from "express";
import { getSystemSupabase } from "../../dbManager.js";
import { getCompanyContext } from "./companyContext.ts";
import { FOUNDING_COMPANY_ID, isMultiCompanyEnabled } from "./multiCompany.ts";

/**
 * Friendly pre-check of the plan limits that the database enforces with triggers (phase2e): the user gets a clear message (HTTP 402, code
 * limit_exceeded) instead of a silent failure. The trigger remains the real barrier. No subscription row = no limit (founding company).
 */
const RULES: Array<{ method: string; rx: RegExp; key: "max_leads" | "max_documents"; table: "leads" | "customer_documents"; label: string }> = [
  { method: "POST", rx: /^\/api\/leads\/?$/, key: "max_leads", table: "leads", label: "leads" },
  { method: "POST", rx: /^\/api\/admin\/customer-documents\/(upload|assign)?\/?$/, key: "max_documents", table: "customer_documents", label: "documents" },
];

export async function limitFor(companyId: string, key: string): Promise<number | null> {
  const db = getSystemSupabase()!;
  const { data: sub } = await db.from("saas_subscriptions").select("plan_id, limit_overrides").eq("company_id", companyId).maybeSingle();
  if (!sub) return null;
  const o = (sub.limit_overrides as any)?.[key];
  if (o !== undefined && o !== null) return Number(o);
  const { data: plan } = await db.from("saas_plans").select(key).eq("id", sub.plan_id).maybeSingle();
  const v = (plan as any)?.[key];
  return v == null ? null : Number(v);
}

export function planLimitMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!isMultiCompanyEnabled()) return next();
    const rule = RULES.find((r) => r.method === req.method && r.rx.test(req.path));
    const ctx = getCompanyContext();
    if (!rule || ctx?.kind !== "company" || ctx.companyId === FOUNDING_COMPANY_ID) return next();
    try {
      const limit = await limitFor(ctx.companyId, rule.key);
      if (limit === null) return next();
      const db = getSystemSupabase()!;
      let q = db.from(rule.table).select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId);
      if (rule.table === "leads") q = q.is("deleted_at", null);
      const { count } = await q;
      if ((count ?? 0) >= limit) return res.status(402).json({ error: `Your plan allows ${limit} ${rule.label}. Contact the platform operator to raise the limit.`, code: "limit_exceeded", limit, current: count });
    } catch (err) {
      console.warn("[limits] pre-check unavailable; the database trigger still applies:", err instanceof Error ? err.message : err);
    }
    return next();
  };
}
