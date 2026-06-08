#!/usr/bin/env node
/**
 * Verify global quotation watermark save/load on production.
 * Usage: API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-global-watermark-production.mjs
 */
const BASE = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
const WM = `${BASE}/assets/sunchaser-logo.png`;
const LEAD_ID = process.env.LEAD_ID || "lead-79791bdf-6407-44ed-a151-290278f9087c";
const QUOTE_ID = process.env.QUOTE_ID || "q-c45f4d78-d205-4fa5-a190-e82423ce443d";

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

function pass(id, ok, msg) {
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${msg}`);
  return ok;
}

(async () => {
  console.log(`\n=== Global watermark verify @ ${BASE} ===\n`);

  const state0 = await api("GET", "/api/state");
  const pdf0 = state0.json?.quotePdfSettings?.[0];
  if (!pdf0?.id) {
    console.error("No quotePdfSettings row found");
    process.exit(1);
  }
  const prev = JSON.parse(JSON.stringify(pdf0));

  const patched = {
    ...pdf0,
    globalPdfHeader: {
      ...(pdf0.globalPdfHeader || {}),
      enabled: true,
      text: pdf0.globalPdfHeader?.text || "☀️ SUNCHASER ENERGY SYSTEMS",
      watermark: { imageUrl: WM, opacity: 0.1, position: "center", repeat: "no-repeat" },
    },
    globalWatermark: { imageUrl: WM, opacity: 0.1, position: "center", repeat: "no-repeat" },
  };

  const save = await api("POST", "/api/db/update", {
    action: "edit",
    table: "quotePdfSettings",
    id: pdf0.id,
    data: patched,
  });
  pass("1 save API", save.status === 200, `status=${save.status} ${save.text?.slice(0, 80)}`);

  await new Promise((r) => setTimeout(r, 2500));
  const state1 = await api("GET", "/api/state");
  const pdf1 = state1.json?.quotePdfSettings?.[0];
  const wmUrl = pdf1?.globalWatermark?.imageUrl || pdf1?.globalPdfHeader?.watermark?.imageUrl;
  pass("2 state hydration", !!wmUrl, wmUrl || "empty");

  const pdfHtml = await fetch(`${BASE}/api/export/pdf/manual-quote/${LEAD_ID}?quoteId=${QUOTE_ID}`).then((r) =>
    r.text()
  );
  const layers = (pdfHtml.match(/page-watermark/g) || []).length;
  pass("3 PDF watermark layers", layers >= 5, `${layers} layers`);

  await api("POST", "/api/db/update", {
    action: "edit",
    table: "quotePdfSettings",
    id: pdf0.id,
    data: prev,
  });

  console.log("\nDone.\n");
})();
