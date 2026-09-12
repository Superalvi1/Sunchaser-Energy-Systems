/**
 * Deterministic Terms & Conditions resolution for standard customer quotations.
 *
 * Priority:
 *   1. Saved quotation terms snapshot (historical freeze)
 *   2. Selected quote template terms1/terms2 (and authoring "terms" pages)
 *   3. Company saved terms
 *   4. Legacy fallback — only if none of the above exist
 *
 * Weak one-liner defaults such as "Quoted prices are valid for 3 days." are
 * NOT treated as a real snapshot; they caused Page 3 to skip template terms.
 */

import { sanitizeQuoteEditorHtml } from "./quoteAuthoring";
import { escapeHtml, parseQuotePageExtendedSettings } from "./quotePdfLayout";

export const TERMS_PAGE_CHAR_BUDGET = 2800;

export const EXISTING_FALLBACK_QUOTE_TERMS = [
  "Quotation validity: 3 days from date of issuance.",
  "Rates are based on current fiscal/DISCO tariffs and duties. Any change will affect the net final price.",
  "Standard Payment schedule: 50% Advance, 40% on delivery of equipment, 10% post-commissioning.",
  "Accepted Payment methods: Bank transfer, pay order, or direct bank deposit.",
  "Work will commence within 3 days after receipt of the advance payment.",
  "Product substitution: In case of hardware supply limitations, Sunchaser may substitute components with equivalent grade models.",
  "Installation standards: All electrical and mechanical works follow Sunchaser's ISO quality controls.",
  "Warranty per manufacturer terms for imported equipment.",
];

const WEAK_DEFAULT_QUOTE_TERMS = [
  "quoted prices are valid for 3 days.",
  "quoted prices are valid for 3 days",
  "standard terms and conditions apply.",
  "standard terms and conditions apply",
  "generation yield matches simulation rules.",
  "generation yield matches simulation rules",
];

export type QuoteTermsSource = "snapshot" | "quote" | "template" | "company" | "fallback";

export interface QuoteTermsPageSnapshot {
  title: string;
  pageType: string;
  contentHtml: string;
  contentText: string;
}

export interface QuoteTermsSnapshot {
  templateId: string;
  templateName: string;
  resolvedAt: string;
  source: QuoteTermsSource;
  pages: QuoteTermsPageSnapshot[];
  html: string;
  clauses: string[];
}

export interface ResolvedQuoteTerms {
  snapshot: QuoteTermsSnapshot;
  source: QuoteTermsSource;
  templateId: string;
  templateName: string;
  html: string;
  clauses: string[];
  pages: QuoteTermsPageSnapshot[];
  hasRichHtml: boolean;
}

function normalizeWeak(text: string): string {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isWeakDefaultTerms(raw: unknown): boolean {
  const text = normalizeWeak(typeof raw === "string" ? raw : String(raw || ""));
  if (!text) return true;
  return WEAK_DEFAULT_QUOTE_TERMS.includes(text);
}

export function looksLikeHtml(raw: unknown): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(String(raw || ""));
}

export function htmlToPlainText(html: string): string {
  const safe = sanitizeQuoteEditorHtml(String(html || ""));
  return safe
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-4]|li|tr|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<h[1-4][^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/"/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

export function htmlToClauses(html: string): string[] {
  return htmlToPlainText(html)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function plainTextToHtml(text: string): string {
  const trimmed = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((l) => escapeHtml(l.trim())).filter(Boolean);
      if (!lines.length) return "";
      return `<p>${lines.join("<br />")}</p>`;
    })
    .filter(Boolean)
    .join("");
}

export function clausesToHtml(clauses: string[]): string {
  return (clauses || [])
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .map((c) => `<p>${escapeHtml(c)}</p>`)
    .join("");
}

export function clausesFromUnknown(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((t) => {
        if (typeof t === "string") return t.trim();
        if (t && typeof t === "object") {
          return String((t as any).termText || (t as any).term_text || (t as any).text || "").trim();
        }
        return "";
      })
      .filter(Boolean);
  }
  const text = String(raw || "").trim();
  if (!text) return [];
  if (looksLikeHtml(text)) return htmlToClauses(text);
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function companyClauses(activeState: any): string[] {
  const dbTerms = Array.isArray(activeState?.companyTerms) ? activeState.companyTerms : [];
  return dbTerms
    .map((t: any) => String(t?.termText || t?.term_text || t?.text || "").trim())
    .filter(Boolean);
}

export function freezeQuoteTermsSnapshot(
  snapshot: QuoteTermsSnapshot | null | undefined
): QuoteTermsSnapshot | undefined {
  if (!snapshot) return undefined;
  try {
    return JSON.parse(JSON.stringify(snapshot)) as QuoteTermsSnapshot;
  } catch {
    return snapshot;
  }
}

export function readTermsSnapshot(raw: unknown): QuoteTermsSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as any;
  const pages = Array.isArray(obj.pages)
    ? obj.pages
        .map((p: any) => ({
          title: String(p?.title || ""),
          pageType: String(p?.pageType || p?.page_type || ""),
          contentHtml: sanitizeQuoteEditorHtml(String(p?.contentHtml || p?.html || "")),
          contentText: String(p?.contentText || p?.text || "").trim(),
        }))
        .filter((p: QuoteTermsPageSnapshot) => p.contentHtml || p.contentText)
    : [];
  const html = sanitizeQuoteEditorHtml(String(obj.html || pages.map((p: QuoteTermsPageSnapshot) => p.contentHtml).join("")));
  const clauses = Array.isArray(obj.clauses) && obj.clauses.length
    ? obj.clauses.map((c: unknown) => String(c || "").trim()).filter(Boolean)
    : htmlToClauses(html);
  if (!html && !clauses.length && !pages.length) return null;
  const source = String(obj.source || "snapshot") as QuoteTermsSource;
  return {
    templateId: String(obj.templateId || obj.template_id || ""),
    templateName: String(obj.templateName || obj.template_name || ""),
    resolvedAt: String(obj.resolvedAt || obj.resolved_at || ""),
    source: ["snapshot", "quote", "template", "company", "fallback"].includes(source) ? source : "snapshot",
    pages,
    html,
    clauses,
  };
}

export function hasSnapshotContent(snapshot: QuoteTermsSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  if (snapshot.clauses?.some((c) => String(c || "").trim() && !isWeakDefaultTerms(c))) return true;
  if (htmlToPlainText(snapshot.html || "").trim() && !isWeakDefaultTerms(snapshot.html)) return true;
  return (snapshot.pages || []).some(
    (p) =>
      (htmlToPlainText(p.contentHtml || "").trim() && !isWeakDefaultTerms(p.contentHtml)) ||
      (p.contentText && !isWeakDefaultTerms(p.contentText))
  );
}

function isTermsPage(page: any): boolean {
  if (!page) return false;
  if (page.is_enabled === false || page.isEnabled === false) return false;
  const type = String(page.page_type || page.pageType || "").toLowerCase();
  const title = String(page.title || "");
  const ext = parseQuotePageExtendedSettings(String(page.body_text || page.bodyText || ""));
  const authoring = String(ext.authoringPageType || "").toLowerCase();
  if (type === "terms1" || type === "terms2" || type === "terms") return true;
  if (authoring === "terms") return true;
  return /terms\s*((&|&|and)\s*)?conditions/i.test(title);
}

export function resolveSelectedTemplateId(quoteObj: any, activeState?: any): string {
  const direct = String(quoteObj?.templateId || quoteObj?.template_id || "").trim();
  if (direct) return direct;
  const templates = Array.isArray(activeState?.quoteTemplates) ? activeState.quoteTemplates : [];
  const official = templates.find((t: any) => /official/i.test(String(t?.name || "")));
  const active = templates.find((t: any) => t && t.is_active !== false && t.isActive !== false);
  return String(official?.id || active?.id || templates[0]?.id || "tmpl-1");
}

export function resolveTemplateName(templateId: string, activeState?: any): string {
  const templates = Array.isArray(activeState?.quoteTemplates) ? activeState.quoteTemplates : [];
  const match = templates.find((t: any) => String(t?.id) === String(templateId));
  return String(match?.name || (templateId === "tmpl-1" ? "Sunchaser Official Proposal Template" : "") || "");
}

function pageBody(page: any): { html: string; text: string } {
  const raw = String(page?.body_text || page?.bodyText || "");
  const ext = parseQuotePageExtendedSettings(raw);
  const html = sanitizeQuoteEditorHtml(String(ext.bodyHtml || ""));
  const text = String(ext.bodyText || "").trim();
  if (html && htmlToPlainText(html)) {
    return { html, text: htmlToPlainText(html) };
  }
  if (text) {
    return { html: looksLikeHtml(text) ? sanitizeQuoteEditorHtml(text) : plainTextToHtml(text), text };
  }
  if (raw && !raw.trim().startsWith("{")) {
    return {
      html: looksLikeHtml(raw) ? sanitizeQuoteEditorHtml(raw) : plainTextToHtml(raw),
      text: looksLikeHtml(raw) ? htmlToPlainText(raw) : raw.trim(),
    };
  }
  return { html: "", text: "" };
}

export function extractTemplateTermsPages(activeState: any, templateId?: string): QuoteTermsPageSnapshot[] {
  const pages = Array.isArray(activeState?.quoteTemplatePages) ? activeState.quoteTemplatePages : [];
  const tid = String(templateId || "").trim();
  return pages
    .filter((p: any) => {
      if (!isTermsPage(p)) return false;
      if (!tid) return true;
      return String(p.template_id || p.templateId || "") === tid;
    })
    .sort(
      (a: any, b: any) =>
        Number(a.sort_order ?? a.sortOrder ?? 0) - Number(b.sort_order ?? b.sortOrder ?? 0)
    )
    .map((p: any) => {
      const body = pageBody(p);
      return {
        title: String(p.title || "Terms & Conditions"),
        pageType: String(p.page_type || p.pageType || "terms"),
        contentHtml: body.html,
        contentText: body.text,
      };
    })
    .filter((p: QuoteTermsPageSnapshot) => p.contentHtml || p.contentText);
}

function snapshotFromParts(
  source: QuoteTermsSource,
  templateId: string,
  templateName: string,
  pages: QuoteTermsPageSnapshot[],
  html: string,
  clauses: string[]
): QuoteTermsSnapshot {
  const safeHtml = sanitizeQuoteEditorHtml(html);
  const safeClauses =
    clauses.length > 0 ? clauses : htmlToClauses(safeHtml);
  return {
    templateId,
    templateName,
    resolvedAt: "",
    source,
    pages,
    html: safeHtml,
    clauses: safeClauses,
  };
}

function resolvedFromSnapshot(snapshot: QuoteTermsSnapshot, source: QuoteTermsSource): ResolvedQuoteTerms {
  const html = sanitizeQuoteEditorHtml(snapshot.html || snapshot.pages.map((p) => p.contentHtml).join(""));
  const clauses = snapshot.clauses?.length ? snapshot.clauses : htmlToClauses(html);
  const hasRichHtml = /<(h[1-4]|ul|ol|li|table|strong|b|u|em)\b/i.test(html);
  return {
    snapshot: { ...snapshot, html, clauses, source },
    source,
    templateId: snapshot.templateId,
    templateName: snapshot.templateName,
    html,
    clauses,
    pages: snapshot.pages,
    hasRichHtml,
  };
}

export function resolveQuoteTerms(quoteObj: any, activeState?: any): ResolvedQuoteTerms {
  const templateId = resolveSelectedTemplateId(quoteObj, activeState);
  const templateName = resolveTemplateName(templateId, activeState);

  const saved = readTermsSnapshot(quoteObj?.termsSnapshot || quoteObj?.customerTermsSnapshot);
  if (saved && hasSnapshotContent(saved)) {
    return resolvedFromSnapshot(saved, "snapshot");
  }

  const rawQuoteTerms = quoteObj?.termsAndConditions ?? quoteObj?.terms_and_conditions;
  const quoteHtml = looksLikeHtml(rawQuoteTerms) ? sanitizeQuoteEditorHtml(String(rawQuoteTerms || "")) : "";
  const fromQuote = clausesFromUnknown(rawQuoteTerms);
  if (!isWeakDefaultTerms(rawQuoteTerms) && (fromQuote.length || htmlToPlainText(quoteHtml))) {
    const html = quoteHtml || clausesToHtml(fromQuote);
    const pages: QuoteTermsPageSnapshot[] = [
      {
        title: "Terms & Conditions",
        pageType: "terms",
        contentHtml: html,
        contentText: fromQuote.join("\n"),
      },
    ];
    return resolvedFromSnapshot(
      snapshotFromParts("quote", templateId, templateName, pages, html, fromQuote),
      "quote"
    );
  }

  const templatePages = extractTemplateTermsPages(activeState, templateId);
  if (templatePages.length) {
    const html = templatePages.map((p) => p.contentHtml).join("");
    const clauses = templatePages.flatMap((p) =>
      p.contentHtml && htmlToPlainText(p.contentHtml)
        ? htmlToClauses(p.contentHtml)
        : p.contentText
          ? clausesFromUnknown(p.contentText)
          : []
    );
    if (htmlToPlainText(html) || clauses.length) {
      return resolvedFromSnapshot(
        snapshotFromParts("template", templateId, templateName, templatePages, html, clauses),
        "template"
      );
    }
  }

  const fromCompany = companyClauses(activeState);
  if (fromCompany.length) {
    const html = clausesToHtml(fromCompany);
    const pages: QuoteTermsPageSnapshot[] = [
      {
        title: "Terms & Conditions",
        pageType: "terms",
        contentHtml: html,
        contentText: fromCompany.join("\n"),
      },
    ];
    return resolvedFromSnapshot(
      snapshotFromParts("company", templateId, templateName, pages, html, fromCompany),
      "company"
    );
  }

  const fallback = EXISTING_FALLBACK_QUOTE_TERMS.slice();
  const html = clausesToHtml(fallback);
  const pages: QuoteTermsPageSnapshot[] = [
    {
      title: "Terms & Conditions",
      pageType: "terms",
      contentHtml: html,
      contentText: fallback.join("\n"),
    },
  ];
  return resolvedFromSnapshot(
    snapshotFromParts("fallback", templateId, templateName, pages, html, fallback),
    "fallback"
  );
}

/** Saved quotation legal text is authoritative. Current company_terms only fill a missing snapshot. */
export function resolveQuoteTermsClauses(quoteObj: any, activeState?: any): string[] {
  return resolveQuoteTerms(quoteObj, activeState).clauses;
}

export function buildSavedQuoteTermsSnapshot(args: {
  existingSnapshot?: unknown;
  selectedTemplateId?: string;
  quoteDraft?: any;
  activeState?: any;
  now?: Date;
}): QuoteTermsSnapshot {
  const templateId = String(
    args.selectedTemplateId || args.quoteDraft?.templateId || args.quoteDraft?.template_id || ""
  ).trim();
  const existing = readTermsSnapshot(args.existingSnapshot);
  if (existing && hasSnapshotContent(existing) && (!templateId || existing.templateId === templateId)) {
    const frozen = freezeQuoteTermsSnapshot(existing)!;
    return frozen;
  }
  const resolved = resolveQuoteTerms(
    {
      ...(args.quoteDraft || {}),
      termsSnapshot: undefined,
      customerTermsSnapshot: undefined,
      templateId: templateId || resolveSelectedTemplateId(args.quoteDraft, args.activeState),
    },
    args.activeState
  );
  const snapshot = freezeQuoteTermsSnapshot({
    ...resolved.snapshot,
    templateId: resolved.templateId,
    templateName: resolved.templateName,
    resolvedAt: (args.now || new Date()).toISOString(),
    source: resolved.source,
  })!;
  return snapshot;
}

export function splitHtmlBlocks(html: string): string[] {
  const trimmed = sanitizeQuoteEditorHtml(String(html || "")).trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/(?=<(?:h[1-4]|p|ul|ol|div|table|hr|blockquote)(?:\s|>))/i);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function paginateHtmlByBudget(html: string, budget = TERMS_PAGE_CHAR_BUDGET): string[] {
  const blocks = splitHtmlBlocks(html);
  if (!blocks.length) {
    const fallback = sanitizeQuoteEditorHtml(html).trim();
    return fallback ? [fallback] : [];
  }
  const pages: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (!current) {
      current = block;
      continue;
    }
    if (current.length + block.length > budget) {
      pages.push(current);
      current = block;
    } else {
      current += block;
    }
  }
  if (current) pages.push(current);
  return pages;
}

export function paginateClauses(
  clauses: string[],
  budget = TERMS_PAGE_CHAR_BUDGET,
  maxPerPage = 14
): string[][] {
  const pages: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const clause of clauses || []) {
    const text = String(clause || "").trim();
    if (!text) continue;
    const len = text.length;
    if (current.length && (chars + len > budget || current.length >= maxPerPage)) {
      pages.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += len;
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}

export function paginateResolvedTerms(resolved: ResolvedQuoteTerms): string[] {
  if (resolved.hasRichHtml && resolved.html) {
    const fromPages = (resolved.pages || [])
      .map((p) => sanitizeQuoteEditorHtml(p.contentHtml || (p.contentText ? plainTextToHtml(p.contentText) : "")))
      .filter((html) => htmlToPlainText(html));
    if (fromPages.length > 1) {
      return fromPages.flatMap((html) => paginateHtmlByBudget(html));
    }
    const packed = paginateHtmlByBudget(resolved.html);
    if (packed.length) return packed;
  }
  return paginateClauses(resolved.clauses).map((group) => clausesToHtml(group));
}

const GENERIC_PAYMENT = /50%\s*advance/i;
const PAYMENT_IN_TERMS = /payment|advance|bank transfer|pay order/i;
const WARRANTY_IN_TERMS = /warranty/i;

/**
 * Template / snapshot legal text is the source of truth for customer PDF wording.
 * Structured paymentSchedule / warrantyTerms remain CRM fields but must not
 * silently contradict the saved Terms page.
 */
export function shouldRenderExtraCommercialCard(
  kind: "payment" | "warranty",
  value: string,
  resolved: ResolvedQuoteTerms
): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  if (resolved.source === "template" || resolved.source === "snapshot") return false;
  const blob = `${resolved.html}\n${resolved.clauses.join("\n")}`.toLowerCase();
  if (blob.includes(text.toLowerCase())) return false;
  if (kind === "payment" && GENERIC_PAYMENT.test(text) && PAYMENT_IN_TERMS.test(blob)) return false;
  if (kind === "warranty" && WARRANTY_IN_TERMS.test(blob)) return false;
  return true;
}

export function termsSnapshotPlainText(snapshot: QuoteTermsSnapshot | null | undefined): string {
  if (!snapshot) return "";
  if (snapshot.clauses?.length) return snapshot.clauses.join("\n");
  return htmlToPlainText(snapshot.html || "");
}
