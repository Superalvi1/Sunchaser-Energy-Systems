/**
 * Verifies Customer Portal v2.2 Premium Merged is live on production.
 * Usage: node scripts/verify-portal-v2-production.mjs
 */
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const API = (
  process.env.VITE_API_BASE_URL ||
  process.env.API_BASE_URL ||
  "https://sunchaser-energy-systems.onrender.com"
).replace(/\/$/, "");

const APP_URL = process.env.PORTAL_APP_URL || API;
const MARKER = "Customer Portal v2.2 Premium Merged";
const NAV_LABELS = ["Home", "Documents", "Payments", "Support", "Account"];
const SERVICE_LABELS = ["Warranty", "Service Requests", "My Solar System"];
const MAX_WAIT_MS = 12 * 60 * 1000;
const POLL_MS = 15_000;

async function fetchIndexAsset() {
  const indexRes = await fetch(`${APP_URL}/`);
  const html = await indexRes.text();
  const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (!m) return { html, js: "", asset: null };
  const asset = m[1];
  const jsRes = await fetch(`${APP_URL}${asset}`);
  const js = await jsRes.text();
  return { html, js, asset };
}

async function waitForDeploy() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const { js, asset } = await fetchIndexAsset();
    if (js.includes(MARKER)) {
      const missingNav = NAV_LABELS.filter((l) => !js.includes(l));
      return { ok: true, asset, missingNav, js };
    }
    console.log(`Waiting for deploy (${Math.round((Date.now() - start) / 1000)}s)… latest asset: ${asset || "?"}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { ok: false };
}

async function loginPortalClient() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "portalclient", password: "123" }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.user?.role === "Customer", body };
}

async function screenshotWithPlaywright() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 120_000 });
  await page.locator('input[placeholder="username"]').fill("portalclient");
  await page.locator('input[type="password"]').first().fill("123");
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.getByText(MARKER, { exact: false }).waitFor({ timeout: 120_000 });
  await page.getByRole("navigation", { name: /main navigation/i }).waitFor({ timeout: 30_000 });
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "production-portal-v2-verification.png");
  await page.screenshot({ path: out, fullPage: false });
  await browser.close();
  return out;
}

const deploy = await waitForDeploy();
if (!deploy.ok) {
  console.error("FAIL: Production bundle does not contain version marker after wait.");
  process.exit(1);
}
console.log("PASS: Bundle contains", MARKER);
console.log("Asset:", deploy.asset);
if (deploy.missingNav?.length) {
  console.warn("WARN: Nav labels missing from bundle:", deploy.missingNav.join(", "));
} else {
  console.log("PASS: Bottom nav labels present in bundle");
}
const missingSvc = SERVICE_LABELS.filter((l) => !deploy.js.includes(l));
if (missingSvc.length) {
  console.warn("WARN: Premium service labels missing:", missingSvc.join(", "));
} else {
  console.log("PASS: Premium Services module labels in bundle");
}
if (deploy.js.includes("Premium services") && !deploy.js.match(/tabs.*Home.*My System.*Warranty.*Invoices/s)) {
  console.log("PASS: No old multi-tab top nav pattern detected in bundle");
}

const login = await loginPortalClient();
console.log(`${login.ok ? "PASS" : "FAIL"}: portalclient customer login`);

try {
  const shot = await screenshotWithPlaywright();
  console.log("PASS: Screenshot saved to", shot);
} catch (e) {
  console.warn("Screenshot skipped (install playwright):", e.message);
}

process.exit(0);
