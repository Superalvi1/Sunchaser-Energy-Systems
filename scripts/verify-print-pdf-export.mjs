#!/usr/bin/env node
/**
 * Phase 20 — Print vs direct PDF download verification.
 * Usage: node scripts/verify-print-pdf-export.mjs [baseUrl] [leadId] [quoteId]
 */
const BASE = process.argv[2] || process.env.API_BASE_URL || "http://localhost:3000";
const LEAD_ID = process.argv[3] || process.env.VERIFY_LEAD_ID || "";
const QUOTE_ID = process.argv[4] || process.env.VERIFY_QUOTE_ID || "";

const results = [];
function pass(id, msg) {
  results.push({ id, ok: true, msg });
  console.log(`PASS ${id}: ${msg}`);
}
function fail(id, msg) {
  results.push({ id, ok: false, msg });
  console.log(`FAIL ${id}: ${msg}`);
}

async function main() {
  let leadId = LEAD_ID;
  let quoteId = QUOTE_ID;

  if (!leadId) {
    const leadsRes = await fetch(`${BASE}/api/leads`);
    if (!leadsRes.ok) {
      fail("0", `Cannot list leads (${leadsRes.status})`);
      process.exit(1);
    }
    const leads = await leadsRes.json();
    const withManual = (leads || []).find(
      (l) =>
        Array.isArray(l.quotes) &&
        l.quotes.some(
          (q) =>
            q.quote_type === "manual_boq" &&
            (q.boqRows || q.boqItems || []).some((r) => r && r.type === "item")
        )
    );
    if (!withManual) {
      fail("0", "No lead with saved manual BOQ found — pass leadId quoteId args");
      process.exit(1);
    }
    leadId = withManual.id;
    const mq = withManual.quotes.find((q) => q.quote_type === "manual_boq");
    quoteId = mq?.id || "";
  }

  const q = quoteId ? `?quoteId=${encodeURIComponent(quoteId)}` : "";
  const previewUrl = `${BASE}/api/export/pdf/manual-quote/${encodeURIComponent(leadId)}${q}`;
  const downloadUrl = `${previewUrl}/download`;

  const htmlRes = await fetch(previewUrl);
  const html = await htmlRes.text();
  if (htmlRes.ok && html.includes("sunchaserPrintDeck") && html.includes("sunchaserDownloadPdf")) {
    pass("1", "HTML preview has separate Print and Download PDF controls");
  } else if (htmlRes.ok && html.includes("Print / Save PDF")) {
    fail("1", "HTML preview still uses legacy single Print / Save PDF button");
  } else if (!htmlRes.ok) {
    fail("1", `HTML preview failed (${htmlRes.status})`);
  } else {
    fail("1", "HTML preview missing split action bar scripts");
  }

  if (htmlRes.ok && !html.includes('onclick="window.print()"')) {
    pass("2", "HTML preview does not use raw window.print() on action button");
  } else {
    fail("2", "HTML preview still wires action button to window.print() directly");
  }

  const pdfRes = await fetch(downloadUrl);
  const ct = pdfRes.headers.get("content-type") || "";
  const cd = pdfRes.headers.get("content-disposition") || "";
  const buf = Buffer.from(await pdfRes.arrayBuffer());

  if (pdfRes.ok && ct.includes("application/pdf")) {
    pass("3", `Download route returns application/pdf (${buf.length} bytes)`);
  } else {
    fail("3", `Download route wrong content-type (${ct}) status=${pdfRes.status}`);
  }

  if (pdfRes.ok && cd.includes("attachment") && /\.pdf/i.test(cd)) {
    pass("4", `Content-Disposition attachment present (${cd.slice(0, 80)})`);
  } else {
    fail("4", `Missing attachment Content-Disposition (${cd || "none"})`);
  }

  if (pdfRes.ok && buf.length > 5000 && buf.slice(0, 5).toString() === "%PDF-") {
    pass("5", "Response is valid PDF binary header");
  } else {
    fail("5", `Invalid or tiny PDF payload (${buf.length} bytes)`);
  }

  if (htmlRes.ok && html.includes("boq-table")) {
    pass("6", "HTML preview includes BOQ table markup");
  } else {
    fail("6", "HTML preview missing BOQ table");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
