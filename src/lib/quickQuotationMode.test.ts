import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sales = readFileSync(join(here, "../components/SalesTeamApp.tsx"), "utf8");
const pdf = readFileSync(join(here, "quotePdfExport.ts"), "utf8");
const server = readFileSync(join(here, "../../server.ts"), "utf8");

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

check("Quick Quotation has a dedicated no-CRM sentinel and visible entry", () => {
  assert.match(sales, /QUICK_QUOTE_LEAD_ID = "__quick_quotation_no_crm__"/);
  assert.match(sales, /data-testid="quick-quotation-no-lead"/);
  assert.match(sales, /No CRM lead .* no customer record .* PDF only/);
});

check("Quick Quotation exits before CRM create\/update quote persistence", () => {
  const marker = "quickQuotePayloadRef.current = quoteData";
  const idx = sales.indexOf(marker);
  const saveIdx = sales.indexOf("let savedQuoteId = editingQuoteId", idx);
  assert.ok(idx >= 0 && saveIdx > idx);
  const quick = sales.slice(idx - 100, saveIdx);
  assert.doesNotMatch(quick, /\/api\/leads\//);
});

check("Quick PDF stages on Android and downloads natively without CRM persistence", () => {
  assert.match(pdf, /manual-quote\?stage=1/);
  assert.match(pdf, /FileTransfer\.downloadFile/);
  assert.match(pdf, /FileViewer\.openDocumentFromLocalPath/);
  assert.match(sales, /downloadEphemeralManualQuotePdf\(quickQuotePayloadRef\.current\)/);
});

check("server ephemeral manual quote can return PDF without saving lead or quote", () => {
  const start = server.indexOf('app.post("/api/export/pdf/manual-quote"');
  const end = server.indexOf("function buildTemplatePreviewMockData", start);
  assert.ok(start >= 0 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /req\.query\.download === "1"/);
  assert.match(route, /sendQuotationPdfResponse/);
  assert.doesNotMatch(route, /persistQuotationToSupabase/);
  assert.doesNotMatch(route, /create-quote/);
});

check("native PDF path streams with FileTransfer instead of blob/Base64/Share", () => {
  assert.match(pdf, /FileTransfer\.downloadFile/);
  assert.match(pdf, /FileViewer\.openDocumentFromLocalPath/);
  assert.match(pdf, /Directory\.Documents/);
  assert.doesNotMatch(pdf, /Share\.share/);
  assert.doesNotMatch(pdf, /blobToBase64/);
});


check("server staged PDF route is authenticated and one-time", () => {
  assert.match(server, /app\.get\("\/api\/export\/pdf\/staged\/:token"/);
  assert.match(server, /resolveStaffActor\(req, res\)/);
  assert.match(server, /takeStagedQuotationPdf/);
  assert.match(server, /Cache-Control", "no-store"/);
});

check("browser PDF path still uses standard anchor download", () => {
  assert.match(pdf, /URL\.createObjectURL\(blob\)/);
  assert.match(pdf, /anchor\.download = filename/);
});

console.log(`\nquick quotation mode tests: ${passed} passed`);
