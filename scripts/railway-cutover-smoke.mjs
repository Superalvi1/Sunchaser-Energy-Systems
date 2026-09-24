const CRM = "https://sunchaser-crm-private-smoke-production.up.railway.app";
const CRM_CUSTOM = "https://crm.sunchaserenergy.co";
const WEB = "https://www.sunchaserenergy.co";
const stamp = Date.now();
const username = `railway-cutover-${stamp}`;
const email = `railway-cutover-${stamp}@test.invalid`;
const password = `RailwayCutover${String(stamp).slice(-6)}!Aa`;
let token = "";
let productSlug = "";
let passed = 0;
let failed = 0;

function result(ok, name, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
  if (ok) passed += 1; else failed += 1;
}
async function request(url, init = {}) {
  const res = await fetch(url, { redirect: "follow", ...init });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { res, text, json };
}

try {
  let x = await request(`${CRM}/health`);
  result(x.res.status === 200, "CRM Railway health", `HTTP ${x.res.status}`);

  x = await request(`${CRM_CUSTOM}/health`);
  result(x.res.status === 200, "CRM custom domain health", `HTTP ${x.res.status}`);

  x = await request(`${CRM}/api/marketplace/catalogue/publication`);
  const source = x.json?.data?.effectivePublicCatalogueSource ?? x.json?.data?.catalogueSource;
  result(x.res.status === 200 && x.json?.ok === true && source === "database", "Catalogue publication source", `HTTP ${x.res.status}, source=${source}`);

  x = await request(`${CRM}/api/marketplace/catalogue/products`);
  const items = x.json?.data?.items;
  productSlug = Array.isArray(items) && items.length ? String(items[0]?.slug || "") : "";
  result(x.res.status === 200 && x.json?.ok === true && Array.isArray(items) && items.length > 0 && !!productSlug, "Live Railway catalogue", `HTTP ${x.res.status}, items=${Array.isArray(items) ? items.length : 0}, first=${productSlug || "n/a"}`);

  x = await request(`${CRM}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, email, password, name: "Railway Cutover Test", role: "Customer" }),
  });
  result(x.res.status === 201, "Synthetic customer registration", `HTTP ${x.res.status}`);

  x = await request(`${CRM}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  token = typeof x.json?.token === "string" ? x.json.token : "";
  result(x.res.status === 200 && !!token, "Synthetic customer login", `HTTP ${x.res.status}, token=${token ? "captured" : "missing"}`);

  // The same just-created Railway-only account must also authenticate through
  // the custom CRM domain. This proves the custom domain is reaching Railway's
  // migrated data plane rather than the old Render/Supabase backend.
  x = await request(`${CRM_CUSTOM}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  result(x.res.status === 200 && typeof x.json?.token === "string", "CRM custom domain uses Railway data", `HTTP ${x.res.status}`);

  // Customer access to the staff-only PDF diagnostic must remain denied.
  // Chromium launch itself is checked by the opt-in deployment startup gate.
  x = await request(`${CRM}/api/debug/pdf-engine`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  result(x.res.status === 403, "PDF diagnostic authorization guard", `HTTP ${x.res.status}`);

  x = await request(`${WEB}/`);
  result(x.res.status === 200, "Marketing root", `HTTP ${x.res.status}`);

  x = await request(`${WEB}/shop`);
  result(x.res.status === 200, "Marketing shop", `HTTP ${x.res.status}`);

  x = await request(`${WEB}/robots.txt`);
  const lines = x.text.replace(/\r/g, "").split("\n").map((v) => v.trim());
  let inWildcard = false;
  let globalBlock = false;
  for (const line of lines) {
    if (/^User-agent:/i.test(line)) {
      inWildcard = /^User-agent:\s*\*$/i.test(line);
      continue;
    }
    if (inWildcard && /^Disallow:\s*\/\s*$/i.test(line)) globalBlock = true;
  }
  result(x.res.status === 200 && !globalBlock, "Production robots indexing", `HTTP ${x.res.status}, globalBlock=${globalBlock}`);

  x = await request(`${WEB}/sitemap.xml`);
  result(x.res.status === 200, "Marketing sitemap", `HTTP ${x.res.status}`);

  const leadBody = {
    name: "Railway Cutover Test",
    phone: "+923001234567",
    city: "Lahore",
    customerType: "residential",
    monthlyBill: 25000,
    backupRequirement: "partial",
    roofType: "rcc",
    systemPreference: "10 kW class (test)",
    source: "marketing_ai_assistant",
    consent: true,
    website: "",
    pagePath: "/railway-cutover-test",
  };
  x = await request(`${WEB}/api/ai-lead`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `railway-ai-${stamp}` },
    body: JSON.stringify(leadBody),
  });
  const leadId = x.json?.leadId ?? x.json?.id;
  result((x.res.status === 200 || x.res.status === 201) && x.json?.ok === true && typeof leadId === "string", "Marketing AI lead -> Railway CRM", `HTTP ${x.res.status}, leadId=${leadId || "n/a"}`);

  if (!productSlug) {
    result(false, "Marketing quote request -> Railway CRM", "no product slug");
  } else {
    const quoteBody = {
      name: "Railway Quote Test",
      email: `quote-${stamp}@test.invalid`,
      phone: "+923001234567",
      city: "Lahore",
      pagePath: "/shop",
      items: [{ slug: productSlug, quantity: 1 }],
    };
    x = await request(`${WEB}/api/quote-request`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `railway-quote-${stamp}` },
      body: JSON.stringify(quoteBody),
    });
    result((x.res.status === 200 || x.res.status === 201) && x.json?.ok === true, "Marketing quote request -> Railway CRM", `HTTP ${x.res.status}, leadId=${x.json?.leadId || "n/a"}`);
  }
} catch (err) {
  result(false, "Fatal smoke error", err instanceof Error ? err.message : String(err));
}

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
