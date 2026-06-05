import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const APP_URL = process.env.PORTAL_APP_URL || "https://sunchaser-energy-systems.onrender.com";
const MARKER = "Customer Portal v2.0 Premium";
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "production-portal-v2-verification.png");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForTimeout(4000);
await page.locator('input[placeholder="username"]').fill("portalclient");
await page.locator('input[type="password"]').first().fill("123");
await page.getByRole("button", { name: /^Sign in$/i }).click();
await page.getByText(MARKER).waitFor({ timeout: 180_000 });
await page.getByRole("navigation", { name: /main navigation/i }).waitFor({ timeout: 60_000 });
await page.screenshot({ path: out });
await browser.close();
console.log("Saved", out);
