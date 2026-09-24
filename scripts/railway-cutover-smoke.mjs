import { resolve4, resolveCname } from "node:dns/promises";
const CRM = "https://crm.sunchaserenergy.co";
const RAILWAY_CRM = "https://sunchaser-crm-private-smoke-production.up.railway.app";
const SITE = "https://www.sunchaserenergy.co";

const checks = [];
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log("PASS", name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name, ok: false, message });
    console.error("FAIL", name, message);
  }
}
async function json(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  return { response, body };
}

const stamp = Date.now();
const username = "railwayverify" + stamp;
const password = "RailwayVerify" + stamp + "X9";
const email = username + "@example.com";
let jwt = "";

for (const host of ["crm.sunchaserenergy.co", "www.sunchaserenergy.co", "sunchaserenergy.co"]) {
  try { console.log("DNS_A", host, JSON.stringify(await resolve4(host))); }
  catch (error) { console.log("DNS_A", host, "ERROR", String(error?.code || error)); }
  try { console.log("DNS_CNAME", host, JSON.stringify(await resolveCname(host))); }
  catch (error) { console.log("DNS_CNAME", host, "NONE", String(error?.code || error)); }
}

await check("Railway CRM health", async () => {
  const response = await fetch(RAILWAY_CRM + "/health");
  if (response.status !== 200) throw new Error("HTTP " + response.status);
});

await check("Custom CRM domain reaches Sunchaser CRM", async () => {
  const { response, body } = await json(CRM + "/health");
  console.log("CUSTOM_CRM_HEALTH", response.status, JSON.stringify(body).slice(0, 240));
  if (response.status !== 200) throw new Error("HTTP " + response.status);
  if (body?.service !== "sunchaser-crm" || body?.status !== "ok") {
    throw new Error("custom domain is not reaching Railway CRM");
  }
});

await check("Marketplace catalogue comes from Railway database", async () => {
  const { response, body } = await json(RAILWAY_CRM + "/api/marketplace/catalogue/products");
  if (response.status !== 200) throw new Error("HTTP " + response.status);
  if (body?.ok !== true) throw new Error("response ok flag missing");
  if (!Array.isArray(body?.data?.items) || body.data.items.length === 0) {
    throw new Error("catalogue is empty");
  }
});

await check("Customer registration provisions CRM customer link", async () => {
  const { response, body } = await json(RAILWAY_CRM + "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      email,
      name: "Railway Migration Verification",
      role: "Customer",
      phone: "+923001234567",
    }),
  });
  if (response.status !== 201) {
    throw new Error("HTTP " + response.status + " " + JSON.stringify(body).slice(0, 240));
  }
  if (!body?.user?.customerId) throw new Error("registration response missing customerId");
});

await check("Customer login returns JWT", async () => {
  const { response, body } = await json(RAILWAY_CRM + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 200) {
    throw new Error("HTTP " + response.status + " " + JSON.stringify(body).slice(0, 240));
  }
  jwt = String(body?.token || body?.jwt || "");
  if (!jwt) throw new Error("JWT missing");
});

await check("Authenticated user retains customerId", async () => {
  const { response, body } = await json(RAILWAY_CRM + "/api/auth/me", {
    headers: { authorization: "Bearer " + jwt },
  });
  if (response.status !== 200) throw new Error("HTTP " + response.status);
  const user = body?.user || body;
  if (user?.role !== "Customer") throw new Error("unexpected role " + user?.role);
  if (!user?.customerId) throw new Error("customerId missing after login");
});

await check("Customer portal loads from Railway database", async () => {
  const { response, body } = await json(RAILWAY_CRM + "/api/customer-portal/me", {
    headers: { authorization: "Bearer " + jwt },
  });
  if (response.status !== 200) {
    throw new Error("HTTP " + response.status + " " + JSON.stringify(body).slice(0, 240));
  }
});

await check("PDF engine launches Chromium", async () => {
  const { response, body } = await json(RAILWAY_CRM + "/api/debug/pdf-engine");
  if (response.status !== 200) {
    throw new Error("HTTP " + response.status + " " + JSON.stringify(body).slice(0, 240));
  }
  if (body?.browserLaunchSuccess === false) throw new Error("browserLaunchSuccess=false");
});

await check("Marketing homepage", async () => {
  const response = await fetch(SITE + "/", { redirect: "follow" });
  console.log("MARKETING_HOME_HEADERS", JSON.stringify({
    status: response.status,
    server: response.headers.get("server"),
    via: response.headers.get("via"),
    railwayRequestId: response.headers.get("x-railway-request-id"),
    vercelId: response.headers.get("x-vercel-id"),
  }));
  if (response.status !== 200) throw new Error("HTTP " + response.status);
});

await check("Marketing shop", async () => {
  const response = await fetch(SITE + "/shop", { redirect: "follow" });
  if (response.status !== 200) throw new Error("HTTP " + response.status);
});

await check("Production robots are not globally blocked", async () => {
  const response = await fetch(SITE + "/robots.txt");
  if (response.status !== 200) throw new Error("HTTP " + response.status);
  const robots = await response.text();
  if (/User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*(?:\n|$)/i.test(robots)) {
    throw new Error("robots.txt still contains global Disallow: /");
  }
});

const passed = checks.filter((item) => item.ok).length;
console.log("RAILWAY_CUTOVER_SMOKE_RESULT", passed + "/" + checks.length);
if (passed !== checks.length) process.exit(1);
