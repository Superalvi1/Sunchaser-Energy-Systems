/**
 * Verify quotation settings persistence + PDF renderer on production.
 * Usage: API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-quotation-settings-production.mjs
 */
const BASE = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
const MARKER = `PDF-VERIFY-${Date.now()}`;
const TABLES = [
  "quoteTemplates",
  "quoteTemplatePages",
  "bankAccounts",
  "companyTerms",
  "ceoMessages",
  "structureDescriptions",
  "quotePdfSettings",
  "socialLinks",
];

const results = [];

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${detail}`);
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

async function main() {
  console.log(`\n=== Quotation settings verify @ ${BASE} ===\n`);

  const diag = await api("GET", "/api/diagnostics/quotation-settings");
  if (diag.status === 200 && diag.json?.supabaseActive) {
    const missing = Object.entries(diag.json.tables || {}).filter(([, v]) => !v.ok);
    record(
      "SCHEMA 8 TABLES",
      missing.length === 0,
      missing.length === 0
        ? `all ok; counts=${JSON.stringify(diag.json.tables)}`
        : `missing: ${missing.map(([k, v]) => `${k}:${v.error}`).join(", ")}`
    );
    record(
      "STATE FROM SUPABASE",
      !!diag.json.stateSample && !diag.json.stateSample.error,
      JSON.stringify(diag.json.stateSample)
    );
  } else {
    const state0 = await api("GET", "/api/state");
    record("PREFLIGHT /api/state", state0.status === 200, `status=${state0.status}`);
    for (const key of TABLES) {
      const arr = state0.json?.[key];
      record(`TABLE DATA ${key}`, Array.isArray(arr), `rows=${Array.isArray(arr) ? arr.length : "n/a"}`);
    }
  }

  const state = await api("GET", "/api/state");
  const pdf0 = state.json?.quotePdfSettings?.[0] || {
    id: "settings-1",
    companyName: "SUNCHASER ENERGY SYSTEMS",
    officeAddress: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
    hotlinePhones: "0309-0236666, 0330-7776444",
    billingEmail: "billing@sunchaser-energy.com",
    websiteUrl: "www.sunchaser-energy.com",
    logoUrl: "",
  };

  const patched = {
    ...pdf0,
    companyName: MARKER,
    officeAddress: `${MARKER} Office Address`,
    hotlinePhones: "0999-VERIFY-LINE",
    logoUrl: "/assets/sunchaser-logo.png",
    globalPdfHeader: {
      enabled: true,
      text: `${MARKER} Header`,
      logoUrl: "/assets/sunchaser-logo.png",
      logoSize: "25px",
      lineColor: "#f59e0b",
      alignment: "left",
    },
    globalPdfFooter: {
      enabled: true,
      text: `${MARKER} Footer`,
      lineColor: "#cbd5e1",
      alignment: "left",
    },
  };

  const save = await api("POST", "/api/db/update", {
    action: "edit",
    table: "quotePdfSettings",
    id: patched.id,
    data: patched,
  });
  record("SAVE quotePdfSettings", save.status === 200, `status=${save.status}`);

  await new Promise((r) => setTimeout(r, 1200));

  const state1 = await api("GET", "/api/state");
  const pdf1 = state1.json?.quotePdfSettings?.[0];
  record(
    "PERSIST companyName",
    pdf1?.companyName === MARKER,
    `got=${pdf1?.companyName || "null"}`
  );

  const preview = await fetch(`${BASE}/api/export/pdf/template-preview/tmpl-1`);
  const html = await preview.text();
  record("PDF companyName", html.includes(MARKER), html.includes(MARKER) ? "found in HTML" : "not in HTML");
  record("PDF officeAddress", html.includes(`${MARKER} Office Address`), html.includes(`${MARKER} Office Address`) ? "found" : "not found");
  record("PDF footer", html.includes(`${MARKER} Footer`), html.includes(`${MARKER} Footer`) ? "found" : "not found");
  record("PDF logo path", html.includes("/assets/sunchaser-logo.png"), html.includes("/assets/sunchaser-logo.png") ? "found" : "not found");

  const ceo = state1.json?.ceoMessages?.[0];
  const ceoName = ceo?.name;
  const ceoMessageSnippet = ceo?.message ? String(ceo.message).slice(0, 40) : "";
  if (ceoName) {
    record("CEO in state", true, ceoName);
    const ceoInPdf =
      (ceoMessageSnippet && html.includes(ceoMessageSnippet)) ||
      (html.includes(ceoName) && !html.includes(`${ceoName} (Preview)`));
    record(
      "PDF CEO content",
      ceoInPdf,
      ceoInPdf ? "message or designation found" : "not in PDF"
    );
  }

  const activeBanks = (state1.json?.bankAccounts || []).filter((b) => b.isActive !== false);
  const bankName =
    activeBanks[0]?.bankName || activeBanks[0]?.bank_name || null;
  if (bankName) {
    record("BANK in state", true, bankName);
    record("PDF bank name", html.includes(bankName), html.includes(bankName) ? "found" : "not in PDF");
  }

  // Restore original branding
  await api("POST", "/api/db/update", {
    action: "edit",
    table: "quotePdfSettings",
    id: pdf0.id,
    data: pdf0,
  });

  console.log("\n=== SUMMARY ===");
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} passed`);
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
