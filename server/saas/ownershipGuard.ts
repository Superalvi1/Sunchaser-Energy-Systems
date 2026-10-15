/**
 * Application-level company ownership check for object routes, in addition to row-level security.
 *
 * Row-level security is the main barrier. This guard is a second, independent one: before a core route runs, every record id the request
 * names (in the path, the query or the body) is looked up with the SERVICE role and its company is compared with the caller's company.
 * If a record belongs to ANOTHER company the id is replaced by one that does not exist, so the route answers exactly as it does for a
 * missing record (its own "not found"), and nothing is written. An id that does not exist is left alone (the route says so itself).
 *
 * Fail closed: when the owner cannot be read the request is refused (503), never passed through.
 * Lists and boot state are not covered here (no id to check); they rely on row-level security.
 */
import type { NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";

export type OwnedTable = "leads" | "customers" | "invoices" | "quotations" | "delivery_challans" | "projects";

type PathRef = { group: number; table: OwnedTable };
type FieldRef = { field: string; table: OwnedTable };
export type OwnershipRule = {
  /** HTTP methods; omitted = any. */
  methods?: string[];
  pattern: RegExp;
  path?: PathRef[];
  query?: FieldRef[];
  body?: FieldRef[];
};

const SEG = "([^/]+)";
export const OWNERSHIP_RULES: readonly OwnershipRule[] = [
  // leads
  { pattern: new RegExp(`^/api/leads/${SEG}/quotes/${SEG}(?:/.*)?$`), path: [{ group: 1, table: "leads" }, { group: 2, table: "quotations" }] },
  { pattern: new RegExp(`^/api/leads/${SEG}(?:/.*)?$`), path: [{ group: 1, table: "leads" }] },
  { pattern: new RegExp(`^/api/projects/${SEG}/net-metering(?:/.*)?$`), path: [{ group: 1, table: "leads" }] },
  { pattern: new RegExp(`^/api/projects/${SEG}(?:/.*)?$`), path: [{ group: 1, table: "projects" }] },
  // invoices, payments, deliveries of an invoice
  { methods: ["POST"], pattern: /^\/api\/admin\/invoices$/, body: [{ field: "customerId", table: "customers" }, { field: "leadId", table: "leads" }, { field: "quotationId", table: "quotations" }] },
  { methods: ["POST"], pattern: /^\/api\/admin\/invoices\/from-lead$/, body: [{ field: "leadId", table: "leads" }, { field: "quotationId", table: "quotations" }] },
  { pattern: new RegExp(`^/api/admin/invoices/${SEG}(?:/.*)?$`), path: [{ group: 1, table: "invoices" }] },
  { pattern: new RegExp(`^/api/export/pdf/invoice/${SEG}(?:/.*)?$`), path: [{ group: 1, table: "invoices" }] },
  { methods: ["POST"], pattern: /^\/api\/admin\/deliveries$/, body: [{ field: "invoiceId", table: "invoices" }] },
  { pattern: new RegExp(`^/api/admin/deliveries/${SEG}(?:/.*)?$`), path: [{ group: 1, table: "delivery_challans" }] },
  // customers and their documents
  { methods: ["POST"], pattern: /^\/api\/admin\/customer-documents(?:\/(?:upload|assign))?$/, body: [{ field: "customerId", table: "customers" }] },
  { pattern: new RegExp(`^/api/admin/customer-documents/${SEG}(?:/.*)?$`), path: [{ group: 1, table: "customers" }] },
  { pattern: new RegExp(`^/api/admin/customers/${SEG}(?:/.*)?$`), path: [{ group: 1, table: "customers" }] },
  { pattern: new RegExp(`^/api/customer-portal/${SEG}$`), path: [{ group: 1, table: "customers" }] },
  // printable quotation / sizing documents
  { pattern: new RegExp(`^/api/export/pdf/(?:manual-quote|auto-sizer)/${SEG}(?:/.*)?$`), path: [{ group: 1, table: "leads" }], query: [{ field: "quoteId", table: "quotations" }] },
  { pattern: new RegExp(`^/api/export/pdf/${SEG}$`), path: [{ group: 1, table: "leads" }], query: [{ field: "quoteId", table: "quotations" }] },
];

/** Paths that look like ids to the patterns above but are fixed words of the API. Never looked up. */
const WORDS = new Set(["deleted", "contracted-ready", "bulk-delete", "from-lead", "dashboard", "me", "upload", "assign", "invoice", "manual-quote", "auto-sizer", "stage-saved-quote", "design-studio-proposal", "template-preview", "staged-public", "warranty-handover"]);

export type ReadOwner = (table: OwnedTable, id: string) => Promise<string | null | undefined>;

export type OwnershipVerdict =
  | { ok: true; rewritten: number; checked: number }
  | { ok: false; status: 503; reason: "owner_lookup_failed" };

const ID_RX = /^[A-Za-z0-9_.:@-]{1,200}$/;

/** Collects (table, id, where) triples a request names, according to the rules. */
export function referencedRecords(method: string, pathname: string, query: Record<string, unknown>, body: unknown): Array<{ table: OwnedTable; id: string; at: "path" | "query" | "body"; key: string | number }> {
  const out: Array<{ table: OwnedTable; id: string; at: "path" | "query" | "body"; key: string | number }> = [];
  const m = method.toUpperCase();
  for (const rule of OWNERSHIP_RULES) {
    if (rule.methods && !rule.methods.includes(m)) continue;
    const match = rule.pattern.exec(pathname);
    if (!match) continue;
    for (const p of rule.path || []) {
      const raw = match[p.group];
      if (!raw) continue;
      let id: string;
      try { id = decodeURIComponent(raw); } catch { continue; }
      if (WORDS.has(id) || !ID_RX.test(id)) continue;
      out.push({ table: p.table, id, at: "path", key: p.group });
    }
    for (const q of rule.query || []) {
      const v = query?.[q.field];
      if (typeof v === "string" && ID_RX.test(v) && !WORDS.has(v)) out.push({ table: q.table, id: v, at: "query", key: q.field });
    }
    for (const b of rule.body || []) {
      const v = (body as Record<string, unknown> | undefined)?.[b.field];
      if (typeof v === "string" && ID_RX.test(v) && !WORDS.has(v)) out.push({ table: b.table, id: v, at: "body", key: b.field });
    }
    break; // first matching rule wins; rules are ordered most specific first
  }
  return out;
}

const decoy = () => `denied-${randomBytes(9).toString("hex")}`;

export async function enforceOwnership(
  req: Pick<Request, "method" | "path" | "url" | "query" | "body"> & { url: string; query: Record<string, unknown>; body?: Record<string, unknown> },
  companyId: string,
  readOwner: ReadOwner,
  onDenied?: (info: { table: OwnedTable; at: string }) => void
): Promise<OwnershipVerdict> {
  const refs = referencedRecords(req.method, req.path, req.query, req.body);
  if (!refs.length) return { ok: true, rewritten: 0, checked: 0 };
  const owners = new Map<string, string | null | undefined>();
  try {
    await Promise.all(refs.map(async (r) => {
      const k = `${r.table}:${r.id}`;
      if (!owners.has(k)) owners.set(k, await readOwner(r.table, r.id));
    }));
  } catch {
    return { ok: false, status: 503, reason: "owner_lookup_failed" };
  }
  let rewritten = 0;
  for (const r of refs) {
    const owner = owners.get(`${r.table}:${r.id}`);
    if (typeof owner !== "string" || owner === companyId) continue; // missing: the route says so; mine: fine
    const replacement = decoy();
    if (r.at === "path") {
      // Replace the exact path segment (the nth capture) in the raw url, keeping the query string.
      const [pathPart, ...rest] = req.url.split("?");
      const segs = pathPart.split("/");
      const idx = segs.findIndex((s) => { try { return decodeURIComponent(s) === r.id; } catch { return false; } });
      if (idx >= 0) segs[idx] = replacement;
      req.url = [segs.join("/"), ...rest].join("?");
    } else if (r.at === "query") {
      const u = new URL(req.url, "http://x");
      u.searchParams.set(String(r.key), replacement);
      req.url = u.pathname + u.search;
      (req.query as Record<string, unknown>)[String(r.key)] = replacement;
    } else if (req.body && typeof req.body === "object") {
      (req.body as Record<string, unknown>)[String(r.key)] = replacement;
    }
    rewritten += 1;
    onDenied?.({ table: r.table, at: r.at });
  }
  return { ok: true, rewritten, checked: refs.length };
}

export function createOwnershipMiddleware(readOwner: ReadOwner, log: (msg: string) => void = (m) => console.warn(m)) {
  return async function ownershipMiddleware(req: Request, res: Response, next: NextFunction, companyId: string): Promise<void> {
    const verdict = await enforceOwnership(req as any, companyId, readOwner, (i) => log(`[company-guard] ${companyId} named a ${i.table} of another company (${i.at}); treated as missing`));
    if (verdict.ok === false) {
      res.status(verdict.status).json({ error: "Ownership check unavailable. Please retry." });
      return;
    }
    next();
  };
}
