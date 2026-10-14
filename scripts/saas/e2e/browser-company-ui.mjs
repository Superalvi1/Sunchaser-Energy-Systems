// Real-browser (Chromium) check of the company-selection screen, "Switch company", and the operator console, against a running
// MULTI_COMPANY_ENABLED server that serves the built SPA. SYNTHETIC data, disposable stack. Screenshots go to OUT_DIR.
//   Env: E2E_BASE_URL, TEST_PW, PLAYWRIGHT_BROWSERS_PATH.  Seed first (seed-two-companies.mjs: both_user works for alpha AND beta, platform_op is an operator).
import fs from "node:fs";
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151", PW = process.env.TEST_PW, OUT = process.env.OUT_DIR || "docs/saas/evidence/screens";
if (!PW || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and a local E2E_BASE_URL."); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 250) : ""}`); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const fresh = async (vp = { width: 1280, height: 900 }) => { const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); page.setDefaultTimeout(20000); return { ctx, page }; };
async function signIn(page, user, pass_ = PW) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("button:visible", { hasText: "Client/Staff Sign In" }).first().click();
  await page.getByPlaceholder("username").fill(user);
  await page.locator('input[type="password"]').first().fill(pass_);
  await page.locator('form button[type="submit"]').first().click();
}
const store = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);
const api = (page, p) => page.evaluate(async (path) => { const t = localStorage.getItem("sunchaser_auth_token"); const r = await fetch(path, { headers: { authorization: `Bearer ${t}` } }); return { status: r.status, body: await r.text() }; }, p);

// 1. a user of two companies
{
  const { ctx, page } = await fresh();
  await signIn(page, "both_user");
  await page.getByTestId("company-select").waitFor();
  const opts = await page.locator('[data-testid^="company-option-"]').allInnerTexts();
  check("two-company user: the company-selection screen appears after sign-in, listing both companies with their roles", opts.length === 2 && opts.some((t) => /Alpha Solar/.test(t) && /Sales Manager/.test(t)) && opts.some((t) => /Beta Energy/.test(t) && /Sales Executive/.test(t)), opts.join(" | "));
  const pre = await api(page, "/api/state");
  check("...and the CRM has NOT loaded behind it: the server answers a refusal and no data until a company is chosen", pre.status >= 400 && !pre.body.includes("\"leads\""), String(pre.status));
  await page.screenshot({ path: `${OUT}/01-company-selection.png` });
  await page.getByTestId("company-option-co_alpha").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="company-select"]'), null, { timeout: 30000 });
  check("choosing Alpha opens the CRM bound to Alpha with the role held there", (await store(page, "sunchaser_company_id")) === "co_alpha" && (await api(page, "/api/state")).status === 200 && JSON.parse((await store(page, "sunchaser_user")) || "{}").role === "Sales Manager");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/02-alpha-crm.png` });
  const alphaState = await api(page, "/api/state");
  // switch to Beta
  await page.goto(BASE + "/select-company", { waitUntil: "domcontentloaded" });
  await page.getByTestId("company-select").waitFor();
  check("'Switch company' (/select-company) lists both companies and marks the current one", (await page.getByTestId("company-option-co_alpha").innerText()).includes("current"));
  await page.screenshot({ path: `${OUT}/03-switch-company.png` });
  await page.getByTestId("company-option-co_beta").click();
  await page.waitForURL(BASE + "/", { timeout: 30000 });
  await page.waitForTimeout(1500);
  const betaState = await api(page, "/api/state");
  check("after switching AND a full page reload (session restore + token renewal), the session is still bound to Beta with Beta's role (not the global role)", (await store(page, "sunchaser_company_id")) === "co_beta" && JSON.parse((await store(page, "sunchaser_user")) || "{}").role === "Sales Executive" && betaState.status === 200 && alphaState.status === 200, JSON.stringify({ c: await store(page, "sunchaser_company_id"), r: JSON.parse((await store(page, "sunchaser_user")) || "{}").role, b: betaState.status }));
  await page.screenshot({ path: `${OUT}/04-beta-crm.png` });
  await ctx.close();
}
// 2. a single-company user goes straight in
{
  const { ctx, page } = await fresh();
  await signIn(page, "alpha_admin");
  await page.waitForFunction(() => !!localStorage.getItem("sunchaser_company_id"), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  check("single-company user: no selection screen, straight into the CRM of the one company", (await page.getByTestId("company-select").count()) === 0 && (await store(page, "sunchaser_company_id")) === "co_alpha" && (await api(page, "/api/state")).status === 200);
  await ctx.close();
}
// 3. a user with no company
{
  const { ctx, page } = await fresh();
  await signIn(page, "nobody");
  await page.getByText(/not active in any company/i).waitFor();
  check("a user who belongs to no company gets a clear message, not a broken CRM", true);
  await page.screenshot({ path: `${OUT}/05-no-company.png` });
  await ctx.close();
}
// 4. the operator console
const stamp = Date.now().toString(36);
{
  const { ctx, page } = await fresh({ width: 1200, height: 900 });
  await signIn(page, "platform_op");
  await page.waitForURL(/\/platform$/, { timeout: 30000 });
  await page.getByTestId("platform-console").waitFor();
  await page.getByTestId("company-row-co_alpha").waitFor();
  check("operator without a company lands on the platform console and sees the company list", (await page.getByTestId("companies-table").innerText()).includes("co_alpha"));
  await page.screenshot({ path: `${OUT}/06-platform-console.png` });
  const name = `Browser Solar ${stamp}`, owner = `br_${stamp}`;
  const form = page.getByTestId("create-company-form");
  await form.getByLabel("Company name").fill(name);
  await form.getByLabel("Administrator name").fill("Browser Owner");
  await form.getByLabel("Administrator username").fill(owner);
  await form.getByLabel("Administrator e-mail").fill(`${owner}@browser.test`);
  // The form will not submit without a storage limit (no unlimited default): try it first, then give one.
  await form.getByRole("button", { name: "Create company" }).click();
  check("the onboarding form will not submit without a storage limit (the field is required)", (await page.getByTestId("temp-password").count()) === 0 && (await form.getByLabel("Storage limit (MB)").evaluate((el) => el.validity.valueMissing)) === true);
  await form.getByLabel("Storage limit (MB)").fill("300");
  await form.getByRole("button", { name: "Create company" }).click();
  await page.getByTestId("temp-password").waitFor();
  const temp = (await page.getByTestId("temp-password-value").innerText()).trim();
  await page.getByTestId("companies-table").getByText(name).waitFor();
  check("onboarding through the form shows the temporary password once and the new company in the list", temp.length >= 14 && (await page.getByTestId("companies-table").innerText()).includes(name));
  await page.screenshot({ path: `${OUT}/07-company-created.png` });
  const row = page.locator(`[data-testid^="company-row-"]`, { hasText: name });
  await row.getByRole("button", { name: "Record payment" }).click();
  const pf = page.getByTestId("payment-form");
  await pf.getByLabel("Amount").fill("15000"); await pf.getByLabel("Reference").fill("TT-BROWSER");
  await pf.getByLabel("Covers until").fill("2027-01-31");
  await pf.getByRole("button", { name: "Save payment" }).click();
  await page.getByText("Payment recorded.").waitFor();
  await row.getByText("15,000").waitFor();
  check("a manual payment recorded in the console shows in the company's paid total and period end", (await row.innerText()).includes("15,000") && (await row.innerText()).includes("2027-01-31"));
  await row.getByRole("button", { name: "Suspend" }).click();
  await page.getByText("Company suspended.").waitFor();
  await row.getByText("suspended").first().waitFor();
  check("suspending from the console shows the status", (await row.innerText()).includes("suspended"));
  await page.screenshot({ path: `${OUT}/08-payment-and-suspend.png` });
  await row.getByRole("button", { name: "Reactivate" }).click();
  await page.getByText("Company active.").waitFor();
  await ctx.close();
  // the new administrator signs in through the browser with the temporary password
  await new Promise((r) => setTimeout(r, 6000));
  const b = await fresh();
  await signIn(b.page, owner, temp);
  await b.page.waitForFunction(() => !!localStorage.getItem("sunchaser_company_id"), null, { timeout: 30000 });
  await b.page.waitForTimeout(1500);
  check("the new company's administrator signs in with the temporary password and opens an empty CRM of their own company", (await store(b.page, "sunchaser_company_id")) === `browser_solar_${stamp}` && (await api(b.page, "/api/state")).status === 200);
  await b.page.screenshot({ path: `${OUT}/09-new-company-crm.png` });
  // a company user cannot open the console even by typing the address
  await b.page.goto(BASE + "/platform", { waitUntil: "domcontentloaded" });
  await b.page.waitForTimeout(1500);
  check("typing /platform as a company user shows no console", (await b.page.getByTestId("platform-console").count()) === 0 && (await api(b.page, "/api/platform/overview")).status === 403);
  await b.ctx.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`); if (fail) console.log("Failed:\n - " + failures.join("\n - ")); process.exitCode = fail ? 1 : 0;
