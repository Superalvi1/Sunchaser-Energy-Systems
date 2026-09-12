import assert from "node:assert/strict";
import {
  buildSavedQuoteTermsSnapshot,
  clausesFromUnknown,
  EXISTING_FALLBACK_QUOTE_TERMS,
  extractTemplateTermsPages,
  htmlToClauses,
  isWeakDefaultTerms,
  paginateClauses,
  paginateHtmlByBudget,
  resolveQuoteTerms,
  resolveQuoteTermsClauses,
  shouldRenderExtraCommercialCard,
  TERMS_PAGE_CHAR_BUDGET,
} from "./quoteTermsSnapshot.ts";
import { compileThreePageQuotationHtml, THREE_PAGE_QUOTATION_PAGE_COUNT } from "./quoteThreePageRender.ts";
import { sanitizeQuoteEditorHtml } from "./quoteAuthoring.ts";
import { serializeQuotePageBody } from "./quotePdfLayout.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

const DETAILED_TERMS_HTML = `
  <h2>1. Commercial Terms</h2>
  <p>This quotation is valid for <strong>seven (7) working days</strong> from the date of issue.</p>
  <h2>2. Payment Schedule</h2>
  <ol>
    <li>40% advance with signed acceptance</li>
    <li>50% on delivery of imported equipment to site</li>
    <li>10% after commissioning and LESCO documentation handover</li>
  </ol>
  <h2>3. Warranty</h2>
  <p>Modules carry a 25-year linear power warranty. Inverters carry a 10-year manufacturer warranty. Workmanship is covered for 24 months from commissioning.</p>
  <p>Site access, civil permissions and DISCO documentation remain the client's responsibility.</p>
`.trim();

function officialTemplateState(termsHtml = DETAILED_TERMS_HTML) {
  return {
    quoteTemplates: [{ id: "tmpl-1", name: "Sunchaser Official Proposal Template", is_active: true }],
    quoteTemplatePages: [
      {
        id: "tmpl-p-6",
        template_id: "tmpl-1",
        page_type: "terms1",
        title: "Terms, Conditions & Regulations (1/2)",
        is_enabled: true,
        sort_order: 9,
        body_text: serializeQuotePageBody({
          bodyText: "Detailed terms",
          bodyHtml: termsHtml,
          authoringPageType: "terms",
        }),
      },
      {
        id: "tmpl-p-7",
        template_id: "tmpl-2",
        page_type: "terms1",
        title: "Other Template Terms",
        is_enabled: true,
        sort_order: 1,
        body_text: serializeQuotePageBody({
          bodyText: "OTHER TEMPLATE ONLY",
          bodyHtml: "<p>OTHER TEMPLATE ONLY</p>",
          authoringPageType: "terms",
        }),
      },
    ],
    companyTerms: [
      { termText: "Quotation validity: 3 days from date of issuance." },
      { termText: "Standard Payment schedule: 50% Advance, 40% on delivery of equipment, 10% post-commissioning." },
    ],
  };
}

const lead = { id: "lead-terms", name: "Terms Client", phone: "0300-0000000", location: "Lahore" };
const boq = [{ id: "p", type: "item", name: "Panel", qty: 1, rate: 1, total: 1 }];

check("weak default one-liners are not treated as real saved terms", () => {
  assert.equal(isWeakDefaultTerms("Quoted prices are valid for 3 days."), true);
  assert.equal(isWeakDefaultTerms("Standard terms and conditions apply."), true);
  assert.equal(isWeakDefaultTerms(""), true);
  assert.equal(isWeakDefaultTerms("This quotation is valid for seven (7) working days."), false);
});

check("selected template saved Terms are used", () => {
  const resolved = resolveQuoteTerms(
    { templateId: "tmpl-1", termsAndConditions: "Quoted prices are valid for 3 days." },
    officialTemplateState()
  );
  assert.equal(resolved.source, "template");
  assert.match(resolved.html, /seven \(7\) working days/);
  assert.match(resolved.html, /40% advance with signed acceptance/);
  assert.equal(resolved.clauses.some((c) => /50% Advance/.test(c)), false);
});

check("fallback is NOT used when template Terms exist", () => {
  const clauses = resolveQuoteTermsClauses({ templateId: "tmpl-1" }, officialTemplateState());
  assert.equal(clauses.some((c) => c === EXISTING_FALLBACK_QUOTE_TERMS[0]), false);
  assert.ok(clauses.some((c) => /seven \(7\) working days/.test(c)));
  const rendered = compileThreePageQuotationHtml(
    { id: "q-tmpl", clientName: "Terms Client", templateId: "tmpl-1", boqItems: boq },
    lead,
    officialTemplateState()
  );
  assert.match(rendered.html, /seven \(7\) working days/);
  assert.doesNotMatch(rendered.html, /Quoted prices are valid for 3 days/);
  assert.match(rendered.html, /data-sunchaser-terms-source="template"/);
});

check("saved quotation stores Terms snapshot", () => {
  const snapshot = buildSavedQuoteTermsSnapshot({
    selectedTemplateId: "tmpl-1",
    quoteDraft: { termsAndConditions: "Quoted prices are valid for 3 days." },
    activeState: officialTemplateState(),
    now: new Date("2026-09-12T00:00:00.000Z"),
  });
  assert.equal(snapshot.templateId, "tmpl-1");
  assert.equal(snapshot.templateName, "Sunchaser Official Proposal Template");
  assert.equal(snapshot.source, "template");
  assert.ok(snapshot.pages.length >= 1);
  assert.match(snapshot.html, /40% advance/);
  assert.equal(snapshot.resolvedAt, "2026-09-12T00:00:00.000Z");
});

check("historical quote reload uses frozen Terms snapshot", () => {
  const snapshot = buildSavedQuoteTermsSnapshot({
    selectedTemplateId: "tmpl-1",
    quoteDraft: {},
    activeState: officialTemplateState(),
  });
  const laterState = officialTemplateState("<p>VERSION B — new template wording</p>");
  laterState.companyTerms = [{ termText: "NEW COMPANY TERM" }];
  const rendered = compileThreePageQuotationHtml(
    {
      id: "q-101",
      clientName: "Snapshot Client",
      templateId: "tmpl-1",
      termsSnapshot: snapshot,
      boqItems: boq,
    },
    lead,
    laterState
  );
  assert.match(rendered.html, /seven \(7\) working days/);
  assert.doesNotMatch(rendered.html, /VERSION B/);
  assert.doesNotMatch(rendered.html, /NEW COMPANY TERM/);
  assert.match(rendered.html, /data-sunchaser-terms-source="snapshot"/);
});

check("changing template later does not mutate historical quote", () => {
  const snapshot = buildSavedQuoteTermsSnapshot({
    selectedTemplateId: "tmpl-1",
    quoteDraft: {},
    activeState: officialTemplateState(),
  });
  const kept = buildSavedQuoteTermsSnapshot({
    existingSnapshot: snapshot,
    selectedTemplateId: "tmpl-1",
    quoteDraft: {},
    activeState: officialTemplateState("<p>VERSION B</p>"),
  });
  assert.match(kept.html, /seven \(7\) working days/);
  assert.doesNotMatch(kept.html, /VERSION B/);
});

check("new quote uses latest template Terms", () => {
  const snapshot = buildSavedQuoteTermsSnapshot({
    selectedTemplateId: "tmpl-1",
    quoteDraft: {},
    activeState: officialTemplateState("<p>VERSION B — latest</p>"),
  });
  assert.match(snapshot.html, /VERSION B/);
});

check("selected template mapping uses that template's pages only", () => {
  const pages = extractTemplateTermsPages(officialTemplateState(), "tmpl-1");
  assert.equal(pages.every((p) => /seven \(7\)|Detailed terms/.test(p.contentText + p.contentHtml)), true);
  const other = resolveQuoteTerms({ templateId: "tmpl-2" }, officialTemplateState());
  assert.match(other.html, /OTHER TEMPLATE ONLY/);
  assert.doesNotMatch(other.html, /seven \(7\) working days/);
});

check("rich heading / numbering content survives rendering safely", () => {
  const rendered = compileThreePageQuotationHtml(
    { id: "q-rich", clientName: "Rich Client", templateId: "tmpl-1", boqItems: boq },
    lead,
    officialTemplateState()
  );
  assert.match(rendered.html, /<h2>1\. Commercial Terms<\/h2>/);
  assert.match(rendered.html, /<ol>/);
  assert.match(rendered.html, /<strong>seven \(7\) working days<\/strong>/);
});

check("unsafe HTML is sanitized", () => {
  const dirty = `<p>Safe clause</p><script>alert(1)</script><img src=x onerror="alert(2)" /><a href="javascript:alert(3)">x</a>`;
  const clean = sanitizeQuoteEditorHtml(dirty);
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onerror/i);
  assert.doesNotMatch(clean, /javascript:/i);
  const rendered = compileThreePageQuotationHtml(
    { id: "q-xss", clientName: "Safe Client", templateId: "tmpl-1", boqItems: boq },
    lead,
    officialTemplateState(dirty)
  );
  const termsBody = rendered.html.match(/class="quote-terms-body"[\s\S]*?data-sunchaser-terms-signature/)?.[0] || "";
  assert.match(termsBody, /Safe clause/);
  assert.doesNotMatch(termsBody, /<script/i);
  assert.doesNotMatch(termsBody, /onerror/i);
  assert.doesNotMatch(termsBody, /javascript:/i);
  assert.doesNotMatch(rendered.html, /alert\(1\)/);
});

check("long Terms are never silently truncated", () => {
  const clauses = Array.from({ length: 20 }, (_, i) => `Legal clause ${i} ${"wording ".repeat(30)}`);
  const packed = paginateClauses(clauses);
  assert.ok(packed.length > 1);
  assert.equal(packed.flat().length, 20);
  assert.equal(packed.flat()[0], clauses[0].trim());
  assert.equal(packed.flat()[19], clauses[19].trim());
});

check("continuation pages preserve all terms and put signature on the final page", () => {
  const terms = Array.from({ length: 20 }, (_, i) => `Legal clause ${i} ${"wording ".repeat(30)}`);
  const rendered = compileThreePageQuotationHtml(
    { id: "q-long", clientName: "Long Client", boqItems: boq },
    lead,
    { companyTerms: terms.map((termText, i) => ({ id: `t-${i}`, termText })) }
  );
  assert.equal(rendered.termsOverflow, true);
  assert.equal(rendered.exportBlocked, false);
  assert.ok(rendered.pageCount > THREE_PAGE_QUOTATION_PAGE_COUNT);
  assert.match(rendered.html, /Legal clause 0/);
  assert.match(rendered.html, /Legal clause 19/);
  assert.match(rendered.html, /data-sunchaser-terms-page="1"/);
  assert.match(rendered.html, /data-sunchaser-terms-pages="[2-9]"/);
  const signatureMatches = rendered.html.match(/data-sunchaser-terms-signature="final"/g) || [];
  assert.equal(signatureMatches.length, 1);
  const lastTermsIdx = rendered.html.lastIndexOf("data-sunchaser-terms-page=");
  const sigIdx = rendered.html.indexOf('data-sunchaser-terms-signature="final"');
  assert.ok(sigIdx > lastTermsIdx);
});

check("preview and downloaded PDF use identical terms source", () => {
  const quote = { id: "q-same", clientName: "Same Client", templateId: "tmpl-1", boqItems: boq };
  const state = officialTemplateState();
  const preview = compileThreePageQuotationHtml(quote, lead, state, { mode: "manual" });
  const download = compileThreePageQuotationHtml(quote, lead, state, { mode: "manual", hideActionBar: true });
  assert.equal(preview.pageCount, download.pageCount);
  const previewTerms = String(preview.html.match(/quote-terms-body[\s\S]*?<\/div>/)?.[0] || preview.html);
  assert.match(preview.html, /seven \(7\) working days/);
  assert.match(download.html, /seven \(7\) working days/);
  assert.equal(
    preview.html.includes("40% advance with signed acceptance"),
    download.html.includes("40% advance with signed acceptance")
  );
  void previewTerms;
});

check("legacy quote without terms snapshot still renders", () => {
  const rendered = compileThreePageQuotationHtml(
    {
      id: "q-legacy",
      clientName: "Legacy Client",
      boqItems: [{ id: "legacy-1", type: "item", name: "Old panel line", qty: 1, rate: 1, total: 1 }],
    },
    lead,
    { companyTerms: [], quotePdfSettings: [] }
  );
  assert.ok(rendered.pageCount >= 3);
  assert.match(rendered.html, /Old panel line/);
  assert.match(rendered.html, /Quotation validity: 3 days from date of issuance/);
});

check("legacy quote with stored template id uses that template", () => {
  const rendered = compileThreePageQuotationHtml(
    {
      id: "q-legacy-tmpl",
      clientName: "Legacy Template Client",
      templateId: "tmpl-1",
      termsAndConditions: "Quoted prices are valid for 3 days.",
      boqItems: boq,
    },
    lead,
    officialTemplateState()
  );
  assert.match(rendered.html, /seven \(7\) working days/);
  assert.doesNotMatch(rendered.html, /Quoted prices are valid for 3 days/);
});

check("payment schedule does not silently contradict selected template", () => {
  const rendered = compileThreePageQuotationHtml(
    {
      id: "q-pay",
      clientName: "Pay Client",
      templateId: "tmpl-1",
      paymentSchedule: "50% Advance, 40% Delivery, 10% Commissioning",
      warrantyTerms: "25 year power degradation, 10 year inverter warranty",
      boqItems: boq,
    },
    lead,
    officialTemplateState()
  );
  assert.match(rendered.html, /40% advance with signed acceptance/);
  assert.doesNotMatch(rendered.html, /<strong>Payment:<\/strong> 50% Advance/);
  assert.doesNotMatch(rendered.html, /<strong>Warranty:<\/strong> 25 year power degradation/);
  const resolved = resolveQuoteTerms({ templateId: "tmpl-1" }, officialTemplateState());
  assert.equal(
    shouldRenderExtraCommercialCard("payment", "50% Advance, 40% Delivery, 10% Commissioning", resolved),
    false
  );
});

check("empty template and company uses fallback", () => {
  const resolved = resolveQuoteTerms({}, { quoteTemplates: [], quoteTemplatePages: [], companyTerms: [] });
  assert.equal(resolved.source, "fallback");
  assert.deepEqual(resolved.clauses, EXISTING_FALLBACK_QUOTE_TERMS);
});

check("saved quote substantial terms beat newer company terms", () => {
  const clauses = resolveQuoteTermsClauses(
    { termsAndConditions: "OLD TERM" },
    { companyTerms: [{ termText: "NEW TERM" }] }
  );
  assert.deepEqual(clauses, ["OLD TERM"]);
});

check("html to clauses does not collapse paragraphs", () => {
  const clauses = htmlToClauses("<h2>A</h2><p>Paragraph one.</p><p>Paragraph two.</p>");
  assert.ok(clauses.includes("A"));
  assert.ok(clauses.includes("Paragraph one."));
  assert.ok(clauses.includes("Paragraph two."));
});

check("clausesFromUnknown keeps multi-line text", () => {
  assert.deepEqual(clausesFromUnknown("One\n\nTwo\nThree"), ["One", "Two", "Three"]);
});

check("paginate html keeps every block", () => {
  const html = Array.from({ length: 12 }, (_, i) => `<p>${"block".repeat(80)} ${i}</p>`).join("");
  const pages = paginateHtmlByBudget(html, 400);
  assert.ok(pages.length > 1);
  assert.match(pages.join(""), /block 0/);
  assert.match(pages.join(""), /block 11/);
  assert.ok(pages.every((p) => p.length));
});

check("standard short terms stay on the 3-page renderer", () => {
  const rendered = compileThreePageQuotationHtml(
    { id: "q-short", clientName: "Short Client", boqItems: boq },
    lead,
    { companyTerms: [{ termText: "Clause one." }] }
  );
  assert.equal(rendered.pageCount, THREE_PAGE_QUOTATION_PAGE_COUNT);
  assert.equal(rendered.termsOverflow, false);
  assert.match(rendered.html, /data-sunchaser-page-count="3"/);
});

check("TERMS_PAGE_CHAR_BUDGET matches previous 2800 cap", () => {
  assert.equal(TERMS_PAGE_CHAR_BUDGET, 2800);
});

check("Save Customer Quote and PDF renderer share the snapshot path", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sales = readFileSync(join(__dirname, "../components/SalesTeamApp.tsx"), "utf8");
  const db = readFileSync(join(__dirname, "../../dbManager.ts"), "utf8");
  const render = readFileSync(join(__dirname, "quoteThreePageRender.ts"), "utf8");
  assert.match(sales, /buildSavedQuoteTermsSnapshot/);
  assert.match(sales, /termsSnapshot/);
  assert.match(sales, /installationChargesFromBoqRow/);
  assert.match(db, /termsSnapshot: quote\.termsSnapshot/);
  assert.match(render, /resolveQuoteTerms\(/);
  assert.match(render, /paginateResolvedTerms|paginateClauses/);
  assert.doesNotMatch(render, /exportBlocked = overflowBlocked \|\| termsFit\.overflow/);
});

console.log(`\nquoteTermsSnapshot tests: ${pass} passed`);
