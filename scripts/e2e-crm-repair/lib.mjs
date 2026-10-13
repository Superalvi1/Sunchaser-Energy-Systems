// Shared helpers for the isolated CRM repair journeys. See README.md for the required stack.
import { chromium, devices } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

export const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3100";
export const STATE = process.env.E2E_STATE_DIR || "/tmp/sunchaser-e2e";
export const SHOTS = `${STATE}/shots`;
fs.mkdirSync(SHOTS, { recursive: true });
const PSQL = (process.env.E2E_PSQL || "-h /srv/sc-pg -p 55432 -U postgres -d sunchaser_test").split(" ");
export const sql = (q) => execFileSync("psql", [...PSQL, "-tAc", q]).toString().trim();

/** Every browser request outside the local test server is aborted, so a misconfigured build cannot reach production. */
export async function launch() {
  const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const ctx = await newContext(options);
    await ctx.route((url) => !["127.0.0.1", "localhost"].includes(url.hostname) && !url.protocol.startsWith("data") && !url.protocol.startsWith("blob"), (route) => route.abort("blockedbyclient"));
    return ctx;
  };
  browser.newPage = async (options) => (await browser.newContext(options)).newPage();
  return browser;
}
export const mobile = devices["Pixel 7"];
export const PW = process.env.TEST_PW;
export const results = [];
export function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}
export function save(file) {
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
export async function staffLogin(page, username) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  // The sign-in form may already be showing (e.g. after a session was rejected).
  if (!(await page.getByPlaceholder("username").isVisible().catch(() => false))) {
    // Desktop shows a text button; the phone layout shows an "Account" icon button.
    await page.getByRole("button", { name: /^(Client\/Staff Sign In|Account)$/ }).filter({ visible: true }).first().click();
  }
  await page.getByPlaceholder("username").fill(username);
  await page.locator("input[type=password]").fill(PW);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForFunction(() => localStorage.getItem("sunchaser_auth_token"), null, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}
export async function apiLogin(username) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  return (await r.json()).token;
}
export const randomPhone = (prefix = "0303") => prefix + String(Math.floor(1000000 + Math.random() * 8999999));
export const canonical = (phone) => "92" + phone.slice(1);
