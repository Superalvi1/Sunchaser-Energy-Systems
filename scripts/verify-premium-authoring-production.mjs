#!/usr/bin/env node
/**
 * Verify Phase 16 premium quotation authoring on production.
 * Usage: API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-premium-authoring-production.mjs
 */
const BASE = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
const LEAD_ID = process.env.LEAD_ID || "lead-79791bdf-6407-44ed-a151-290278f9087c";
const QUOTE_ID = process.env.QUOTE_ID || "q-c45f4d78-d205-4fa5-a190-e82423ce443d";
const WM = `${BASE}/assets/sunchaser-logo.png`;

const results = [];

function pass(id, ok, msg) {
  results.push({ id, ok, msg });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${msg}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

(async () => {
  console.log(`\n=== Phase 16 premium authoring verify @ ${BASE} ===\n`);

  const indexHtml = await fetch(`${BASE}/`).then((r) => r.text());
  const jsMatch = indexHtml.match(/src="(\/assets\/index-[^"]+\.js)"/);
  let bundleHasAuthoring = false;
  if (jsMatch) {
    const js = await fetch(`${BASE}${jsMatch[1]}`).then((r) => r.text());
    bundleHasAuthoring =
      js.includes("quote-authoring-body") ||
      js.includes("Premium Typography") ||
      js.includes("QuoteRichTextEditor");
    pass("1 frontend bundle", bundleHasAuthoring, `${jsMatch[1]} ${bundleHasAuthoring ? "has Phase 16 UI" : "OLD bundle"}`);
  } else {
    pass("1 frontend bundle", false, "no JS asset in index.html");
  }

  const state = await api("GET", "/api/state");
  pass("2 /api/state", state.status === 200, `status=${state.status}`);

  const pages = state.json?.quoteTemplatePages || [];
  const pdfSettings = state.json?.quotePdfSettings?.[0];
  pass("3 template pages", pages.length > 0, `${pages.length} pages`);

  const pdfHtml = await fetch(`${BASE}/api/export/pdf/manual-quote/${LEAD_ID}?quoteId=${QUOTE_ID}`).then((r) =>
    r.text()
  );
  pass("4 PDF export", pdfHtml.length > 5000, `len=${pdfHtml.length}`);

  const wmLayers = (pdfHtml.match(/page-watermark/g) || []).length;
  pass("5 watermark layers", wmLayers >= 3, `${wmLayers} layers`);

  const hasPricing = /Subtotal|Discount|Final Price|BOQ Gross|Turnkey/i.test(pdfHtml);
  pass("6 pricing block", hasPricing, hasPricing ? "found" : "missing");

  const hasHeadings =
    pdfHtml.includes("quote-heading-h2") ||
    pdfHtml.includes("quote-authoring-body") ||
    pdfHtml.includes("#d97706");
  pass("7 heading styles", hasHeadings, hasHeadings ? "gold/authoring CSS" : "legacy only");

  const hasTable = pdfHtml.includes("<table");
  pass("8 tables", hasTable, hasTable ? "table markup in PDF" : "none on current export");

  const hasSig =
    pdfHtml.includes("quote-signature-block") ||
    pdfHtml.includes("ceo-signature-block") ||
    /Muhammad Allauddin|Digital Seal/i.test(pdfHtml);
  pass("9 signatures", hasSig, hasSig ? "signature content found" : "not on enabled pages");

  if (pdfSettings?.id) {
    await api("POST", "/api/db/update", {
      action: "edit",
      table: "quotePdfSettings",
      id: pdfSettings.id,
      data: {
        ...pdfSettings,
        globalWatermark: { imageUrl: WM, opacity: 0.12, scale: 55, position: "center" },
        globalTypography: {
          fontFamily: "Inter, sans-serif",
          fontSize: "11px",
          headingColor: "#d97706",
          bodyColor: "#475569",
          lineHeight: "1.6",
        },
        pdfQuality: "print",
      },
    });
    await new Promise((r) => setTimeout(r, 2500));
    const pdf2 = await fetch(`${BASE}/api/export/pdf/manual-quote/${LEAD_ID}?quoteId=${QUOTE_ID}`).then((r) => r.text());
    const wm2 = (pdf2.match(/page-watermark/g) || []).length;
    pass("10 watermark after save", wm2 >= wmLayers, `${wm2} layers`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===\n`);
  process.exit(failed.length ? 1 : 0);
})();
