import { randomBytes, randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSystemSupabase } from "../../dbManager.js";
import { hashPassword } from "../../src/lib/passwordHash.ts";
import { COMPANY_ID_PATTERN, FOUNDING_COMPANY_ID, isMultiCompanyEnabled } from "./multiCompany.ts";

/**
 * Operator (platform) API: operator-led onboarding, plans, manual subscriptions, a manual payment ledger, staff seats, an audit trail.
 * Only platform administrators (users.is_platform_admin) reach it; every handler uses the service role explicitly and writes the audit trail.
 * Nothing here is reachable by a company user, and no response ever contains a password hash. A temporary password is shown ONCE, to the operator.
 *
 *   GET   /api/platform/overview                       companies with plan, subscription, usage vs limits, payments total, overdue flag
 *   GET   /api/platform/plans   PUT /api/platform/plans/:id
 *   POST  /api/platform/companies                      onboarding (atomic: company, trial subscription, first administrator, neutral branding)
 *   PATCH /api/platform/companies/:id                  status (active|suspended|cancelled), plan, limit overrides, period end, notes
 *   POST  /api/platform/companies/:id/payments         manual payment (or reversal) and the period it covers
 *   POST  /api/platform/companies/:id/members          another staff member (seat limit enforced)
 *   GET   /api/platform/audit?company=<id>
 */
export class PlatformInputError extends Error { constructor(m: string, readonly status = 400) { super(m); } }

const clip = (v: unknown, max: number, field: string, required = false): string => {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  if (required && !t) throw new PlatformInputError(`${field} is required.`);
  if (t.length > max) throw new PlatformInputError(`${field} is too long (limit ${max}).`);
  return t;
};
const num = (v: unknown, field: string, min = 0): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new PlatformInputError(`${field} must be a number of at least ${min}.`);
  return n;
};
const isoDate = (v: unknown, field: string): string => {
  const t = clip(v, 10, field, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) throw new PlatformInputError(`${field} must be a date (YYYY-MM-DD).`);
  return t;
};

export const LIMIT_KEYS = ["max_staff", "max_leads", "max_documents", "max_storage_mb"] as const;

export function cleanCompanyInput(body: any) {
  const name = clip(body?.name, 120, "Company name", true);
  const id = clip(body?.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([0-9])/, "c$1"), 41, "Company id", true);
  if (!COMPANY_ID_PATTERN.test(id) || id === FOUNDING_COMPANY_ID) throw new PlatformInputError("Company id must be 2-41 characters: a lowercase letter, then lowercase letters, digits or underscores (and not the founding company's).");
  const username = clip(body?.ownerUsername, 60, "Administrator username", true).toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(username)) throw new PlatformInputError("Administrator username: 3-60 letters, digits, dot, dash or underscore.");
  const email = clip(body?.ownerEmail, 160, "Administrator e-mail", true).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PlatformInputError("Administrator e-mail is not valid.");
  const trialDays = body?.trialDays == null || body.trialDays === "" ? 14 : Math.floor(num(body.trialDays, "Trial days"));
  if (trialDays > 365) throw new PlatformInputError("Trial days: at most 365.");
  return { id, name, username, email, ownerName: clip(body?.ownerName, 120, "Administrator name", true), planId: clip(body?.planId || "pilot", 41, "Plan", true), trialDays };
}

export function cleanOverrides(v: unknown): Record<string, number> {
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new PlatformInputError("limitOverrides must be an object.");
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(k)) throw new PlatformInputError(`Unknown limit ${k}.`);
    if (val === null || val === "") continue;
    const n = Number(val);
    if (!Number.isInteger(n) || n < 0) throw new PlatformInputError(`${k} must be a whole number of at least 0.`);
    out[k] = n;
  }
  return out;
}

export const temporaryPassword = () => `${randomBytes(9).toString("base64url")}-${Math.floor(10 + Math.random() * 89)}Aa`;

function requirePlatform(req: Request, res: Response, next: NextFunction) {
  if (!isMultiCompanyEnabled()) return res.status(404).json({ error: "Not found." });
  if (!(req as any).actor?.isPlatformAdmin) return res.status(403).json({ error: "Platform administrators only.", code: "platform_only" });
  next();
}

async function audit(db: SupabaseClient, req: Request, action: string, companyId: string | null, detail: Record<string, unknown>) {
  const a = (req as any).actor || {};
  await db.from("saas_audit").insert({ actor_user_id: a.id || null, actor_username: a.username || null, action, company_id: companyId, detail });
}

function fail(res: Response, err: any) {
  if (err instanceof PlatformInputError) return res.status(err.status).json({ error: err.message });
  const msg = String(err?.message || err);
  if (/duplicate key|already exists|unique/i.test(msg)) return res.status(409).json({ error: "That company id, username or e-mail already exists.", code: "duplicate" });
  const m = /limit_exceeded:([a-z_]+):(\d+)/.exec(msg);
  if (m) return res.status(409).json({ error: `Plan limit reached (${m[1]} = ${m[2]}).`, code: "limit_exceeded", limit: Number(m[2]) });
  console.error("[platform]", msg);
  return res.status(500).json({ error: "The platform request failed." });
}

export async function loadOverview(db: SupabaseClient) {
  const [companies, subs, plans, usage, pays] = await Promise.all([
    db.from("companies").select("id, slug, name, status, created_at").order("created_at"),
    db.from("saas_subscriptions").select("*"),
    db.from("saas_plans").select("*"),
    db.rpc("saas_usage"),
    db.from("saas_payments").select("company_id, amount_pkr"),
  ]);
  for (const r of [companies, subs, plans, usage, pays]) if (r.error) throw r.error;
  const today = new Date().toISOString().slice(0, 10);
  return (companies.data || []).map((c: any) => {
    const sub: any = (subs.data || []).find((s: any) => s.company_id === c.id) || null;
    const plan: any = sub ? (plans.data || []).find((p: any) => p.id === sub.plan_id) : null;
    const u: any = (usage.data || []).find((x: any) => x.company_id === c.id) || { staff: 0, leads: 0, documents: 0 };
    const lim = (k: string) => (sub ? (sub.limit_overrides?.[k] ?? plan?.[k] ?? null) : null);
    return {
      id: c.id, name: c.name, status: c.status, createdAt: c.created_at,
      subscription: sub && { status: sub.status, planId: sub.plan_id, planName: plan?.name, periodStart: sub.current_period_start, periodEnd: sub.current_period_end, trialEndsAt: sub.trial_ends_at, notes: sub.notes, overrides: sub.limit_overrides },
      usage: { staff: u.staff, leads: u.leads, documents: u.documents },
      limits: { max_staff: lim("max_staff"), max_leads: lim("max_leads"), max_documents: lim("max_documents"), max_storage_mb: lim("max_storage_mb") },
      paidPkr: (pays.data || []).filter((p: any) => p.company_id === c.id).reduce((s: number, p: any) => s + Number(p.amount_pkr), 0),
      overdue: !!(sub && sub.current_period_end && sub.current_period_end < today && ["trial", "active", "past_due"].includes(sub.status)),
    };
  });
}

export function registerPlatformRoutes(app: Express): void {
  app.use("/api/platform", requirePlatform);

  app.get("/api/platform/overview", async (_req, res) => {
    try { return res.json({ companies: await loadOverview(getSystemSupabase()!) }); } catch (e) { return fail(res, e); }
  });

  app.get("/api/platform/plans", async (_req, res) => {
    const { data, error } = await getSystemSupabase()!.from("saas_plans").select("*").order("id");
    return error ? fail(res, error) : res.json({ plans: data });
  });

  app.put("/api/platform/plans/:id", async (req, res) => {
    try {
      const id = clip(req.params.id, 41, "Plan id", true);
      if (!/^[a-z][a-z0-9_]{1,40}$/.test(id)) throw new PlatformInputError("Plan id: lowercase letters, digits and underscores.");
      const lim = (v: unknown, f: string) => (v == null || v === "" ? null : Math.floor(num(v, f)));
      const row = { id, name: clip(req.body?.name, 80, "Name", true), max_staff: lim(req.body?.maxStaff, "Max staff"), max_leads: lim(req.body?.maxLeads, "Max leads"), max_documents: lim(req.body?.maxDocuments, "Max documents"), monthly_price_pkr: num(req.body?.monthlyPricePkr ?? 0, "Monthly price"), note: clip(req.body?.note, 300, "Note"), active: req.body?.active !== false, updated_at: new Date().toISOString() };
      // Only sent when given: the storage-limit column exists once phase2g is applied.
      if (req.body?.maxStorageMb !== undefined) (row as any).max_storage_mb = lim(req.body.maxStorageMb, "Max storage (MB)");
      const db = getSystemSupabase()!;
      const { error } = await db.from("saas_plans").upsert(row, { onConflict: "id" });
      if (error) throw error;
      await audit(db, req, "plan.saved", null, row);
      return res.json({ plan: row });
    } catch (e) { return fail(res, e); }
  });

  app.post("/api/platform/companies", async (req, res) => {
    try {
      const c = cleanCompanyInput(req.body);
      const db = getSystemSupabase()!;
      const password = temporaryPassword();
      const { data, error } = await db.rpc("saas_create_company", {
        p_id: c.id, p_name: c.name, p_plan: c.planId, p_trial_days: c.trialDays,
        p_user: { id: `u-${randomUUID()}`, username: c.username, name: c.ownerName, email: c.email, password_hash: hashPassword(password) },
        p_actor: { id: (req as any).actor.id, username: (req as any).actor.username },
      });
      if (error) throw error;
      return res.status(201).json({ company: data, owner: { username: c.username, temporaryPassword: password, note: "Shown once. The administrator should set a new password (Forgot password) at first sign-in." } });
    } catch (e) { return fail(res, e); }
  });

  app.patch("/api/platform/companies/:id", async (req, res) => {
    try {
      const id = req.params.id;
      if (id === FOUNDING_COMPANY_ID) throw new PlatformInputError("The founding company is not managed here.", 403);
      const db = getSystemSupabase()!;
      const { data: co } = await db.from("companies").select("id, status").eq("id", id).maybeSingle();
      if (!co) throw new PlatformInputError("Company not found.", 404);
      const { data: sub } = await db.from("saas_subscriptions").select("*").eq("company_id", id).maybeSingle();
      const changes: Record<string, unknown> = {}, subPatch: Record<string, unknown> = {};
      if (req.body?.status !== undefined) {
        const st = String(req.body.status);
        if (!["active", "suspended", "cancelled", "trial"].includes(st)) throw new PlatformInputError("status must be trial, active, suspended or cancelled.");
        changes.status = st; subPatch.status = st === "cancelled" ? "cancelled" : st === "suspended" ? "suspended" : st;
        const { error } = await db.from("companies").update({ status: st, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) throw error;
      }
      if (req.body?.planId !== undefined) {
        const planId = clip(req.body.planId, 41, "Plan", true);
        const { data: p } = await db.from("saas_plans").select("id").eq("id", planId).eq("active", true).maybeSingle();
        if (!p) throw new PlatformInputError("Unknown or inactive plan.");
        subPatch.plan_id = planId; changes.planId = planId;
      }
      if (req.body?.limitOverrides !== undefined) { subPatch.limit_overrides = cleanOverrides(req.body.limitOverrides); changes.limitOverrides = subPatch.limit_overrides; }
      if (req.body?.periodEnd !== undefined) { subPatch.current_period_end = isoDate(req.body.periodEnd, "periodEnd"); changes.periodEnd = subPatch.current_period_end; }
      if (req.body?.notes !== undefined) { subPatch.notes = clip(req.body.notes, 500, "Notes"); changes.notes = subPatch.notes; }
      if (!Object.keys(changes).length) throw new PlatformInputError("Nothing to change.");
      if (Object.keys(subPatch).length) {
        if (!sub) throw new PlatformInputError("The company has no subscription record.", 409);
        const { error } = await db.from("saas_subscriptions").update({ ...subPatch, updated_at: new Date().toISOString() }).eq("company_id", id);
        if (error) throw error;
      }
      await audit(db, req, "company.updated", id, { before: { status: co.status, plan: sub?.plan_id }, changes });
      return res.json({ ok: true, changes });
    } catch (e) { return fail(res, e); }
  });

  app.post("/api/platform/companies/:id/payments", async (req, res) => {
    try {
      const id = req.params.id;
      const db = getSystemSupabase()!;
      const { data: sub } = await db.from("saas_subscriptions").select("*").eq("company_id", id).maybeSingle();
      if (!sub) throw new PlatformInputError("The company has no subscription record.", 404);
      const reversalOf = clip(req.body?.reversalOf, 60, "reversalOf");
      let amount = num(req.body?.amountPkr, "Amount", 0.01);
      if (reversalOf) {
        const { data: orig } = await db.from("saas_payments").select("id, company_id, amount_pkr").eq("id", reversalOf).maybeSingle();
        if (!orig || orig.company_id !== id || Number(orig.amount_pkr) <= 0) throw new PlatformInputError("The payment to reverse was not found for this company.");
        amount = -amount;
      }
      const row = { id: `pay_${randomUUID().replace(/-/g, "")}`, company_id: id, subscription_id: sub.id, amount_pkr: amount, reversal_of: reversalOf || null, method: clip(req.body?.method, 60, "Method", true), reference: clip(req.body?.reference, 120, "Reference") || null, paid_at: isoDate(req.body?.paidAt, "paidAt"), covers_from: req.body?.coversFrom ? isoDate(req.body.coversFrom, "coversFrom") : null, covers_to: req.body?.coversTo ? isoDate(req.body.coversTo, "coversTo") : null, note: clip(req.body?.note, 300, "Note") || null, recorded_by: (req as any).actor.username };
      const ins = await db.from("saas_payments").insert(row);
      if (ins.error) throw ins.error;
      // A payment that covers a period moves the subscription to that period and marks it active (suspension stays an explicit operator decision).
      if (!reversalOf && row.covers_to) {
        const { error } = await db.from("saas_subscriptions").update({ current_period_start: row.covers_from || sub.current_period_start, current_period_end: row.covers_to, status: sub.status === "cancelled" ? "cancelled" : sub.status === "suspended" ? "suspended" : "active", updated_at: new Date().toISOString() }).eq("company_id", id);
        if (error) throw error;
      }
      await audit(db, req, reversalOf ? "payment.reversed" : "payment.recorded", id, { payment: row.id, amountPkr: amount, method: row.method, reference: row.reference });
      return res.status(201).json({ payment: row });
    } catch (e) { return fail(res, e); }
  });

  app.post("/api/platform/companies/:id/members", async (req, res) => {
    try {
      const id = req.params.id;
      const db = getSystemSupabase()!;
      const { data: co } = await db.from("companies").select("id").eq("id", id).maybeSingle();
      if (!co || id === FOUNDING_COMPANY_ID) throw new PlatformInputError("Company not found.", 404);
      const role = clip(req.body?.role || "Sales Executive", 40, "Role", true);
      const username = clip(req.body?.username, 60, "Username", true).toLowerCase();
      const email = clip(req.body?.email, 160, "E-mail", true).toLowerCase();
      if (!/^[a-z0-9._-]{3,60}$/.test(username) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PlatformInputError("Username or e-mail is not valid.");
      const password = temporaryPassword();
      const userId = `u-${randomUUID()}`;
      const u = await db.from("users").insert({ id: userId, username, password: hashPassword(password), name: clip(req.body?.name, 120, "Name", true), email, role, account_status: "Approved", email_verified: true, onboarding_completed: false, approved_by: (req as any).actor.username });
      if (u.error) throw u.error;
      const m = await db.from("company_memberships").insert({ id: `mem_${randomUUID().replace(/-/g, "")}`, company_id: id, user_id: userId, role, status: "active" });
      if (m.error) { await db.from("users").delete().eq("id", userId); throw m.error; }   // the seat limit refused: the new login does not stay behind
      await audit(db, req, "member.added", id, { username, role });
      return res.status(201).json({ member: { username, role }, temporaryPassword: password });
    } catch (e) { return fail(res, e); }
  });

  app.get("/api/platform/audit", async (req, res) => {
    const db = getSystemSupabase()!;
    let q = db.from("saas_audit").select("*").order("id", { ascending: false }).limit(200);
    if (req.query.company) q = q.eq("company_id", String(req.query.company));
    const { data, error } = await q;
    return error ? fail(res, error) : res.json({ audit: data });
  });
}
